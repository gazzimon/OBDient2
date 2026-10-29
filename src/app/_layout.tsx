import '../global.css';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SystemUI from 'expo-system-ui';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  useFonts,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import { ClearDtcsModal } from '@/presentation/components/assistant/ClearDtcsModal';
import { ProbeScanModal } from '@/presentation/components/assistant/ProbeScanModal';
import { Onboarding } from '@/presentation/components/onboarding/Onboarding';
import { PermissionSheet } from '@/presentation/components/permissions/PermissionSheet';
import { restoreAccount } from '@/presentation/hooks/useAccount';
import { NAVIGATION_TOOL_NAMES, navigationTools } from '@/presentation/services/navigation-tools';
import { container } from '@/data/container';
import { MagicRelayer } from '@/data/auth/magic-identity';
import { myTrips } from '@/presentation/services/my-trips';
import { baselineRecorder } from '@/presentation/services/baseline-recorder';
import { connectionKeeper } from '@/presentation/services/connection-keeper';
import { parkingRecorder } from '@/presentation/services/parking-recorder';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_700Bold,
  });

  useEffect(() => {
    // Portrait everywhere except the AR screens, which lock landscape themselves.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    // The window behind everything: dark, or a white strip shows while the keyboard moves.
    void SystemUI.setBackgroundColorAsync('#0D0D0D');
    // The remembered adapter reconnects quietly, and again when it comes back;
    // navigation never waits for it.
    connectionKeeper.start();
    // "Dónde estacioné": the position when the adapter link goes.
    parkingRecorder.start();
    // Who was signed in, from SecureStore; no network.
    void restoreAccount();
    // "Llevame a…" from the assistant drives the navigation.
    container.setNavigationTools(NAVIGATION_TOOL_NAMES, navigationTools);
    // "Mis viajes": records by itself while the adapter is connected.
    myTrips.start();
    // What is normal for each car: learnt by itself, compared by the diagnosis.
    baselineRecorder.start();
    container.setBaselineSource((vin) => baselineRecorder.compare(vin));
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0D0D0D' }} />;
  }

  return (
    // Keyboard handling that works edge-to-edge (Android 15+), where React
    // Native's own KeyboardAvoidingView does nothing.
    <KeyboardProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0D0D0D' },
        }}
      />
      {/* First run: welcome and safety, account, adapter, ready. */}
      <Onboarding />
      <ClearDtcsModal />
      <ProbeScanModal />
      {/* The explanation before a permission, whoever asks for it. */}
      <PermissionSheet />
      {/* Magic's code and device-approval screens (email login, ADR-0008). Last, so it draws on top. */}
      <MagicRelayer />
    </KeyboardProvider>
  );
}
