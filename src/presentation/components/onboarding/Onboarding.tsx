// First run, in four steps (2026-10-29): welcome and safety, the account, the
// adapter, ready. It replaces the three stacked windows (notice, permissions,
// account) that did not say how many were left and did not end where the app
// starts being useful: with the car connected.
//
// Every step but the first can be skipped. Location and camera are offered at
// the end, next to what still works without them; the microphone waits until
// it is used. Ajustes → "Ver de nuevo la introducción" brings it back.

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PERMISSIONS, type PermissionKind } from '@/domain/permissions/permissions';
import { carLabel } from '@/domain/vehicle/car-brief';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { AdapterList, NotFoundHelp } from '@/presentation/components/obd/AdapterList';
import { useAccount } from '@/presentation/hooks/useAccount';
import { useAdapterScan } from '@/presentation/hooks/useAdapterScan';
import { finishIntro, refreshPermissions, requestFromPanel, usePermissionStore } from '@/presentation/services/permissions';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

const STEPS = 4;
const LOADED_AT = Date.now();
// Offered at the end; Bluetooth is asked when the adapter is looked for.
const LATER_PERMISSIONS: readonly PermissionKind[] = ['location', 'camera'];

export function Onboarding() {
  const done = useSettingsStore((s) => s.onboardingDone);
  // Mounted fresh each time it is shown, so it starts from the first step.
  return done ? null : <Steps />;
}

function Steps() {
  // Seen the notice already (Ajustes → see it again): straight to the account.
  const [step, setStep] = useState(() => (useSettingsStore.getState().disclaimerAccepted ? 1 : 0));
  // Magic's code screen is drawn under any Modal: step aside while it is up.
  const signingIn = useAccount().busy;
  const next = () => setStep((s) => Math.min(s + 1, STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <Modal
      visible={!signingIn}
      animationType="fade"
      statusBarTranslucent
      // Back goes one step back; on the first step it does nothing until the notice is accepted.
      onRequestClose={() => (step > 0 ? back() : undefined)}
    >
      <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between px-5 pt-3 pb-2 h-12">
          {step > 0 ? (
            <Pressable onPress={back} hitSlop={10} accessibilityLabel="Paso anterior" className="active:opacity-60">
              <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
            </Pressable>
          ) : (
            <View style={{ width: 22 }} />
          )}
          <View className="flex-row gap-2" accessibilityLabel={`Paso ${step + 1} de ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View
                key={i}
                style={{ width: i === step ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i <= step ? COLORS.mint : COLORS.border }}
              />
            ))}
          </View>
          <Text className="text-brand-muted font-mono text-[10px]" style={{ width: 22, textAlign: 'right' }}>
            {step + 1}/{STEPS}
          </Text>
        </View>
        {step === 0 && <Welcome onNext={next} />}
        {step === 1 && <Account onNext={next} />}
        {step === 2 && <Adapter onNext={next} />}
        {step === 3 && <Ready />}
      </SafeAreaView>
    </Modal>
  );
}

function Page({ icon, title, lead, children, footer }: { icon: string; title: string; lead: string; children?: ReactNode; footer: ReactNode }) {
  return (
    <>
      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingTop: 24, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <MaterialCommunityIcons name={icon as never} size={36} color={COLORS.mint} />
        <Text className="text-brand-text font-mono-bold text-xl mt-4 mb-2">{title}</Text>
        <Text className="text-brand-muted font-mono text-sm leading-6 mb-6">{lead}</Text>
        {children}
      </ScrollView>
      <View className="px-6 pb-3 pt-2 gap-1">{footer}</View>
    </>
  );
}

function Skip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="py-3 items-center active:opacity-60">
      <Text className="text-brand-muted font-mono text-sm">{label}</Text>
    </Pressable>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  const accept = useSettingsStore((s) => s.setDisclaimerAccepted);
  return (
    <Page
      icon="car-connected"
      title="Bienvenido a OBDient"
      lead="Leé tu auto por el adaptador, preguntale al asistente qué le pasa y navegá con la ruta dibujada sobre la calle."
      footer={
        <PillButton
          label="Entendido, empezar"
          onPress={() => {
            accept(true);
            onNext();
          }}
        />
      }
    >
      <View className="bg-brand-surface border border-brand-border rounded-2xl p-4 gap-3">
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons name="alert-outline" size={18} color={COLORS.amber} />
          <Text className="text-brand-text font-mono-bold text-sm">Asistencia, no piloto automático</Text>
        </View>
        <Text className="text-brand-muted font-mono text-xs leading-5">
          La ruta sobre la cámara es una ayuda y puede estar desalineada: el tránsito, las señales y tu vista siempre
          mandan. Montá el teléfono en un soporte fijo que no tape tu visión y no lo toques mientras manejás.
        </Text>
        <Text className="text-brand-muted font-mono text-xs leading-5">
          El asistente puede equivocarse y no reemplaza a un mecánico: verificá antes de reparar o de decidir si el auto
          puede andar.
        </Text>
      </View>
    </Page>
  );
}

function Account({ onNext }: { onNext: () => void }) {
  const { status, profile } = useAccount();
  const dismiss = useSettingsStore((s) => s.setAccountPromptDismissed);
  if (status === 'signed-in' && profile) {
    return (
      <Page icon="account-check-outline" title="Ya entraste" lead={`Estás con ${profile.email}. El asistente está listo.`} footer={<PillButton label="Seguir" onPress={onNext} />}>
        <Hint text="La cuenta se ve siempre arriba a la derecha. Tocándola cerrás sesión o entrás con otra." />
      </Page>
    );
  }
  return (
    <Page
      icon="account-circle-outline"
      title="Tu cuenta"
      lead="Con tu cuenta usás el asistente. Te mandamos un código por correo; en un teléfono nuevo también te pedimos aprobarlo."
      footer={
        <Skip
          label="Ahora no"
          onPress={() => {
            dismiss(true);
            onNext();
          }}
        />
      }
    >
      <EmailSignIn />
      <Hint text="Sin cuenta, la navegación y el adaptador funcionan igual. Entrás cuando quieras desde la barra de arriba." />
    </Page>
  );
}

function Adapter({ onNext }: { onNext: () => void }) {
  const { connectionState, deviceName, vin, error } = useOBDStore();
  const { devices, scanning, nothingFound, scanError, scan, connect } = useAdapterScan();

  if (connectionState === 'connected') {
    const car = vin === undefined ? 'leyendo el auto…' : (carLabel(vin, LOADED_AT) ?? 'auto sin VIN');
    return (
      <Page icon="check-circle-outline" title="Conectado" lead={`${deviceName ?? 'El adaptador'} · ${car}`} footer={<PillButton label="Seguir" onPress={onNext} />}>
        <Hint text="Queda recordado: la app lo vuelve a buscar sola cada vez que la abrís, cuando volvés a ella y si se corta." />
        <Hint text="El adaptador y el auto se ven siempre arriba a la izquierda." />
      </Page>
    );
  }

  return (
    <Page
      icon="bluetooth-connect"
      title="Conectá tu OBDient"
      lead="Con el adaptador la app lee el auto: códigos, sensores, diagnóstico e informes."
      footer={<Skip label="Lo hago después" onPress={onNext} />}
    >
      <View className="gap-3 mb-5">
        <HowTo n={1} text="Enchufalo en el conector OBD: suele estar bajo el volante, a la izquierda." />
        <HowTo n={2} text="Dá contacto (o arrancá el motor). La luz del adaptador se prende." />
        <HowTo n={3} text="Tocá Buscar y elegilo de la lista. No hace falta emparejarlo en Android." />
      </View>
      {connectionState === 'connecting' ? (
        <View className="flex-row items-center gap-3 py-3">
          <ActivityIndicator color={COLORS.mint} />
          <Text className="text-brand-text font-mono text-sm">Conectando con {deviceName ?? 'el adaptador'}…</Text>
        </View>
      ) : (
        <PillButton label={scanning ? 'Buscando…' : 'Buscar'} onPress={() => void scan()} loading={scanning} />
      )}
      {(error ?? scanError) && <Text className="text-brand-red font-mono text-xs mt-3">{error ?? scanError}</Text>}
      {nothingFound && <NotFoundHelp />}
      <AdapterList devices={devices} onPick={(d) => void connect(d)} />
    </Page>
  );
}

function Ready() {
  const router = useRouter();
  const finish = useSettingsStore((s) => s.setOnboardingDone);
  const { status } = useAccount();
  const { connectionState, deviceName } = useOBDStore();
  const statuses = usePermissionStore((s) => s.statuses);

  useEffect(() => {
    void refreshPermissions();
  }, []);

  const close = (to?: Href) => {
    finishIntro();
    finish(true);
    if (to) router.navigate(to);
  };

  return (
    <Page icon="flag-checkered" title="Listo" lead="Esto quedó así. Todo se puede cambiar después." footer={<PillButton label="Empezar" onPress={() => close()} />}>
      <View className="gap-2 mb-5">
        <Check ok text="Aviso de seguridad aceptado" />
        <Check ok={status === 'signed-in'} text={status === 'signed-in' ? 'Cuenta activa: asistente disponible' : 'Sin cuenta: el asistente pide entrar'} />
        <Check
          ok={connectionState === 'connected'}
          text={connectionState === 'connected' ? `Adaptador ${deviceName ?? ''} conectado y recordado` : 'Sin adaptador: lo buscás tocando la barra de arriba'}
        />
        {LATER_PERMISSIONS.map((k) =>
          statuses[k] === 'granted' ? (
            <Check key={k} ok text={`${PERMISSIONS[k].title}: permitida`} />
          ) : (
            <View key={k} className="bg-brand-surface rounded-2xl px-4 py-3 flex-row items-center gap-3">
              <MaterialCommunityIcons name={PERMISSIONS[k].icon as never} size={20} color={COLORS.muted} />
              <View className="flex-1">
                <Text className="text-brand-text font-mono-bold text-xs">{PERMISSIONS[k].title}</Text>
                <Text className="text-brand-muted font-mono text-[11px] leading-4">{PERMISSIONS[k].why}</Text>
              </View>
              <Pressable onPress={() => void requestFromPanel(k)} className="px-3 py-2 rounded-full bg-brand-pill active:opacity-70">
                <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
                  Permitir
                </Text>
              </Pressable>
            </View>
          ),
        )}
      </View>
      <Text className="text-brand-muted font-mono text-[10px] mb-2">EMPEZAR POR</Text>
      <View className="gap-2">
        <PillButton label="Tablero en vivo" variant="secondary" onPress={() => close('/dashboard')} />
        <PillButton label="Preguntarle al asistente" variant="secondary" onPress={() => close('/assistant')} />
        <PillButton label="Informe PDF del auto" variant="secondary" onPress={() => close('/report')} />
      </View>
    </Page>
  );
}

function HowTo({ n, text }: { n: number; text: string }) {
  return (
    <View className="flex-row gap-3">
      <View className="w-6 h-6 rounded-full border border-brand-mint items-center justify-center">
        <Text className="text-brand-mint font-mono-bold text-xs">{n}</Text>
      </View>
      <Text className="text-brand-text font-mono text-xs leading-5 flex-1">{text}</Text>
    </View>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View className="flex-row items-center gap-3 px-1 py-1">
      <MaterialCommunityIcons name={ok ? 'check-circle' : 'circle-outline'} size={18} color={ok ? COLORS.mint : COLORS.muted} />
      <Text className="font-mono text-xs flex-1" style={{ color: ok ? COLORS.text : COLORS.muted }}>
        {text}
      </Text>
    </View>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <View className="flex-row gap-2 mt-4">
      <MaterialCommunityIcons name="information-outline" size={16} color={COLORS.muted} />
      <Text className="text-brand-muted font-mono text-[11px] leading-5 flex-1">{text}</Text>
    </View>
  );
}
