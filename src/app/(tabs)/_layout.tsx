import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, type ColorValue } from 'react-native';
import { TopStatusBar } from '@/presentation/components/layout/TopStatusBar';
import { COLORS } from '@/presentation/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color} size={size} />;
  }
  return TabBarIcon;
}

export default function TabsLayout() {
  return (
    // The adapter and the account, always in sight above every tab.
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopStatusBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: COLORS.mint,
          tabBarInactiveTintColor: COLORS.muted,
          tabBarStyle: {
            backgroundColor: COLORS.bg,
            borderTopColor: COLORS.border,
            borderTopWidth: 1,
          },
          tabBarLabelStyle: {
            fontFamily: 'IBMPlexMono_400Regular',
            fontSize: 10,
          },
          sceneStyle: { backgroundColor: COLORS.bg },
        }}
      >
        {/* The app opens on Inicio (the assistant's start screen, decision 2026-10-31). */}
        <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: tabIcon('chat-processing-outline') }} />
        <Tabs.Screen name="diagnostico" options={{ title: 'Diagnóstico', tabBarIcon: tabIcon('car-wrench') }} />
        <Tabs.Screen name="mapa" options={{ title: 'Mapa', tabBarIcon: tabIcon('map-marker-path') }} />
        <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: tabIcon('cog-outline') }} />
      </Tabs>
    </View>
  );
}
