// Keeps the sensor fusion running while the calling screen is focused.

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { container } from '@/data/container';

export function useSensorsWhileFocused(): void {
  useFocusEffect(
    useCallback(() => {
      void container.sensors.acquire();
      return () => container.sensors.release();
    }, []),
  );
}
