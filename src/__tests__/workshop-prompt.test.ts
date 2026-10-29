import { runTurn } from '@/domain/assistant/agent-loop';
import { DRIVER, maxTokensFor, SYSTEM_PROMPT, WORKSHOP, WORKSHOP_PROMPT, type AssistantContext } from '@/domain/assistant/prompt';
import type { LlmPort, LlmRequest } from '@/domain/ports/llm.port';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';

const STOPPED: AssistantContext = { connected: true, protocol: 'CAN 11/500', supportedPids: 4, moving: false, speedKmh: 0, navigating: false, labMode: true };

describe('the mechanic prompt (socios build)', () => {
  it('talks to a mechanic and keeps to the diagnosis', () => {
    expect(WORKSHOP_PROMPT).toContain('mecánico de un taller socio de la FIUI');
    expect(WORKSHOP_PROMPT).not.toContain('teléfono del conductor');
    expect(WORKSHOP_PROMPT).toContain('Terminá cada respuesta con el próximo paso del diagnóstico');
    expect(WORKSHOP_PROMPT).toContain('Nunca termines ofreciendo cotizar, comprar, buscar un comercio o un taller');
    expect(WORKSHOP_PROMPT).not.toContain('de lo más barato a lo más caro');
  });

  it('keeps the shared rules, and the driver services only on request, after the diagnosis', () => {
    for (const rule of ['Nunca inventes ni estimes un valor que no mediste', 'nunca lo completes', 'pasalo en find de did_probe', 'rejected_by_car']) {
      expect(WORKSHOP_PROMPT).toContain(rule);
    }
    const onRequest = WORKSHOP_PROMPT.indexOf('Solo si el mecánico lo pide, nunca por tu cuenta');
    expect(onRequest).toBeGreaterThan(WORKSHOP_PROMPT.indexOf('Diagnóstico del fabricante'));
    for (const service of ['- Navegación:', '- web_search es para comercios', '- Repuestos y sus precios', '- Combustible:']) {
      expect(WORKSHOP_PROMPT.indexOf(service)).toBeGreaterThan(onRequest);
    }
  });

  it('the driver prompt is still the default', () => {
    expect(DRIVER.system).toBe(SYSTEM_PROMPT);
    expect(maxTokensFor(STOPPED)).toBe(900);
    expect(maxTokensFor(STOPPED, WORKSHOP)).toBe(1400);
    expect(maxTokensFor({ ...STOPPED, moving: true }, WORKSHOP)).toBe(150);
  });

  it('runTurn sends the persona it is given', async () => {
    const requests: LlmRequest[] = [];
    const llm: LlmPort = {
      async complete(req) {
        requests.push(req);
        return { content: 'Medí la tensión de batería con el motor en marcha.', toolCalls: [], finishReason: 'stop' };
      },
    };
    const vehicle: VehicleToolsPort = { supportedPids: () => [], execute: async () => ({ ok: true, data: {}, summary: '' }) };
    const confirmation = { confirm: async () => true };
    await runTurn({ history: [], text: 'P0562', context: STOPPED, persona: WORKSHOP, llm, vehicle, confirmation });
    await runTurn({ history: [], text: 'P0562', context: STOPPED, llm, vehicle, confirmation });
    expect(requests.map((r) => [r.messages[0]!.content, r.maxTokens])).toEqual([
      [WORKSHOP_PROMPT, 1400],
      [SYSTEM_PROMPT, 900],
    ]);
  });
});
