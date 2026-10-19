// The assistant's tools that run in the app, not on the car: navigation
// (NavigationTools) and the voice (set_audio, M5).

import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import { NAVIGATION_TOOL_NAMES, navigationTools } from './navigation-tools';
import { voice } from './voice';

export const APP_TOOL_NAMES: ReadonlySet<string> = new Set([...NAVIGATION_TOOL_NAMES, 'set_audio']);

export const appTools = {
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    if (call.name === 'set_audio') {
      voice.setMuted(!call.on);
      return Promise.resolve({
        ok: true,
        data: { voice: call.on ? 'on' : 'muted' },
        summary: call.on ? 'Voz activada' : 'Voz en silencio',
      });
    }
    return navigationTools.execute(call, signal);
  },
};
