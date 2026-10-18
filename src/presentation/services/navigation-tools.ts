// The app's navigation tools for the assistant: the real geocoder, GPS and
// navigation controller behind NavigationTools (domain/navigation).

import * as Location from 'expo-location';
import { router } from 'expo-router';
import { container } from '@/data/container';
import { NavigationTools } from '@/domain/navigation/navigation-tools';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { navigation } from './navigation-controller';

export { NAVIGATION_TOOL_NAMES } from '@/domain/navigation/navigation-tools';

// The app's instance.
export const navigationTools = new NavigationTools({
  geocoder: () => container.geocoder(),
  position: async () => {
    const ego = useEgoStore.getState().ego;
    if (ego) return ego.position;
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
  },
  planTo: (place) => navigation.planTo(place),
  start: () => navigation.start(),
  stop: () => navigation.stop(),
  openDrive: () => router.push('/drive'),
  // The Ruta tab shows the planned route with its "Iniciar" button.
  openMap: () => router.navigate('/'),
  state: () => useNavStore.getState(),
});
