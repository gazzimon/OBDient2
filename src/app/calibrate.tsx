// AR calibration, done once per phone mount, parked on a straight flat road.
//
// What the app believes is drawn over the camera:
//   – the horizon            → match the real horizon with pitch / roll
//   – a 3.5 m lane ahead     → align it with the lane using yaw; its width at
//                              the bottom of the image checks FOV and height
//   – marks at 5/10/20/40 m  → compare with lane dashes to check height
// The live pitch/roll from the sensors keep running underneath, so what you
// calibrate is the OFFSET between sensor and camera, which is what is fixed.

import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Line, Polygon } from 'react-native-svg';
import { project, type CameraPose, type Intrinsics } from '@/domain/ar/camera-model';
import { CameraStage } from '@/presentation/components/ar/CameraStage';
import { HorizonLine } from '@/presentation/components/ar/ArOverlay';
import { useLandscapeWhileFocused } from '@/presentation/hooks/useLandscape';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useSettingsStore } from '@/store/settingsStore';

const LANE_M = 3.5;
const MARKS_M = [5, 10, 20, 40];

export default function CalibrateScreen() {
  useKeepAwake();
  useLandscapeWhileFocused();
  useSensorsWhileFocused();
  const router = useRouter();
  const pose = useEgoStore((s) => s.pose);
  const cal = useSettingsStore((s) => s.calibration);
  const set = useSettingsStore((s) => s.setCalibration);
  const reset = useSettingsStore((s) => s.resetCalibration);

  const cameraPose: CameraPose = {
    heightM: cal.cameraHeightM,
    // Vehicle frame: "north" is straight ahead of the car.
    yawDeg: cal.yawOffsetDeg,
    pitchDeg: (pose?.pitchDeg ?? 0) + cal.pitchOffsetDeg,
    rollDeg: (pose?.rollDeg ?? 0) + cal.rollOffsetDeg,
  };

  return (
    <View className="flex-1 bg-black flex-row">
      <View className="flex-1">
        <CameraStage>
          {({ width, height }) => <Guides intr={{ width, height, hfovDeg: cal.hfovDeg }} pose={cameraPose} />}
        </CameraStage>
      </View>

      <ScrollView className="w-64 bg-brand-bg/95 border-l border-brand-border" contentContainerStyle={{ padding: 12, gap: 8 }}>
        <Text className="text-brand-text font-mono-bold text-sm">Calibración AR</Text>
        <Text className="text-brand-muted font-mono text-[10px] leading-4">
          Estaciona en una calle recta y plana. Alinea la línea punteada con el horizonte y el carril con tu carril.
        </Text>
        <Stepper label="Cabeceo" unit="°" value={cal.pitchOffsetDeg} step={0.5} onChange={(v) => set({ pitchOffsetDeg: v })} />
        <Stepper label="Alabeo" unit="°" value={cal.rollOffsetDeg} step={0.5} onChange={(v) => set({ rollOffsetDeg: v })} />
        <Stepper label="Guiñada" unit="°" value={cal.yawOffsetDeg} step={0.5} onChange={(v) => set({ yawOffsetDeg: v })} />
        <Stepper label="Campo visión" unit="°" value={cal.hfovDeg} step={1} min={30} max={120} onChange={(v) => set({ hfovDeg: v })} />
        <Stepper label="Altura" unit=" m" value={cal.cameraHeightM} step={0.05} min={0.5} max={3} onChange={(v) => set({ cameraHeightM: v })} />
        <Toggle
          label="Invertir sensor"
          on={cal.gravitySign === -1}
          hint="Si el horizonte se mueve al revés al inclinar el teléfono"
          onPress={() => set({ gravitySign: cal.gravitySign === 1 ? -1 : 1 })}
        />
        <Text className="text-brand-muted font-mono text-[10px]">
          {pose ? `Sensor: cabeceo ${pose.pitchDeg.toFixed(1)}°, alabeo ${pose.rollDeg.toFixed(1)}°` : 'Sensor: esperando…'}
        </Text>
        <View className="flex-row gap-2 mt-2">
          <Pressable onPress={reset} className="flex-1 rounded-full border border-brand-text py-2 items-center active:opacity-60">
            <Text className="text-brand-text font-mono text-xs">Restablecer</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} className="flex-1 rounded-full bg-brand-pill py-2 items-center active:opacity-60">
            <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
              Listo
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Guides({ intr, pose }: { intr: Intrinsics; pose: CameraPose }) {
  const h = LANE_M / 2;
  const at = (east: number, north: number) => project({ east, north, up: 0 }, pose, intr);
  const corners = [at(-h, 3), at(-h, 60), at(h, 60), at(h, 3)];
  const lane = corners.every(Boolean) ? corners.map((p) => `${p!.x},${p!.y}`).join(' ') : null;

  return (
    <Svg width={intr.width} height={intr.height} pointerEvents="none">
      <HorizonLine pose={pose} intr={intr} />
      {lane && <Polygon points={lane} fill={COLORS.mint} fillOpacity={0.18} stroke={COLORS.mint} strokeWidth={2} />}
      {MARKS_M.map((d) => {
        const a = at(-h, d);
        const b = at(h, d);
        return a && b ? <Line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.text} strokeWidth={1.5} /> : null;
      })}
    </Svg>
  );
}

function Stepper(props: {
  label: string;
  unit: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const { label, unit, value, step, min = -45, max = 45, onChange } = props;
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  return (
    <View className="bg-brand-surface rounded-xl px-3 py-2">
      <Text className="text-brand-muted font-mono text-[10px]">{label}</Text>
      <View className="flex-row items-center justify-between mt-1">
        <StepButton icon="−" onPress={() => onChange(clamp(value - step))} />
        <Text className="text-brand-text font-mono text-sm">
          {value.toFixed(step < 0.1 ? 2 : 1)}
          {unit}
        </Text>
        <StepButton icon="+" onPress={() => onChange(clamp(value + step))} />
      </View>
    </View>
  );
}

function StepButton({ icon, onPress }: { icon: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} className="w-9 h-9 rounded-full border border-brand-border items-center justify-center active:opacity-60">
      <Text className="text-brand-teal font-mono-bold text-base">{icon}</Text>
    </Pressable>
  );
}

function Toggle({ label, on, hint, onPress }: { label: string; on: boolean; hint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="bg-brand-surface rounded-xl px-3 py-2 active:opacity-70">
      <View className="flex-row items-center justify-between">
        <Text className="text-brand-text font-mono text-xs">{label}</Text>
        <View className={`w-9 h-5 rounded-full ${on ? 'bg-brand-teal' : 'bg-brand-border'} justify-center`}>
          <View className={`w-4 h-4 rounded-full bg-brand-text ${on ? 'self-end mr-0.5' : 'ml-0.5'}`} />
        </View>
      </View>
      <Text className="text-brand-muted font-mono text-[10px] mt-1">{hint}</Text>
    </Pressable>
  );
}
