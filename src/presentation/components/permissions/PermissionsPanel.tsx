// Settings → Permisos: each permission with its state and the one action that
// fixes it (ask, or open Android's Settings when it no longer asks).

import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionStatus } from '@/domain/permissions/permissions';
import { refreshPermissions, requestFromPanel, usePermissionStore } from '@/presentation/services/permissions';
import { COLORS } from '@/presentation/theme';

const LABEL: Record<PermissionStatus, string> = {
  granted: 'Permitido',
  not_asked: 'Sin pedir',
  denied: 'Rechazado',
  blocked: 'Bloqueado',
};

export function PermissionsPanel() {
  const statuses = usePermissionStore((s) => s.statuses);
  useEffect(() => {
    void refreshPermissions();
  }, []);

  return (
    <View className="mb-6">
      {ALL_PERMISSIONS.map((k) => {
        const status = statuses[k];
        const ok = status === 'granted';
        return (
          <View key={k} className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-2">
            <MaterialCommunityIcons name={PERMISSIONS[k].icon as never} size={18} color={ok ? COLORS.mint : COLORS.amber} />
            <View className="ml-3 flex-1">
              <Text className="text-brand-text font-mono text-sm">{PERMISSIONS[k].title}</Text>
              <Text className="text-brand-muted font-mono text-[10px] leading-4">
                {ok ? PERMISSIONS[k].why : PERMISSIONS[k].without}
              </Text>
            </View>
            {ok ? (
              <Text className="text-brand-mint font-mono text-[11px]">{LABEL.granted}</Text>
            ) : (
              <Pressable onPress={() => void requestFromPanel(k)} hitSlop={8} className="active:opacity-60 items-end">
                <Text className="text-brand-amber font-mono text-[10px]">{status ? LABEL[status] : '…'}</Text>
                <Text className="text-brand-mint font-mono-bold text-xs">{status === 'blocked' ? 'Abrir Ajustes' : 'Permitir'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
