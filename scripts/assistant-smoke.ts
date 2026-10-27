/// <reference types="node" />
// The assistant's agent loop against the real model, with a simulated car.
//   npm run assistant:smoke [-- https://obdient.duckdns.org/llm/v1]
// Token: ~/.config/obdient/llm-token (server/newapi/setup-chat.py). Never printed.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runTurn, ToolMemo } from '@/domain/assistant/agent-loop';
import type { AssistantContext } from '@/domain/assistant/prompt';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { ApiMessage } from '@/domain/ports/llm.port';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { OpenAiChatClient } from '@/data/llm/openai-chat-client';

const baseUrl = process.argv[2] ?? 'https://obdient.duckdns.org/llm/v1';
const apiKey = readFileSync(join(homedir(), '.config/obdient/llm-token'), 'utf8').trim();
const llm = new OpenAiChatClient({ baseUrl, apiKey, model: 'obdient-chat', fetch: fetch as never });

// A parked car with a lean condition: P0171 stored, idle a bit rough.
function simulated(): VehicleToolsPort {
  const answer = (c: ToolCall): ToolOutcome => {
    switch (c.name) {
      case 'read_pids': {
        const v: Record<string, number> = { RPM: 812, VOLTAGE: 12.4, COOLANT_TEMP: 88, ENGINE_LOAD: 24, SPEED: 0 };
        const data = Object.fromEntries(c.pids.map((p) => [p, v[p] ?? null]));
        return { ok: true, data, summary: c.pids.map((p) => `${p}: ${v[p]}`).join(', ') };
      }
      case 'sample_pids':
        return { ok: true, data: { RPM: { min: 760, max: 870, mean: 812, last: 805, n: 40 } }, summary: 'RPM 760–870' };
      case 'read_dtcs':
        return c.kind === 'stored'
          ? {
              ok: true,
              // The shape VehicleToolAdapter returns; no description source yet.
              data: {
                kind: 'stored',
                codes: [
                  { code: 'P0171', ecu: '18DAF111', system: 'powertrain', owner: 'standard', description: null },
                  { code: 'P1101', ecu: '18DAF111', system: 'powertrain', owner: 'manufacturer', description: null },
                ],
                ecusAnswered: 1,
                incomplete: false,
              },
              summary: 'Códigos guardados: P0171, P1101',
            }
          : { ok: true, data: { kind: c.kind, codes: [], ecusAnswered: 1, incomplete: false }, summary: `Sin códigos ${c.kind}` };
      case 'read_freeze_frame':
        return { ok: true, data: { dtc: 'P0171', RPM: 790, COOLANT_TEMP: 91, SPEED: 0, FUEL_TRIM_LONG: 18.8, FUEL_TRIM_SHORT: 7.0 }, summary: 'freeze frame' };
      case 'read_readiness':
        return {
          ok: true,
          data: { milOn: true, dtcCount: 2, ignition: 'spark', complete: ['misfire', 'fuel_system', 'components', 'catalyst'], incomplete: ['evap_system'], distSinceClear: { value: 1420, unit: 'km' } },
          summary: 'Testigo encendido, 2 códigos, monitores incompletos: evap_system',
        };
      case 'read_vehicle_info':
        return { ok: true, data: { vin: '8AGTB69C0KR000000', supported: 34 }, summary: 'VIN' };
      case 'read_adapter_info':
        return { ok: true, data: { chip: 'STN1040 v1.3.6', protocol: 'ISO 15765-4 CAN 29/500', speedHz: 24, volts: 12.4 }, summary: 'adaptador' };
      case 'run_adapter_bench':
        return { ok: true, data: { speedHz: 24 }, summary: '24 Hz' };
      case 'clear_dtcs':
        return { ok: true, data: { cleared: true }, summary: 'Códigos borrados' };
      case 'read_fault_history':
        return { ok: true, data: { events: [] }, summary: 'Historial vacío' };
      case 'calculate':
        return { ok: true, data: { expression: c.expression, result: 0 }, summary: 'cálculo' };
      case 'search_place':
      case 'set_destination':
      case 'start_navigation':
      case 'route_status':
      case 'stop_navigation':
      case 'where_am_i':
      case 'fuel_prices':
      case 'weather':
      case 'dollar_rate':
      case 'car_price':
      case 'log_service':
      case 'read_service_log':
      case 'web_search':
      case 'research':
      case 'web_fetch':
      case 'knowledge_lookup':
      case 'docs_search':
      case 'chat_search':
      case 'scan_modules':
      case 'obd_command':
      case 'did_probe':
        return { ok: false, error: 'not_supported', message: 'Sin navegación en el humo.' };
    }
  };
  return {
    supportedPids: () => ['SPEED', 'RPM', 'COOLANT_TEMP', 'ENGINE_LOAD', 'FUEL_TRIM_SHORT', 'FUEL_TRIM_LONG'],
    execute: async (c) => answer(c),
  };
}

const STOPPED: AssistantContext = { connected: true, protocol: 'CAN 29/500', supportedPids: 34, moving: false, speedKmh: 0, navigating: false, labMode: false };
const MOVING: AssistantContext = { ...STOPPED, moving: true, speedKmh: 52, navigating: true };

async function main() {
  const vehicle = simulated();
  const memo = new ToolMemo();
  let history: ApiMessage[] = [];
  const turns: [string, AssistantContext, boolean][] = [
    ['¿Cómo está la batería y tengo algún código?', STOPPED, false],
    ['Tengo el check engine prendido, ¿qué puede ser?', STOPPED, false],
    ['Dale, borrame los códigos', STOPPED, false], // declines
    ['¿Todo bien con el motor?', MOVING, false],
  ];
  for (const [text, context, accept] of turns) {
    const t0 = Date.now();
    const tools: string[] = [];
    const r = await runTurn({
      history,
      text,
      context,
      llm,
      vehicle,
      memo,
      confirmation: { confirm: async () => accept },
      onEvent: (e) => {
        if (e.type === 'tool_start') tools.push(`${e.call.name}${'pids' in e.call ? `(${e.call.pids.join(',')})` : 'kind' in e.call ? `(${e.call.kind})` : ''}`);
        if (e.type === 'tool_refused') tools.push(`✗${e.name}:${e.outcome.ok ? '' : e.outcome.error}`);
      },
    });
    history = [...history, ...r.messages];
    console.log(`\n» ${text}   [${context.moving ? 'en movimiento' : 'detenido'}]`);
    console.log(`  herramientas: ${tools.join(' · ') || '—'}`);
    console.log(`  ${(Date.now() - t0) / 1000} s · ${r.modelCalls} llamadas al modelo · inválidas ${r.invalidCalls}`);
    console.log(`  ${r.text.replace(/\n/g, '\n  ')}`);
  }
}

void main();
