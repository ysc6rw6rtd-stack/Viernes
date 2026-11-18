import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../lib/api';
import {
  SpeechSegmenter,
  concatBlocks,
  encodeWav,
  parseWakeCommand,
  resample,
  rms,
} from '../lib/wake-word';

export type HandsFreeState = 'off' | 'starting' | 'listening' | 'awake' | 'transcribing' | 'error';

/** After "Viernes" on its own, wait this long for the request. */
const AWAKE_WINDOW_MS = 8000;
/** Audio kept from just before speech starts, so the first word is not clipped. */
const PRE_ROLL_MS = 400;
const TARGET_RATE = 16000;
const BLOCK_SIZE = 2048;

function speechLanguage(): string | undefined {
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  return lang?.toLowerCase().startsWith('es') ? 'es' : undefined;
}

/** Short two-tone chime: "I'm listening". */
function chime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  [660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.12);
  });
}

/**
 * Listen continuously; when someone says "Viernes ...", transcribe the request
 * with the local speech backend and hand it to `onCommand`.
 *
 * `paused` must be true while Viernes is answering or speaking, so it never
 * hears (and answers) itself.
 */
export function useHandsFree({
  enabled,
  paused,
  onCommand,
}: {
  enabled: boolean;
  paused: boolean;
  onCommand: (text: string) => void;
}) {
  const [state, setState] = useState<HandsFreeState>('off');
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState('');

  const pausedRef = useRef(paused);
  const onCommandRef = useRef(onCommand);
  const awakeUntilRef = useRef(0);
  const busyRef = useRef(false);
  pausedRef.current = paused;
  onCommandRef.current = onCommand;

  const handleSegment = useCallback(async (samples: Float32Array, rate: number) => {
    busyRef.current = true;
    const wasAwake = Date.now() < awakeUntilRef.current;
    setState('transcribing');
    try {
      const wav = encodeWav(resample(samples, rate, TARGET_RATE), TARGET_RATE);
      const { text } = await transcribeAudio(wav, 'speech.wav', speechLanguage());
      const heard = (text ?? '').trim();
      if (heard) setLastHeard(heard);

      const match = parseWakeCommand(heard);
      if (match.heard && match.command) {
        awakeUntilRef.current = 0;
        onCommandRef.current(match.command);
      } else if (match.heard) {
        awakeUntilRef.current = Date.now() + AWAKE_WINDOW_MS;
      } else if (wasAwake && heard) {
        awakeUntilRef.current = 0;
        onCommandRef.current(heard);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entender el audio');
    } finally {
      busyRef.current = false;
      setState(Date.now() < awakeUntilRef.current ? 'awake' : 'listening');
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let wasAwake = false;

    const start = async () => {
      setState('starting');
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        if (!cancelled) {
          setError('Sin acceso al micrófono. Permítelo en Windows y vuelve a activarlo.');
          setState('error');
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      ctx = new AudioContext();
      const rate = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
      const segmenter = new SpeechSegmenter();
      const preRollBlocks = Math.ceil((PRE_ROLL_MS / 1000) * rate / BLOCK_SIZE);
      const history: Float32Array[] = [];
      let segment: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        const block = new Float32Array(event.inputBuffer.getChannelData(0));
        const now = Date.now();

        const awake = now < awakeUntilRef.current;
        if (awake && !wasAwake && ctx) chime(ctx);
        if (!awake && wasAwake && !busyRef.current) setState('listening');
        wasAwake = awake;

        if (pausedRef.current || busyRef.current) {
          segmenter.reset();
          segment = [];
          history.length = 0;
          return;
        }

        history.push(block);
        if (history.length > preRollBlocks) history.shift();

        const ev = segmenter.feed(rms(block), now);
        if (ev === 'start') {
          segment = [...history];
        } else if (segmenter.speaking) {
          segment.push(block);
        }
        if (ev === 'end') {
          const samples = concatBlocks(segment);
          segment = [];
          void handleSegment(samples, rate);
        } else if (ev === 'discard') {
          segment = [];
        }
      };

      source.connect(processor);
      // ScriptProcessor only runs while connected to the output; it writes
      // nothing, so this is silent.
      processor.connect(ctx.destination);
      if (!cancelled) setState('listening');
    };

    void start();

    return () => {
      cancelled = true;
      awakeUntilRef.current = 0;
      if (processor) processor.onaudioprocess = null;
      processor?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setState('off');
    };
  }, [enabled, handleSegment]);

  return { state, error, lastHeard };
}
