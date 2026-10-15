// QVAC signature pattern: section title with a thin mint underline.

import React from 'react';
import { View, Text } from 'react-native';

interface SectionHeaderProps {
  title: string;
  // Optional element rendered at the right edge (e.g. a "+" action)
  right?: React.ReactNode;
}

export function SectionHeader({ title, right }: SectionHeaderProps) {
  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-brand-text font-mono text-lg">{title}</Text>
        {right}
      </View>
      <View className="h-px bg-brand-teal opacity-60" />
    </View>
  );
}
