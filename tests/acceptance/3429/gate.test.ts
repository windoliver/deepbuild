// #3429, what stays as it was: in allow-all the done gate at the turn's end is unchanged (a Copilot false done still
// comes back to the session with its failing case, once), and a session another adapter gates gets no mode reading from
// the plugin (a Claude Code session deep-hook watches inside paseo). Paseo is #55's stand-in around the real plugin;
// the hub, deep mcp and deep-hook are real, and Claude Code is #29's stand-in (README, The worlds).
// First: what you gave the suite by hand, before ../29's helpers (loaded through ../55) delete DEEP_* (#55 D1).
import '../55/env.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEEP_HOOK, QUESTION, Session, makeWorld, startHub as startHub29 } from '../29/h-d.ts';
import {
  CART, CHECK, FALSE_DONE, Host, about, claimDone, cleanup, commitFalseDone, create, deepServer, events, fakeAgent, kinds, needPlugin, said, toolCall, turnEnds, turnStarts, waitFor, within,
  type Ev, type Fake, type Line,
} from '../55/helpers.ts';
import { AC, ALLOW_ALL, needRun } from './run.ts';
import { NOT_KNOWN, UNCHECKED, copilot, naming, readingsOf, rowOf, rowSays, saying, stating } from './world.ts';

afterEach(cleanup, 120_000);

const PROMPT = 'Make the cart total take the 10% discount off.';
const sendsNaming = (host: Host, f: Fake, text: string): Line[] => host.callsOf(f, 'send').filter((c) => String(c.args?.text ?? '').includes(text));
const verdictsOf = (evs: readonly Ev[], claim: string): Ev[] => evs.filter((e) => e.kind === 'verdict.made' && (e.subject === claim || e.data?.claim === claim));

it(`${AC.gate} in allow-all, a Copilot false done still comes back to the session with its failing case, once, and its claim is judged once and doesn't pass`, async () => {
  const w = await copilot(ALLOW_ALL);
  // The false done, as #55's: your prompt starts a turn, the agent edits the cart (still no discount), commits, claims
  // done through DeepBuild's MCP server, and ends its turn.
  await turnStarts(w.host, w.f, 't1', PROMPT);
  const mcp = await deepServer(w.home, w.repo.dir, w.servers);
  const commit = commitFalseDone(w.repo.dir);
  toolCall(w.f, 't1', 'edit', { type: 'edit', filePath: join(w.repo.dir, 'src/cart.js'), oldString: CART, newString: FALSE_DONE });
  const claim = await claimDone(mcp, commit);
  await w.host.settled(await turnEnds(w.host, w.f, 't1', { words: 'Done: the cart takes the discount off.' }));

  const sent = await within(180_000, () => sendsNaming(w.host, w.f, CHECK)[0]);
  // A second copy of it, were one sent, shows within this bound.
  await within(10_000, () => sendsNaming(w.host, w.f, CHECK).length > 1);
  const evs = await events(w.home);
  const verdicts = verdictsOf(evs, claim);
  expect(sent, `${AC.gate} in ${ALLOW_ALL} the done gate at the turn's end is unchanged: the failing case (${CHECK}) must come back into Copilot agent ${w.f.agent.id} (session ${w.f.session}) through paseo; the plugin sent ${JSON.stringify(w.host.callsOf(w.f, 'send'))}; ${claim}'s verdicts: ${verdicts.map(said).join('; ') || 'none'}; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}; plugin errors ${JSON.stringify(w.host.errors()).slice(0, 800)}`).toBeDefined();
  expect(sendsNaming(w.host, w.f, CHECK).map((c) => String(c.args?.text).slice(0, 200)), `${AC.gate} the failing case comes back once`).toHaveLength(1);
  expect(w.host.callsOf(w.f, 'send').filter((c) => c.interrupt), `${AC.gate} never an interrupt: an idle session gets a prompt, a running one a steer`).toEqual([]);
  // The gate's word for it is the base's to choose (README, On the merge base): a false done is one that doesn't pass.
  expect(verdicts.map((v) => (v.data.outcome === 'PASS' ? 'PASS' : 'not PASS')), `${AC.gate} the false done ${claim} of session ${w.f.session} is judged once and doesn't pass: ${verdicts.map(said).join('; ') || 'no verdict'}`).toEqual(['not PASS']);
  needRun(AC.gate);
}, 500_000);

it(`${AC.claude} a Claude Code session deep-hook gates, run through paseo with its snapshot reading bypassPermissions, gets no mode reading from the plugin`, async () => {
  needPlugin();
  if (!existsSync(DEEP_HOOK)) throw Error('BLOCKED: no target/debug/deep-hook, which gates the Claude Code session: cargo build --locked -q -p deep-hook');
  // #29's world: a Claude Code session whose hooks deep-hook sends, in its own repo. deep-hook binds the session first.
  const w = makeWorld();
  await startHub29(w);
  const host = await Host.start(w.home);
  const s = new Session(w);
  await s.start();
  await s.typed(QUESTION);
  const bound = await waitFor(async () => (await events(w.home)).find((e) => e.kind === 'session.start' && e.session === s.id), 60_000, `deep-hook's session.start for Claude Code session ${s.id}`, 500)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}: nothing shows that deep-hook gates the session`); });
  if (!/^claude/.test(String(bound.data?.agent))) throw Error(`BLOCKED: session ${s.id} isn't bound as Claude Code's by deep-hook: ${said(bound)}`);
  // The same session as paseo runs it: provider claude, the agent's own session ID, its snapshot reading the mode
  // that skips Claude Code's prompts, among the modes paseo 0.15.0's Claude provider lists.
  const MODE = 'bypassPermissions';
  const f = fakeAgent('claude', w.repo, s.id);
  f.snapshot.currentModeId = MODE;
  f.snapshot.runtimeInfo.modeId = MODE;
  f.snapshot.availableModes = ['plan', 'default', 'acceptEdits', 'auto', MODE].map((id) => ({ id, label: id }));
  await create(host, f);
  await turnStarts(host, f, 't1', QUESTION);
  // The plugin reads the agent for this turn's line; a mode reading that line brought would show within these bounds.
  await within(30_000, () => host.callsOf(f, 'refresh').length > 0);
  const mode = (evs: readonly Ev[]): Ev[] => { const own = readingsOf(evs, s.id); return [...new Set([...naming(own, MODE), ...stating(own, UNCHECKED), ...stating(own, NOT_KNOWN)])]; };
  await within(20_000, async () => mode(await events(w.home)).length > 0);

  const evs = await events(w.home);
  expect(mode(evs).map(said), `${AC.claude} Claude Code session ${s.id} is gated by deep-hook, which sees every call whatever its mode, so the plugin's line for its turn (snapshot mode ${MODE}) brings no mode reading; the session's record: ${kinds(evs.filter((e) => about(e, s.id)))}; plugin errors ${JSON.stringify(host.errors()).slice(0, 400)}`).toEqual([]);
  const row = await rowOf(w.home, s.id);
  if (!row.list || !row.detail) throw Error(`BLOCKED: the hub lists no row for Claude Code session ${s.id}, so nothing shows what its row holds: ${rowSays(row)}`);
  expect([...saying(row, UNCHECKED), ...saying(row, NOT_KNOWN)], `${AC.claude} Claude Code session ${s.id}'s row holds no mode line from the plugin; it reads ${rowSays(row)}`).toEqual([]);
  needRun(AC.claude);
}, 400_000);
