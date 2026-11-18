/**
 * Voice output with the operating system's own voices (Web Speech API
 * `speechSynthesis`). On Windows these are the built-in voices, including
 * Spanish ones, so Viernes can talk without any extra download or service.
 */

export function systemVoiceAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

const SPANISH_HINT = /[ñáéíóúü¿¡]|\b(el|la|los|las|que|de|y|en|un|una|es|por|para|con|hola|gracias)\b/i;

/** Rough language guess: Spanish if the text looks Spanish, else the UI language. */
export function guessLanguage(text: string, fallback: string): string {
  const hits = text.slice(0, 400).match(new RegExp(SPANISH_HINT.source, 'gi'))?.length ?? 0;
  if (hits >= 2) return 'es';
  return fallback;
}

/** Best installed voice for a language ('es', 'en-US', ...). */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | undefined {
  const base = lang.toLowerCase().split('-')[0];
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  if (matching.length === 0) return undefined;
  const exact = matching.filter((v) => v.lang.toLowerCase() === lang.toLowerCase());
  const pool = exact.length ? exact : matching;
  // Prefer natural/online voices when Windows offers them, then local ones.
  return (
    pool.find((v) => /natural|online|neural/i.test(v.name))
    ?? pool.find((v) => v.localService)
    ?? pool[0]
  );
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/**
 * Speak `text`. Resolves when speech finishes (or is cancelled), rejects on
 * error. Call `cancelSystemVoice()` to stop.
 */
export async function speakWithSystemVoice(text: string): Promise<void> {
  if (!systemVoiceAvailable()) throw new Error('Voice output is not available');
  const synth = window.speechSynthesis;
  synth.cancel();
  const uiLang = (typeof navigator !== 'undefined' && navigator.language) || 'es-ES';
  const lang = guessLanguage(text, uiLang);
  const voice = pickVoice(await loadVoices(), lang);

  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? lang;
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') resolve();
      else reject(new Error(`Voice output failed: ${event.error}`));
    };
    synth.speak(utterance);
  });
}

export function cancelSystemVoice(): void {
  if (systemVoiceAvailable()) window.speechSynthesis.cancel();
}
