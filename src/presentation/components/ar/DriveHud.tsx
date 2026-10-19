// Heads-up information around the AR view: next maneuver, speed, ETA and the
// state of each source. Deliberately sparse — glanceable, not readable.

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { instructionEs } from '@/domain/navigation/guidance';
import { AR_BLOCKER_ES, arBlocker, headingGuide } from '@/domain/navigation/heading-guide';
import type { Maneuver } from '@/domain/navigation/route';
import { formatDistance, formatEta } from '@/presentation/format';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useOBDStore } from '@/store/obdStore';
import { usePerceptionStore } from '@/store/perceptionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVoiceMuted, voice } from '@/presentation/services/voice';

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

export function DriveHud({
  onExit,
  ribbonVisible,
  arVisible,
}: {
  onExit: () => void;
  ribbonVisible: boolean;
  // False while the map is full screen: AR-only notices would just be noise.
  arVisible: boolean;
}) {
  const progress = useNavStore((s) => s.progress);
  const route = useNavStore((s) => s.route);
  const status = useNavStore((s) => s.status);
  const navError = useNavStore((s) => s.error);
  const ego = useEgoStore((s) => s.ego);
  const pose = useEgoStore((s) => s.pose);
  const obdState = useOBDStore((s) => s.connectionState);
  const obdHz = useOBDStore((s) => s.speedRateHz);
  const debug = useSettingsStore((s) => s.debugOverlay);
  const detectorOn = useSettingsStore((s) => s.detectorEnabled);

  const m = progress?.nextManeuver ?? null;
  const guide =
    route && progress && ego?.headingValid ? headingGuide(route, progress, ego.position, ego.headingDeg) : null;
  const blocker =
    status === 'arrived' || !arVisible
      ? null
      : arBlocker({
          hasPosition: ego != null,
          hasPose: pose != null,
          headingValid: ego?.headingValid ?? false,
          hasProgress: progress != null,
          ribbonVisible,
        });
  const remainingS =
    route && progress ? (route.durationS * progress.remainingM) / Math.max(1, route.distanceM) : null;

  const muted = useVoiceMuted();
  // Landscape: the camera cutout and the gesture bar are on the sides.
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: Math.max(12, insets.top),
    paddingBottom: Math.max(12, insets.bottom),
    paddingLeft: Math.max(12, insets.left),
    paddingRight: Math.max(12, insets.right),
  };
  return (
    <View pointerEvents="box-none" className="absolute inset-0" style={pad}>
      {/* Next maneuver */}
      <View className="flex-row items-start justify-between">
        {status === 'arrived' ? (
          <Card>
            <MaterialCommunityIcons name="flag-checkered" size={36} color={COLORS.mint} />
            <Text className="text-brand-text font-mono-bold text-base ml-3">Llegaste a tu destino</Text>
          </Card>
        ) : m && progress?.distanceToManeuverM != null ? (
          <Card>
            <MaterialCommunityIcons name={maneuverIcon(m)} size={40} color={COLORS.mint} />
            <View className="ml-3 max-w-[260px]">
              <Text className="text-brand-text font-mono-bold text-2xl">
                {formatDistance(progress.distanceToManeuverM)}
              </Text>
              <Text className="text-brand-muted font-mono text-xs" numberOfLines={2}>
                {instructionEs(m)}
              </Text>
            </View>
          </Card>
        ) : route || !ego ? (
          <Card>
            <Text className="text-brand-muted font-mono text-xs">
              {ego ? 'Ubicando el vehículo en la ruta…' : 'Esperando GPS…'}
            </Text>
          </Card>
        ) : (
          // Free driving: nothing to announce.
          <View />
        )}

        <View className="flex-row gap-3">
          {/* Silence (M5): guidance and the assistant; critical alerts still speak. */}
          <Pressable
            onPress={() => voice.setMuted(!muted)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Activar la voz' : 'Silenciar la voz'}
            className="w-11 h-11 rounded-full bg-brand-surface/90 border border-brand-border items-center justify-center active:opacity-60"
          >
            <MaterialCommunityIcons name={muted ? 'volume-off' : 'volume-high'} size={22} color={muted ? COLORS.amber : COLORS.text} />
          </Pressable>
          <Pressable
            onPress={onExit}
            hitSlop={10}
            className="w-11 h-11 rounded-full bg-brand-surface/90 border border-brand-border items-center justify-center active:opacity-60"
          >
            <MaterialCommunityIcons name="close" size={22} color={COLORS.text} />
          </Pressable>
        </View>
      </View>

      {/* Direction arrow: always there, AR or not. */}
      {guide && status !== 'arrived' && (
        <View pointerEvents="none" className="self-center items-center mt-1">
          <View
            className="w-16 h-16 rounded-full bg-brand-surface/80 border border-brand-teal items-center justify-center"
            style={{ transform: [{ rotate: `${guide.relativeDeg}deg` }] }}
          >
            <MaterialCommunityIcons name="navigation" size={38} color={COLORS.mint} />
          </View>
          {Math.abs(guide.relativeDeg) > 120 && (
            <Text className="text-brand-amber font-mono text-xs mt-1">Da la vuelta</Text>
          )}
        </View>
      )}
      {blocker && (
        <View pointerEvents="none" className="self-center mt-2 px-3 py-1.5 rounded-full bg-brand-surface/90 border border-brand-border">
          <Text className="text-brand-muted font-mono text-xs">{AR_BLOCKER_ES[blocker]}</Text>
        </View>
      )}

      {progress?.offRoute && (
        <View className="self-center mt-2 px-3 py-1.5 rounded-full bg-brand-surface/90 border border-brand-amber">
          <Text className="text-brand-amber font-mono text-xs">Fuera de ruta — recalculando</Text>
        </View>
      )}
      {navError && status === 'navigating' && (
        <Text className="self-center mt-1 text-brand-red font-mono text-[10px]">{navError}</Text>
      )}

      <View className="flex-1" pointerEvents="none" />

      {/* Bottom bar */}
      <View pointerEvents="none" className="flex-row items-end justify-between">
        <Card>
          <View className="items-center">
            <Text className="text-brand-text font-mono-bold text-3xl">
              {ego ? Math.round(ego.speedMps * 3.6) : '--'}
            </Text>
            <Text className="text-brand-muted font-mono text-[10px]">
              km/h · {ego?.speedSource === 'obd' ? 'OBD' : ego?.speedSource === 'gps' ? 'GPS' : '—'}
            </Text>
          </View>
        </Card>

        <View className="items-end gap-1">
          <View className="flex-row gap-1.5">
            <Chip label="GPS" ok={ego != null && ego.gpsAccuracyM <= 20} warn={ego != null} />
            <Chip label="IMU" ok={pose != null} warn={false} />
            <Chip label={obdState === 'connected' ? `OBD ${obdHz.toFixed(0)}Hz` : 'OBD'} ok={obdState === 'connected'} warn={obdState === 'connecting'} />
          </View>
          {detectorOn && (__DEV__ || debug) && <DetectorChip />}
          {route && progress && remainingS != null && (
            <Card>
              <Text className="text-brand-teal font-mono-bold text-lg">{formatEta(remainingS)}</Text>
              <Text className="text-brand-muted font-mono text-xs ml-3">{formatDistance(progress.remainingM)}</Text>
            </Card>
          )}
        </View>
      </View>

      {debug && ego && pose && (
        <View pointerEvents="none" className="absolute left-3 top-24 bg-black/60 rounded-lg p-2">
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

function Card({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row items-center bg-brand-surface/90 border border-brand-border rounded-2xl px-4 py-3">
      {children}
    </View>
  );
}

// Dev / technical data: is the detector really running, how fast, what it sees.
function DetectorChip() {
  const status = usePerceptionStore((s) => s.status);
  const error = usePerceptionStore((s) => s.error);
  const stats = usePerceptionStore((s) => s.stats);
  const seen = usePerceptionStore((s) => s.objects.length);
  const label =
    status === 'running' && stats
      ? `YOLO ${stats.fps.toFixed(0)} fps · ${stats.inferenceMs.toFixed(0)} ms · ${seen} obj · ${stats.delegate}`
      : status === 'error'
        ? `YOLO error: ${error ?? '?'}`
        : `YOLO ${status}`;
  return <Chip label={label} ok={status === 'running'} warn={status === 'loading'} />;
}

function Chip({ label, ok, warn }: { label: string; ok: boolean; warn: boolean }) {
  const border = ok ? 'border-brand-teal' : warn ? 'border-brand-amber' : 'border-brand-border';
  const text = ok ? 'text-brand-teal' : warn ? 'text-brand-amber' : 'text-brand-muted';
  return (
    <View className={`px-2 py-0.5 rounded-full bg-brand-surface/90 border ${border}`}>
      <Text className={`font-mono text-[10px] ${text}`}>{label}</Text>
    </View>
  );
}
