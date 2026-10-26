import { BATCH, MAX_QUEUED, TrackQueue, carOf, trackDeviceFor, trackDue } from '@/domain/trips/live-track';

const p = (t: number) => ({ t, lat: -27, lng: -55, kmh: 30, bearing: 90, acc: 5 });

describe('live track', () => {
  it('every 5 s moving, every minute stopped', () => {
    expect(trackDue(null, 0, 0)).toBe(true);
    expect(trackDue(0, 4_000, 40)).toBe(false);
    expect(trackDue(0, 5_000, 40)).toBe(true);
    expect(trackDue(0, 30_000, 0)).toBe(false);
    expect(trackDue(0, 60_000, 0)).toBe(true);
  });

  it('device ids are what Traccar accepts and do not show the adapter address', () => {
    const salt = 'a'.repeat(32);
    // The adapter's Bluetooth address (Android gives the MAC).
    const id = trackDeviceFor(salt, '00:1D:A5:68:98:8B');
    expect(id).toMatch(/^obd_[0-9a-f]{16}$/);
    expect(id).not.toContain('001da568988b');
    // The same adapter on the same phone is the same device; formatting does not matter.
    expect(trackDeviceFor(salt, '001DA568988B')).toBe(id);
    // Another install, or another adapter, is another device.
    expect(trackDeviceFor('b'.repeat(32), '00:1D:A5:68:98:8B')).not.toBe(id);
    expect(trackDeviceFor(salt, '00:1D:A5:68:98:8C')).not.toBe(id);
    // No address: the phone itself, still stable.
    expect(trackDeviceFor(salt, null)).toMatch(/^obd_[0-9a-f]{16}$/);
    expect(trackDeviceFor(salt, null)).toBe(trackDeviceFor(salt, ''));
  });

  it('the lab gets the car (first 11 characters of the VIN), never its serial', () => {
    expect(carOf('8AGEA76C0RR000043')).toBe('8AGEA76C0RR');
    expect(carOf(null)).toBeNull();
    expect(carOf('8AG')).toBeNull();
  });

  it('queues while offline, sends oldest first in batches, drops the oldest beyond the cap', () => {
    const q = new TrackQueue();
    for (let i = 0; i < MAX_QUEUED + 10; i++) q.push(p(i));
    expect(q.size).toBe(MAX_QUEUED);
    const batch = q.next();
    expect(batch).toHaveLength(BATCH);
    expect(batch[0]!.t).toBe(10);
    q.sent(batch.length);
    expect(q.next()[0]!.t).toBe(10 + BATCH);
  });
});
