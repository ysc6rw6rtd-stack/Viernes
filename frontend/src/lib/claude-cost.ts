/**
 * Claude spend estimates and friendly API error messages for Viernes.
 *
 * Prices are USD per million tokens (Anthropic first-party API). Haiku 5.5's
 * price is for prompts up to 100K tokens, which covers normal chat.
 */
export const CLAUDE_PRICING: Record<string, { input: number; output: number; label: string }> = {
  'claude-opus-5-5': { input: 4, output: 20, label: 'Claude Opus 5.5' },
  'claude-sonnet-5-5': { input: 2, output: 10, label: 'Claude Sonnet 5.5' },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, label: 'Claude Haiku 5.5' },
  'claude-opus-4-6': { input: 5, output: 25, label: 'Claude Opus 4.6' },
  'claude-sonnet-4-6': { input: 3, output: 15, label: 'Claude Sonnet 4.6' },
  'claude-haiku-4-5': { input: 1, output: 5, label: 'Claude Haiku 4.5' },
};

export const CLAUDE_CONSOLE_URL = 'https://platform.claude.com/';

export function isClaudeModel(model: string): boolean {
  return model.startsWith('claude-');
}

/** Estimated USD cost of `promptTokens` in and `completionTokens` out. */
export function estimateClaudeCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = CLAUDE_PRICING[model];
  if (!price) return null;
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

/**
 * Turn raw API failures into an instruction the user can act on. Returns the
 * original text when nothing more specific applies.
 */
export function friendlyChatError(message: string, model = ''): string {
  const m = message.toLowerCase();
  const authProblem = m.includes('401') || m.includes('unauthorized') || m.includes('403');
  if (model && !isClaudeModel(model) && authProblem) {
    return `El modelo «${model}» no es de Claude y no tienes clave para usarlo. Elige un modelo de Claude arriba a la izquierda (Ctrl+K), por ejemplo claude-opus-5-5.`;
  }
  if (m.includes('credit balance') || m.includes('billing') || m.includes('402')) {
    return 'Te has quedado sin saldo de Claude. Recarga créditos en platform.claude.com (Facturación) y vuelve a intentarlo.';
  }
  if (
    m.includes('invalid x-api-key')
    || m.includes('authentication_error')
    || m.includes('invalid api key')
    || m.includes('401')
    || m.includes('expired')
  ) {
    return 'Tu clave de Claude no es válida o ha caducado. Crea una nueva en platform.claude.com (Claves de API) y ponla en Ajustes → Inference source.';
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('overloaded') || m.includes('529')) {
    return 'Claude está saturado o has hecho muchas peticiones seguidas. Espera un minuto y vuelve a intentarlo.';
  }
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('connection')) {
    return 'No hay conexión con el servidor de Viernes o con internet. Comprueba tu conexión y vuelve a intentarlo.';
  }
  return message;
}
