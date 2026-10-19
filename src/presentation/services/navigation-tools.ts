// The app's navigation tools for the assistant: the real geocoder, GPS and
// navigation controller behind NavigationTools (domain/navigation).

import * as Location from 'expo-location';
import { router } from 'expo-router';
import { container } from '@/data/container';
import { followLink } from '@/data/routing/follow-link';
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
  state: () => useNavStore.getState(),
  followLink: (url, signal) => followLink(url, signal),
  remote: {
    fuel: (here, product, signal) =>
      container.toolsClient.post('fuel', { lat: here.lat, lng: here.lng, ...(product ? { product } : {}) }, signal, 'Los precios de combustible'),
    weather: (at, signal) => container.toolsClient.post('weather', { lat: at.lat, lng: at.lng }, signal, 'El pronóstico'),
  },
});
