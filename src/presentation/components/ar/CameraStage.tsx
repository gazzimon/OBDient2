// Camera preview sized to an exact 16:9 rectangle, centred on the screen.
//
// The AR projection needs to know which pixel of the preview is which ray of
// the camera. Letting the preview "cover" the screen would crop an unknown
// margin; an explicit 16:9 box with ratio="16:9" keeps image and overlay in
// the same coordinates. The overlay receives the box size as its frame.

import { useState, type ReactNode } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PillButton } from '@/presentation/components/layout/PillButton';

const ASPECT = 16 / 9;

interface Props {
  children: (frame: { width: number; height: number }) => ReactNode;
}

export function CameraStage({ children }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const fitted = width / height > ASPECT ? { width: height * ASPECT, height } : { width, height: width / ASPECT };
    setBox(fitted);
  };

  if (!permission) return <View className="flex-1 bg-black" />;
  if (!permission.granted) {
    return (
      <View className="flex-1 bg-brand-bg items-center justify-center px-8 gap-4">
        <Text className="text-brand-text font-mono text-sm text-center">
          La guía AR necesita la cámara para dibujar la ruta sobre la calle.
        </Text>
        <PillButton label="Permitir cámara" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black items-center justify-center" onLayout={onLayout}>
      {box && (
        <View style={{ width: box.width, height: box.height }}>
          <CameraView style={{ width: box.width, height: box.height }} facing="back" ratio="16:9" />
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }}>
            {children(box)}
          </View>
        </View>
      )}
    </View>
  );
}
