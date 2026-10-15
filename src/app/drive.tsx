// AR guidance: camera + route drawn on the road + HUD. Landscape, screen on.

import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { ArOverlay } from '@/presentation/components/ar/ArOverlay';
import { CameraStage } from '@/presentation/components/ar/CameraStage';
import { DriveHud } from '@/presentation/components/ar/DriveHud';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { useLandscapeWhileFocused } from '@/presentation/hooks/useLandscape';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { useNavStore } from '@/store/navStore';

export default function DriveScreen() {
  useKeepAwake();
  useLandscapeWhileFocused();
  useSensorsWhileFocused();
  const router = useRouter();
  const route = useNavStore((s) => s.route);

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
      <CameraStage>{({ width, height }) => <ArOverlay width={width} height={height} />}</CameraStage>
      <DriveHud onExit={exit} />
    </View>
  );
}
