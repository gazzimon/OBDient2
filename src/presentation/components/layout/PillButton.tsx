// QVAC button styles: primary = light pill with dark text,
// secondary = outlined white, destructive = outlined red.

import React from 'react';
import { Pressable, Text, ActivityIndicator } from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
}

const CONTAINER: Record<Variant, string> = {
  primary:     'bg-brand-pill',
  secondary:   'border border-brand-text',
  destructive: 'border border-brand-red',
};

const LABEL: Record<Variant, string> = {
  primary:     'text-brand-bg',
  secondary:   'text-brand-text',
  destructive: 'text-brand-red',
};

export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: PillButtonProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      className={`rounded-full py-3 px-6 items-center justify-center flex-row gap-2 active:opacity-70 ${CONTAINER[variant]} ${inactive ? 'opacity-40' : ''}`}
    >
      {loading && (
        <ActivityIndicator size="small" color={variant === 'primary' ? '#0D0D0D' : '#F5F5F5'} />
      )}
      <Text className={`font-mono text-sm ${LABEL[variant]}`}>{label}</Text>
    </Pressable>
  );
}
