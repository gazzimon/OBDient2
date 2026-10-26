// The pages the assistant read, as buttons under its tool row: tapping one opens
// it in the browser, so the driver can check what the answer rests on.

import { Linking, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SourceLink } from '@/domain/assistant/tools';
import { COLORS } from '@/presentation/theme';

const MAX_SHOWN = 4;

export function SourcesRow({ sources }: { sources: readonly SourceLink[] }) {
  if (sources.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2 mb-3 px-1" style={{ marginTop: -4 }}>
      {sources.slice(0, MAX_SHOWN).map((s) => (
        <Pressable
          key={s.url}
          accessibilityRole="link"
          accessibilityLabel={`Abrir ${s.title ?? s.site}`}
          onPress={() => void Linking.openURL(s.url).catch(() => undefined)}
          className="flex-row items-center rounded-full border border-brand-border bg-brand-surface px-3 h-8 active:opacity-60"
        >
          <MaterialCommunityIcons name="open-in-new" size={12} color={COLORS.mint} />
          <Text className="text-brand-teal font-mono text-[10px] ml-1.5" numberOfLines={1} style={{ maxWidth: 170 }}>
            {s.site}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
