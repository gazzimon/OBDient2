import { ALL_PERMISSIONS, ESSENTIAL, PERMISSIONS, statusFrom } from '@/domain/permissions/permissions';

describe('permissions', () => {
  it('state from Android: granted wins; never_ask_again is blocked', () => {
    expect(statusFrom(true, 'never_ask_again')).toBe('granted');
    expect(statusFrom(false, null)).toBe('not_asked');
    expect(statusFrom(false, 'denied')).toBe('denied');
    expect(statusFrom(false, 'never_ask_again')).toBe('blocked');
  });

  it('every permission says why, what still works, and where to turn it on', () => {
    for (const k of ALL_PERMISSIONS) {
      expect(PERMISSIONS[k].why.length).toBeGreaterThan(10);
      expect(PERMISSIONS[k].without).toMatch(/^Sin /);
      expect(PERMISSIONS[k].settingsName).toMatch(/Permitir/);
    }
  });

  it('the microphone is not asked at first start', () => {
    expect(ESSENTIAL).not.toContain('microphone');
  });
});
