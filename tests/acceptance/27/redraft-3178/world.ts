// The world this folder's tests share (README: The surface): a question that waits on you, `deep setup` that never
// builds, and a session that asks through its own `deep mcp`. Everything else comes from ../helpers.ts and the stand-in
// of ../outcomes-redraft/ (its `Claude`, which writes a hook's added context and a held stop's feedback into the
// transcript as Claude Code does), imported as they are.
//
// Why a question of its own: a choice with a recommended option is provisional at the base (design: "With a provisional
// ask, work goes on with the recommended option"), so deep_ask answers it at once with the recommendation and no stop
// is held for it ("a taste call or choice that isn't provisional leaves the agent waiting on you"). The question the
// issue's session goes idle with waits on you, so these tests ask a choice with no recommendation (README: The dispute).
import { existsSync } from 'node:fs';
import {
  allEvents, assistantSays, deep, deepEntries, newSession, payload, readSettings, settingsFile, shown, tag, typedPrompt, waitFor,
  type Ev, type Hub, type Line, type Option, type Session,
} from '../helpers.ts';
import { Claude } from '../outcomes-redraft/standin.ts';

export interface Waiting { question: string; options: Option[]; subject?: Line; recommended?: string }
/** A fresh choice between two header colours with no recommendation: it waits on you, its first option (blue) the default at its deadline. */
export function waitingQuestion(subject?: Line): Waiting {
  const t = tag(4);
  return { question: `Which header colour for the checkout page (${t})?`, options: [{ id: 'blue', label: `Blue header ${t}` }, { id: 'green', label: `Green header ${t}` }], ...(subject ? { subject } : {}) };
}
/** deep_ask's arguments, every nullable field given as the tool's schema lists it, `recommended` null unless the question names one. */
export const askArgs = (q: Waiting): Line => ({ kind: 'choice', question: q.question, options: q.options, recommended: q.recommended ?? null, steps: null, where: null, why: null, check: null, subject: q.subject ?? null });

/**
 * `deep setup` with HOME the test's home, a hub already answering. It never builds (the clone is built): every
 * deep-hook an entry of DeepBuild's runs must exist, else BLOCKED.
 */
export async function setupHome(home: string): Promise<void> {
  const r = await deep(home, ['setup']);
  if (r.code !== 0 || !existsSync(settingsFile(home))) throw Error(`BLOCKED: deep setup must exit 0 and write ${settingsFile(home)}: ${shown(r)}`);
  for (const { hook } of deepEntries(readSettings(home))) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which isn't built: ${hook.command}`);
  }
}

export interface Asked { s: Session; claude: Claude; handle: string; id: string; created: Ev; q: Waiting; blue: Option; green: Option; reply: Line }
/**
 * A session of its own Claude Code (or one given) starts, you type a prompt and the agent calls deep_ask with `q`.
 * Resolves once the hub filed the ask, with `finish` for the call's reply (the agent's words follow it).
 */
export async function beginAsk(hub: Hub, home: string, o: { cwd: string; q: Waiting; claude?: Claude }): Promise<{ s: Session; claude: Claude; created: Ev; finish: () => Promise<Asked> }> {
  const claude = o.claude ?? Claude.start(home);
  const s = newSession(home, o.cwd);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Pick a header colour for the checkout page, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour for the checkout page, then stop.' }));
  let replied: Line | undefined;
  const replying = claude.tool(s, 'deep_ask', askArgs(o.q), 120_000).then((r) => (replied = r));
  const found = await waitFor(async () => replied?.error ? replied : (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === o.q.question), 60_000, `the deep_ask "${o.q.question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(replied ?? 'nothing yet').slice(0, 1500)}`); });
  if ('error' in found && !('kind' in found)) throw Error(`BLOCKED: deep_ask failed for ${s.id}: ${JSON.stringify(found).slice(0, 1500)}`);
  const created = found as Ev;
  return {
    s, claude, created,
    finish: async () => {
      const reply = await replying;
      assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
      return { s, claude, handle: `ask:${created.id}`, id: created.id, created, q: o.q, blue: o.q.options[0]!, green: o.q.options[1]!, reply };
    },
  };
}
/** The session's Stop after it asked. */
export const stopAfterAsking = (a: Asked, extra: Line = {}) => a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.', ...extra }));
/** Whether a text carries the answer green to this ask: its label (a fresh tag per ask), or the handle with the option ID. */
export const carriesGreen = (text: string, a: Asked) => text.includes(a.green.label) || new RegExp(`${a.handle}[^\\n]*\\bgreen\\b`).test(text);
