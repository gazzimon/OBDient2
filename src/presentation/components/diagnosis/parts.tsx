// Pieces shared by Diagnóstico's screens: the verdict on top of a summary (B),
// a row of a list (C), the reading state, and the actions at the bottom.

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Tone } from '@/domain/diagnosis/views';
import { COLORS } from '@/presentation/theme';

export const TONE_COLOR: Record<Tone, string> = { ok: COLORS.mint, warn: COLORS.amber, bad: COLORS.red };

export function VerdictCard({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  return (
    <View className="bg-brand-surface rounded-2xl p-4 mb-4 border" style={{ borderColor: TONE_COLOR[tone] }}>
      <Text className="font-mono-bold text-sm" style={{ color: TONE_COLOR[tone] }}>
        {title}
      </Text>
      <Text className="text-brand-text font-mono text-xs leading-5 mt-2">{detail}</Text>
    </View>
  );
}

export function StatusRow({
  tone,
  title,
  detail,
  right,
  onPress,
}: {
  tone: Tone | 'off';
  title: string;
  detail?: string | null;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: tone === 'off' ? COLORS.border : TONE_COLOR[tone] }} />
      <View className="flex-1">
        <Text className="text-brand-text font-mono text-sm">{title}</Text>
        {detail ? <Text className="text-brand-muted font-mono text-[11px] leading-4 mt-0.5">{detail}</Text> : null}
      </View>
      {right}
      {onPress && <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 bg-brand-surface rounded-2xl px-4 py-3 mb-2 active:opacity-60">
      {body}
    </Pressable>
  ) : (
    <View className="flex-row items-center gap-3 bg-brand-surface rounded-2xl px-4 py-3 mb-2">{body}</View>
  );
}

// Reading, or why it could not.
export function ReadState({ loading, error, label = 'Leyendo el auto…' }: { loading: boolean; error: string | null; label?: string }) {
  if (loading) {
    return (
      <View className="flex-row items-center gap-3 py-4">
        <ActivityIndicator color={COLORS.mint} />
        <Text className="text-brand-muted font-mono text-xs">{label}</Text>
      </View>
    );
  }
  return error ? <Text className="text-brand-amber font-mono text-xs leading-5 mb-4">{error}</Text> : null;
}

export function Actions({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2 mt-4">{children}</View>;
}

export function ActionChip({ label, icon, onPress, disabled }: { label: string; icon?: keyof typeof MaterialCommunityIcons.glyphMap; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center gap-2 border border-brand-border rounded-full px-4 py-2 active:opacity-60"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      {icon && <MaterialCommunityIcons name={icon} size={16} color={COLORS.mint} />}
      <Text className="text-brand-text font-mono text-xs">{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-brand-border">
      <Text className="text-brand-muted font-mono text-xs">{label}</Text>
      <Text selectable className="text-brand-text font-mono text-xs flex-1 text-right ml-4" numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}
