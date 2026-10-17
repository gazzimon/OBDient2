// Driver alert, big and short-lived, over everything while driving.
// Freshness is judged against the detector's own clock (render stays pure).

import { Text, View } from 'react-native';
import { usePerceptionStore } from '@/store/perceptionStore';

const VISIBLE_MS = 2500;

export function AlertFlash() {
  const alert = usePerceptionStore((s) => s.lastAlert);
  const updatedAt = usePerceptionStore((s) => s.updatedAt);
  if (!alert || alert.level === 'info' || updatedAt - alert.at > VISIBLE_MS) {
    // 'info' (e.g. "el de adelante arrancó") is spoken only: no flash needed.
    return null;
  }
  const critical = alert.level === 'critical';
  return (
    <View pointerEvents="none" className="absolute top-3 left-0 right-0 items-center">
      <View
        className={`px-6 py-3 rounded-2xl border-2 ${critical ? 'bg-brand-red border-brand-red' : 'bg-brand-surface/95 border-brand-amber'}`}
      >
        <Text className={`font-mono-bold ${critical ? 'text-3xl text-brand-bg' : 'text-xl text-brand-amber'}`}>
          {alert.message}
        </Text>
      </View>
    </View>
  );
}
