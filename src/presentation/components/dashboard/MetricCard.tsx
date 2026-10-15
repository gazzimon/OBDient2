// QVAC-style metric card: icon + label top, big bold value, status line in mint.

import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ObdParameter } from '@/domain/entities/obd-parameter';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface MetricCardProps {
  icon: IconName;
  label: string;
  param: ObdParameter | undefined;
}

export function MetricCard({ icon, label, param }: MetricCardProps) {
  const statusText =
    param == null ? null :
    param.alert == null ? 'En rango' :
    param.alert.severity === 'critical' ? 'Crítico' : 'Aviso';

  const statusClass =
    param?.alert == null ? 'text-brand-teal' :
    param.alert.severity === 'critical' ? 'text-brand-red' : 'text-brand-amber';

  return (
    <View className="bg-brand-surface rounded-2xl p-4 flex-1">
      <View className="flex-row items-center gap-2 mb-3">
        <MaterialCommunityIcons name={icon} size={14} color="#9A9A9A" />
        <Text className="text-brand-muted font-mono text-xs" numberOfLines={1}>
          {label}
        </Text>
      </View>

      <Text className="text-brand-text font-mono-bold text-2xl">
        {param == null ? '--' : `${param.value}`}
        {param != null && (
          <Text className="text-brand-muted font-mono text-sm"> {param.unit}</Text>
        )}
      </Text>

      {statusText != null && (
        <Text className={`font-mono text-xs mt-1 ${statusClass}`}>{statusText}</Text>
      )}
    </View>
  );
}
