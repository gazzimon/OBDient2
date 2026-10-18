// A tool the assistant ran (or wanted to): what it did, and how it went.
// Shown between the messages so the user sees the car being read.

import { ActivityIndicator, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ToolStatus } from '@/domain/assistant/conversation';
import { COLORS } from '@/presentation/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TOOLS: Record<string, { label: string; icon: IconName }> = {
  read_pids: { label: 'Leyendo valores en vivo', icon: 'gauge' },
  sample_pids: { label: 'Midiendo durante unos segundos', icon: 'chart-line' },
  read_dtcs: { label: 'Leyendo códigos de falla', icon: 'engine-outline' },
  read_freeze_frame: { label: 'Leyendo el freeze frame', icon: 'camera-timer' },
  read_readiness: { label: 'Leyendo monitores de emisiones', icon: 'clipboard-check-outline' },
  read_vehicle_info: { label: 'Leyendo VIN y PIDs soportados', icon: 'card-account-details-outline' },
  read_adapter_info: { label: 'Datos del adaptador', icon: 'bluetooth-connect' },
  run_adapter_bench: { label: 'Probando el adaptador', icon: 'speedometer' },
  clear_dtcs: { label: 'Borrando códigos', icon: 'delete-sweep-outline' },
  read_fault_history: { label: 'Leyendo el historial de fallas', icon: 'history' },
  calculate: { label: 'Calculando', icon: 'calculator-variant-outline' },
};

const STATUS: Record<Exclude<ToolStatus, 'running'>, { icon: IconName; color: string }> = {
  ok: { icon: 'check-circle-outline', color: COLORS.mint },
  failed: { icon: 'alert-circle-outline', color: COLORS.amber },
  refused: { icon: 'cancel', color: COLORS.muted },
};

export function ToolRow({ name, status, detail }: { name: string; status: ToolStatus; detail: string | null }) {
  const tool = TOOLS[name] ?? { label: name, icon: 'wrench-outline' as IconName };
  return (
    <View className="flex-row items-start gap-2 mb-3 px-1">
      <MaterialCommunityIcons name={tool.icon} size={16} color={COLORS.muted} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-brand-muted font-mono text-xs">{tool.label}</Text>
        {detail ? (
          <Text className="text-brand-muted font-mono text-[10px] leading-4" numberOfLines={3}>
            {detail}
          </Text>
        ) : null}
      </View>
      {status === 'running' ? (
        <ActivityIndicator size="small" color={COLORS.mint} />
      ) : (
        <MaterialCommunityIcons name={STATUS[status].icon} size={16} color={STATUS[status].color} />
      )}
    </View>
  );
}
