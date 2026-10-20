// Writes the trip log to the app's document directory, one file per trip:
//   <documents>/trips/trip-YYYYMMDD-HHMMSS.jsonl
// (Camera frames for the teacher models left with the detector, 2026-10-20;
// see the etapa-camara branch. Folders from older trips are still deleted
// with their trip.)
//
// Buffered in memory and appended every 2 s, so a crash loses at most that.
// Local only: the log holds the driver's positions and never leaves the phone
// unless the person exports it — Settings → Viajes grabados → share (any
// build), or on a development build:
//   adb exec-out run-as com.obdient.obdient2.dev cat files/trips/<name>
// (Paths.document is the app's files dir on Android; run-as needs a
// debuggable build, so preview/production builds rely on sharing).

import { Directory, File, Paths } from 'expo-file-system';
import { TRIP_LOG_VERSION, TripLogBuffer, type TripRecord } from '@/domain/recording/trip-log';

const FLUSH_MS = 2000;

export interface TripFileInfo {
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number | null;
}

export class TripRecorder {
  private file: File | null = null;
  private buffer = new TripLogBuffer();
  private timer: ReturnType<typeof setInterval> | null = null;

  get active(): boolean {
    return this.file != null;
  }

  start(meta: Record<string, unknown>): string {
    this.stop();
    const dir = tripsDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const name = `trip-${stamp(new Date())}.jsonl`;
    const file = new File(dir, name);
    file.create();
    this.file = file;
    this.buffer = new TripLogBuffer();
    this.buffer.push({ k: 'hdr', v: TRIP_LOG_VERSION, startedAt: new Date().toISOString(), meta });
    this.flush();
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    return name;
  }

  record(rec: TripRecord): void {
    if (this.file) this.buffer.push(rec);
  }

  event(name: string, data?: Record<string, unknown>): void {
    this.record({ k: 'ev', t: Date.now(), name, ...(data ? { data } : {}) });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
    this.file = null;
  }

  list(): TripFileInfo[] {
    const dir = tripsDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.jsonl'))
      .map((f) => {
        const info = f.info();
        return { name: f.name, sizeBytes: info.size ?? 0, modifiedMs: info.modificationTime ?? null };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  // file:// URI for the share sheet.
  uri(name: string): string {
    return new File(tripsDir(), name).uri;
  }

  remove(name: string): void {
    const f = new File(tripsDir(), name);
    if (f.exists) f.delete();
    const frames = new Directory(tripsDir(), stem(name));
    if (frames.exists) frames.delete();
  }

  private flush(): void {
    const text = this.buffer.drain();
    if (!text || !this.file) return;
    try {
      this.file.write(text, { append: true });
    } catch (err) {
      // Disk full or file gone: stop recording rather than fail navigation.
      console.warn('[TripRecorder] write failed, recording stopped:', err);
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.file = null;
    }
  }
}

function tripsDir(): Directory {
  return new Directory(Paths.document, 'trips');
}


function stem(name: string): string {
  return name.replace(/\.jsonl$/, '');
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
