import React from 'react';
import { View, Text } from 'react-native';
import type { ConnectionState } from '@/store/obdStore';

interface ConnectionStatusProps {
  state: ConnectionState;
  deviceName?: string | null;
}

const CONFIG: Record<ConnectionState, { dot: string; label: string; text: string }> = {
  connected:    { dot: 'bg-brand-teal',  label: 'Conectado',    text: 'text-brand-teal' },
  connecting:   { dot: 'bg-brand-amber', label: 'Conectando…', text: 'text-brand-amber' },
  disconnected: { dot: 'bg-brand-muted', label: 'Desconectado', text: 'text-brand-muted' },
};

export function ConnectionStatus({ state, deviceName }: ConnectionStatusProps) {
  const { dot, label, text } = CONFIG[state];

  return (
    <View className="flex-row items-center gap-2">
      <View className={`w-2 h-2 rounded-full ${dot}`} />
      <Text className={`font-mono text-xs ${text}`}>
        {state === 'connected' && deviceName ? deviceName : label}
      </Text>
    </View>
  );
}
