// AC10 #19.3f3246ed A test prompt to an agent runs only with `deep doctor --prompt`, since it spends plan usage.
//
// The stand-in `claude` and `codex` log every call; a call that sends a prompt (README: AC10, What counts as a test
// prompt) is one that could reach a model: `claude -p`, `codex exec`, or either with no subcommand that stays off
// the model. `deep doctor` and `deep doctor --json` must make none; `deep doctor --prompt` must send Claude Code its
// test prompt, and the prompt item then reads what came back, never "not checked".

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, doctor, isPrompt, promptItem, shown, world } from './helpers.ts';

afterAll(cleanup, 60_000);

/** deep doctor, as JSON and in words, without --prompt: no stand-in call may send a prompt. Throws naming the call. */
async function noPromptWithoutFlag(plant?: string): Promise<void> {
  const w = await world(plant ? { plant } : {});
  for (const json of [true, false]) {
    const d = await doctor(w.h, [], { json });
    const prompts = d.calls.filter(isPrompt);
    if (prompts.length) throw Error(`AC10 deep doctor${json ? ' --json' : ''} sent a test prompt without --prompt, spending plan usage: ${prompts.join(' | ')}`);
  }
}

describe('AC10 #19.3f3246ed A test prompt to an agent runs only with `deep doctor --prompt`, since it spends plan usage', () => {
  it('AC10 #19.3f3246ed deep doctor and deep doctor --json send no agent a prompt; deep doctor --prompt sends Claude Code its test prompt and reads the answer', async () => {
    await noPromptWithoutFlag();
    const w = await world();
    const d = await doctor(w.h, ['--prompt']);
    const sent = d.calls.filter((c) => isPrompt(c) && c.startsWith('claude '));
    expect(sent.length, `AC10 deep doctor --prompt must send Claude Code a test prompt (a \`claude -p\` call); the stand-ins saw ${JSON.stringify(d.calls)}: ${shown(d.ran)}`).toBeGreaterThan(0);
    const item = promptItem(d.items);
    expect(item, `AC10 deep doctor --prompt shows Claude Code's test prompt as an item: ${shown(d.ran)}`).toBeDefined();
    expect(item!.code, `AC10 a test prompt that ran is never "not checked": ${JSON.stringify(item)}`).not.toBe('not_checked');
    expect(item!.level, `AC10 the stand-in answered the prompt with a successful turn, so the item is ok: ${JSON.stringify(item)}`).toBe('ok');
  }, 600_000);

  it('AC10 #19.3f3246ed (wrong program) a doctor that sends the test prompt without --prompt (prompt-without-flag) fails this test, naming the call', async () => {
    await expect(noPromptWithoutFlag('prompt-without-flag')).rejects.toThrow(/AC10 deep doctor( --json)? sent a test prompt without --prompt, spending plan usage: claude /);
  }, 600_000);
});
