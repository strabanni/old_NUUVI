// One place where NUUVI talks to Claude (Anthropic's API). Everything that uses it is optional:
// it only switches on when the site has an ANTHROPIC_API_KEY, and every feature has a plain
// fallback for when it's off or Claude can't be reached.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

export function createAi({ client = null, apiKey = null } = {}) {
  let api = client;
  const enabled = !!(client || apiKey);

  // Asks Claude and returns its answer as JSON shaped like `schema`.
  async function ask({ system, content, schema, effort = 'medium', maxTokens = 16000 }) {
    if (!enabled) throw new Error('AI is off');
    api ??= new Anthropic({ apiKey });
    const request = {
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    };
    let res;
    try {
      // If Claude declines (its safety checks can be over-careful with fiction), another model takes over.
      res = await api.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      res = await api.beta.messages.create(request); // the account doesn't have fallbacks: plain request
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined');
    if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of room');
    const text = res.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('No answer');
    return JSON.parse(text);
  }

  return { enabled, ask };
}
