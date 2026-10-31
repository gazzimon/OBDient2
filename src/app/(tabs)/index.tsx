// Inicio: the assistant (ADR-0007, M3), chat about the car with the car's own
// data. The app opens here, on the start screen (decision 2026-10-31).
//
// Every turn runs on the phone: the model asks for readings, the app reads
// the adapter and answers back. Without an account the start screen still
// shows: the phrases the app answers by itself work, and the rest ask to sign in.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import type { ChatItem } from '@/domain/assistant/conversation';
import { SEE_ON_MAP, suggest } from '@/domain/assistant/suggestions';
import { capabilities, startHere, type StarterState } from '@/domain/assistant/starters';
import { container } from '@/data/container';
import { ChatBubble } from '@/presentation/components/assistant/ChatBubble';
import { ErrorRow } from '@/presentation/components/assistant/ErrorRow';
import { SourcesRow } from '@/presentation/components/assistant/SourcesRow';
import { PlacesCard } from '@/presentation/components/assistant/PlacesCard';
import { ToolRow, toolLabel } from '@/presentation/components/assistant/ToolRow';
import { WaitingAscii } from '@/presentation/components/assistant/WaitingAscii';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { StartScreen } from '@/presentation/components/assistant/StartScreen';
import { useAccount } from '@/presentation/hooks/useAccount';
import { useAssistant } from '@/presentation/hooks/useAssistant';
import { useVoiceInput, voiceInputAvailable } from '@/presentation/hooks/useVoiceInput';
import { pickPhoto, type Photo, type PhotoSource } from '@/presentation/services/photo';
import { COLORS } from '@/presentation/theme';
import { useChatStore } from '@/store/chatStore';
import { useNavStore } from '@/store/navStore';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ensurePermission } from '@/presentation/services/permissions';
import { shareConversation } from '@/presentation/services/share-conversation';

// Above this OBD speed the chat is only the microphone (Modo manejo).
const MOVING_KMH = 8;

// Each photo costs ~1.5k tokens of the 32k context.
const MAX_PHOTOS = 2;

// The fixed fourth button: the destination is typed by the driver.
const GO_TO = 'Llevame a ';

export default function AssistantScreen() {
  const { status } = useAccount();
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const runningId = useChatStore((s) => s.runningId);
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const { send, sendNotes, discardNotes, continueInNew, stop, running } = useAssistant();
  const notes = conversation?.notes?.length ?? 0;
  const [text, setText] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const list = useRef<FlatList<ChatItem>>(null);
  const input = useRef<TextInput>(null);
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const navigating = useNavStore((s) => s.status === 'navigating');
  // Without the adapter there is no speed: the chat stays as it is.
  const moving = useOBDStore((s) => (s.parameters.SPEED?.value ?? 0) > MOVING_KMH);

  const items = conversation?.items ?? [];
  // Only the newest map card draws a live map.
  // Thinking, nothing written yet (or running a tool): the waiting animation.
  const lastItem = items[items.length - 1];
  const waiting = runningId != null && runningId === conversation?.id && !(lastItem?.kind === 'assistant' && lastItem.text.trim());
  const busyWith = lastItem?.kind === 'tool' && lastItem.status === 'running' ? toolLabel(lastItem.name) : null;
  const lastPlacesId = [...items].reverse().find((i) => i.kind === 'tool' && i.places?.length)?.id ?? null;
  const streamingId = runningId != null && runningId === conversation?.id ? items[items.length - 1]?.id : null;

  // Follow the conversation as it grows and as the answer streams in.
  const last = items[items.length - 1];
  useEffect(() => {
    if (last) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [last]);

  // Next questions, drawn again after each answer (and when the context changes).
  const lastId = last?.id;
  // Next questions: online, the model's for this answer (they arrive a moment
  // after it); offline, fixed phrases the app answers by itself. The empty
  // chat shows a few examples.
  const next = conversation?.next;
  const lastTools = useMemo(() => {
    const lastUser = items.reduce((at, it, i) => (it.kind === 'user' ? i : at), -1);
    return items.slice(lastUser + 1).flatMap((it) => (it.kind === 'tool' ? [{ name: it.name, detail: it.detail }] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);
  const suggestions = useMemo(() => {
    if (!online || items.length === 0) {
      const lastUser = items.reduce((at, it, i) => (it.kind === 'user' ? i : at), -1);
      const lastQuestion = lastUser >= 0 ? (items[lastUser] as { text: string }).text : null;
      return suggest({ lastTools, connected, online, navigating, lastQuestion });
    }
    return next && next.afterId === lastId ? [...next.questions] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, next, connected, online, navigating, lastTools]);
  // The fixed button: the map right after a destination was shown, otherwise "Ir a…".
  const destinationShown = lastTools.some((t) => t.name === 'set_destination');
  const showSuggestions = status === 'signed-in' && !running && last?.kind !== 'user' && text === '' && photos.length === 0;

  // The start screen: what is going on with the car, and what can be asked now.
  const signedIn = status === 'signed-in';
  const audience = useSettingsStore((s) => s.audience);
  const startCtx = useMemo(() => {
    const vin = container.vehicleTools.knownVin();
    const lastRead = container.faults.list(vin ?? undefined).find((e) => e.type === 'codes' && e.kind === 'stored');
    return {
      connected,
      online,
      signedIn,
      navigating,
      parked: container.parking.latest() != null,
      lastCodes: lastRead?.type === 'codes' && lastRead.codes.length ? lastRead.codes.map((c) => c.code) : null,
    };
    // A conversation that ended (items) may have read codes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, online, signedIn, navigating, items.length]);
  const ask = (t: string, state: Exclude<StarterState, 'unavailable'>) => (state === 'sign-in' ? setSignInOpen(true) : submit(t));

  // A suggestion is sent as a message, except "Ver en el mapa".
  const pick = (t: string) => (t === SEE_ON_MAP ? router.navigate('/mapa') : submit(t));

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

  // Voice (M6): what is heard shows in the box; the final text is sent.
  const mic = useVoiceInput((heard) => submit(heard, []));
  const listening = mic.state !== 'idle';

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
        <Text className="text-brand-text font-mono text-sm flex-1 mr-3" numberOfLines={1}>
          {conversation?.title ?? 'Asistente'}
        </Text>
        <View className="flex-row items-center gap-4">
          {!connected && <Text className="text-brand-amber font-mono text-[10px]">sin adaptador</Text>}
          <Pressable onPress={() => setListOpen(true)} hitSlop={8} accessibilityLabel="Conversaciones" className="active:opacity-60">
            <MaterialCommunityIcons name="history" size={22} color={COLORS.mint} />
          </Pressable>
          <Pressable onPress={newConversation} hitSlop={8} disabled={running} className="active:opacity-60">
            <MaterialCommunityIcons name="plus-circle-outline" size={22} color={running ? COLORS.border : COLORS.mint} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {items.length === 0 ? (
          <StartScreen
            start={startHere(startCtx)}
            capabilities={capabilities(audience, startCtx)}
            signedIn={signedIn}
            onAsk={ask}
            onDrive={() => router.push('/drive')}
            onSignIn={() => setSignInOpen(true)}
          />
        ) : (
          <FlatList
            ref={list}
            className="flex-1 px-4"
            contentContainerStyle={{ paddingVertical: 12 }}
            data={items as ChatItem[]}
            // With the position: conversations saved before 2026-10-19 repeat ids.
            keyExtractor={(i, index) => `${index}:${i.id}`}
            ListFooterComponent={waiting ? <WaitingAscii key={runningId ?? 'w'} label={busyWith} /> : showSuggestions && !moving ? <Suggestions items={suggestions} onPick={pick} onGoTo={goTo} mapFirst={destinationShown} /> : null}
            renderItem={({ item }) => {
              switch (item.kind) {
                case 'user':
                  return <ChatBubble role="user" text={item.text} at={item.at} photos={item.photos} />;
                case 'assistant':
                  return (
                    <ChatBubble role="assistant" text={item.text} at={item.at} cancelled={item.cancelled} streaming={item.id === streamingId} />
                  );
                case 'tool':
                  return (
                    <>
                      <ToolRow name={item.name} status={item.status} detail={item.detail} />
                      {item.sources?.length ? <SourcesRow sources={item.sources} /> : null}
                      {item.places?.length ? <PlacesCard id={item.id} pins={item.places} live={item.id === lastPlacesId} /> : null}
                    </>
                  );
                case 'error': {
                  const retry = item.retryText;
                  return (
                    <ErrorRow
                      text={item.text}
                      onRetry={retry && !running ? () => submit(retry) : undefined}
                      onContinue={item.action === 'continue_new' && !running ? () => void continueInNew(retry) : undefined}
                    />
                  );
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
        {status === 'signed-in' && moving && (
          <DrivingMic
            listening={listening}
            partial={mic.partial}
            running={running}
            onStop={running ? stop : mic.stop}
            onTalk={() => void ensurePermission('microphone').then((ok) => (ok ? mic.start() : undefined))}
          />
        )}
        {!signedIn && items.length > 0 && (
          <Pressable onPress={() => setSignInOpen(true)} className="flex-row items-center gap-2 px-4 py-3 border-t border-brand-border active:opacity-60">
            <MaterialCommunityIcons name="account-outline" size={18} color={COLORS.mint} />
            <Text className="text-brand-mint font-mono text-xs">Entrá con tu correo para conversar con el asistente</Text>
          </Pressable>
        )}
        {status === 'signed-in' && !moving && (
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
            ) : !canSend && voiceInputAvailable ? (
              <Pressable
                onPress={() => void ensurePermission('microphone').then((ok) => (ok ? mic.start() : undefined))}
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
      <SignInSheet visible={signInOpen && !signedIn} onClose={() => setSignInOpen(false)} />
    </SafeAreaView>
  );
}

// Moving: no keyboard, no buttons to read — one big microphone (or stop).
function DrivingMic({
  listening,
  partial,
  running,
  onTalk,
  onStop,
}: {
  listening: boolean;
  partial: string;
  running: boolean;
  onTalk: () => void;
  onStop: () => void;
}) {
  const busy = listening || running;
  return (
    <View className="items-center px-4 pt-3 pb-5 border-t border-brand-border">
      <Text className="text-brand-muted font-mono text-xs mb-3 text-center" numberOfLines={2}>
        {listening ? partial || 'Escuchando…' : running ? 'Respondiendo…' : 'En movimiento: tocá y hablá'}
      </Text>
      <Pressable
        onPress={busy ? onStop : onTalk}
        disabled={!busy && !voiceInputAvailable}
        accessibilityLabel={listening ? 'Terminar de hablar' : running ? 'Detener' : 'Hablar'}
        className="w-20 h-20 rounded-full items-center justify-center active:opacity-60"
        style={{ backgroundColor: busy ? COLORS.red : COLORS.mint }}
      >
        <MaterialCommunityIcons name={running ? 'stop' : 'microphone'} size={40} color={busy ? COLORS.text : COLORS.bg} />
      </Pressable>
    </View>
  );
}

// Up to three suggested questions and the fixed "Ir a…" button.
function Suggestions({
  items,
  onPick,
  onGoTo,
  mapFirst,
}: {
  items: readonly string[];
  onPick: (t: string) => void;
  onGoTo: () => void;
  mapFirst: boolean;
}) {
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
      {mapFirst ? (
        // The destination is on the map already: one big, obvious way there.
        <Pressable
          onPress={() => router.navigate('/mapa')}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-2 rounded-2xl h-12 mb-2 active:opacity-70"
          style={{ backgroundColor: COLORS.mint }}
        >
          <MaterialCommunityIcons name="map-outline" size={20} color={COLORS.bg} />
          <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
            {SEE_ON_MAP}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onGoTo}
          className="flex-row items-center gap-2 bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 mb-2 active:opacity-60"
        >
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={COLORS.mint} />
          <Text className="text-brand-mint font-mono text-xs">Ir a una dirección…</Text>
        </Pressable>
      )}
    </View>
  );
}

// The account, asked for when a question needs the model.
function SignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} />
      <View className="bg-brand-surface rounded-t-3xl px-6 pt-5 pb-8">
        <Text className="text-brand-text font-mono-bold text-base">Entrá para usar el asistente</Text>
        <Text className="text-brand-muted font-mono text-xs leading-5 mt-2 mb-5">
          El asistente lee tu auto con el adaptador y te explica lo que encuentra. Entrás con un código que te llega por
          correo. La navegación y el resto de la app funcionan sin cuenta.
        </Text>
        <EmailSignIn />
      </View>
    </Modal>
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
                accessibilityLabel="Compartir la conversación"
                onPress={() => void shareConversation(item).catch(() => Alert.alert('No se pudo compartir la conversación.'))}
                className="pl-3 active:opacity-60"
              >
                <MaterialCommunityIcons name="share-variant-outline" size={18} color={COLORS.muted} />
              </Pressable>
              <Pressable
                hitSlop={8}
                disabled={running}
                onPress={() => useChatStore.getState().remove(item.id)}
                className="pl-4 active:opacity-60"
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
