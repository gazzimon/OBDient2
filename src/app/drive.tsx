// Modo manejo: the tilted 3D map (or flat 2D) with the car, and the HUD
// around it. Screen on, any orientation. With a route it guides; without one
// it is free driving (map, speed, the assistant by voice).
//
// The camera is not part of driving any more (decision 2026-10-20): it lives
// in the Tablero, as a plain camera view with the gauges. The AR guidance is
// kept on the etapa-camara branch.

import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { DriveHud } from '@/presentation/components/drive/DriveHud';
import { DriveMap } from '@/presentation/components/drive/DriveMap';
import { useFreeOrientationWhileFocused } from '@/presentation/hooks/useLandscape';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { setDrivingScreen } from '@/presentation/services/my-trips';
import { useNavStore } from '@/store/navStore';

export default function DriveScreen() {
  useKeepAwake();
  useSensorsWhileFocused();
  useFreeOrientationWhileFocused();
  // Every drive is a trip, with the adapter or with the GPS alone (Mis viajes).
  useFocusEffect(
    useCallback(() => {
      setDrivingScreen(true);
      return () => setDrivingScreen(false);
    }, []),
  );
  const router = useRouter();
  const route = useNavStore((s) => s.route);

  const exit = () => {
    if (route) navigation.stop();
    // After a reload the drive screen may be the only one: back to the map.
    if (router.canGoBack()) router.back();
    else router.replace('/mapa');
  };

  return (
    <View className="flex-1 bg-black">
      {/* Full screen: the clock and battery would sit on the HUD's buttons. */}
      <StatusBar hidden />
      <DriveMap />
      <DriveHud onExit={exit} />
    </View>
  );
}
