// The diagnostic report (2026-10-28): one HTML page the phone prints to PDF
// (expo-print) for the workshop or the car's owner. What was read now (codes,
// monitors, live values), the likely causes, what is unusual for this car, and
// its recent history.
//
// - Plain HTML and inline CSS only: the print engine is the system WebView,
//   and on iOS it cannot load local files (no external fonts or images).
// - White page, dark text: it is printed and photocopied.
// - Privacy (ADR-0011): the VIN keeps its first 11 characters (make, model,
//   year, plant) and hides the serial, like every export of the app. Nothing
//   about the driver: no e-mail, no positions.
// - Every text is escaped: codes and descriptions come from the car and the
//   base, notes from the user.

import { maskVin } from '@/domain/privacy/redact';

export interface ReportCode {
  readonly code: string;
  readonly description: string | null;
}

export interface ReportHypothesis {
  readonly title: string;
  readonly system: string;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly checks: readonly string[];
  readonly safety: string | null;
}

export interface ReportData {
  readonly generatedAt: number;
  readonly vin: string | null;
  readonly make: string | null;
  // Who made it: the workshop or mechanic, as typed (optional).
  readonly workshop: string | null;
  readonly adapter: string | null;
  // null: could not be read (no adapter, or the car did not answer).
  readonly storedCodes: readonly ReportCode[] | null;
  readonly pendingCodes: readonly ReportCode[] | null;
  readonly readiness: {
    readonly milOn: boolean;
    readonly complete: readonly string[];
    readonly incomplete: readonly string[];
    readonly distSinceClearKm: number | null;
  } | null;
  readonly live: readonly { readonly label: string; readonly value: string }[];
  readonly hypotheses: readonly ReportHypothesis[];
  readonly unusual: readonly string[];
  readonly baseline: readonly { readonly label: string; readonly text: string }[];
  readonly history: readonly { readonly at: number; readonly text: string }[];
  readonly service: readonly { readonly at: number; readonly item: string; readonly km: number | null }[];
  readonly notes: string | null;
}

export function buildReportHtml(data: ReportData): string {
  const sections = [
    header(data),
    codesSection(data),
    readinessSection(data),
    hypothesesSection(data),
    liveSection(data),
    baselineSection(data),
    historySection(data),
    notesSection(data),
    footer(),
  ].filter(Boolean);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Informe de diagnóstico</title><style>${CSS}</style></head><body>${sections.join('')}</body></html>`;
}

const CSS = `
*{box-sizing:border-box}
body{font-family:-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;color:#1a1a1a;font-size:11pt;line-height:1.4;margin:0}
h1{font-size:18pt;margin:0 0 2pt}
h2{font-size:12.5pt;margin:16pt 0 6pt;padding-bottom:3pt;border-bottom:1.5pt solid #0d8a64;color:#0d5c44}
.muted{color:#5a5a5a}
.small{font-size:9pt}
table{width:100%;border-collapse:collapse}
td,th{text-align:left;vertical-align:top;padding:4pt 6pt;border-bottom:.5pt solid #d8d8d8}
th{font-size:9pt;color:#5a5a5a;font-weight:600}
.code{font-family:"Courier New",monospace;font-weight:700;white-space:nowrap}
.pill{display:inline-block;border:1pt solid #0d8a64;color:#0d5c44;border-radius:8pt;padding:0 6pt;font-size:9pt}
.warn{border:1.5pt solid #b3261e;background:#fdecea;color:#7a1712;padding:6pt 8pt;border-radius:4pt;margin:4pt 0}
.hyp{border:.75pt solid #cfcfcf;border-radius:4pt;padding:6pt 8pt;margin:6pt 0;page-break-inside:avoid}
.hyp h3{font-size:11pt;margin:0 0 3pt}
.bar{height:4pt;background:#e6e6e6;border-radius:2pt;margin:3pt 0 5pt}
.bar span{display:block;height:4pt;background:#0d8a64;border-radius:2pt}
ul{margin:2pt 0 0 14pt;padding:0}
.grid{display:flex;gap:16pt}
.grid>div{flex:1}
footer{margin-top:20pt;padding-top:6pt;border-top:.5pt solid #d8d8d8}
`;

function header(d: ReportData): string {
  const rows: [string, string][] = [
    ['Fecha', dateTime(d.generatedAt)],
    ['Vehículo', d.make ?? 'Marca no identificada'],
    ['VIN', d.vin ? maskVin(d.vin) : 'No informado por el auto'],
  ];
  if (d.adapter) rows.push(['Adaptador', d.adapter]);
  if (d.workshop) rows.push(['Realizado por', d.workshop]);
  return `<header><h1>Informe de diagnóstico</h1><div class="muted small">OBDient · lectura OBD-II del vehículo</div>
<table style="margin-top:8pt">${rows.map(([k, v]) => `<tr><th style="width:28%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></header>`;
}

function codesSection(d: ReportData): string {
  const block = (title: string, list: readonly ReportCode[] | null) => {
    if (list == null) return `<p><b>${esc(title)}:</b> <span class="muted">no se pudieron leer.</span></p>`;
    if (list.length === 0) return `<p><b>${esc(title)}:</b> ninguno.</p>`;
    return `<p style="margin-bottom:2pt"><b>${esc(title)}:</b></p><table>${list
      .map((c) => `<tr><td class="code" style="width:16%">${esc(c.code)}</td><td>${c.description ? esc(c.description) : '<span class="muted">Sin descripción en la base (puede ser un código del fabricante).</span>'}</td></tr>`)
      .join('')}</table>`;
  };
  return `<section><h2>Códigos de falla</h2>${block('Guardados', d.storedCodes)}${block('Pendientes', d.pendingCodes)}</section>`;
}

function readinessSection(d: ReportData): string {
  const r = d.readiness;
  if (!r) return '';
  const list = (l: readonly string[]) => (l.length ? esc(l.join(', ')) : '—');
  const dist = r.distSinceClearKm != null ? `<p>Distancia desde el último borrado de códigos: <b>${num(r.distSinceClearKm)} km</b>.</p>` : '';
  return `<section><h2>Testigo y monitores de emisiones</h2>
<p>Testigo de motor (MIL): <b>${r.milOn ? 'encendido' : 'apagado'}</b>.</p>
<table><tr><th style="width:28%">Completos</th><td>${list(r.complete)}</td></tr><tr><th>Incompletos</th><td>${list(r.incomplete)}</td></tr></table>${dist}
<p class="muted small">Monitores incompletos son normales después de borrar códigos o desconectar la batería; para la VTV suelen tener que estar completos.</p></section>`;
}

function hypothesesSection(d: ReportData): string {
  if (d.hypotheses.length === 0) return '';
  const items = d.hypotheses.map((h, i) => {
    const pct = Math.max(0, Math.min(100, Math.round(h.confidence)));
    const safety = h.safety ? `<div class="warn">⚠ ${esc(h.safety)}</div>` : '';
    const evidence = h.evidence.length ? `<div class="small"><b>Por qué:</b> ${esc(h.evidence.join('; '))}.</div>` : '';
    const checks = h.checks.length ? `<div class="small" style="margin-top:3pt"><b>Qué revisar:</b><ul>${h.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : '';
    return `<div class="hyp"><h3>${i + 1}. ${esc(h.title)} <span class="pill">${esc(h.system)}</span></h3><div class="small muted">Coincidencia ${pct}%</div><div class="bar"><span style="width:${pct}%"></span></div>${safety}${evidence}${checks}</div>`;
  });
  return `<section><h2>Causas más probables</h2><p class="muted small">Ordenadas por la evidencia del auto y de lo informado. Es una orientación para el diagnóstico, no un dictamen.</p>${items.join('')}</section>`;
}

function liveSection(d: ReportData): string {
  if (d.live.length === 0) return '';
  const rows = d.live.map((v) => `<tr><td>${esc(v.label)}</td><td style="width:30%"><b>${esc(v.value)}</b></td></tr>`).join('');
  return `<section><h2>Valores en vivo al momento del informe</h2><table>${rows}</table></section>`;
}

function baselineSection(d: ReportData): string {
  if (d.unusual.length === 0 && d.baseline.length === 0) return '';
  const unusual = d.unusual.length ? `<div class="warn" style="border-color:#b26a00;background:#fff4e0;color:#5c3700"><b>Distinto de lo habitual en este auto:</b><ul>${d.unusual.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>` : '';
  const rows = d.baseline.map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(b.text)}</td></tr>`).join('');
  const table = rows ? `<table>${rows}</table>` : '';
  return `<section><h2>Lo habitual en este auto</h2><p class="muted small">Aprendido por la app en conexiones anteriores con este mismo vehículo.</p>${unusual}${table}</section>`;
}

function historySection(d: ReportData): string {
  if (d.history.length === 0 && d.service.length === 0) return '';
  const faults = d.history.length
    ? `<div><b>Historial de fallas</b><table>${d.history.map((h) => `<tr><td style="width:34%" class="small">${esc(day(h.at))}</td><td class="small">${esc(h.text)}</td></tr>`).join('')}</table></div>`
    : '';
  const service = d.service.length
    ? `<div><b>Service registrado</b><table>${d.service.map((s) => `<tr><td style="width:34%" class="small">${esc(day(s.at))}</td><td class="small">${esc(s.item)}${s.km != null ? ` · ${num(s.km)} km` : ''}</td></tr>`).join('')}</table></div>`
    : '';
  return `<section><h2>Antecedentes</h2><div class="grid">${faults}${service}</div></section>`;
}

function notesSection(d: ReportData): string {
  if (!d.notes?.trim()) return '';
  return `<section><h2>Observaciones</h2><p>${esc(d.notes.trim()).replace(/\n/g, '<br>')}</p></section>`;
}

function footer(): string {
  return `<footer class="small muted">Informe generado con OBDient a partir de la lectura OBD-II del vehículo. Las causas y los porcentajes son orientativos y no reemplazan la revisión de un mecánico. El VIN se muestra sin sus últimos 6 caracteres.</footer>`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function day(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function dateTime(ms: number): string {
  const d = new Date(ms);
  return `${day(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Thousands with a dot, decimals with a comma (es-AR).
function num(v: number): string {
  const [i, f] = (Math.round(v * 10) / 10).toString().split('.');
  return i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (f ? `,${f}` : '');
}
