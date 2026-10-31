// The module scan (M9): which modules answer on the car's buses, at which
// addresses, and who they are (F187, else F190). One implementation for every
// way in: the assistant's scan_modules and the app's own screen run this, and
// both get the same report (domain/obd/module-scan-report.ts), saved on the phone.
//
// Needs the link alone: the telemetry pauses while it runs, and the adapter is
// put back as the telemetry needs it at the end, also when cancelled.

import { isCan } from '@/data/adapters/elm-protocol';
import {
  BUS_PRESET,
  FUNCTIONAL_11,
  FUNCTIONAL_29,
  FUNCTIONAL_PROBE,
  identifyReply,
  mergeTargets,
  moduleAnswered,
  needsFlowPair,
  protocolToPreset,
  respondersFrom,
  scanTargets,
  SCAN_IDENTIFY,
  SCAN_PROBE,
  udsReply,
  urhCommand,
  type Bus,
  type ScanPath,
  type ScanProgressEvent,
  type ScanProgressListener,
  type ScanTarget,
} from '@/domain/obd/module-scan';
import { applyScanEvent, finishReport, initialScanState, type MakeAddresses, type ModuleScanLog, type ModuleScanReport } from '@/domain/obd/module-scan-report';
import { makeFromVin } from '@/domain/obd/vin-make';
import type { ObdSession } from './obd-session';
import { quiet } from './stn';
import { identifyText } from './uds-frames';

export class ModuleScanCancelled extends Error {}

export interface ModuleScanDeps {
  // The VIN, read once per session (VehicleToolAdapter.ensureVin).
  readonly vin: () => Promise<string | null>;
  // The addresses the lab knows for a make (obdient-tools).
  readonly knownTargets?: (make: string, model: string | null, signal: AbortSignal) => Promise<ScanTarget[]>;
  readonly log?: ModuleScanLog;
  readonly now?: () => number;
}

export class ModuleScanService {
  // Request → response ID of each module found, per session: the maker's pairing
  // (714 → 77E), which obd_command and did_probe need to filter the answer and
  // send its FlowControl.
  private readonly pairsBySession = new WeakMap<ObdSession, Map<string, string>>();

  constructor(
    private readonly session: () => ObdSession | null,
    private readonly deps: ModuleScanDeps,
  ) {}

  pairs(s: ObdSession): ReadonlyMap<string, string> | undefined {
    return this.pairsBySession.get(s);
  }

  async scan(request: { make?: string | null; model?: string | null }, signal: AbortSignal, onProgress?: ScanProgressListener): Promise<ModuleScanReport> {
    const s = this.session();
    if (!s?.sessionInfo) throw new Error('Session not open');
    const info = s.sessionInfo;
    const bit29 = /29BIT/.test(info.protocol);
    const isStn = info.identity.stn != null;
    let state = initialScanState();
    const emit = (event: ScanProgressEvent) => {
      state = applyScanEvent(state, event);
      onProgress?.(event);
    };
    emit({ type: 'scan-started', protocol: info.protocol });
    const vin = await this.deps.vin();
    // The make's own addresses (ABS, airbag, body…): OBD's 7E0–7E7 and the
    // 7DF broadcast only reach engine and gearbox.
    const make = request.make?.toLowerCase() ?? makeFromVin(vin);
    const model = request.model ?? null;
    let makeStatus: MakeAddresses = make ? 'none' : 'no-make';
    let makeTargets: ScanTarget[] = [];
    if (make && this.deps.knownTargets) {
      try {
        makeTargets = await this.deps.knownTargets(make, model, signal);
        if (makeTargets.length) makeStatus = 'loaded';
      } catch {
        if (signal.aborted) throw new ModuleScanCancelled();
        makeStatus = 'failed';
        emit({ type: 'lookup-warning', message: 'No se pudieron cargar direcciones conocidas de la marca; se probarán solo direcciones genéricas.' });
      }
    }

    type Found = ScanTarget & { bus: Bus; identify: string | null };
    const result = await s.exclusive(async (port) => {
      await quiet(port, 'ATH1');
      // Which path: the B33-U vendor UDS set (firmware does ISO-TP) if it takes
      // AT UDS1, else the STN/ELM header path.
      const udsAt = (await quiet(port, 'AT UDS1')) != null;
      const path: ScanPath = udsAt ? 'uds-at' : 'stn';

      // Which buses are reachable: HS always; MS/SW only on STN that accept the
      // preset (the B14 has no SW-CAN, so STP 63 returns '?').
      const buses: Bus[] = ['HS'];
      if (isStn && !udsAt) {
        for (const bus of ['MS', 'SW'] as Bus[]) {
          const ok = await quiet(port, `STP ${bit29 ? BUS_PRESET[bus].bit29 : BUS_PRESET[bus].bit11}`);
          if (ok != null && !/\?|ERR/i.test(ok)) buses.push(bus);
          else emit({ type: 'bus-skipped', bus, status: 'unavailable' });
        }
        // Restore HS before scanning (the probes above left us on SW).
        await quiet(port, `STP ${protocolToPreset(info.protocol)}`);
        await quiet(port, 'STPO');
        await quiet(port, 'ATH1');
      } else {
        for (const bus of ['MS', 'SW'] as Bus[]) emit({ type: 'bus-skipped', bus, status: 'not-tested' });
      }

      const out: Found[] = [];
      const seen = new Set<string>();
      let skipped = { otherWidth: 0, overLimit: 0 };
      let elmFlow = false;
      // FlowControl to the module's own request ID when the adapter's default
      // (RxID − 8, or 29-bit swap) misses it. On the STN a custom pair turns the
      // default off for every other ID, so pairs are cleared before each module.
      const flowFor = async (t: ScanTarget) => {
        if (isStn) {
          await quiet(port, 'STCFCPC');
          if (needsFlowPair(t)) await quiet(port, `STCFCPA ${t.reqHeader}, ${t.rxHeader}`);
        } else if (needsFlowPair(t)) {
          await quiet(port, `ATFCSH ${t.reqHeader}`);
          await quiet(port, 'ATFCSD 30 00 00');
          elmFlow = (await quiet(port, 'ATFCSM 1')) != null;
        } else if (elmFlow) {
          await quiet(port, 'ATFCSM 0');
          elmFlow = false;
        }
      };
      try {
        for (const bus of buses) {
          if (signal.aborted) throw new ModuleScanCancelled();
          if (bus !== 'HS') {
            await quiet(port, `STP ${bit29 ? BUS_PRESET[bus].bit29 : BUS_PRESET[bus].bit11}`);
            await quiet(port, 'STPO');
            await quiet(port, 'ATH1');
          }
          const generic = [...scanTargets(bit29)];
          // STN: a functional broadcast finds modules no list has.
          if (path === 'stn') {
            await quiet(port, `ATSH ${bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11}`);
            await quiet(port, 'ATCRA').catch(() => undefined);
            const broadcast = await quiet(port, FUNCTIONAL_PROBE, 2500);
            for (const r of broadcast ? respondersFrom(broadcast, bit29) : []) if (!generic.some((c) => c.id === r.id)) generic.unshift(r);
          }
          const merged = mergeTargets(generic, makeTargets, bit29);
          skipped = { otherWidth: merged.otherWidth, overLimit: merged.overLimit };
          emit({ type: 'bus-started', bus, totalTargets: merged.targets.length });
          const foundBeforeBus = out.length;
          for (const [index, t] of merged.targets.entries()) {
            if (signal.aborted) throw new ModuleScanCancelled();
            if (seen.has(`${bus}:${t.id}`)) continue;
            let present: boolean;
            let identify: string | null = null;
            let identitySource: 'F187' | 'F190' | null = null;
            if (path === 'uds-at') {
              const probe = await quiet(port, urhCommand(t.reqHeader, t.rxHeader, SCAN_PROBE), 1500);
              present = probe != null && udsReply(probe, SCAN_PROBE) !== '';
            } else {
              await quiet(port, `ATSH ${t.reqHeader}`);
              // Only this module's answer; the default filter takes 7E8–7EF only,
              // so VW 77D, GM 641 or PSA 652 were dropped.
              await quiet(port, `ATCRA ${t.rxHeader}`);
              await flowFor(t);
              const probe = await quiet(port, SCAN_PROBE, 1200);
              present = probe != null && moduleAnswered(probe);
            }
            emit({ type: 'target-checked', bus, completed: index + 1, total: merged.targets.length, targetId: t.id, responded: present });
            if (!present) continue;
            emit({ type: 'module-found', bus, module: t });
            for (const req of SCAN_IDENTIFY) {
              const raw = path === 'uds-at' ? await quiet(port, urhCommand(t.reqHeader, t.rxHeader, req), 1500) : await quiet(port, req, 1500);
              identify = identifyReply(raw && path === 'uds-at' ? udsReply(raw, req) : raw, req);
              if (identify && raw && path === 'stn') identify = identifyText(raw, isCan(info.protocol));
              if (identify) {
                identitySource = req.endsWith('F187') ? 'F187' : 'F190';
                break;
              }
            }
            seen.add(`${bus}:${t.id}`);
            out.push({ ...t, bus, identify });
            emit({ type: 'module-identified', bus, moduleId: t.id, source: identitySource });
          }
          emit({ type: 'bus-finished', bus, modulesFound: out.length - foundBeforeBus });
        }
      } finally {
        if (buses.length > 1) {
          await quiet(port, `STP ${protocolToPreset(info.protocol)}`).catch(() => undefined);
          await quiet(port, 'STPO').catch(() => undefined);
        }
        if (udsAt) await quiet(port, 'AT UDS0').catch(() => undefined);
        if (isStn) await quiet(port, 'STCFCPC').catch(() => undefined);
        else if (elmFlow) await quiet(port, 'ATFCSM 0').catch(() => undefined);
        await quiet(port, 'ATCRA').catch(() => undefined);
        // The last module's header would stay: telemetry asks the functional one.
        await quiet(port, `ATSH ${bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11}`).catch(() => undefined);
        await quiet(port, 'ATH0').catch(() => undefined);
      }
      emit({ type: 'scan-finished', busesScanned: buses, modulesFound: out.length });
      return { out, path, skipped };
    });

    const pairs = this.pairsBySession.get(s) ?? new Map<string, string>();
    for (const m of result.out) pairs.set(m.reqHeader, m.rxHeader);
    this.pairsBySession.set(s, pairs);
    const report = finishReport(
      state,
      {
        at: (this.deps.now ?? Date.now)(),
        vin,
        make,
        model,
        protocol: info.protocol,
        adapter: info.identity.stn ?? info.identity.elm ?? 'adaptador',
        path: result.path,
        makeAddresses: { status: makeStatus, count: makeTargets.length },
        skipped: result.skipped,
      },
      new Map(result.out.filter((m) => m.identify != null).map((m) => [`${m.bus}:${m.id}`, m.identify!])),
    );
    // A full report or none: a cancelled scan says less than it seems.
    this.deps.log?.add(report);
    return report;
  }
}
