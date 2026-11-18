/**
 * Which model the chat should start on.
 *
 * With Claude as the inference source the user already chose a Claude model
 * during setup, so that wins over the server's generic recommendation (which
 * can be an unrelated model the cloud engine happens to list first).
 */
export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';

export function pickStartupModel({
  source,
  configuredModel,
  recommended,
  current,
  available,
}: {
  source: string | undefined;
  configuredModel: string | undefined;
  recommended: string;
  current: string;
  available: string[];
}): string {
  if (source === 'claude') {
    if (current.startsWith('claude-') && available.includes(current)) return current;
    const wanted = configuredModel || CLAUDE_DEFAULT_MODEL;
    if (available.includes(wanted)) return wanted;
    const anyClaude = available.find((id) => id.startsWith('claude-'));
    if (anyClaude) return anyClaude;
  }
  if (current && available.includes(current)) return current;
  return recommended;
}
