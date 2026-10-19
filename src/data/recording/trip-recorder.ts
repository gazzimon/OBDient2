// Writes the trip log to the app's document directory, one file per trip:
//   <documents>/trips/trip-YYYYMMDD-HHMMSS.jsonl
// plus, when frame capture is on, its camera frames (JPEG, bursts):
//   <documents>/trips/trip-YYYYMMDD-HHMMSS/<epoch ms>.jpg
//
// Buffered in memory and appended every 2 s, so a crash loses at most that.
// Local only: the log holds the driver's positions and never leaves the phone
// unless the person exports it — Settings → Viajes grabados → share (any
// build), or on a development build:
//   adb exec-out run-as com.obdient.obdient2.dev cat files/trips/<name>
// (Paths.document is the app's files dir on Android; run-as needs a
// debuggable build, so preview/production builds rely on sharing).

import { Directory, File, Paths } from 'expo-file-system';
import { Images, type PixelFormat } from 'react-native-nitro-image';
import { NO_COMPRESSION, zip } from 'react-native-zip-archive';
import { TRIP_LOG_VERSION, TripLogBuffer, type TripRecord } from '@/domain/recording/trip-log';

const FLUSH_MS = 2000;
// JPEG encodes in flight at once; frames beyond that are dropped, never queued.
const MAX_FRAME_SAVES = 2;
const JPEG_QUALITY = 85;

// Packed pixels handed over from the camera thread.
export interface CapturedFrame {
  readonly buffer: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: PixelFormat;
  readonly orientation: string;
  readonly tMs: number;
  readonly burst: number;
  readonly index: number;
}

export interface TripFileInfo {
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number | null;
  // Camera frames kept with the trip (0 when frame capture was off).
  readonly frames: number;
}

export class TripRecorder {
  private file: File | null = null;
  private buffer = new TripLogBuffer();
  private timer: ReturnType<typeof setInterval> | null = null;
  // Frames of the current trip: <documents>/trips/<trip>/<t>.jpg
  private frames: Directory | null = null;
  private savingFrames = 0;
  // Frame errors already written to the log (a few are enough to diagnose).
  private frameErrors = 0;

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
    this.frames = new Directory(dir, stem(name));
    this.frameErrors = 0;
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

  // Encodes and stores a camera frame, then logs it. Off the JS thread
  // (nitro-image encodes natively); the log line is written once the file exists.
  saveFrame = (f: CapturedFrame): void => {
    const dir = this.frames;
    if (!this.file || !dir || this.savingFrames >= MAX_FRAME_SAVES) return;
    this.savingFrames += 1;
    const name = `${f.tMs}.jpg`;
    void (async () => {
      try {
        if (!dir.exists) dir.create({ intermediates: true });
        // A buffer of this runtime, alive for the whole call: the one that
        // arrives from the camera thread is reported "detached" by Nitro. The
        // async loader copies it before leaving the JS thread and decodes off it.
        const pixels = f.buffer.slice().buffer as ArrayBuffer;
        const image = await Images.loadFromRawPixelDataAsync({
          buffer: pixels,
          width: f.width,
          height: f.height,
          pixelFormat: f.pixelFormat,
        });
        await image.saveToFileAsync(new File(dir, name).uri.replace(/^file:\/\//, ''), 'jpg', JPEG_QUALITY);
        this.record({
          k: 'frm',
          t: f.tMs,
          f: `${dir.name}/${name}`,
          w: f.width,
          h: f.height,
          o: f.orientation,
          b: f.burst,
          i: f.index,
        });
      } catch (err) {
        console.warn('[TripRecorder] frame not saved:', err, Object.prototype.toString.call(f.buffer));
        // Release builds show no console: leave the first errors in the log itself.
        if (this.frameErrors < 3) {
          this.frameErrors += 1;
          this.event('frame-error', { message: String(err).slice(0, 300) });
        }
      } finally {
        this.savingFrames -= 1;
      }
    })();
  };

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
    this.file = null;
    this.frames = null;
  }

  list(): TripFileInfo[] {
    const dir = tripsDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.jsonl'))
      .map((f) => {
        const info = f.info();
        const frames = new Directory(tripsDir(), stem(f.name));
        return {
          name: f.name,
          sizeBytes: info.size ?? 0,
          modifiedMs: info.modificationTime ?? null,
          frames: frames.exists ? frames.list().length : 0,
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  // file:// URI for the share sheet.
  uri(name: string): string {
    return new File(tripsDir(), name).uri;
  }

  // The log and its frames in one .zip (in the cache dir), for the share sheet:
  // release builds cannot be read with adb run-as, so this is how a trip with
  // frames leaves the phone. Stored without compression: the frames are JPEGs
  // already, and zipping is then just a copy.
  async archive(name: string): Promise<string> {
    const target = new File(Paths.cache, `${stem(name)}.zip`);
    if (target.exists) target.delete();
    const frames = new Directory(tripsDir(), stem(name));
    const sources = [new File(tripsDir(), name).uri, ...(frames.exists ? [frames.uri] : [])].map(toPath);
    await zip(sources, toPath(target.uri), NO_COMPRESSION);
    return target.uri;
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

// file:///data/…/x/ → /data/…/x (the zip module takes plain paths).
function toPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');
}

function stem(name: string): string {
  return name.replace(/\.jsonl$/, '');
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
