import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
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
      <Tabs.Screen name="index" options={{ title: 'Ruta', tabBarIcon: tabIcon('map-marker-path') }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Tablero', tabBarIcon: tabIcon('gauge') }} />
      <Tabs.Screen name="vehicle" options={{ title: 'Vehículo', tabBarIcon: tabIcon('car-connected') }} />
      <Tabs.Screen name="assistant" options={{ title: 'Asistente', tabBarIcon: tabIcon('chat-processing-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: tabIcon('cog-outline') }} />
    </Tabs>
  );
}
