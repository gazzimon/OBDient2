// Camera probe: what this phone exposes to apps (ADR-0005, "varias cámaras").
//
// Lists every camera device VisionCamera sees — position, type, physical
// sub-cameras of a logical camera, focal length, zoom range and the zoom
// factors where the logical camera switches lens (a lens switch through zoom
// keeps the stream running, unlike reopening another camera). Shareable as
// text, like the adapter bench.

import { ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCameraDevices, type CameraDevice } from 'react-native-vision-camera';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';

function describe(d: CameraDevice): string {
  const fps = d.supportedFPSRanges.reduce((m, r) => Math.max(m, r.max), 0);
  const lines = [
    `${d.position} · ${d.type}${d.isVirtualDevice ? ' (lógica)' : ''} · id ${d.id}`,
    `  ${d.localizedName}`,
    `  focal ${d.focalLength != null ? `${d.focalLength.toFixed(2)} mm` : '—'} · f/${d.lensAperture.toFixed(1)} · hasta ${fps} fps`,
    `  zoom ${d.minZoom.toFixed(1)}–${d.maxZoom.toFixed(1)}×${
      d.zoomLensSwitchFactors.length ? ` · cambia de lente en ${d.zoomLensSwitchFactors.map((z) => `${z.toFixed(1)}×`).join(', ')}` : ''
    }`,
  ];
  for (const p of d.physicalDevices) {
    lines.push(`  └ física: ${p.type} · focal ${p.focalLength != null ? `${p.focalLength.toFixed(2)} mm` : '—'} · id ${p.id}`);
  }
  return lines.join('\n');
}

export default function CamerasScreen() {
  const router = useRouter();
  const devices = useCameraDevices();
  const report = devices.length ? devices.map(describe).join('\n\n') : 'Ninguna cámara visible todavía.';
  const back = devices.filter((d) => d.position === 'back');
  const multi = back.some((d) => d.isVirtualDevice && d.physicalDevices.length > 1);

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
        <SectionHeader title="Cámaras del teléfono" />
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          {`${devices.length} dispositivos · ${back.length} traseros · ${
            multi ? 'hay una cámara lógica con varias lentes' : 'sin cámara lógica multi-lente visible'
          }`}
        </Text>
        <View className="bg-brand-surface rounded-2xl p-3">
          <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
            {report}
          </Text>
        </View>
        <View className="flex-row gap-3 mt-4">
          <View className="flex-1">
            <PillButton label="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
          <View className="flex-1">
            <PillButton label="Compartir" onPress={() => void Share.share({ message: `OBDient2 · cámaras\n\n${report}` })} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
