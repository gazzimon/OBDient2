import { BATCH, MAX_QUEUED, TrackQueue, deviceIdFor, newDeviceId, trackDue } from '@/domain/trips/live-track';

const p = (t: number) => ({ t, lat: -27, lng: -55, kmh: 30, bearing: 90, acc: 5 });

describe('live track', () => {
  it('every 5 s moving, every minute stopped', () => {
    expect(trackDue(null, 0, 0)).toBe(true);
    expect(trackDue(0, 4_000, 40)).toBe(false);
    expect(trackDue(0, 5_000, 40)).toBe(true);
    expect(trackDue(0, 30_000, 0)).toBe(false);
    expect(trackDue(0, 60_000, 0)).toBe(true);
  });

  it('device ids are what Traccar accepts', () => {
    expect(newDeviceId()).toMatch(/^obd_[a-z0-9]{8}$/);
    // The adapter's Bluetooth address (Android gives the MAC).
    expect(deviceIdFor('00:1D:A5:68:98:8B')).toBe('obd_001da568988b');
    expect(deviceIdFor(null)).toBeNull();
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
