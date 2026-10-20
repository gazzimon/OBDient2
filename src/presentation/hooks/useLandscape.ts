// Locks landscape while the calling screen is focused (either side, so the
// phone mount can face any way), and returns to portrait on leave.

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

export function useLandscapeWhileFocused(): void {
  useFocusEffect(
    useCallback(() => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      };
    }, []),
  );
}

// The driving map: any orientation the phone is in (mounted upright or
// sideways); back to portrait on leave. The AR camera needs landscape.
export function useDriveOrientationWhileFocused(landscape: boolean): void {
  useFocusEffect(
    useCallback(() => {
      void (landscape
        ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
        : ScreenOrientation.unlockAsync());
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      };
    }, [landscape]),
  );
}
