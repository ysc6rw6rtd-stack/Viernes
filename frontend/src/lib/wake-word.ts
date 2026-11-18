/**
 * Hands-free ("wake word") helpers for Viernes.
 *
 * Everything here is pure so it can be unit-tested without a microphone:
 * matching the wake word in a transcript, cutting the microphone stream into
 * speech segments, and packing PCM samples into a WAV file the local speech
 * backend can transcribe.
 */

/** Spellings speech-to-text produces for "Viernes" (Spanish b/v merge). */
export const WAKE_WORDS = ['viernes', 'biernes'] as const;

/** Lower-case, strip accents and punctuation, collapse whitespace. */
export function normalizeTranscript(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WakeMatch {
  /** The wake word was spoken. */
  heard: boolean;
  /** Whatever was said after the wake word ('' if nothing yet). */
  command: string;
}

/**
 * Find the wake word in a transcript and return the request that follows it,
 * keeping the user's original wording (accents, punctuation) for the command.
 */
export function parseWakeCommand(text: string): WakeMatch {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = normalizeTranscript(words[i]);
    if ((WAKE_WORDS as readonly string[]).includes(word)) {
      const command = words
        .slice(i + 1)
        .join(' ')
        .replace(/^[\s,.:;!?-]+/, '')
        .trim();
      return { heard: true, command };
    }
  }
  return { heard: false, command: '' };
}

/** Root-mean-square level of one block of samples (0..1). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export interface SegmenterOptions {
  /** Level above the noise floor (as a multiple) that counts as speech. */
  speechRatio: number;
  /** Absolute minimum level that counts as speech. */
  minLevel: number;
  /** Silence that ends a segment, in ms. */
  hangoverMs: number;
  /** Segments shorter than this are discarded (clicks, coughs), in ms. */
  minSpeechMs: number;
  /** Hard cap on a segment, in ms. */
  maxSegmentMs: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: SegmenterOptions = {
  speechRatio: 3,
  minLevel: 0.015,
  hangoverMs: 900,
  minSpeechMs: 350,
  maxSegmentMs: 12000,
};

export type SegmentEvent = 'start' | 'end' | 'discard' | null;

/**
 * Voice-activity segmenter: feed it one level per audio block and it reports
 * when speech starts and ends. The noise floor adapts while nobody speaks, so
 * a fan or a quiet room does not keep it triggered.
 */
export class SpeechSegmenter {
  private opts: SegmenterOptions;
  private noiseFloor = 0.005;
  private inSpeech = false;
  private segmentStart = 0;
  private lastVoice = 0;
  private voicedMs = 0;
  private lastFeed = 0;

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...DEFAULT_SEGMENTER_OPTIONS, ...opts };
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  threshold(): number {
    return Math.max(this.opts.minLevel, this.noiseFloor * this.opts.speechRatio);
  }

  reset(): void {
    this.inSpeech = false;
    this.voicedMs = 0;
    this.lastFeed = 0;
  }

  feed(level: number, now: number): SegmentEvent {
    const dt = this.lastFeed ? Math.min(now - this.lastFeed, 500) : 0;
    this.lastFeed = now;
    const voiced = level >= this.threshold();

    if (!this.inSpeech) {
      if (voiced) {
        this.inSpeech = true;
        this.segmentStart = now;
        this.lastVoice = now;
        this.voicedMs = 0;
        return 'start';
      }
      // Track the room's background level only while it is quiet.
      this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
      return null;
    }

    if (voiced) {
      this.lastVoice = now;
      this.voicedMs += dt;
    }
    const tooLong = now - this.segmentStart >= this.opts.maxSegmentMs;
    if (now - this.lastVoice >= this.opts.hangoverMs || tooLong) {
      this.inSpeech = false;
      return this.voicedMs >= this.opts.minSpeechMs ? 'end' : 'discard';
    }
    return null;
  }
}

/** Linear-interpolation resample to `toRate` (speech models want 16 kHz). */
export function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Pack mono float samples into a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Join captured blocks into one buffer. */
export function concatBlocks(blocks: Float32Array[]): Float32Array {
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
