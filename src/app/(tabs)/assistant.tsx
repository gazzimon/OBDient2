// The assistant (ADR-0007, M3): chat about the car, with the car's own data.
//
// Every turn runs on the phone: the model asks for readings, the app reads
// the adapter and answers back. Without an account the tab explains how to
// get one; everything else in the app works without it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import type { ChatItem } from '@/domain/assistant/conversation';
import { SEE_ON_MAP, suggest } from '@/domain/assistant/suggestions';
import { ChatBubble } from '@/presentation/components/assistant/ChatBubble';
import { ErrorRow } from '@/presentation/components/assistant/ErrorRow';
import { ToolRow } from '@/presentation/components/assistant/ToolRow';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { useAccount } from '@/presentation/hooks/useAccount';
import { useAssistant } from '@/presentation/hooks/useAssistant';
import { useVoiceInput } from '@/presentation/hooks/useVoiceInput';
import { pickPhoto, type Photo, type PhotoSource } from '@/presentation/services/photo';
import { COLORS } from '@/presentation/theme';
import { useChatStore } from '@/store/chatStore';
import { useNavStore } from '@/store/navStore';
import { useOBDStore } from '@/store/obdStore';

// Each photo costs ~1.5k tokens of the 16k context.
const MAX_PHOTOS = 2;

// The fixed fourth button: the destination is typed by the driver.
const GO_TO = 'Llevame a ';

export default function AssistantScreen() {
  const { status } = useAccount();
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const runningId = useChatStore((s) => s.runningId);
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const { send, sendNotes, discardNotes, stop, running } = useAssistant();
  const notes = conversation?.notes?.length ?? 0;
  const [text, setText] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const list = useRef<FlatList<ChatItem>>(null);
  const input = useRef<TextInput>(null);
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const navigating = useNavStore((s) => s.status === 'navigating');

  const items = conversation?.items ?? [];
  const streamingId = runningId != null && runningId === conversation?.id ? items[items.length - 1]?.id : null;

  // Follow the conversation as it grows and as the answer streams in.
  const last = items[items.length - 1];
  useEffect(() => {
    if (last) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [last]);

  // Next questions, drawn again after each answer (and when the context changes).
  const lastId = last?.id;
  const suggestions = useMemo(() => {
    const lastUser = items.reduce((at, it, i) => (it.kind === 'user' ? i : at), -1);
    const lastTools = items.slice(lastUser + 1).flatMap((it) => (it.kind === 'tool' ? [{ name: it.name, detail: it.detail }] : []));
    const lastQuestion = lastUser >= 0 ? (items[lastUser] as { text: string }).text : null;
    return suggest({ lastTools, connected, online, navigating, lastQuestion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, connected, online, navigating]);
  const showSuggestions = status === 'signed-in' && !running && last?.kind !== 'user' && text === '' && photos.length === 0;

  // Voice (M6): what is heard shows in the box; the final text is sent.
  const mic = useVoiceInput((heard) => submit(heard, []));
  const listening = mic.state === 'listening';

  // A suggestion is sent as a message, except "Ver en el mapa".
  const pick = (t: string) => (t === SEE_ON_MAP ? router.navigate('/') : submit(t));

  const goTo = () => {
    setText(GO_TO);
    setTimeout(() => input.current?.focus(), 50);
  };

  // A photo alone gets a default question.
  const submit = (value = text, attached: Photo[] = photos) => {
    if (running || (!value.trim() && attached.length === 0)) return;
    setText('');
    setPhotos([]);
    void send(value.trim() || '¿Qué ves en la foto?', attached.map((p) => p.dataUrl));
  };

  const attach = async (source: PhotoSource) => {
    try {
      const photo = await pickPhoto(source);
      if (photo) setPhotos((list) => [...list, photo].slice(-MAX_PHOTOS));
    } catch {
      Alert.alert('Foto', 'No se pudo preparar la foto.');
    }
  };
  const choosePhoto = () =>
    Alert.alert('Adjuntar foto', 'Por ejemplo, un testigo del tablero o una etiqueta.', [
      { text: 'Cámara', onPress: () => void attach('camera') },
      { text: 'Galería', onPress: () => void attach('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  const canSend = text.trim() !== '' || photos.length > 0;

  const newConversation = () => {
    if (running) return;
    useChatStore.getState().open('');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-brand-border">
        <Pressable onPress={() => setListOpen(true)} hitSlop={8} className="flex-row items-center gap-2 flex-1 active:opacity-60">
          <MaterialCommunityIcons name="forum-outline" size={18} color={COLORS.muted} />
          <Text className="text-brand-text font-mono text-sm flex-1" numberOfLines={1}>
            {conversation?.title ?? 'Asistente'}
          </Text>
        </Pressable>
        <View className="flex-row items-center gap-4">
          {!connected && <Text className="text-brand-amber font-mono text-[10px]">sin adaptador</Text>}
          <Pressable onPress={newConversation} hitSlop={8} disabled={running} className="active:opacity-60">
            <MaterialCommunityIcons name="plus-circle-outline" size={22} color={running ? COLORS.border : COLORS.mint} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {status !== 'signed-in' ? (
          <View className="flex-1 justify-center px-6">
            <MaterialCommunityIcons name="account-lock-outline" size={36} color={COLORS.mint} style={{ alignSelf: 'center' }} />
            <Text className="text-brand-text font-mono-bold text-base text-center mt-3">Entrá para usar el asistente</Text>
            <Text className="text-brand-muted font-mono text-xs leading-5 text-center mt-2 mb-6">
              El asistente lee tu auto con el adaptador y te explica lo que encuentra. Necesita tu cuenta: entrás con un
              código que te llega por correo. La navegación y el resto de la app funcionan sin cuenta.
            </Text>
            <EmailSignIn />
          </View>
        ) : items.length === 0 ? (
          <View className="flex-1 justify-center px-6">
            <Text className="text-brand-text font-mono-bold text-base text-center">Preguntale a tu auto</Text>
            <Text className="text-brand-muted font-mono text-xs leading-5 text-center mt-2 mb-5">
              {connected
                ? 'Lee códigos, freeze frame, monitores y valores en vivo. Para borrar códigos te pide confirmación.'
                : 'Conectá el adaptador en la pestaña Vehículo para que pueda leer el auto.'}
            </Text>
            <Suggestions items={suggestions} onPick={pick} onGoTo={goTo} />
          </View>
        ) : (
          <FlatList
            ref={list}
            className="flex-1 px-4"
            contentContainerStyle={{ paddingVertical: 12 }}
            data={items as ChatItem[]}
            // With the position: conversations saved before 2026-10-19 repeat ids.
            keyExtractor={(i, index) => `${index}:${i.id}`}
            ListFooterComponent={showSuggestions ? <Suggestions items={suggestions} onPick={pick} onGoTo={goTo} /> : null}
            renderItem={({ item }) => {
              switch (item.kind) {
                case 'user':
                  return <ChatBubble role="user" text={item.text} at={item.at} photos={item.photos} />;
                case 'assistant':
                  return (
                    <ChatBubble role="assistant" text={item.text} at={item.at} cancelled={item.cancelled} streaming={item.id === streamingId} />
                  );
                case 'tool':
                  return <ToolRow name={item.name} status={item.status} detail={item.detail} />;
                case 'error': {
                  const retry = item.retryText;
                  return <ErrorRow text={item.text} onRetry={retry && !running ? () => submit(retry) : undefined} />;
                }
              }
            }}
          />
        )}

        {status === 'signed-in' && notes > 0 && !running && (
          <View className="px-4 py-3 border-t border-brand-border bg-brand-surface">
            <View className="flex-row items-center gap-2">
              <MaterialCommunityIcons name="note-text-outline" size={18} color={COLORS.amber} />
              <Text className="text-brand-text font-mono text-xs flex-1">
                {notes === 1 ? '1 nota sin enviar' : `${notes} notas sin enviar`}
              </Text>
            </View>
            <View className="flex-row gap-2 mt-2">
              <Pressable
                onPress={() => void sendNotes()}
                className="flex-1 h-10 rounded-full items-center justify-center active:opacity-60"
                style={{ backgroundColor: COLORS.mint }}
              >
                <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
                  Pasar al asistente
                </Text>
              </Pressable>
              <Pressable onPress={discardNotes} className="h-10 px-5 rounded-full items-center justify-center border border-brand-border active:opacity-60">
                <Text className="text-brand-muted font-mono text-xs">Descartar</Text>
              </Pressable>
            </View>
          </View>
        )}
        {status === 'signed-in' && photos.length > 0 && (
          <View className="flex-row gap-2 px-4 pt-3">
            {photos.map((p) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 10 }} />
                <Pressable
                  onPress={() => setPhotos((list) => list.filter((x) => x.uri !== p.uri))}
                  hitSlop={8}
                  className="absolute -top-2 -right-2 bg-brand-surface rounded-full"
                >
                  <MaterialCommunityIcons name="close-circle" size={18} color={COLORS.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {status === 'signed-in' && mic.error && (
          <Pressable onPress={mic.clearError} className="px-4 pt-2">
            <Text className="text-brand-amber font-mono text-[11px] leading-4">{mic.error}</Text>
          </Pressable>
        )}
        {status === 'signed-in' && (
          <View className="flex-row items-end gap-2 px-4 py-3 border-t border-brand-border">
            <Pressable onPress={choosePhoto} disabled={running} hitSlop={8} className="w-9 h-11 items-center justify-center active:opacity-60">
              <MaterialCommunityIcons name="camera-outline" size={22} color={running ? COLORS.border : COLORS.muted} />
            </Pressable>
            <TextInput
              ref={input}
              value={listening ? mic.partial : text}
              onChangeText={setText}
              editable={!listening}
              placeholder={listening ? 'Escuchando…' : 'Escribí o tocá el micrófono…'}
              placeholderTextColor={COLORS.muted}
              multiline
              className="flex-1 bg-brand-surface rounded-2xl px-4 py-3 text-brand-text font-mono text-sm max-h-32"
            />
            {running ? (
              <Pressable onPress={stop} hitSlop={8} className="w-11 h-11 rounded-full items-center justify-center bg-brand-surface active:opacity-60">
                <MaterialCommunityIcons name="stop" size={22} color={COLORS.red} />
              </Pressable>
            ) : listening ? (
              <Pressable
                onPress={mic.stop}
                hitSlop={8}
                accessibilityLabel="Terminar de hablar"
                className="w-11 h-11 rounded-full items-center justify-center active:opacity-60"
                style={{ backgroundColor: COLORS.red }}
              >
                <MaterialCommunityIcons name="microphone" size={22} color={COLORS.text} />
              </Pressable>
            ) : !canSend ? (
              <Pressable
                onPress={() => void mic.start()}
                hitSlop={8}
                accessibilityLabel="Hablar"
                className="w-11 h-11 rounded-full items-center justify-center active:opacity-60"
                style={{ backgroundColor: COLORS.mint }}
              >
                <MaterialCommunityIcons name="microphone-outline" size={22} color={COLORS.bg} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => submit()}
                disabled={!canSend}
                hitSlop={8}
                className="w-11 h-11 rounded-full items-center justify-center active:opacity-60"
                style={{ backgroundColor: canSend ? COLORS.mint : COLORS.surface }}
              >
                <MaterialCommunityIcons name="send" size={20} color={canSend ? COLORS.bg : COLORS.muted} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <ConversationList visible={listOpen} onClose={() => setListOpen(false)} />
    </SafeAreaView>
  );
}

// Up to three suggested questions and the fixed "Ir a…" button.
function Suggestions({ items, onPick, onGoTo }: { items: readonly string[]; onPick: (t: string) => void; onGoTo: () => void }) {
  return (
    <View>
      {items.map((e) => (
        <Pressable
          key={e}
          onPress={() => onPick(e)}
          className="bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 mb-2 active:opacity-60"
        >
          <Text className="text-brand-text font-mono text-xs">{e}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={onGoTo}
        className="flex-row items-center gap-2 bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 mb-2 active:opacity-60"
      >
        <MaterialCommunityIcons name="map-marker-outline" size={16} color={COLORS.mint} />
        <Text className="text-brand-mint font-mono text-xs">Ir a una dirección…</Text>
      </Pressable>
    </View>
  );
}

function ConversationList({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const running = useChatStore((s) => s.runningId != null);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} />
      <View className="bg-brand-surface rounded-t-3xl px-4 pt-4 pb-8 max-h-[70%]">
        <Text className="text-brand-text font-mono-bold text-sm mb-3">Conversaciones</Text>
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          ListEmptyComponent={<Text className="text-brand-muted font-mono text-xs">Todavía no hay conversaciones.</Text>}
          renderItem={({ item }) => (
            <View className="flex-row items-center border-b border-brand-border py-3">
              <Pressable
                className="flex-1 active:opacity-60"
                disabled={running}
                onPress={() => {
                  useChatStore.getState().open(item.id);
                  onClose();
                }}
              >
                <Text className={`font-mono text-sm ${item.id === activeId ? 'text-brand-teal' : 'text-brand-text'}`} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-brand-muted font-mono text-[10px]">{new Date(item.updatedAt).toLocaleString()}</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                disabled={running}
                onPress={() => useChatStore.getState().remove(item.id)}
                className="pl-3 active:opacity-60"
              >
                <MaterialCommunityIcons name="trash-can-outline" size={18} color={COLORS.muted} />
              </Pressable>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}
