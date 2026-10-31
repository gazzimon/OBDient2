// Informes (2026-10-31): the last PDFs made on this phone, to share again or to
// compare before and after a repair. The newest ten are kept; the screen deletes
// the files of the ones that fall out.

export interface SavedReport {
  readonly id: string;
  readonly at: number;
  // The PDF in the app's documents.
  readonly uri: string;
  readonly vin: string | null;
  readonly make: string | null;
  // Stored codes when it was made; null if the car was not read.
  readonly codes: readonly string[] | null;
  readonly workshop: string | null;
}

export interface SavedReportStorage {
  load(): SavedReport[];
  save(reports: readonly SavedReport[]): void;
}

export const MAX_SAVED_REPORTS = 10;

export class SavedReports {
  constructor(private readonly storage: SavedReportStorage) {}

  // Returns the ones that no longer fit, whose files are to be deleted.
  add(report: SavedReport): SavedReport[] {
    const all = [report, ...this.storage.load()].sort((a, b) => b.at - a.at);
    this.storage.save(all.slice(0, MAX_SAVED_REPORTS));
    return all.slice(MAX_SAVED_REPORTS);
  }

  list(): SavedReport[] {
    return [...this.storage.load()].sort((a, b) => b.at - a.at);
  }

  remove(id: string): SavedReport | null {
    const all = this.storage.load();
    const gone = all.find((r) => r.id === id) ?? null;
    this.storage.save(all.filter((r) => r.id !== id));
    return gone;
  }
}
