// The service log (oil, filters, brakes, VTV…), kept on the phone. Until the
// app has a garage with the user's cars, each entry names the car the user
// confirmed in the chat, plus the VIN when the adapter knew it.

export interface ServiceEntry {
  readonly id: string;
  readonly at: number;
  readonly car: string;
  readonly vin: string | null;
  readonly item: string;
  readonly km: number | null;
  readonly note: string | null;
}

export interface ServiceStorage {
  load(): ServiceEntry[];
  save(entries: readonly ServiceEntry[]): void;
}

export const MAX_ENTRIES = 300;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export class ServiceLog {
  constructor(private readonly storage: ServiceStorage) {}

  add(entry: ServiceEntry): ServiceEntry {
    this.storage.save([...this.storage.load(), entry].slice(-MAX_ENTRIES));
    return entry;
  }

  // Newest first; `car` matches by words ("onix" finds "Chevrolet Onix 2016").
  list(car: string | null = null): ServiceEntry[] {
    const all = [...this.storage.load()].sort((a, b) => b.at - a.at);
    if (!car) return all;
    const words = fold(car).split(' ').filter(Boolean);
    return all.filter((e) => {
      const text = fold(`${e.car} ${e.vin ?? ''}`);
      return words.every((w) => text.includes(w));
    });
  }

  // The cars named so far, to ask "¿es el Onix o el Gol?".
  cars(): string[] {
    const seen = new Map<string, string>();
    for (const e of this.list()) if (!seen.has(fold(e.car))) seen.set(fold(e.car), e.car);
    return [...seen.values()];
  }
}
