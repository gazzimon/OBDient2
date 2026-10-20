// The Tablero's camera view (decision 2026-10-20): just the camera, with the
// car's numbers on top and the assistant as in the driving screen.
//
//   left rail   🎤 talk (subtitles, follow-up listening) · 📷 photo → the
//               assistant listens for the question about it · ↻ front/back
//   bottom      km/h and RPM, large, on a dark glass band
//   top right   engine temperature and battery
//   moving      an amber "mirá la calle" notice (> 10 km/h)
//
// Only a preview: no frame processing, so it stays light on low-end phones.
// The camera runs only while this view is on screen and the app is open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, type CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircularGauge } from '@/presentation/components/gauges/CircularGauge';
import { DriveSubtitles, MIC_LABEL, RailButton } from '@/presentation/components/drive/DriveHud';
import { useDriveAssistant } from '@/presentation/hooks/useDriveAssistant';
import { ensurePermission } from '@/presentation/services/permissions';
import { photoFrom } from '@/presentation/services/photo';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const MOVING_KMH = 10;
const FRESH_MS = 3000;

function useFresh(pid: 'SPEED' | 'RPM' | 'COOLANT_TEMP' | 'VOLTAGE'): number | null {
  const p = useOBDStore((s) => s.parameters[pid]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return p && now - p.timestamp.getTime() < FRESH_MS ? p.value : null;
}

// Camera on only while this screen is focused and the app in front.
function useCameraActive(): boolean {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  return focused && foreground;
}

export function CameraHud() {
  useKeepAwake();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [snapping, setSnapping] = useState(false);
  const camera = useRef<CameraView>(null);
  const active = useCameraActive();
  const assistant = useDriveAssistant();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const insets = useSafeAreaInsets();

  const kmh = useFresh('SPEED');
  const rpm = useFresh('RPM');
  const coolant = useFresh('COOLANT_TEMP');
  const volts = useFresh('VOLTAGE');
  const moving = kmh != null && kmh > MOVING_KMH;

  useEffect(() => {
    void ensurePermission('camera').then(setAllowed);
  }, []);

  const snap = async () => {
    if (!camera.current || snapping) return;
    setSnapping(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const pic = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      const photo = pic ? await photoFrom(pic.uri, pic.width, pic.height) : null;
      if (photo) assistant.askAboutPhoto(photo.dataUrl);
    } finally {
      setSnapping(false);
    }
  };

  if (allowed === false) {
    return (
      <View className="flex-1 bg-brand-bg items-center justify-center px-8 gap-4">
        <Text className="text-brand-text font-mono text-sm text-center">La vista de cámara necesita el permiso de la cámara.</Text>
        <Pressable
          onPress={() => void ensurePermission('camera').then(setAllowed)}
          className="px-5 py-3 rounded-full active:opacity-70"
          style={{ backgroundColor: COLORS.mint }}
        >
          <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
            Permitir cámara
          </Text>
        </Pressable>
      </View>
    );
  }

  const gauge = landscape ? 150 : 170;
  return (
    <View className="flex-1 bg-black">
      {allowed && <CameraView ref={camera} style={{ flex: 1 }} facing={facing} active={active} animateShutter={false} />}

      <View
        pointerEvents="box-none"
        className="absolute inset-0"
        style={{ paddingTop: Math.max(10, insets.top), paddingLeft: Math.max(10, insets.left), paddingRight: Math.max(10, insets.right), paddingBottom: 10 }}
      >
        {/* Moving: the road comes first. */}
        <View pointerEvents="none" className="flex-row items-start justify-between">
          {moving ? (
            <View className="flex-row items-center gap-2 px-4 py-2 rounded-2xl" style={{ backgroundColor: COLORS.amber }}>
              <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
                ⚠ En movimiento: mirá la calle
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View className="gap-2 items-end">
            <Chip label="Motor" value={coolant != null ? `${Math.round(coolant)}°C` : '--'} warn={coolant != null && coolant >= 105} />
            <Chip label="Batería" value={volts != null ? `${volts.toFixed(1).replace('.', ',')} V` : '--'} warn={volts != null && (volts < 11.8 || volts > 15)} />
          </View>
        </View>

        <View pointerEvents="box-none" className="flex-1 justify-center">
          <View className="gap-3 self-start">
            <RailButton
              size={64}
              icon={assistant.phase === 'thinking' ? 'stop' : assistant.phase === 'speaking' ? 'microphone-message' : 'microphone'}
              label={MIC_LABEL[assistant.phase]}
              onPress={assistant.talk}
              color={assistant.phase === 'idle' ? COLORS.mint : COLORS.red}
              iconColor={assistant.phase === 'idle' ? COLORS.bg : COLORS.text}
            />
            <RailButton icon={snapping ? 'timer-sand' : 'camera'} label="Foto para el asistente" onPress={() => void snap()} />
            <RailButton icon="camera-flip-outline" label="Cambiar de cámara" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
          </View>
        </View>

        <DriveSubtitles assistant={assistant} landscape={landscape} />

        {/* The numbers, on a dark glass band. */}
        <View pointerEvents="none" className="flex-row justify-center gap-4 self-center rounded-3xl px-4 pt-3" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <CircularGauge value={kmh ?? NaN} min={0} max={180} unit="km/h" label="Velocidad" size={gauge} />
          <CircularGauge
            value={rpm ?? NaN}
            min={0}
            max={8000}
            unit="rpm"
            label="RPM"
            size={gauge}
            color={rpm != null && rpm >= 6000 ? COLORS.red : rpm != null && rpm >= 4500 ? COLORS.amber : COLORS.mint}
          />
        </View>
      </View>
    </View>
  );
}

function Chip({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <View className="flex-row items-baseline gap-2 px-3 py-1.5 rounded-xl" style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: warn ? COLORS.amber : 'transparent' }}>
      <Text className="text-brand-muted font-mono text-[10px]">{label}</Text>
      <Text className="font-mono-bold text-base" style={{ color: warn ? COLORS.amber : COLORS.text }}>
        {value}
      </Text>
    </View>
  );
}
