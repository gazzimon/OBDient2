// The bar on top of a pushed screen: back, the title, and an optional action.

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';

export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-brand-border">
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Volver" className="mr-3 active:opacity-60">
        <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
      </Pressable>
      <Text className="text-brand-text font-mono-bold text-base flex-1" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}
