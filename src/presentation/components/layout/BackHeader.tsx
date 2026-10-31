// The top bar of a pushed screen: back arrow, title, and an optional action.

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';

export function BackHeader({ title, right }: { title: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-3 px-4 py-3 border-b border-brand-border">
      <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Volver" className="active:opacity-60">
        <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
      </Pressable>
      <Text className="text-brand-text font-mono-bold text-base flex-1" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}
