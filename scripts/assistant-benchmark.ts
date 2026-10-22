/// <reference types="node" />
// Benchmark OBDient vs Gemini in the car (2026-10-22): the cases of
// benchmark-cases.ts against the real model with simulated tools, N runs each
// (the model is not deterministic), and a report in docs/benchmarks/.
//   npm run assistant:benchmark [-- --runs 3] [-- --block drive,car,memory] [-- --only A3,C2] [-- --verbose] [-- --no-report]
// Token: ~/.config/obdient/llm-token. Never printed.
//
// What it does NOT measure: Gemini (there is no way to run it from here: the
// report has a sheet to try the same requests by hand), real network or GPS time
// (the tools are simulated, so the seconds are the model's).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn, ToolMemo } from '@/domain/assistant/agent-loop';
import type { ApiMessage } from '@/domain/ports/llm.port';
import { llm, vehicle, type Check } from './eval-kit';
import { CASES, spoken, type BenchCase, type Block } from './benchmark-cases';

type Verdict = 'PASA' | 'PARCIAL' | 'SIN CAPACIDAD' | 'FALLA' | 'ERROR';
const VERDICTS: readonly Verdict[] = ['PASA', 'PARCIAL', 'SIN CAPACIDAD', 'FALLA', 'ERROR'];
const BLOCKS: Record<Block, string> = { drive: 'A · Manejo', car: 'B · El auto', memory: 'C · Memoria personal' };

interface TurnRun {
  readonly prompt: string;
  readonly text: string;
  readonly tools: string[];
  readonly firstTextMs: number | null;
  readonly totalMs: number;
  readonly words: number;
  readonly modelCalls: number;
  readonly mustFailed: string[];
  readonly niceFailed: string[];
}
interface CaseRun {
  readonly id: string;
  readonly run: number;
  readonly verdict: Verdict;
  readonly turns: TurnRun[];
  readonly error?: string;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const sec = (ms: number | null) => (ms == null ? '—' : (ms / 1000).toFixed(1));
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const failures = (checks: readonly Check[] | undefined, rec: { text: string; tools: string[] }) => (checks ?? []).map((c) => c(rec)).filter((f): f is string => f != null);

async function runCase(c: BenchCase, run: number): Promise<CaseRun> {
  const memo = new ToolMemo();
  let history: ApiMessage[] = [];
  const turns: TurnRun[] = [];
  try {
    for (const turn of c.turns) {
      const tools: string[] = [];
      const t0 = Date.now();
      let firstTextMs: number | null = null;
      const r = await runTurn({
        history,
        text: turn.text,
        context: turn.context,
        llm,
        vehicle: vehicle(c.car),
        memo,
        ...(c.summary && history.length === 0 ? { summary: c.summary } : {}),
        confirmation: { confirm: async () => turn.accept ?? false },
        onEvent: (e) => {
          if (e.type === 'text' && firstTextMs == null) firstTextMs = Date.now() - t0;
          if (e.type === 'tool_start') {
            const { name, ...args } = e.call as { name: string } & Record<string, unknown>;
            tools.push(`${name}(${JSON.stringify(args)})`);
          }
          if (e.type === 'tool_refused') tools.push(`✗${e.name}:${e.outcome.ok ? '' : e.outcome.error}`);
        },
      });
      history = [...history, ...r.messages];
      const rec = { text: r.text, tools };
      turns.push({
        prompt: turn.text,
        text: r.text,
        tools,
        firstTextMs,
        totalMs: Date.now() - t0,
        words: words(r.text),
        modelCalls: r.modelCalls,
        mustFailed: failures(turn.must, rec),
        niceFailed: failures([...(turn.nice ?? []), ...(turn.context.moving ? [spoken] : [])], rec),
      });
    }
  } catch (err) {
    return { id: c.id, run, verdict: 'ERROR', turns, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
  const must = turns.some((t) => t.mustFailed.length);
  const nice = turns.some((t) => t.niceFailed.length);
  const verdict: Verdict = must ? 'FALLA' : c.gap ? 'SIN CAPACIDAD' : nice ? 'PARCIAL' : 'PASA';
  return { id: c.id, run, verdict, turns };
}

// ── Report ───────────────────────────────────────────────────────────────────

function modal(runs: CaseRun[]): { verdict: Verdict; n: number } {
  const count = new Map<Verdict, number>();
  for (const r of runs) count.set(r.verdict, (count.get(r.verdict) ?? 0) + 1);
  const [verdict, n] = [...count.entries()].sort((a, b) => b[1] - a[1] || VERDICTS.indexOf(a[0]) - VERDICTS.indexOf(b[0]))[0]!;
  return { verdict, n };
}

function commonFailures(runs: CaseRun[]): string {
  const count = new Map<string, number>();
  for (const r of runs) for (const t of r.turns) for (const f of [...t.mustFailed, ...t.niceFailed]) count.set(f, (count.get(f) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f, n]) => `${f} (${n}×)`).join('; ') || '—';
}

function report(cases: readonly BenchCase[], runs: CaseRun[], runsPerCase: number, meta: { date: string; commit: string }): string {
  const byCase = new Map(cases.map((c) => [c.id, runs.filter((r) => r.id === c.id)]));
  const allTurns = (rs: CaseRun[]) => rs.flatMap((r) => r.turns);
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out(`# OBDient frente a Gemini en el auto — benchmark ${meta.date}`);
  out();
  out(`Modelo: \`obdient-chat\` (Qwen3.8-27B INT4 en la Z440) · commit \`${meta.commit}\` · ${cases.length} casos × ${runsPerCase} corridas.`);
  out();
  out('## Qué mide y qué no');
  out();
  out('- Mide **OBDient** con el modelo real y **herramientas simuladas** (con las formas de resultado de las reales). Los segundos son los del modelo: no incluyen red ni GPS.');
  out('- **No mide a Gemini**: no se puede correr desde acá. La columna "Gemini" es lo que **Google anunció** (octubre de 2026) y de dónde saca los datos; la hoja del final trae los mismos pedidos para probarlos a mano.');
  out('- Los chequeos son reglas (sin modelo juez): revisar las transcripciones de `.json` antes de citar un número.');
  out('- Veredictos: **PASA** (correcto y bien dicho) · **PARCIAL** (correcto pero con algo que corregir) · **SIN CAPACIDAD** (no existe la herramienta, y fue honesto) · **FALLA** (se equivocó o **inventó**) · **ERROR** (falló el servidor).');
  out();

  out('## Resumen por bloque');
  out();
  out('| Bloque | Casos | PASA | PARCIAL | SIN CAPACIDAD | FALLA | ERROR | Seg. a la 1ª palabra | Seg. por turno | Palabras |');
  out('|---|---|---|---|---|---|---|---|---|---|');
  for (const [block, name] of Object.entries(BLOCKS) as [Block, string][]) {
    const cs = cases.filter((c) => c.block === block);
    if (!cs.length) continue;
    const rs = cs.flatMap((c) => byCase.get(c.id) ?? []);
    const pct = (v: Verdict) => `${Math.round((rs.filter((r) => r.verdict === v).length / rs.length) * 100)} %`;
    const ts = allTurns(rs);
    out(`| ${name} | ${cs.length} | ${pct('PASA')} | ${pct('PARCIAL')} | ${pct('SIN CAPACIDAD')} | ${pct('FALLA')} | ${pct('ERROR')} | ${sec(median(ts.flatMap((t) => (t.firstTextMs == null ? [] : [t.firstTextMs]))))} | ${sec(median(ts.map((t) => t.totalMs)))} | ${median(ts.map((t) => t.words)) ?? '—'} |`);
  }
  out();
  const mem = cases.filter((c) => c.block === 'memory');
  if (mem.length) {
    const rs = mem.flatMap((c) => byCase.get(c.id) ?? []);
    const honest = rs.filter((r) => r.verdict !== 'FALLA' && r.verdict !== 'ERROR').length;
    out(`**Memoria — honestidad:** en ${honest} de ${rs.length} corridas no inventó un lugar ni un dato (${Math.round((honest / rs.length) * 100)} %). Es el riesgo que importa mientras no tengamos la capacidad: un destino inventado en un auto en marcha es peor que un "no sé".`);
    out();
  }

  out('## Detalle por caso');
  out();
  out('| Caso | Pedido | Resultado | 1ª palabra (s) | Por turno (s) | Palabras | Gemini lo anuncia | Datos que usa Google | Fallas más comunes |');
  out('|---|---|---|---|---|---|---|---|---|');
  for (const c of cases) {
    const rs = byCase.get(c.id) ?? [];
    const m = modal(rs);
    const ts = allTurns(rs);
    out(
      `| ${c.id} | ${c.turns[0]!.text} | ${m.verdict} (${m.n}/${rs.length}) | ${sec(median(ts.flatMap((t) => (t.firstTextMs == null ? [] : [t.firstTextMs]))))} | ${sec(median(ts.map((t) => t.totalMs)))} | ${median(ts.map((t) => t.words)) ?? '—'} | ${c.google.announced ? 'sí' : 'no lo menciona'} | ${c.google.data} | ${commonFailures(rs)} |`,
    );
  }
  out();

  out('## Brechas (lo que no pasa) y lo que costaría cerrarlas');
  out();
  const gaps = cases.filter((c) => {
    const m = modal(byCase.get(c.id) ?? []);
    return m.verdict !== 'PASA' && m.verdict !== 'ERROR';
  });
  if (!gaps.length) out('Ninguna.');
  for (const c of gaps) {
    const m = modal(byCase.get(c.id) ?? []);
    out(`- **${c.id} · ${c.what}** — ${m.verdict}. ${c.gap ? `Falta: ${c.gap}. ` : ''}${c.close ? `Para cerrarla: ${c.close}.` : `Fallas: ${commonFailures(byCase.get(c.id) ?? [])}.`}`);
  }
  out();

  out('## Hoja de pruebas manuales: los mismos pedidos, para decírselos a Gemini');
  out();
  out('Decirlos tal cual, con el teléfono conectado al auto o a Android Auto, y anotar. "Correcto" = hizo lo que se pedía sin que el usuario tuviera que corregirlo.');
  out();
  out('| Caso | Decile a Gemini | ¿Lo hizo? | ¿Correcto? | Segundos | Notas |');
  out('|---|---|---|---|---|---|');
  for (const c of cases) out(`| ${c.id} | ${c.turns.map((t) => `"${t.text}"`).join(' → ')} | | | | |`);
  out();
  out('## Conclusión');
  out();
  out('_Pendiente: se redacta después de revisar las transcripciones de los casos que no pasan._');
  out();
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const runsPerCase = Number(arg('--runs') ?? 3) || 3;
  const blocks = arg('--block')?.split(',') as Block[] | undefined;
  const only = arg('--only')?.split(',');
  const verbose = args.includes('--verbose');
  const cases = CASES.filter((c) => (!blocks || blocks.includes(c.block)) && (!only || only.includes(c.id)));
  if (!cases.length) throw new Error('ningún caso coincide con --block / --only');

  const runs: CaseRun[] = [];
  for (let run = 1; run <= runsPerCase; run++) {
    for (const c of cases) {
      const r = await runCase(c, run);
      runs.push(r);
      const ms = r.turns.reduce((s, t) => s + t.totalMs, 0);
      console.log(`${r.verdict === 'PASA' ? '✔' : r.verdict === 'FALLA' || r.verdict === 'ERROR' ? '✘' : '~'} ${c.id} #${run} ${r.verdict} (${sec(ms)} s) ${c.what}`);
      const bad = r.turns.flatMap((t) => [...t.mustFailed, ...t.niceFailed]);
      if (bad.length || r.error) console.log(`     ${r.error ?? bad.join('; ')}`);
      if (verbose) for (const t of r.turns) console.log(`     » ${t.prompt}\n       [${t.tools.join(' · ') || 'sin herramientas'}]\n       ${t.text.replace(/\n/g, '\n       ')}`);
    }
  }

  const total = runs.length;
  for (const v of VERDICTS) {
    const n = runs.filter((r) => r.verdict === v).length;
    if (n) console.log(`${v}: ${n}/${total}`);
  }
  if (args.includes('--no-report')) return;

  const date = new Date().toISOString().slice(0, 10);
  let commit = 'desconocido';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: join(__dirname, '..') }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  const dir = join(__dirname, '../docs/benchmarks');
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${date}-obdient-vs-gemini`);
  // --merge: keep the runs of the cases not re-run (after fixing a case or a rule).
  let all = runs;
  if (args.includes('--merge') && existsSync(`${base}.json`)) {
    const prev = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { runs: CaseRun[] };
    all = [...prev.runs.filter((r) => !cases.some((c) => c.id === r.id)), ...runs];
  }
  const reported = CASES.filter((c) => all.some((r) => r.id === c.id));
  writeFileSync(`${base}.md`, report(reported, all, runsPerCase, { date, commit }));
  writeFileSync(`${base}.json`, JSON.stringify({ date, commit, runsPerCase, cases: reported.map((c) => ({ id: c.id, block: c.block, what: c.what, gap: c.gap ?? null, google: c.google })), runs: all }, null, 1));
  console.log(`\nInforme: docs/benchmarks/${date}-obdient-vs-gemini.md (+ .json con las transcripciones)`);
}

void main();
