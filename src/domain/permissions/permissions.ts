// The app's permissions, one place (2026-10-19): what each is for, what stops
// working without it, and where to turn it on if Android no longer asks.
//
// Asked when the feature needs it, after a short explanation; never blocking
// the app. Android stops showing its dialog after two refusals ("blocked"):
// then only Settings can turn it on, and the app checks again on return.

export type PermissionKind = 'location' | 'bluetooth' | 'camera' | 'microphone';

// not_asked: Android's dialog will show · denied: refused, it can be asked
// again · blocked: only Settings.
export type PermissionStatus = 'granted' | 'not_asked' | 'denied' | 'blocked';

export type LastAnswer = 'denied' | 'never_ask_again' | null;

export function statusFrom(granted: boolean, last: LastAnswer): PermissionStatus {
  if (granted) return 'granted';
  if (last === 'never_ask_again') return 'blocked';
  return last === 'denied' ? 'denied' : 'not_asked';
}

export interface PermissionInfo {
  readonly title: string;
  readonly icon: string;
  // Why, in one line (the explanation before Android's dialog).
  readonly why: string;
  // What still works without it.
  readonly without: string;
  // Android's own name for it in Settings → Apps → OBDient2 → Permisos.
  readonly settingsName: string;
}

export const PERMISSIONS: Readonly<Record<PermissionKind, PermissionInfo>> = {
  location: {
    title: 'Ubicación',
    icon: 'map-marker-outline',
    why: 'Para guiarte, buscar lugares cerca y saber dónde está el auto.',
    without: 'Sin ubicación no hay navegación; el chat y los datos del auto siguen andando.',
    settingsName: 'Ubicación → Permitir solo mientras se usa la app',
  },
  bluetooth: {
    title: 'Bluetooth (dispositivos cercanos)',
    icon: 'bluetooth',
    why: 'Para conectar el adaptador OBD y leer el auto.',
    without: 'Sin Bluetooth no hay datos del auto; la navegación y el chat siguen andando.',
    settingsName: 'Dispositivos cercanos → Permitir',
  },
  camera: {
    title: 'Cámara',
    icon: 'camera-outline',
    why: 'Para dibujar la ruta sobre la calle y detectar autos y peatones.',
    without: 'Sin cámara, la guía sigue en el mapa, sin la vista sobre la calle.',
    settingsName: 'Cámara → Permitir solo mientras se usa la app',
  },
  microphone: {
    title: 'Micrófono',
    icon: 'microphone-outline',
    why: 'Para que le hables al asistente en vez de escribir.',
    without: 'Sin micrófono, el chat sigue por texto.',
    settingsName: 'Micrófono → Permitir solo mientras se usa la app',
  },
};

// Asked together at first start; the microphone waits until it is used.
export const ESSENTIAL: readonly PermissionKind[] = ['location', 'bluetooth', 'camera'];
export const ALL_PERMISSIONS: readonly PermissionKind[] = ['location', 'bluetooth', 'camera', 'microphone'];

export const SETTINGS_PATH = 'Ajustes → Apps → OBDient2 → Permisos';
