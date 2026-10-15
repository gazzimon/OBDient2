import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { AlertSeverity } from '@/core/constants/pids';

interface AlertBannerProps {
  severity: AlertSeverity;
  message: string;
  onDismiss: () => void;
}

// QVAC style: dark surface with colored outline, never a filled background
const CONFIG: Record<AlertSeverity, { container: string; text: string; label: string }> = {
  critical: {
    container: 'bg-brand-surface border border-brand-red',
    text:      'text-brand-red',
    label:     'CRÍTICO',
  },
  warning: {
    container: 'bg-brand-surface border border-brand-amber',
    text:      'text-brand-amber',
    label:     'AVISO',
  },
};

export function AlertBanner({ severity, message, onDismiss }: AlertBannerProps) {
  const { container, text, label } = CONFIG[severity];

  return (
    <View className={`mx-4 mb-3 px-4 py-3 rounded-2xl flex-row items-start justify-between ${container}`}>
      <View className="flex-1 mr-3">
        <Text className={`font-mono-bold text-xs mb-1 ${text}`}>
          {label}
        </Text>
        <Text className="text-brand-text font-mono text-sm leading-5">{message}</Text>
      </View>
      <Pressable onPress={onDismiss} className="mt-0.5 active:opacity-60" hitSlop={8}>
        <Text className={`font-mono text-lg leading-none ${text}`}>✕</Text>
      </Pressable>
    </View>
  );
}
