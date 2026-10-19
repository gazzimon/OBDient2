// First start, after the safety notice: the three essential permissions with
// their reason, asked one after another. The microphone waits until it is used.
// "Ahora no" is always possible: each feature asks again when it needs it.

import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ESSENTIAL, PERMISSIONS } from '@/domain/permissions/permissions';
import { askEssentials, finishIntro, refreshPermissions, usePermissionStore } from '@/presentation/services/permissions';
import { COLORS } from '@/presentation/theme';
import { useSettingsStore } from '@/store/settingsStore';

export function PermissionsIntro() {
  const disclaimerAccepted = useSettingsStore((s) => s.disclaimerAccepted);
  const introSeen = usePermissionStore((s) => s.introSeen);
  const statuses = usePermissionStore((s) => s.statuses);
  const [busy, setBusy] = useState(false);
  const visible = disclaimerAccepted && !introSeen;

  useEffect(() => {
    if (visible) void refreshPermissions();
  }, [visible]);
  // Already granted (e.g. an update): nothing to explain.
  useEffect(() => {
    if (visible && ESSENTIAL.every((k) => statuses[k] === 'granted')) finishIntro();
  }, [visible, statuses]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={finishIntro}>
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <Text className="text-brand-text font-mono-bold text-base text-center mb-1">Antes de empezar</Text>
          <Text className="text-brand-muted font-mono text-xs text-center mb-5">OBDient necesita estos permisos:</Text>
          {ESSENTIAL.map((k) => (
            <View key={k} className="flex-row gap-3 mb-4">
              <MaterialCommunityIcons
                name={(statuses[k] === 'granted' ? 'check-circle' : PERMISSIONS[k].icon) as never}
                size={22}
                color={COLORS.mint}
              />
              <View className="flex-1">
                <Text className="text-brand-text font-mono-bold text-xs">{PERMISSIONS[k].title}</Text>
                <Text className="text-brand-muted font-mono text-[11px] leading-4">{PERMISSIONS[k].why}</Text>
              </View>
            </View>
          ))}
          <Text className="text-brand-muted font-mono text-[11px] leading-4 mb-5">
            El micrófono te lo pido cuando lo uses. Todo se puede cambiar después en Ajustes → Permisos.
          </Text>
          <Pressable
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void askEssentials(ESSENTIAL).finally(() => setBusy(false));
            }}
            className="bg-brand-pill rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
              Permitir
            </Text>
          </Pressable>
          <Pressable onPress={finishIntro} className="py-3 items-center active:opacity-60 mt-1">
            <Text className="text-brand-muted font-mono text-xs">Ahora no</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
