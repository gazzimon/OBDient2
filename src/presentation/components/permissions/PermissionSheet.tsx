// The explanation before a permission, shown by ensurePermission() when a
// feature needs it. If Android no longer asks, it shows where to turn it on and
// opens Settings; on return, the feature continues by itself.

import { Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PERMISSIONS, SETTINGS_PATH } from '@/domain/permissions/permissions';
import { allowFromSheet, dismissSheet, usePermissionStore } from '@/presentation/services/permissions';
import { COLORS } from '@/presentation/theme';

export function PermissionSheet() {
  const sheet = usePermissionStore((s) => s.sheet);
  if (!sheet) return null;
  const info = PERMISSIONS[sheet.kind];
  const blocked = sheet.status === 'blocked';

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={dismissSheet}>
      <Pressable className="flex-1 bg-black/60" onPress={dismissSheet} />
      <View className="bg-brand-surface border-t border-brand-border rounded-t-3xl px-6 pt-6 pb-10">
        <View className="flex-row items-center gap-3 mb-3">
          <MaterialCommunityIcons name={info.icon as never} size={28} color={blocked ? COLORS.amber : COLORS.mint} />
          <Text className="text-brand-text font-mono-bold text-base flex-1">{info.title}</Text>
        </View>
        <Text className="text-brand-text font-mono text-sm leading-5 mb-2">{info.why}</Text>

        {blocked ? (
          <View className="bg-brand-bg rounded-xl p-4 mb-4 border border-brand-border">
            {sheet.stillOff && (
              <Text className="text-brand-amber font-mono text-xs mb-2">Todavía está desactivado.</Text>
            )}
            <Text className="text-brand-muted font-mono text-xs leading-5">
              Android ya no lo pregunta. Activalo en {SETTINGS_PATH} → {info.settingsName}. Al volver, sigo solo.
            </Text>
          </View>
        ) : (
          sheet.status === 'denied' && (
            <Text className="text-brand-muted font-mono text-xs leading-5 mb-4">
              Lo rechazaste antes. Si tocás Permitir, Android te lo vuelve a preguntar.
            </Text>
          )
        )}
        <Text className="text-brand-muted font-mono text-[11px] leading-4 mb-5">{info.without}</Text>

        <Pressable onPress={() => void allowFromSheet()} className="bg-brand-pill rounded-xl py-3 items-center active:opacity-70">
          <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
            {blocked ? 'Abrir Ajustes' : 'Permitir'}
          </Text>
        </Pressable>
        <Pressable onPress={dismissSheet} className="py-3 items-center active:opacity-60 mt-1">
          <Text className="text-brand-muted font-mono text-xs">Ahora no</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
