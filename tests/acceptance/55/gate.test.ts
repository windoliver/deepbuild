// #55's done gate through paseo: AC2 (a Copilot false done comes back with its failing case, the verdict recorded
// once), AC3 (a Claude session deep-hook watches is gated once), AC12 (a pi session with the pi package is gated once,
// by the package) and AC14 (words for an idle session wait for the agent's own idle signal, never typed into a dialog).
// Paseo is fixtures/paseo-host.mjs around the real plugin; the hub, deep-hook, deep mcp, the pi package and real pi
// are real (README, The worlds).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, startHub } from '../27/helpers.ts';
import { BEHAVIOR, CHECK_BYTES, CHECK_FILE, DEFAULT_RULES, DEEP_HOOK, SETTINGS, Session, draftFor, req, startHub as startHub29, type World as World29 } from '../29/h-d.ts';
import { Pi, piCli, startHub as startHub40 } from '../40/helpers.ts';
import {
  AC, ASK_SETTINGS, CART, CHECK, FALSE_DONE, Host, about, cleanup, asksNaming, claimDone, commitFalseDone, create, deepServer, editConfig, events, fakeAgent, git, kinds, makeHome,
  needPlugin, permissionAsked, permissionOf, said, sleep, specRepo, tempDir, toolCall, turnEnds, turnStarts, waitFor, within, type Ev, type Fake, type Line, type Permission,
} from './helpers.ts';

afterEach(cleanup, 120_000);

const PROMPT = 'Make the cart total take the 10% discount off.';
const sendsNaming = (host: Host, f: Fake, text: string): Line[] => host.callsOf(f, 'send').filter((c) => String(c.args?.text ?? '').includes(text));
const verdictsOf = (evs: readonly Ev[], claims: readonly string[]): Ev[] => evs.filter((e) => e.kind === 'verdict.made' && (claims.includes(String(e.subject)) || claims.includes(String(e.data?.claim))));
const claimsIn = (evs: readonly Ev[], sessions: readonly string[]): string[] => evs.filter((e) => e.kind === 'claim.made' && sessions.includes(String(e.session))).map((e) => `claim:${e.id}`);
const stopsIn = (evs: readonly Ev[], sessions: readonly string[]): Ev[] => evs.filter((e) => e.kind === 'agent.stop' && sessions.includes(String(e.session)));

/** A Copilot agent run through paseo, which has no hooks of its own, in the fixture repo, opened with the plugin's MCP server. */
async function copilot(o: { plant?: string } = {}) {
  needPlugin();
  const { home } = makeHome();
  editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
  const repo = specRepo(home);
  await startHub(home);
  const host = await Host.start(home, o);
  const f = fakeAgent('copilot', repo.dir);
  const servers = await create(host, f);
  return { home, repo, host, f, servers };
}
/**
 * The false done: your prompt starts a turn, the agent edits the cart (still no discount), commits, claims done through
 * DeepBuild's MCP server, and ends the turn reading `status`; `dialogs` are pending as it ends.
 */
async function falseDone(w: Awaited<ReturnType<typeof copilot>>, o: { status?: string; dialogs?: Permission[] } = {}): Promise<string> {
  await turnStarts(w.host, w.f, 't1', PROMPT);
  const mcp = await deepServer(w.home, w.repo.dir, w.servers);
  const commit = commitFalseDone(w.repo.dir);
  toolCall(w.f, 't1', 'edit', { type: 'edit', filePath: join(w.repo.dir, 'src/cart.js'), oldString: CART, newString: FALSE_DONE });
  const claim = await claimDone(mcp, commit);
  for (const d of o.dialogs ?? []) (w.f.snapshot.pendingPermissions as Permission[]).push(d);
  await w.host.settled(await turnEnds(w.host, w.f, 't1', { words: 'Done: the cart takes the discount off.', status: o.status }));
  for (const d of o.dialogs ?? []) await w.host.settled(await w.host.fire('agent.permission.before', { agent: w.f.agent, request: d }));
  return claim;
}

describe(`${AC[2]} A false done from a Copilot session run through paseo comes back to that session with the failing case, and the verdict is recorded once`, () => {
  it(`${AC[2]} the turn's end runs the gate for the session's claim; ${CHECK}'s failure is sent into the same Copilot session once, as a prompt, and one FAIL is recorded`, async () => {
    const w = await copilot();
    const claim = await falseDone(w);
    const sent = await within(180_000, () => sendsNaming(w.host, w.f, CHECK)[0]);
    await sleep(5000);
    const evs = await events(w.home);
    const verdicts = verdictsOf(evs, [claim]);
    expect(sent, `${AC[2]} the failing case (${CHECK}) must come back into Copilot agent ${w.f.agent.id} (session ${w.f.session}) through paseo; the plugin sent ${JSON.stringify(w.host.callsOf(w.f, 'send'))}; ${claim}'s verdicts: ${verdicts.map(said).join('; ') || 'none'}; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}; plugin errors ${JSON.stringify(w.host.errors()).slice(0, 800)}`).toBeDefined();
    expect(sendsNaming(w.host, w.f, CHECK), `${AC[2]} the failing case is sent once`).toHaveLength(1);
    expect(w.host.callsOf(w.f, 'send').filter((c) => c.interrupt), `${AC[2]} never an interrupt: an idle session gets a prompt, a running one a steer`).toEqual([]);
    expect(verdicts.map((v) => v.data.outcome), `${AC[2]} ${claim} has one verdict, FAIL: ${verdicts.map(said).join('; ')}`).toEqual(['FAIL']);
  }, 400_000);
});

describe(`${AC[14]} An agent showing a picker and a trust prompt while it reads unknown gets no words, and gets them once it reads idle`, () => {
  const picker = (f: Fake): Permission => permissionOf(f, { kind: 'question', name: 'model_picker', title: 'Choose a model', input: { options: ['stand-in', 'stand-in-large'] } });
  const trustPrompt = (f: Fake): Permission => permissionOf(f, { kind: 'other', name: 'trust_folder', title: 'Do you trust the files in this folder?' });
  it(`${AC[14]} the send-back waits while the agent reads initializing with both dialogs up, goes once after it reads idle from its own snapshot, and answers neither dialog`, async () => {
    const w = await copilot();
    const dialogs = [picker(w.f), trustPrompt(w.f)];
    const claim = await falseDone(w, { status: 'initializing', dialogs });
    await waitFor(async () => verdictsOf(await events(w.home), [claim]).find((v) => v.data.outcome === 'FAIL'), 180_000, `${claim}'s FAIL`)
      .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}: the words this test holds back never came due`); });
    await sleep(8000);
    const early = w.host.callsOf(w.f, 'send');
    expect(early.map((c) => ({ into: c.into, status: c.status })), `${AC[14]} no words while the agent reads ${String(w.f.snapshot.status)} with "${dialogs.map((d) => d.title).join('" and "')}" up${early[0]?.into ? `: they went into the dialog "${early[0].into}"` : ''}`).toEqual([]);
    const answered = w.host.callsOf(w.f, 'respondToPermission').filter((c) => dialogs.some((d) => d.id === c.args?.requestId));
    expect(answered, `${AC[14]} words for the session never answer a dialog: ${JSON.stringify(answered)}`).toEqual([]);

    // You close both in paseo's app; the agent reads idle from its own snapshot.
    await w.host.resolve(w.f, dialogs[0]!.id, { behavior: 'allow', updatedInput: { model: 'stand-in' } });
    await w.host.resolve(w.f, dialogs[1]!.id, { behavior: 'allow' });
    w.f.snapshot.status = 'idle';
    await w.host.show(w.f);
    const sent = await within(60_000, () => sendsNaming(w.host, w.f, CHECK)[0]);
    await sleep(5000);
    expect(sent, `${AC[14]} once the agent reads idle the words go in: the plugin sent ${JSON.stringify(w.host.callsOf(w.f, 'send'))}`).toBeDefined();
    expect(w.host.callsOf(w.f, 'send').map((c) => c.into), `${AC[14]} the words go in once, into no dialog`).toEqual([null]);
  }, 400_000);
});

// ---- A Claude session deep-hook watches, inside paseo: #29's world, its drafted task and its Claude Code stand-in.
async function deepHook(): Promise<void> {
  if (existsSync(DEEP_HOOK)) return;
  const r = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 });
  if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: ${DEEP_HOOK} is missing and cargo build failed: ${r.stderr.slice(-2000)}`);
}
/** #29's world (tests/acceptance/29/h-d.ts, makeWorld) under /tmp/dh55-*: BEHAVIOR's drafted definition checks CHECK_FILE, which fails on the base and on the change below. */
function draftWorld(): World29 {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function checkToken(token: { exp: number }): boolean {\n  return token.exp > 0;\n}\n');
  writeFileSync(join(repo, CHECK_FILE), CHECK_BYTES, { mode: 0o755 });
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node -e 0' } }, null, 2)}\n`);
  git(repo, ['init', '-q']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'An expired token is rejected with 401', { check: CHECK_FILE, on_base: 'fails' })], deliverables: ['src/auth.ts'] })] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo, confirm, drafts, work, base: git(repo, ['rev-parse', 'HEAD']) };
}

describe(`${AC[3]} A Claude session run through paseo is gated exactly once`, () => {
  it(`${AC[3]} a false done in a Claude session that deep-hook watches inside paseo gets one stop, one verdict, and nothing from the plugin`, async () => {
    needPlugin();
    await deepHook();
    const w = draftWorld();
    await startHub29(w);
    const host = await Host.start(w.home);
    const s = new Session(w);
    const f = fakeAgent('claude', w.repo, s.id);
    await create(host, f);
    await s.start();
    await s.typed(BEHAVIOR);
    await turnStarts(host, f, 't1', BEHAVIOR);
    const locked = await within(180_000, async () => {
      const evs = await events(w.home);
      const ask = evs.find((e) => e.kind === 'user.ask' && e.session === s.id && e.data?.text === BEHAVIOR);
      const ref = Array.isArray(ask?.data?.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
      return ref && evs.some((e) => e.kind === 'definition.locked' && e.data?.task_ref === ref) ? ref : undefined;
    });
    if (!locked) throw Error(`BLOCKED: the prompt opened no task with a locked definition in session ${s.id}: ${kinds(await events(w.home))}`);
    await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
    toolCall(f, 't1', 'Edit', { type: 'edit', filePath: join(w.repo, 'src/auth.ts'), oldString: 'token.exp > 0', newString: 'token.exp > Date.now() / 1000' });
    await s.stop('Done: expired tokens are rejected.');
    await host.settled(await turnEnds(host, f, 't1', { words: 'Done: expired tokens are rejected.' }));
    const sessions = [s.id, String(f.agent.id)];
    await within(180_000, async () => verdictsOf(await events(w.home), claimsIn(await events(w.home), sessions)).length > 0);
    await sleep(8000);
    const evs = await events(w.home);
    const claims = claimsIn(evs, sessions);
    expect(stopsIn(evs, sessions).map(said), `${AC[3]} the turn's end is one stop, deep-hook's, for session ${s.id}; paseo's agent ID ${f.agent.id} is no second session`).toHaveLength(1);
    expect(claims, `${AC[3]} one claim for the turn: ${claims.join(', ')}`).toHaveLength(1);
    expect(verdictsOf(evs, claims).map(said), `${AC[3]} session ${s.id}'s claim is judged once`).toHaveLength(1);
    expect(host.actionsOn(f), `${AC[3]} the plugin delivers nothing into session ${s.id}, which deep-hook gates`).toEqual([]);
  }, 600_000);
});

describe(`${AC[12]} A pi session run through paseo with the pi package loaded is gated once, by the package`, () => {
  it(`${AC[12]} a pi turn with a permission request through paseo: one stop, the package's; the plugin raises no ask and delivers nothing`, async () => {
    needPlugin();
    piCli();
    const tmp = tempDir();
    const home = join(tmp, 'h');
    const cwd = join(tmp, 'w');
    mkdirSync(home);
    mkdirSync(cwd);
    await startHub40(home);
    editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
    const command = 'echo built > built.txt';
    const pi = await Pi.start(home, cwd, { steps: [{ tools: [{ name: 'bash', arguments: { command } }] }, { text: 'Built.' }] });
    await waitFor(async () => (await events(home)).some((e) => e.kind === 'session.start' && e.session === pi.session), 30_000, `the pi package's session.start for ${pi.session}`);
    const host = await Host.start(home);
    const f = fakeAgent('pi', cwd, pi.session);
    await create(host, f);
    await turnStarts(host, f, 't1', 'Build it.');
    await pi.call({ type: 'prompt', message: 'Build it.' });
    await host.settled(await permissionAsked(host, f, permissionOf(f, { kind: 'tool', name: 'bash', title: `Run ${command}`, input: { command } })));
    await pi.until('agent_settled', 1);
    toolCall(f, 't1', 'bash', { type: 'shell', command });
    await host.settled(await turnEnds(host, f, 't1', { words: 'Built.' }));
    await sleep(8000);
    const evs = await events(home);
    const sessions = [pi.session, String(f.agent.id)];
    expect(asksNaming(evs, command).map(said), `${AC[12]} pi session ${pi.session}'s one permission request is never filed by the plugin`).toEqual([]);
    expect(host.actionsOn(f), `${AC[12]} the plugin delivers nothing into pi session ${pi.session}, which the package gates`).toEqual([]);
    expect(stopsIn(evs, sessions).map(said), `${AC[12]} pi session ${pi.session}'s turn is one stop, the package's`).toHaveLength(1);
  }, 400_000);
});
