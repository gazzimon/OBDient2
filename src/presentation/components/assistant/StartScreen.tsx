// The assistant's start screen: "Para empezar" from the car's state, then the
// six things the assistant can do, each opening into questions to tap. What
// the moment cannot serve stays visible, dimmed, with the reason.

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CapabilityId, CapabilityView, StartItem, StarterState } from '@/domain/assistant/starters';
import { COLORS } from '@/presentation/theme';

const ICON: Record<CapabilityId, keyof typeof MaterialCommunityIcons.glyphMap> = {
  faults: 'alert-outline',
  live: 'pulse',
  modules: 'view-grid-outline',
  trip: 'map-marker-outline',
  service: 'wrench-outline',
  info: 'magnify',
};

type Pickable = Exclude<StarterState, 'unavailable'>;

export function StartScreen({
  start,
  capabilities,
  signedIn,
  onAsk,
  onDrive,
  onSignIn,
}: {
  start: readonly StartItem[];
  capabilities: readonly CapabilityView[];
  signedIn: boolean;
  onAsk: (text: string, state: Pickable) => void;
  onDrive: () => void;
  onSignIn: () => void;
}) {
  const [open, setOpen] = useState<CapabilityId | null>(null);
  return (
    <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }} keyboardShouldPersistTaps="handled">
      <Text className="text-brand-text font-mono-bold text-base">Preguntale a tu auto</Text>
      <Text className="text-brand-muted font-mono text-xs leading-5 mt-1 mb-4">Tocá una pregunta o escribí la tuya.</Text>

      {start.length > 0 && (
        <>
          <Text className="text-brand-muted font-mono text-[10px] mb-2">PARA EMPEZAR</Text>
          <View className="flex-row flex-wrap gap-2 mb-5">
            {start.map((s) =>
              s.kind === 'drive' ? (
                <Pressable key={s.text} onPress={onDrive} className="flex-row items-center gap-2 rounded-full px-4 py-2 active:opacity-70" style={{ backgroundColor: COLORS.mint }}>
                  <MaterialCommunityIcons name="steering" size={16} color={COLORS.bg} />
                  <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
                    {s.text}
                  </Text>
                </Pressable>
              ) : (
                <Chip key={s.text} text={s.text} state={s.state} onPress={() => onAsk(s.text, s.state)} />
              ),
            )}
          </View>
        </>
      )}

      <Text className="text-brand-muted font-mono text-[10px] mb-2">QUÉ PUEDO HACER</Text>
      <View className="gap-2">
        {capabilities.map((v) => {
          const id = v.capability.id;
          const expanded = open === id && v.reason == null;
          return (
            <View key={id} className="bg-brand-surface rounded-2xl overflow-hidden" style={{ opacity: v.reason ? 0.45 : 1 }}>
              <Pressable
                onPress={() => setOpen(expanded ? null : id)}
                disabled={v.reason != null}
                accessibilityRole="button"
                accessibilityState={{ expanded, disabled: v.reason != null }}
                className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
              >
                <MaterialCommunityIcons name={ICON[id]} size={18} color={COLORS.mint} />
                <Text className="text-brand-text font-mono text-sm flex-1">{v.capability.title}</Text>
                {v.reason ? (
                  <Text className="text-brand-muted font-mono text-[10px]">{v.reason}</Text>
                ) : (
                  <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
                )}
              </Pressable>
              {expanded && (
                <View className="flex-row flex-wrap gap-2 px-4 pb-4">
                  {v.questions.map((q) => (
                    <Chip key={q.text} text={q.text} state={q.state} onPress={() => onAsk(q.text, q.state)} />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {!signedIn && (
        <Pressable onPress={onSignIn} className="mt-5 flex-row items-center gap-2 border border-brand-border rounded-2xl px-4 py-3 active:opacity-60">
          <MaterialCommunityIcons name="account-outline" size={18} color={COLORS.mint} />
          <Text className="text-brand-text font-mono text-xs flex-1 leading-5">
            Sin cuenta, la app contesta lo básico del auto. Entrá con tu correo para conversar con el asistente.
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

// A question; one that needs the account shows a lock and asks to sign in.
function Chip({ text, state, onPress }: { text: string; state: Pickable; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-1 border border-brand-border rounded-full px-3 py-2 active:opacity-60">
      {state === 'sign-in' && <MaterialCommunityIcons name="lock-outline" size={12} color={COLORS.muted} />}
      <Text className="text-brand-text font-mono text-xs">{text}</Text>
    </Pressable>
  );
}
