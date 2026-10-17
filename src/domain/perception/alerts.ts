// Driver alerts from the scene: deterministic rules, never the model's call
// (lesson from Qwen-Drive: models confuse causes when several urgencies
// coexist; priorities must be explicit).
//
//   fcw            forward collision: lead vehicle closing, TTC below threshold
//   headway        following too close: < 0.8 s behind the lead at speed
//   lead-departed  stopped behind a vehicle that has started moving
//   vru            pedestrian / cyclist / motorbike / animal in the ego path
//
// Thresholds follow common FCW practice (warning ~2.7 s, critical ~1.5 s) and
// adapt nothing to the model: they can be tuned from recorded trips.

import { VEHICLES, type ObjectClass } from './detection';
import type { PerceivedObject, Scene } from './scene';

export type AlertKind = 'fcw' | 'headway' | 'lead-departed' | 'vru';
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface DriverAlert {
  readonly kind: AlertKind;
  readonly level: AlertLevel;
  readonly trackId: number;
  readonly message: string; // Spanish, short enough to be spoken
}

export interface AlertTuning {
  readonly fcwWarningS: number;
  readonly fcwCriticalS: number;
  readonly fcwMinSpeedMps: number;
  readonly fcwMaxDistanceM: number;
  readonly headwayS: number;
  readonly headwayMinSpeedMps: number;
  readonly headwaySustainMs: number;
  readonly stoppedMps: number;
  readonly stoppedSustainMs: number;
  readonly departNearM: number;
  readonly departGainM: number;
  readonly vruLookaheadS: number;
  readonly vruMinM: number;
  readonly cooldownMs: number;
}

export const DEFAULT_ALERTS: AlertTuning = {
  fcwWarningS: 2.7,
  fcwCriticalS: 1.5,
  fcwMinSpeedMps: 3,
  fcwMaxDistanceM: 60,
  headwayS: 0.8,
  headwayMinSpeedMps: 8,
  headwaySustainMs: 2000,
  stoppedMps: 0.5,
  stoppedSustainMs: 2000,
  departNearM: 15,
  departGainM: 2.5,
  vruLookaheadS: 2.5,
  vruMinM: 8,
  cooldownMs: 6000,
};

const RANK: Record<AlertLevel, number> = { info: 0, warning: 1, critical: 2 };

export class AlertEngine {
  private lastFired = new Map<AlertKind, { t: number; level: AlertLevel }>();
  private headwaySince: number | null = null;
  private stoppedSince: number | null = null;
  // While stopped: the lead we are waiting behind and its closest distance.
  private waitingBehind: { trackId: number; minForwardM: number } | null = null;

  constructor(private readonly tuning: AlertTuning = DEFAULT_ALERTS) {}

  // Alerts to raise now (already filtered by cooldown), most urgent first.
  update(scene: Scene, egoSpeedMps: number, now: number): DriverAlert[] {
    const candidates = [
      this.fcw(scene.lead, egoSpeedMps),
      this.headway(scene.lead, egoSpeedMps, now),
      this.leadDeparted(scene.lead, egoSpeedMps, now),
      // The lead (e.g. a motorbike) is already covered by FCW: one warning per object.
      this.vru(scene.vrusInPath.filter((o) => o.trackId !== scene.lead?.trackId), egoSpeedMps),
    ].filter((a): a is DriverAlert => a != null);

    candidates.sort((a, b) => RANK[b.level] - RANK[a.level]);
    return candidates.filter((a) => this.admit(a, now));
  }

  private fcw(lead: PerceivedObject | null, v: number): DriverAlert | null {
    const t = this.tuning;
    if (!lead?.ttc || v < t.fcwMinSpeedMps) return null;
    if (lead.distance && lead.distance.forwardM > t.fcwMaxDistanceM) return null;
    const ttc = lead.ttc.ttcS;
    if (ttc < t.fcwCriticalS) return { kind: 'fcw', level: 'critical', trackId: lead.trackId, message: '¡Frena!' };
    if (ttc < t.fcwWarningS) {
      return { kind: 'fcw', level: 'warning', trackId: lead.trackId, message: 'Atención, vehículo adelante' };
    }
    return null;
  }

  private headway(lead: PerceivedObject | null, v: number, now: number): DriverAlert | null {
    const t = this.tuning;
    const close = lead?.distance != null && v >= t.headwayMinSpeedMps && lead.distance.forwardM / v < t.headwayS;
    if (!close) {
      this.headwaySince = null;
      return null;
    }
    this.headwaySince ??= now;
    if (now - this.headwaySince < t.headwaySustainMs) return null;
    return { kind: 'headway', level: 'warning', trackId: lead!.trackId, message: 'Mantén la distancia' };
  }

  private leadDeparted(lead: PerceivedObject | null, v: number, now: number): DriverAlert | null {
    const t = this.tuning;
    if (v > t.stoppedMps) {
      this.stoppedSince = null;
      this.waitingBehind = null;
      return null;
    }
    this.stoppedSince ??= now;
    if (now - this.stoppedSince < t.stoppedSustainMs) return null;

    if (!lead?.distance) return null;
    const d = lead.distance.forwardM;
    const w = this.waitingBehind;
    if (!w || w.trackId !== lead.trackId) {
      this.waitingBehind = d <= t.departNearM ? { trackId: lead.trackId, minForwardM: d } : null;
      return null;
    }
    w.minForwardM = Math.min(w.minForwardM, d);
    // Shrinking in the image confirms it is moving away, not just box noise.
    const movingAway = d - w.minForwardM >= t.departGainM && (lead.ttc?.rate ?? 0) < -0.05;
    if (!movingAway) return null;
    this.waitingBehind = null;
    return { kind: 'lead-departed', level: 'info', trackId: lead.trackId, message: 'El de adelante arrancó' };
  }

  private vru(vrus: readonly PerceivedObject[], v: number): DriverAlert | null {
    const t = this.tuning;
    const reach = Math.max(t.vruMinM, v * t.vruLookaheadS);
    let best: DriverAlert | null = null;
    for (const o of vrus) {
      const near = o.distance ? o.distance.forwardM <= reach : false;
      const imminent = o.ttc != null && o.ttc.ttcS < t.fcwCriticalS && v >= t.fcwMinSpeedMps;
      if (!near && !imminent) continue;
      const level: AlertLevel = imminent ? 'critical' : 'warning';
      if (!best || RANK[level] > RANK[best.level]) {
        best = { kind: 'vru', level, trackId: o.trackId, message: vruMessage(o.cls, imminent) };
      }
    }
    return best;
  }

  // Cooldown per kind; a more severe level always gets through.
  private admit(a: DriverAlert, now: number): boolean {
    const last = this.lastFired.get(a.kind);
    if (last && now - last.t < this.tuning.cooldownMs && RANK[a.level] <= RANK[last.level]) return false;
    this.lastFired.set(a.kind, { t: now, level: a.level });
    return true;
  }
}

function vruMessage(cls: ObjectClass, imminent: boolean): string {
  if (imminent) return '¡Frena!';
  if (cls === 'person') return 'Peatón adelante';
  if (cls === 'bicycle') return 'Ciclista adelante';
  if (cls === 'animal') return 'Animal en el camino';
  return VEHICLES.has(cls) ? 'Moto adelante' : 'Atención adelante';
}
