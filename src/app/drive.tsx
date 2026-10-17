// AR guidance: camera + route drawn on the road + HUD. Landscape, screen on.
//
// The map rides along as a floating window; tapping it swaps roles (map full
// screen, AR floating) and tapping again swaps back. Both views stay mounted
// and only change size and layer, so the swap is instant and the camera
// never restarts.

import { useMemo, useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { detectorModel } from '@/data/perception/detector-model';
import { AlertFlash } from '@/presentation/components/ar/AlertFlash';
import { ArOverlay } from '@/presentation/components/ar/ArOverlay';
import { CameraStage } from '@/presentation/components/ar/CameraStage';
import { DriveHud } from '@/presentation/components/ar/DriveHud';
import { DetectionOverlay } from '@/presentation/components/ar/DetectionOverlay';
import { DriveMap } from '@/presentation/components/ar/DriveMap';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { useDetector } from '@/presentation/hooks/useDetector';
import { useLandscapeWhileFocused } from '@/presentation/hooks/useLandscape';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

// Floating window: bottom centre, between the speed and ETA cards; 16:9.
const PIP_W = 224;
const PIP_H = 126;
const PIP_BOX: ViewStyle = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  marginLeft: -PIP_W / 2,
  width: PIP_W,
  height: PIP_H,
};
const PIP: ViewStyle = {
  ...PIP_BOX,
  zIndex: 2,
  elevation: 2,
  borderRadius: 14,
  overflow: 'hidden',
  borderWidth: 1,
  borderColor: '#2DE1A5',
};
const FULL: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, elevation: 0 };
const PIP_TAP: ViewStyle = { ...PIP_BOX, zIndex: 10, elevation: 10 };

export default function DriveScreen() {
  useKeepAwake();
  useLandscapeWhileFocused();
  useSensorsWhileFocused();
  const router = useRouter();
  const route = useNavStore((s) => s.route);
  const [ribbonVisible, setRibbonVisible] = useState(false);
  const [mapPrimary, setMapPrimary] = useState(false);

  // On-device detector (E4) on the same camera session as the AR preview.
  const detectorEnabled = useSettingsStore((s) => s.detectorEnabled);
  const detectorDelegate = useSettingsStore((s) => s.detectorDelegate);
  const detectorModelId = useSettingsStore((s) => s.detectorModelId);
  const manifest = useMemo(() => detectorModel(detectorModelId), [detectorModelId]);
  // Frames for the teacher models ride on the same output, detector or not.
  const captureFrames = useSettingsStore((s) => s.recordTrips && s.recordFrames) && route != null;
  const { frameOutput } = useDetector(manifest, detectorDelegate, detectorEnabled && route != null, captureFrames);
  const useOutput = detectorEnabled || captureFrames;
  const outputs = useMemo(() => (useOutput ? [frameOutput] : []), [useOutput, frameOutput]);

  const exit = () => {
    navigation.stop();
    router.back();
  };

  if (!route) {
    return (
      <View className="flex-1 bg-brand-bg items-center justify-center gap-4">
        <Text className="text-brand-muted font-mono text-sm">No hay una ruta activa.</Text>
        <PillButton label="Volver" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <View style={mapPrimary ? PIP : FULL}>
        <CameraStage outputs={outputs}>
          {({ width, height }) => (
            <>
              <ArOverlay width={width} height={height} onRibbonVisible={setRibbonVisible} />
              {detectorEnabled && <DetectionOverlay width={width} height={height} />}
            </>
          )}
        </CameraStage>
      </View>
      <View style={mapPrimary ? FULL : PIP}>
        <DriveMap primary={mapPrimary} />
      </View>
      <DriveHud onExit={exit} ribbonVisible={ribbonVisible} arVisible={!mapPrimary} />
      <AlertFlash />
      {/* Tap target over the floating window, above everything else. */}
      <Pressable
        onPress={() => setMapPrimary((m) => !m)}
        style={PIP_TAP}
        accessibilityRole="button"
        accessibilityLabel={mapPrimary ? 'Mostrar la cámara' : 'Mostrar el mapa'}
      />
    </View>
  );
}
