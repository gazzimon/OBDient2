// One voice for the whole app (M5): detector alerts, maneuvers and the
// assistant all speak through here, by priority:
//
//   critical alert > alert > maneuver > assistant
//
// - Something more important cuts what is being said (it is not resumed).
// - Something as or less important waits its turn; per priority only the
//   latest waits (a newer maneuver replaces an older one).
// - What waited too long is dropped: a late maneuver is wrong, a late alert
//   is noise.
// - Muted ("silencio"), only critical alerts speak. The alert level from
//   Settings decides which alerts speak at all; the voice switch, everything.

export type VoicePriority = 'critical' | 'alert' | 'maneuver' | 'assistant';

// The drive view's sound button: everything, only alerts, or silence (a
// critical alert still speaks: it is about not crashing).
export type SoundMode = 'all' | 'alerts' | 'silent';
export type AlertVoiceLevel = 'all' | 'critical' | 'off';

const RANK: Readonly<Record<VoicePriority, number>> = { critical: 3, alert: 2, maneuver: 1, assistant: 0 };

// How long each may wait before it is no longer worth saying.
export const MAX_WAIT_MS: Readonly<Record<VoicePriority, number>> = {
  critical: 1_500,
  alert: 3_000,
  maneuver: 6_000,
  assistant: 30_000,
};

export interface Speaker {
  // `done` is called when it finishes on its own, not when stopped.
  speak(text: string, options: { readonly rate: number }, done: () => void): void;
  stop(): void;
}

export interface VoiceSettings {
  readonly voiceOn: () => boolean;
  readonly alertLevel: () => AlertVoiceLevel;
}

interface Utterance {
  readonly text: string;
  readonly priority: VoicePriority;
  readonly at: number;
}

export class VoiceArbiter {
  private current: (Utterance & { readonly token: number }) | null = null;
  private waiting: Utterance[] = [];
  private token = 0;
  private mode: SoundMode = 'all';
  private readonly listeners = new Set<(mode: SoundMode) => void>();

  constructor(
    private readonly speaker: Speaker,
    private readonly settings: VoiceSettings,
    private readonly now: () => number = Date.now,
  ) {}

  say(text: string, priority: VoicePriority): void {
    const t = text.trim();
    if (!t || !this.allowed(priority)) return;
    const u: Utterance = { text: t, priority, at: this.now() };
    if (!this.current) return this.start(u);
    if (RANK[priority] > RANK[this.current.priority]) {
      this.speaker.stop();
      this.current = null;
      return this.start(u);
    }
    this.waiting = [...this.waiting.filter((w) => w.priority !== priority), u];
  }

  isMuted(): boolean {
    return this.mode === 'silent';
  }

  setMuted(muted: boolean): void {
    this.setMode(muted ? 'silent' : 'all');
  }

  soundMode(): SoundMode {
    return this.mode;
  }

  setMode(mode: SoundMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.waiting = this.waiting.filter((w) => this.allowed(w.priority));
    if (this.current && !this.allowed(this.current.priority)) {
      this.speaker.stop();
      this.current = null;
      this.next();
    }
    for (const l of this.listeners) l(mode);
  }

  onMuted(listener: (mode: SoundMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Everything stops (navigation ended).
  stopAll(): void {
    this.waiting = [];
    if (this.current) this.speaker.stop();
    this.current = null;
  }

  private allowed(p: VoicePriority): boolean {
    if (!this.settings.voiceOn()) return false;
    if (p === 'critical' || p === 'alert') {
      const level = this.settings.alertLevel();
      if (level === 'off' || (level === 'critical' && p === 'alert')) return false;
    }
    if (this.mode === 'silent') return p === 'critical';
    if (this.mode === 'alerts') return p === 'critical' || p === 'alert';
    return true;
  }

  private start(u: Utterance): void {
    const token = ++this.token;
    this.current = { ...u, token };
    this.speaker.speak(u.text, { rate: u.priority === 'critical' ? 1.15 : 1 }, () => {
      if (this.current?.token !== token) return;
      this.current = null;
      this.next();
    });
  }

  private next(): void {
    const now = this.now();
    this.waiting = this.waiting.filter((w) => now - w.at <= MAX_WAIT_MS[w.priority] && this.allowed(w.priority));
    if (this.waiting.length === 0) return;
    const best = this.waiting.reduce((a, b) => (RANK[b.priority] > RANK[a.priority] ? b : a));
    this.waiting = this.waiting.filter((w) => w !== best);
    this.start(best);
  }
}

// What the assistant says aloud: the text without list marks, at most a few
// sentences (the prompt already keeps it short while moving).
export function forSpeech(text: string, maxChars = 400): string {
  const plain = text
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/([:.;!?])\s*\n+/g, '$1 ')
    .replace(/\n+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const end = cut.lastIndexOf('. ');
  return end > 0 ? cut.slice(0, end + 1) : cut;
}
