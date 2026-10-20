// Screen orientation for the screens used in the car mount.

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

// The driving map and the dashboard camera: any orientation the phone is in
// (mounted upright or sideways); back to portrait on leave. `active` false
// leaves the orientation alone (e.g. the dashboard showing its gauges).
export function useFreeOrientationWhileFocused(active = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      void ScreenOrientation.unlockAsync();
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      };
    }, [active]),
  );
}
