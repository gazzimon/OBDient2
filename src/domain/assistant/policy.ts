// What each tool may do and when (ADR-0007): a call is allowed, needs the
// user's confirmation on screen, or is refused with a reason the model can read.
//
// Reads are always fine. Anything that stops the telemetry or changes the car's
// state is kept away from driving, and erasing codes always asks first.

import type { ToolCall, ToolErrorCode } from './tools';

export type ToolLevel = 'read' | 'exclusive' | 'destructive';

export const TOOL_LEVEL: Readonly<Record<ToolCall['name'], ToolLevel>> = {
  read_pids: 'read',
  sample_pids: 'read',
  read_dtcs: 'read',
  read_freeze_frame: 'read',
  read_readiness: 'read',
  read_vehicle_info: 'read',
  read_adapter_info: 'read',
  run_adapter_bench: 'exclusive',
  clear_dtcs: 'destructive',
  read_fault_history: 'read',
  calculate: 'read',
  // Navigation is what the driver asks for while driving: allowed moving.
  search_place: 'read',
  set_destination: 'read',
  start_navigation: 'read',
  route_status: 'read',
  stop_navigation: 'read',
  where_am_i: 'read',
  web_search: 'read',
  research: 'read',
  web_fetch: 'read',
  knowledge_lookup: 'read',
  docs_search: 'read',
  chat_search: 'read',
  // Use the bus in exclusive mode (like the adapter bench); car stopped.
  scan_modules: 'exclusive',
  obd_command: 'exclusive',
  did_probe: 'exclusive',
  fuel_prices: 'read',
  dollar_rate: 'read',
  weather: 'read',
  car_price: 'read',
  // Writes only the phone's own log, after the user confirmed the car.
  log_service: 'read',
  read_service_log: 'read',
};

// While moving, a sample keeps polling secondary PIDs instead of the dashboard's:
// short is fine, long is not.
export const SAMPLE_SECONDS_WHILE_MOVING = 5;

export interface PolicyContext {
  readonly moving: boolean;
  readonly navigating: boolean;
  // "Modo laboratorio": the free read-command tool is only available then.
  readonly labMode: boolean;
  // Successful clears in this conversation: one is enough.
  readonly clearsThisConversation: number;
}

export type PolicyDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'deny'; readonly error: ToolErrorCode; readonly message: string };

const ALLOW: PolicyDecision = { kind: 'allow' };

export function evaluatePolicy(call: ToolCall, ctx: PolicyContext): PolicyDecision {
  switch (call.name) {
    case 'sample_pids':
      if (ctx.moving && call.seconds > SAMPLE_SECONDS_WHILE_MOVING) {
        return deny('not_allowed_while_moving', `En movimiento, como máximo ${SAMPLE_SECONDS_WHILE_MOVING} s de muestreo.`);
      }
      return ALLOW;
    case 'read_adapter_info':
      // The full check needs the link alone for a moment (headers on).
      if (call.fullCheck && ctx.moving) {
        return deny('not_allowed_while_moving', 'La prueba completa del adaptador se hace con el auto detenido.');
      }
      return ALLOW;
    case 'run_adapter_bench':
      if (ctx.moving) return deny('not_allowed_while_moving', 'La prueba del adaptador se hace con el auto detenido.');
      if (ctx.navigating) return deny('not_allowed_while_moving', 'La prueba del adaptador pausa la telemetría: terminá la navegación primero.');
      return ALLOW;
    case 'scan_modules':
      if (ctx.moving) return deny('not_allowed_while_moving', 'El barrido de módulos se hace con el auto detenido.');
      if (ctx.navigating) return deny('not_allowed_while_moving', 'El barrido pausa la telemetría: terminá la navegación primero.');
      return ALLOW;
    case 'obd_command':
      if (!ctx.labMode) return deny('not_supported', 'Enviar comandos sueltos al auto está en Modo laboratorio (Ajustes).');
      if (ctx.moving) return deny('not_allowed_while_moving', 'Los comandos al bus se mandan con el auto detenido.');
      if (ctx.navigating) return deny('not_allowed_while_moving', 'Terminá la navegación primero.');
      return ALLOW;
    case 'did_probe':
      if (!ctx.labMode) return deny('not_supported', 'El sondeo de DIDs está en Modo laboratorio (Ajustes).');
      if (ctx.moving) return deny('not_allowed_while_moving', 'El sondeo de DIDs se hace con el auto detenido.');
      if (ctx.navigating) return deny('not_allowed_while_moving', 'Terminá la navegación primero.');
      return ALLOW;
    case 'clear_dtcs':
      if (ctx.moving) return deny('not_allowed_while_moving', 'Los códigos se borran con el auto detenido.');
      if (ctx.clearsThisConversation > 0) return deny('already_done', 'Los códigos ya se borraron en esta conversación.');
      return { kind: 'confirm' };
    default:
      return ALLOW;
  }
}

function deny(error: ToolErrorCode, message: string): PolicyDecision {
  return { kind: 'deny', error, message };
}
