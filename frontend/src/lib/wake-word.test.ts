import { describe, expect, it } from 'vitest';
import {
  SpeechSegmenter,
  concatBlocks,
  encodeWav,
  normalizeTranscript,
  parseWakeCommand,
  resample,
  rms,
} from './wake-word';
import { guessLanguage, pickVoice } from './system-voice';

describe('wake word', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeTranscript('¡Viérnes,  ÁBRE!')).toBe('viernes abre');
  });

  it('extracts the request after "Viernes"', () => {
    expect(parseWakeCommand('Oye Viernes, ¿qué tiempo hace hoy?')).toEqual({
      heard: true,
      command: '¿qué tiempo hace hoy?',
    });
  });

  it('accepts the b/v spelling speech-to-text often produces', () => {
    expect(parseWakeCommand('Biernes pon música').command).toBe('pon música');
  });

  it('reports the wake word alone with an empty request', () => {
    expect(parseWakeCommand('Viernes.')).toEqual({ heard: true, command: '' });
  });

  it('ignores speech without the wake word at the start', () => {
    expect(parseWakeCommand('el viernes que viene vamos al cine').heard).toBe(false);
    expect(parseWakeCommand('hola qué tal').heard).toBe(false);
    expect(parseWakeCommand('').heard).toBe(false);
  });

  it('accepts a greeting before the name', () => {
    expect(parseWakeCommand('¡Oye, Viernes! abre el correo')).toEqual({
      heard: true,
      command: 'abre el correo',
    });
    expect(parseWakeCommand('Hey Viernes').command).toBe('');
  });
});

describe('speech segmenter', () => {
  const feedMany = (seg: SpeechSegmenter, level: number, fromMs: number, toMs: number) => {
    const events = [];
    for (let t = fromMs; t <= toMs; t += 40) {
      const ev = seg.feed(level, t);
      if (ev) events.push(ev);
    }
    return events;
  };

  it('emits start and end around speech', () => {
    const seg = new SpeechSegmenter();
    expect(feedMany(seg, 0.002, 0, 1000)).toEqual([]);
    expect(feedMany(seg, 0.2, 1040, 2000)).toEqual(['start']);
    expect(feedMany(seg, 0.002, 2040, 3500)).toEqual(['end']);
  });

  it('discards clicks shorter than the minimum speech length', () => {
    const seg = new SpeechSegmenter();
    feedMany(seg, 0.002, 0, 1000);
    expect(feedMany(seg, 0.2, 1040, 1080)).toEqual(['start']);
    expect(feedMany(seg, 0.002, 1120, 2500)).toEqual(['discard']);
  });

  it('caps very long segments', () => {
    const seg = new SpeechSegmenter({ maxSegmentMs: 2000 });
    feedMany(seg, 0.002, 0, 500);
    expect(feedMany(seg, 0.2, 540, 3000)).toEqual(['start', 'end', 'start']);
  });
});

describe('audio packing', () => {
  it('computes rms', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });

  it('resamples to the target rate', () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
  });

  it('writes a valid 16-bit mono WAV', async () => {
    const wav = encodeWav(concatBlocks([new Float32Array([0, 1]), new Float32Array([-1])]), 16000);
    const view = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe('audio/wav');
    expect(view.byteLength).toBe(44 + 3 * 2);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });
});

describe('system voice', () => {
  const voice = (name: string, lang: string, localService = true) =>
    ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  it('prefers a natural Spanish voice for Spanish text', () => {
    const voices = [
      voice('Microsoft David', 'en-US'),
      voice('Microsoft Helena', 'es-ES'),
      voice('Microsoft Elvira Online (Natural)', 'es-ES', false),
    ];
    expect(pickVoice(voices, guessLanguage('Hola, ¿qué tal estás hoy?', 'en-US'))?.name)
      .toBe('Microsoft Elvira Online (Natural)');
  });

  it('falls back to the UI language for non-Spanish text', () => {
    expect(guessLanguage('The weather is nice', 'en-US')).toBe('en-US');
    expect(pickVoice([voice('Microsoft Helena', 'es-ES')], 'fr-FR')).toBeUndefined();
  });
});
