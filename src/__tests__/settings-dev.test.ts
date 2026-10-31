import { DEFAULT_ENDPOINTS, useSettingsStore } from '@/store/settingsStore';

// A driver build (no audience): jest hoists this above the import.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

describe('Ajustes › Dev', () => {
  it('a driver install starts without the development tools', () => {
    const s = useSettingsStore.getState();
    expect(s).toMatchObject({ devMode: false, recordTrips: false, labMode: false, audience: 'driver', shareScans: true });
  });

  it('switching Dev off turns every development tool off and brings the servers back', () => {
    const s = useSettingsStore.getState();
    s.setDevMode(true);
    s.setLabMode(true);
    s.setDebugOverlay(true);
    s.setRecordTrips(true);
    s.setEndpoints({ routingUrl: 'http://192.168.100.210:5000' });
    useSettingsStore.getState().setDevMode(false);
    expect(useSettingsStore.getState()).toMatchObject({ devMode: false, labMode: false, debugOverlay: false, recordTrips: false, ...DEFAULT_ENDPOINTS });
  });
});
