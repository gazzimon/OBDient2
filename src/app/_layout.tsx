import '../global.css';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  useFonts,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import { ClearDtcsModal } from '@/presentation/components/assistant/ClearDtcsModal';
import { AccountGate } from '@/presentation/components/feedback/AccountGate';
import { DisclaimerGate } from '@/presentation/components/feedback/Disclaimer';
import { restoreAccount } from '@/presentation/hooks/useAccount';
import { APP_TOOL_NAMES, appTools } from '@/presentation/services/app-tools';
import { container } from '@/data/container';
import { MagicRelayer } from '@/data/auth/magic-identity';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_700Bold,
  });

  useEffect(() => {
    // Portrait everywhere except the AR screens, which lock landscape themselves.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    // The remembered adapter reconnects quietly; navigation never waits for it.
    void container.obd.reconnectLast();
    // Who was signed in, from SecureStore; no network.
    void restoreAccount();
    // "Llevame a…" from the assistant drives the navigation.
    container.setNavigationTools(APP_TOOL_NAMES, appTools);
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0D0D0D' }} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0D0D0D' },
        }}
      />
      <DisclaimerGate />
      <AccountGate />
      <ClearDtcsModal />
      {/* Magic's code and device-approval screens (email login, ADR-0008). Last, so it draws on top. */}
      <MagicRelayer />
    </>
  );
}
