// The driving screen around the map (Modo manejo, F1; docs/plans/modo-navegacion-ux.md):
//
//   1 maneuver banner (tap: say it again), with "luego" when the next one is close
//   2 left rail, within the driver's reach: talk to the assistant, sound
//     (all → only alerts → silent), 3D/2D with the GPS state as a dot
//   3 speed, bottom right
//   4 trip bar: ✕ end (confirmed), time · km · arrival, ⋯ quick actions
//
// Glanceable and one tap each: large targets, nothing to type. Works in
// portrait and landscape.

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SOUND_LABEL, followingManeuver, gpsQuality, nextSoundMode, repeatPhrase, type GpsQuality } from '@/domain/navigation/drive-hud';
import { instructionEs } from '@/domain/navigation/guidance';
import type { Maneuver } from '@/domain/navigation/route';
import type { SoundMode } from '@/domain/voice/voice-arbiter';
import { formatDistance, formatDuration, formatEta } from '@/presentation/format';
import { chunkAt } from '@/domain/voice/subtitles';
import { useDriveAssistant, type DrivePhase } from '@/presentation/hooks/useDriveAssistant';
import { useSoundMode, voice } from '@/presentation/services/voice';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function maneuverIcon(m: Maneuver): IconName {
  if (m.type === 'arrive') return 'flag-checkered';
  if (m.type === 'roundabout') return 'rotate-right';
  switch (m.modifier) {
    case 'left':
    case 'sharp-left':
      return 'arrow-left-top';
    case 'slight-left':
      return 'arrow-top-left';
    case 'right':
    case 'sharp-right':
      return 'arrow-right-top';
    case 'slight-right':
      return 'arrow-top-right';
    case 'uturn':
      return 'arrow-u-left-top';
    default:
      return 'arrow-up';
  }
}

const SOUND_ICON: Readonly<Record<SoundMode, IconName>> = {
  all: 'volume-high',
  alerts: 'bell-ring-outline',
  silent: 'volume-off',
};

export const MIC_LABEL: Readonly<Record<DrivePhase, string>> = {
  idle: 'Hablar con el asistente',
  listening: 'Terminar de hablar',
  thinking: 'Detener la respuesta',
  speaking: 'Cortar y hablar',
};

const GPS_DOT: Readonly<Record<GpsQuality, string>> = { ok: COLORS.mint, weak: COLORS.amber, none: COLORS.red };

export function DriveHud({ onExit }: { onExit: () => void }) {
  const route = useNavStore((s) => s.route);
  const progress = useNavStore((s) => s.progress);
  const status = useNavStore((s) => s.status);
  const ego = useEgoStore((s) => s.ego);
  const pose = useEgoStore((s) => s.pose);
  const location = useEgoStore((s) => s.location);
  const debug = useSettingsStore((s) => s.debugOverlay);
  const map3d = useSettingsStore((s) => s.driveMap3d);
  const sound = useSoundMode();
  const assistant = useDriveAssistant();
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const insets = useSafeAreaInsets();

  const arrived = status === 'arrived';
  const m = progress?.nextManeuver ?? null;
  const then = route && m ? followingManeuver(route, m) : null;
  const remainingS = route && progress ? (route.durationS * progress.remainingM) / Math.max(1, route.distanceM) : null;
  const gps = location === 'ok' ? gpsQuality(ego?.gpsAccuracyM ?? null) : 'none';

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2000);
  };
  const cycleSound = () => {
    const next = nextSoundMode(sound);
    voice.setMode(next);
    flash(SOUND_LABEL[next]);
  };
  const toggleMap = () => {
    useSettingsStore.getState().setDriveMap3d(!map3d);
    flash(map3d ? 'Mapa 2D, norte arriba' : 'Mapa 3D');
  };
  const confirmExit = () => {
    if (!route || arrived) return onExit();
    Alert.alert('¿Terminar el viaje?', undefined, [
      { text: 'Seguir', style: 'cancel' },
      { text: 'Terminar', style: 'destructive', onPress: onExit },
    ]);
  };

  const pad = {
    paddingTop: Math.max(10, insets.top),
    paddingBottom: Math.max(10, insets.bottom),
    paddingLeft: Math.max(10, insets.left),
    paddingRight: Math.max(10, insets.right),
  };

  return (
    <View pointerEvents="box-none" className="absolute inset-0" style={pad}>
      {/* 1 Maneuver banner */}
      {route && !arrived && (
        <Pressable
          onPress={() => m && progress?.distanceToManeuverM != null && voice.say(repeatPhrase(m, progress.distanceToManeuverM), 'maneuver')}
          accessibilityRole="button"
          accessibilityLabel="Repetir la indicación"
          className="flex-row items-center rounded-2xl px-4 py-3 active:opacity-80"
          style={{ backgroundColor: progress?.offRoute ? COLORS.amber : COLORS.mintDark, maxWidth: landscape ? 440 : undefined }}
        >
          {progress?.offRoute ? (
            <Text className="font-mono-bold text-lg" style={{ color: COLORS.bg }}>
              Fuera de ruta — recalculando…
            </Text>
          ) : m && progress?.distanceToManeuverM != null ? (
            <>
              <MaterialCommunityIcons name={maneuverIcon(m)} size={48} color={COLORS.text} />
              <View className="ml-3 flex-1">
                <Text className="text-brand-text font-mono-bold text-3xl">{formatDistance(progress.distanceToManeuverM)}</Text>
                <Text className="text-brand-text font-mono text-sm" numberOfLines={2}>
                  {instructionEs(m)}
                </Text>
              </View>
              {then && (
                <View className="items-center ml-2 pl-3 border-l" style={{ borderColor: '#ffffff55' }}>
                  <Text className="text-brand-text font-mono text-[10px]">luego</Text>
                  <MaterialCommunityIcons name={maneuverIcon(then)} size={28} color={COLORS.text} />
                </View>
              )}
            </>
          ) : (
            <Text className="text-brand-text font-mono text-sm">{ego ? 'Ubicando el vehículo en la ruta…' : 'Esperando GPS…'}</Text>
          )}
        </Pressable>
      )}

      {/* 2 Rail (left) and 3 speed (right) */}
      <View pointerEvents="box-none" className="flex-1 flex-row items-center justify-between">
        <View className="gap-3">
          <RailButton
            size={64}
            icon={assistant.phase === 'thinking' ? 'stop' : assistant.phase === 'speaking' ? 'microphone-message' : 'microphone'}
            label={MIC_LABEL[assistant.phase]}
            onPress={assistant.talk}
            color={assistant.phase === 'idle' ? COLORS.mint : COLORS.red}
            iconColor={assistant.phase === 'idle' ? COLORS.bg : COLORS.text}
          />
          <RailButton icon={SOUND_ICON[sound]} label={SOUND_LABEL[sound]} onPress={cycleSound} iconColor={sound === 'all' ? COLORS.text : COLORS.amber} />
          <RailButton label={map3d ? 'Cambiar a mapa 2D' : 'Cambiar a mapa 3D'} onPress={toggleMap} dot={GPS_DOT[gps]}>
            <Text className="text-brand-text font-mono-bold text-base">{map3d ? '3D' : '2D'}</Text>
          </RailButton>
        </View>
        <View pointerEvents="none" className="self-end mb-2">
          <Speed kmh={ego ? Math.round(ego.speedMps * 3.6) : null} source={ego?.speedSource ?? null} />
        </View>
      </View>

      {/* The conversation, as film subtitles */}
      <DriveSubtitles assistant={assistant} landscape={landscape} />
      {toast && (
        <View pointerEvents="none" className="self-center mb-2 px-4 py-2 rounded-full bg-brand-surface/95 border border-brand-border">
          <Text className="text-brand-text font-mono text-sm">{toast}</Text>
        </View>
      )}

      {/* 4 Trip bar */}
      <View className="flex-row items-center bg-brand-surface/95 border border-brand-border rounded-2xl px-2 py-2">
        <BarButton icon="close" label="Terminar el viaje" onPress={confirmExit} />
        <View className="flex-1 items-center">
          {arrived ? (
            <Text className="text-brand-mint font-mono-bold text-lg">Llegaste a tu destino</Text>
          ) : route && progress && remainingS != null ? (
            <>
              <Text className="text-brand-mint font-mono-bold text-2xl">{formatDuration(remainingS)}</Text>
              <Text className="text-brand-muted font-mono text-xs">
                {formatDistance(progress.remainingM)} · llega {formatEta(remainingS)}
              </Text>
            </>
          ) : (
            <Text className="text-brand-muted font-mono text-sm">{route ? 'Calculando…' : 'Manejo libre'}</Text>
          )}
        </View>
        <BarButton icon="dots-horizontal" label="Más opciones" onPress={() => setSheet(true)} />
      </View>

      <QuickActions
        visible={sheet}
        onClose={() => setSheet(false)}
        sound={sound}
        onSound={cycleSound}
        map3d={map3d}
        onMap={toggleMap}
        onEnd={() => {
          setSheet(false);
          confirmExit();
        }}
        hasRoute={route != null}
      />

      {(debug || __DEV__) && <TechChips />}
      {debug && ego && pose && (
        <View pointerEvents="none" className="absolute left-24 top-28 bg-black/60 rounded-lg p-2">
          <Text className="text-brand-text font-mono text-[10px]">
            {`hdg ${ego.headingDeg.toFixed(1)}° ${ego.headingValid ? '' : '(?)'}\n` +
              `pitch ${pose.pitchDeg.toFixed(1)}° roll ${pose.rollDeg.toFixed(1)}° ${pose.side}\n` +
              `aLong ${ego.accelLongMps2.toFixed(2)} yaw ${ego.yawRateDegS.toFixed(1)}°/s\n` +
              `gps ±${ego.gpsAccuracyM.toFixed(0)}m  xtrack ${progress?.crossTrackM.toFixed(1) ?? '-'}m`}
          </Text>
        </View>
      )}
    </View>
  );
}

// Large, centred, two lines at most, over a dark band: readable from the
// seat at a glance, like film subtitles. Only the piece being said, never the
// whole answer.
export function DriveSubtitles({ assistant, landscape }: { assistant: ReturnType<typeof useDriveAssistant>; landscape: boolean }) {
  const subs = assistant.subtitles;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!subs?.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [subs?.startedAt]);

  let text: string | null = null;
  let tone: 'say' | 'heard' | 'status' | 'error' = 'say';
  if (assistant.phase === 'speaking' && subs?.startedAt) {
    text = subs.chunks[chunkAt(subs.chunks, now - subs.startedAt)] ?? null;
  } else if (assistant.phase === 'listening') {
    // The last words heard, not the whole phrase.
    text = assistant.heard ? assistant.heard.split(/\s+/).slice(-8).join(' ') : 'Te escucho…';
    tone = assistant.heard ? 'heard' : 'status';
  } else if (assistant.phase === 'thinking') {
    text = `${assistant.busyWith ?? 'Pensando'}…`;
    tone = 'status';
  } else if (assistant.error) {
    text = assistant.error;
    tone = 'error';
  }
  if (!text) return null;

  const size = tone === 'say' || tone === 'heard' ? (landscape ? 26 : 30) : 20;
  const color = tone === 'error' ? COLORS.amber : tone === 'say' ? COLORS.text : tone === 'heard' ? COLORS.mint : COLORS.muted;
  return (
    <View pointerEvents="none" className="self-center mb-3 px-5 py-2 rounded-2xl" style={{ backgroundColor: 'rgba(0,0,0,0.72)', maxWidth: landscape ? 620 : '96%' }}>
      <Text
        numberOfLines={2}
        className="text-center"
        style={{ color, fontSize: size, lineHeight: size * 1.25, fontFamily: 'IBMPlexMono_700Bold' }}
      >
        {text}
      </Text>
    </View>
  );
}

export function RailButton({
  icon,
  label,
  onPress,
  size = 56,
  color = COLORS.surface,
  iconColor = COLORS.text,
  dot,
  children,
}: {
  icon?: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  iconColor?: string;
  dot?: string;
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="rounded-full items-center justify-center border border-brand-border active:opacity-60"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {children ?? (icon && <MaterialCommunityIcons name={icon} size={size * 0.45} color={iconColor} />)}
      {dot && <View className="absolute top-1 right-1 w-3 h-3 rounded-full border border-brand-bg" style={{ backgroundColor: dot }} />}
    </Pressable>
  );
}

function BarButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} className="w-14 h-14 items-center justify-center active:opacity-60">
      <MaterialCommunityIcons name={icon} size={28} color={COLORS.text} />
    </Pressable>
  );
}

function Speed({ kmh, source }: { kmh: number | null; source: string | null }) {
  return (
    <View className="w-20 h-20 rounded-full bg-brand-surface/95 border-2 border-brand-border items-center justify-center">
      <Text className="text-brand-text font-mono-bold text-3xl">{kmh ?? '--'}</Text>
      <Text className="text-brand-muted font-mono text-[10px]">km/h{source === 'gps' ? ' · GPS' : ''}</Text>
    </View>
  );
}

function QuickActions({
  visible,
  onClose,
  sound,
  onSound,
  map3d,
  onMap,
  onEnd,
  hasRoute,
}: {
  visible: boolean;
  onClose: () => void;
  sound: SoundMode;
  onSound: () => void;
  map3d: boolean;
  onMap: () => void;
  onEnd: () => void;
  hasRoute: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose} />
      <View className="bg-brand-surface rounded-t-3xl px-5 pt-4 pb-8">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-brand-text font-mono-bold text-base">Acciones rápidas</Text>
          <BarButton icon="close" label="Cerrar" onPress={onClose} />
        </View>
        <View className="flex-row gap-3 mb-4">
          <Tile icon={SOUND_ICON[sound]} label={SOUND_LABEL[sound]} onPress={onSound} />
          <Tile icon={map3d ? 'map-outline' : 'rotate-3d-variant'} label={map3d ? 'Mapa 2D' : 'Mapa 3D'} onPress={onMap} />
        </View>
        <Pressable onPress={onEnd} className="h-14 rounded-2xl items-center justify-center active:opacity-70" style={{ backgroundColor: COLORS.red }}>
          <Text className="font-mono-bold text-base" style={{ color: COLORS.text }}>
            {hasRoute ? 'Terminar viaje' : 'Salir del modo manejo'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 h-24 rounded-2xl bg-brand-bg items-center justify-center gap-2 active:opacity-60">
      <MaterialCommunityIcons name={icon} size={30} color={COLORS.text} />
      <Text className="text-brand-text font-mono text-xs text-center">{label}</Text>
    </Pressable>
  );
}

// Field-testing aid: the sources, only in Dev or with "Datos técnicos".
function TechChips() {
  const ego = useEgoStore((s) => s.ego);
  const pose = useEgoStore((s) => s.pose);
  const obdState = useOBDStore((s) => s.connectionState);
  const obdHz = useOBDStore((s) => s.speedRateHz);
  const items = [
    `GPS ${ego ? `±${ego.gpsAccuracyM.toFixed(0)}m` : '—'}`,
    `IMU ${pose ? 'ok' : '—'}`,
    `OBD ${obdState === 'connected' ? `${obdHz.toFixed(0)}Hz` : '—'}`,
  ];
  return (
    <View pointerEvents="none" className="absolute right-3 top-1/3">
      {items.map((t) => (
        <Text key={t} className="text-brand-muted font-mono text-[9px] text-right">
          {t}
        </Text>
      ))}
    </View>
  );
}
