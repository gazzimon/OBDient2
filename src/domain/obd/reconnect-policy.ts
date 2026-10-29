// When to try the remembered adapter again (2026-10-29). The car comes and
// goes: it is off when the app opens, the driver walks away, the contact is
// cut. One try at launch was not enough; trying forever ignores the user.
//
// - A fresh reason to look (the app opens or comes back, Bluetooth turns on)
//   tries right away and starts the waits over.
// - After a failed try or a lost link: 5 s, 15 s, 30 s, then every minute,
//   while the app is in front.
// - "Desconectar" stops it until the user connects again or the app restarts.

export const RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000];

export class ReconnectPolicy {
  private stopped = false;
  private failures = 0;

  userStopped(): void {
    this.stopped = true;
  }

  connected(): void {
    this.stopped = false;
    this.failures = 0;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  // A fresh reason to look: true when it should try now.
  shouldTry(): boolean {
    if (this.stopped) return false;
    this.failures = 0;
    return true;
  }

  // After a failed try or a lost link: how long to wait, or null to stop.
  nextDelay(): number | null {
    if (this.stopped) return null;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)]!;
    this.failures++;
    return delay;
  }
}
