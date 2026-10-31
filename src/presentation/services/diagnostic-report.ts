// "Informe PDF" (2026-10-28): reads the car with the assistant's own tools,
// builds the page (domain/report) and hands the PDF to the share sheet. The
// last ten stay in the app's documents (Diagnóstico › Informes, 2026-10-31);
// nothing is uploaded.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { container } from '@/data/container';
import { PID_LABEL } from '@/domain/assistant/offline';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import { MONITOR_LABEL } from '@/domain/obd/capture-digest';
import type { MonitorId } from '@/core/utils/obdDiagnostics';
import { makeFromVin } from '@/domain/obd/vin-make';
import { buildReportHtml, type ReportCode, type ReportData } from '@/domain/report/diagnostic-report';
import { describeBaseline } from '@/domain/vehicle/baseline';
import type { FaultEvent } from '@/domain/faults/fault-history';
import { baselineRecorder } from '@/presentation/services/baseline-recorder';
import { useOBDStore } from '@/store/obdStore';

// A4 in points.
const PAGE = { width: 595, height: 842 } as const;
const LIVE_PIDS: readonly PidId[] = ['RPM', 'SPEED', 'COOLANT_TEMP', 'ENGINE_LOAD', 'VOLTAGE', 'FUEL_TRIM_SHORT', 'FUEL_TRIM_LONG', 'INTAKE_MAP'];
const HISTORY_ROWS = 8;
const SERVICE_ROWS = 8;
// A read that does not answer in this time is left out of the report.
const READ_MS = 15_000;

export type ReportStep = 'reading' | 'diagnosing' | 'printing';

export async function shareDiagnosticReport(
  opts: { readonly workshop: string | null; readonly notes: string | null; readonly symptoms: string | null },
  onStep: (s: ReportStep) => void = () => undefined,
): Promise<void> {
  const data = await gather(opts, onStep);
  onStep('printing');
  const { uri } = await Print.printToFileAsync({ html: buildReportHtml(data), ...PAGE });
  await shareReportFile(keep(uri, data));
}

// Into documents/informes, listed with the last ten; older files are deleted.
function keep(printed: string, data: ReportData): string {
  try {
    const dir = new Directory(Paths.document, 'informes');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `informe-${data.generatedAt}.pdf`);
    new File(printed).moveSync(file);
    const dropped = container.savedReports.add({
      id: `r-${data.generatedAt.toString(36)}`,
      at: data.generatedAt,
      uri: file.uri,
      vin: data.vin,
      make: data.make,
      codes: data.storedCodes?.map((c) => c.code) ?? null,
      workshop: data.workshop,
    });
    for (const r of dropped) deleteFile(r.uri);
    return file.uri;
  } catch {
    // Not kept, still shared.
    return printed;
  }
}

export async function shareReportFile(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Compartir informe' });
}

export function deleteSavedReport(id: string): void {
  const gone = container.savedReports.remove(id);
  if (gone) deleteFile(gone.uri);
}

function deleteFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

async function gather(
  opts: { readonly workshop: string | null; readonly notes: string | null; readonly symptoms: string | null },
  onStep: (s: ReportStep) => void,
): Promise<ReportData> {
  const connected = useOBDStore.getState().connectionState === 'connected';
  let storedCodes: ReportCode[] | null = null;
  let pendingCodes: ReportCode[] | null = null;
  let readiness: ReportData['readiness'] = null;
  const live: { label: string; value: string }[] = [];
  if (connected) {
    onStep('reading');
    await container.vehicleTools.ensureVin();
    storedCodes = codesOf(await run({ name: 'read_dtcs', kind: 'stored' }));
    pendingCodes = codesOf(await run({ name: 'read_dtcs', kind: 'pending' }));
    readiness = readinessOf(await run({ name: 'read_readiness' }));
    const supported = new Set<PidId>([...container.vehicleTools.supportedPids(), 'VOLTAGE']);
    const pids = LIVE_PIDS.filter((p) => supported.has(p));
    const values = pids.length ? await run({ name: 'read_pids', pids }) : null;
    if (values?.ok) {
      const d = values.data as Partial<Record<PidId, { value: number | null; unit: string }>>;
      for (const p of pids) {
        const v = d[p]?.value;
        if (v != null) live.push({ label: PID_LABEL[p] ?? PID_DEFINITIONS[p].name, value: `${num(v)} ${PID_DEFINITIONS[p].unit}` });
      }
    }
  }
  onStep('diagnosing');
  const diagnosis = await run({ name: 'diagnose', symptoms: opts.symptoms });
  const vin = container.vehicleTools.knownVin();
  const car = container.baselines.get(vin);
  const unusual = baselineRecorder.compare(vin).deviations.map((d) => `${d.label}: ${num(d.value)} ${d.unit} (lo habitual es ${num(d.usual)})`);
  return {
    generatedAt: Date.now(),
    vin,
    make: makeFromVin(vin),
    workshop: opts.workshop?.trim() || null,
    adapter: adapterName(),
    storedCodes,
    pendingCodes,
    readiness,
    live,
    hypotheses: hypothesesOf(diagnosis),
    unusual,
    baseline: car ? describeBaseline(car).map(({ label, text }) => ({ label, text })) : [],
    history: (vin ? container.faults.list(vin) : []).slice(0, HISTORY_ROWS).map((e) => ({ at: e.at, text: historyText(e) })),
    service: container.serviceLog
      .list()
      .filter((e) => vin != null && e.vin === vin)
      .slice(0, SERVICE_ROWS)
      .map((e) => ({ at: e.at, item: e.item, km: e.km })),
    notes: opts.notes,
  };
}

// "B35 · STN1040 v1.3.6": the adapter's name and its chip, when connected.
function adapterName(): string | null {
  const { deviceName, session } = useOBDStore.getState();
  const chip = session ? (session.identity.stn ?? (session.identity.elm || null)) : null;
  return [deviceName, chip].filter(Boolean).join(' · ') || null;
}

async function run(call: ToolCall): Promise<ToolOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_MS);
  try {
    return await container.vehicleTools.execute(call, controller.signal);
  } catch {
    return { ok: false, error: 'timeout', message: 'El auto no respondió a tiempo.' };
  } finally {
    clearTimeout(timer);
  }
}

function codesOf(out: ToolOutcome): ReportCode[] | null {
  if (!out.ok) return null;
  return ((out.data as { codes?: { code: string; description: string | null }[] }).codes ?? []).map((c) => ({ code: c.code, description: c.description }));
}

function readinessOf(out: ToolOutcome): ReportData['readiness'] {
  if (!out.ok) return null;
  const d = out.data as { milOn: boolean; complete: MonitorId[]; incomplete: MonitorId[]; distSinceClear?: { value: number } };
  const label = (l: MonitorId[]) => l.map((m) => MONITOR_LABEL[m] ?? m);
  return { milOn: d.milOn, complete: label(d.complete), incomplete: label(d.incomplete), distSinceClearKm: d.distSinceClear?.value ?? null };
}

function hypothesesOf(out: ToolOutcome): ReportData['hypotheses'] {
  if (!out.ok) return [];
  const list = (out.data as { hypotheses?: { cause: string; system: string; confidencePct: number; evidence: string[]; checks: string[]; safety?: string }[] }).hypotheses ?? [];
  return list.map((h) => ({ title: h.cause, system: h.system, confidence: h.confidencePct, evidence: h.evidence, checks: h.checks, safety: h.safety ?? null }));
}

function historyText(e: FaultEvent): string {
  switch (e.type) {
    case 'codes':
      return e.codes.length ? `Códigos ${e.kind === 'stored' ? 'guardados' : e.kind === 'pending' ? 'pendientes' : 'permanentes'}: ${e.codes.map((c) => c.code).join(', ')}` : 'Sin códigos';
    case 'freeze_frame':
      return `Freeze frame de ${e.dtc.code}`;
    case 'cleared':
      return e.codesBefore.length ? `Se borraron los códigos (${e.codesBefore.map((c) => c.code).join(', ')})` : 'Se borraron los códigos';
  }
}

function num(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}
