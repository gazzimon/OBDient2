// Modo manejo: tilted 3D map with the car + HUD, the camera in a floating
// window with what the detector sees. Landscape, screen on. Works with a
// route (guidance) or without one (free driving: map, speed, detector).
//
// Tapping the floating window swaps roles (camera full screen with the AR
// route on the road, map floating) and back. Settings → "Guía AR" makes the
// camera the starting view. Both views stay mounted and only change size and
// layer, so the swap is instant and the camera never restarts.

import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { ArOverlay } from '@/presentation/components/ar/ArOverlay';
import { CameraStage } from '@/presentation/components/ar/CameraStage';
import { DriveHud } from '@/presentation/components/ar/DriveHud';
import { DriveMap } from '@/presentation/components/ar/DriveMap';
import { useDriveOrientationWhileFocused } from '@/presentation/hooks/useLandscape';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

// Floating window: right side, between the buttons and the ETA card (the
// car sits low in the middle of the map); 16:9.
const PIP_W = 208;
const PIP_H = 117;
const PIP_BOX: ViewStyle = {
  position: 'absolute',
  right: 12,
  top: '50%',
  marginTop: -PIP_H / 2 - 20,
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
  useSensorsWhileFocused();
  const router = useRouter();
  const route = useNavStore((s) => s.route);
  const [ribbonVisible, setRibbonVisible] = useState(false);
  // The camera (AR guidance, detector) only when turned on in Settings: off,
  // the screen is the map alone — lighter, and any orientation.
  const cameraOn = useSettingsStore((s) => s.driveAr);
  useDriveOrientationWhileFocused(cameraOn);
  const [mapPrimary, setMapPrimary] = useState(() => !useSettingsStore.getState().driveAr);
  const mapMain = !cameraOn || mapPrimary;

  const exit = () => {
    if (route) navigation.stop();
    // After a reload the drive screen may be the only one: back to the map.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View className="flex-1 bg-black">
      {/* Full screen: the clock and battery would sit on the HUD's buttons. */}
      <StatusBar hidden />
      {cameraOn && (
        <View style={mapMain ? PIP : FULL}>
          <CameraStage>
            {({ width, height }) => (
              <>
                <ArOverlay width={width} height={height} onRibbonVisible={setRibbonVisible} />
              </>
            )}
          </CameraStage>
        </View>
      )}
      <View style={mapMain ? FULL : PIP}>
        <DriveMap primary={mapMain} />
      </View>
      <DriveHud onExit={exit} ribbonVisible={ribbonVisible} arVisible={!mapMain} />
      {/* Tap target over the floating window, above everything else. */}
      {cameraOn && (
        <Pressable
          onPress={() => setMapPrimary((m) => !m)}
          style={PIP_TAP}
          accessibilityRole="button"
          accessibilityLabel={mapMain ? 'Mostrar la cámara' : 'Mostrar el mapa'}
        />
      )}
    </View>
  );
}
