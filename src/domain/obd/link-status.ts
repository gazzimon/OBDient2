// What the top bar says about the adapter (2026-10-29): one line, and a tone
// that is not only a colour (the dot is filled, a ring, or hollow).

export type LinkTone = 'ok' | 'busy' | 'off';

export interface LinkInput {
  readonly state: 'disconnected' | 'connecting' | 'connected';
  // Waiting for the next try at the remembered adapter.
  readonly retrying: boolean;
  readonly stoppedByUser: boolean;
  readonly deviceName: string | null;
  // The remembered adapter, if any.
  readonly rememberedName: string | null;
  readonly remembered: boolean;
  // "Chevrolet 2024"; null when unknown; undefined while the VIN is being read.
  readonly car: string | null | undefined;
  readonly vinRead: boolean;
}

export interface LinkStatus {
  readonly tone: LinkTone;
  readonly text: string;
}

export function linkStatus(i: LinkInput): LinkStatus {
  const name = i.deviceName ?? i.rememberedName ?? 'el adaptador';
  switch (i.state) {
    case 'connected': {
      const car = !i.vinRead ? null : (i.car ?? 'auto sin VIN');
      return { tone: 'ok', text: car ? `${name} · ${car}` : name };
    }
    case 'connecting':
      return { tone: 'busy', text: `Conectando ${name}…` };
    case 'disconnected':
      if (!i.remembered) return { tone: 'off', text: 'Sin adaptador · Conectar' };
      if (i.stoppedByUser) return { tone: 'off', text: `${name} desconectado` };
      if (i.retrying) return { tone: 'busy', text: `Buscando ${name}…` };
      return { tone: 'off', text: `${name} · Conectar` };
  }
}
