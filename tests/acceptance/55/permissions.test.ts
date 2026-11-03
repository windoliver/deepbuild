// #55's permission requests through paseo: AC4 (a saved decision answers it without reaching you, logged as decided
// for you), AC6 (an authority answer from paseo's own app, unsigned, is refused naming the trusted path, and the ask
// stays open), AC8 (an ACP agent with no facts entry is watch-only and says what it lacks; no ACP request is approved by
// default), AC9 (kind `other` is never answered from a saved decision) and AC10 (in a Claude session deep-hook watches,
// one prompt is one ask and one delivery, both deep-hook's). Paseo is fixtures/paseo-host.mjs around the real plugin;
// the hub, the resolver, `deep inbox answer`, deep-hook and `deep setup` are real (README, The worlds).
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Claude, makeRepo, payload, replied, setup, newSession, startHub, typedPrompt, firedShown } from '../27/helpers.ts';
import {
  AC, ASK_SETTINGS, Host, about, answer, asksNaming, cleanup, create, editConfig, events, fakeAgent, inboxRows, kinds, makeHome, needPlugin, permissionAsked, permissionOf,
  readFacts, said, sleep, specRepo, turnStarts, waitFor, within, type Ev, type Fake, type Line, type Permission,
} from './helpers.ts';

afterEach(cleanup, 120_000);

/** An agent paseo runs, of `provider`, in a turn you started, in a home with the hub and your ask settings. */
async function agentIn(provider: string, o: { plant?: string } = {}) {
  needPlugin();
  const { home } = makeHome();
  editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
  const repo = specRepo(home);
  await startHub(home);
  const host = await Host.start(home, o);
  const f = fakeAgent(provider, repo.dir);
  await create(host, f);
  await turnStarts(host, f, 't1', 'Run the checks, then publish.');
  return { home, repo, host, f };
}
type World = Awaited<ReturnType<typeof agentIn>>;
const shell = (f: Fake, command: string, kind: Permission['kind'] = 'tool'): Permission => permissionOf(f, { kind, name: 'Bash', title: `Run ${command}`, input: { command }, detail: { type: 'shell', command } });
/** The ask a request became: the newest ask.created after `after` naming `text`. */
async function askAfter(w: World, text: string, after: number, timeoutMs = 30_000): Promise<Ev | undefined> {
  return within(timeoutMs, async () => asksNaming(await events(w.home), text).filter((e) => e.log_pos > after).at(-1));
}
const lastPos = async (w: World): Promise<number> => (await events(w.home)).at(-1)?.log_pos ?? 0;
const handleOf = (ask: Ev): string => `ask:${ask.id}`;
const rowOf = async (w: World, ask: Ev): Promise<Line | undefined> => (await inboxRows(w.home)).find((r) => r.ask === handleOf(ask) || r.ask === ask.id);
const allowOption = (ask: Ev): string => String((ask.data.options as Line[])[0]!.id);
const responses = (w: World, p: Permission): Line[] => w.host.callsOf(w.f, 'respondToPermission').filter((c) => c.args?.requestId === p.id);
const allowed = (w: World, p: Permission): Line[] => responses(w, p).filter((c) => c.args?.response?.behavior === 'allow');
/** A decision you saved by answering: the first `command` request asked you, you allowed it on the trusted path, and it reached the agent. */
async function decided(w: World, command: string): Promise<Ev> {
  const before = await lastPos(w);
  const first = shell(w.f, command);
  await w.host.settled(await permissionAsked(w.host, w.f, first));
  const ask = await askAfter(w, command, before);
  if (!ask) throw Error(`BLOCKED: the first ${command} request opened no ask: ${kinds((await events(w.home)).filter((e) => e.log_pos > before))}`);
  await answer(w.home, handleOf(ask), allowOption(ask));
  await waitFor(() => allowed(w, first)[0], 30_000, `your yes to ${handleOf(ask)} answering paseo's request ${first.id}`)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}; the plugin's calls ${JSON.stringify(w.host.callsOf(w.f))}`); });
  return ask;
}

describe(`${AC[4]} A permission request that matches a saved decision is answered without reaching you, and is logged as decided for you`, () => {
  it(`${AC[4]} the second npm test request is allowed through paseo from your saved decision, with a decision.applied and nothing open for you`, async () => {
    const w = await agentIn('copilot');
    await decided(w, 'npm test');
    const before = await lastPos(w);
    const again = shell(w.f, 'npm test');
    await w.host.settled(await permissionAsked(w.host, w.f, again));
    const answered = await within(30_000, () => allowed(w, again)[0]);
    const evs = (await events(w.home)).filter((e) => e.log_pos > before);
    expect(answered, `${AC[4]} paseo's request ${again.id} must be allowed from the decision you saved; the plugin's answers ${JSON.stringify(responses(w, again))}; the record since: ${kinds(evs)}`).toBeDefined();
    expect(evs.filter((e) => e.kind === 'decision.applied').map(said), `${AC[4]} the answer is logged as decided for you`).toHaveLength(1);
    const open = [];
    for (const ask of asksNaming(evs, 'npm test')) if ((await rowOf(w, ask))?.outcome === 'unanswered') open.push(handleOf(ask));
    expect(open, `${AC[4]} the request reaches you nowhere: no ask about it is left open`).toEqual([]);
    expect(evs.filter((e) => e.kind === 'ask.batched'), `${AC[4]} nothing about it is shown to you`).toEqual([]);
  }, 300_000);
});

describe(`${AC[9]} A paseo permission request of kind \`other\` is never answered from a saved decision; it becomes an ask`, () => {
  it(`${AC[9]} with npm test decided, a request of kind other for the same npm test is asked, not answered`, async () => {
    const w = await agentIn('copilot');
    await decided(w, 'npm test');
    const before = await lastPos(w);
    const other = shell(w.f, 'npm test', 'other');
    await w.host.settled(await permissionAsked(w.host, w.f, other));
    const ask = await askAfter(w, 'npm test', before);
    await sleep(5000);
    expect(responses(w, other), `${AC[9]} paseo's request ${other.id} of kind other is never answered from the decision`).toEqual([]);
    expect(ask, `${AC[9]} it becomes an ask: the record since holds ${kinds((await events(w.home)).filter((e) => e.log_pos > before))}`).toBeDefined();
    expect((await rowOf(w, ask!))?.outcome, `${AC[9]} ${handleOf(ask!)} waits for you`).toBe('unanswered');
  }, 300_000);
});

describe(`${AC[6]} An unsigned authority answer from paseo's phone or desktop app is refused, naming the trusted path, and the ask stays open`, () => {
  it(`${AC[6]} you allow git push in paseo's own app: the agent's request resolves in paseo, and DeepBuild's ask stays open, unanswered, with no decision saved and the refusal naming the trusted path`, async () => {
    const w = await agentIn('copilot');
    const before = await lastPos(w);
    const push = shell(w.f, 'git push origin main');
    await w.host.settled(await permissionAsked(w.host, w.f, push));
    const ask = await askAfter(w, 'git push origin main', before);
    if (!ask) throw Error(`BLOCKED: the git push request opened no ask: ${kinds((await events(w.home)).filter((e) => e.log_pos > before))}`);
    const handle = handleOf(ask);
    const from = await lastPos(w);
    // Paseo's phone app, which signs nothing here: the person's tap resolves the request in paseo.
    await w.host.resolve(w.f, push.id, { behavior: 'allow' });
    const refusal = await within(20_000, async () => (await events(w.home)).find((e) => e.log_pos > from && (about(e, handle) || about(e, ask.id)) && /trusted path/i.test(JSON.stringify(e))));
    await sleep(3000);
    const evs = (await events(w.home)).filter((e) => e.log_pos > from);
    expect(evs.filter((e) => e.kind === 'decision.created').map(said), `${AC[6]} the app's answer to ${handle} is never saved as a decision`).toEqual([]);
    expect(evs.filter((e) => e.kind.startsWith('ask.') && e.kind !== 'ask.batched' && (about(e, handle) || about(e, ask.id))).map(said), `${AC[6]} nothing answers or closes ${handle}`).toEqual([]);
    expect((await rowOf(w, ask))?.outcome, `${AC[6]} ${handle} stays open`).toBe('unanswered');
    expect(refusal, `${AC[6]} the answer from paseo's app is refused naming the trusted path, about ${handle}; the record since: ${evs.map(said).join('; ') || 'nothing'}`).toBeDefined();
  }, 300_000);
});

describe(`${AC[8]} An ACP agent with no facts entry is watch-only and says which facts it lacks; no ACP request is approved without the resolver or you`, () => {
  const FIELDS = ['bridge', 'permissions', 'modelCheck', 'timeouts'];
  it(`${AC[8]} an ACP agent paseo runs whose provider the facts don't list reads watch-only, naming ${FIELDS.join(', ')}, and its request isn't approved`, async () => {
    const provider = `dh55-acp-${randomUUID().slice(0, 4)}`;
    expect(Object.keys(readFacts().providers ?? {}), `${AC[8]} the facts have no entry for ${provider}`).not.toContain(provider);
    const w = await agentIn(provider);
    const rm = shell(w.f, 'rm -rf build');
    await w.host.settled(await permissionAsked(w.host, w.f, rm));
    const reading = await within(20_000, async () => (await events(w.home)).find((e) => e.kind === 'session.reading' && about(e, w.f.session) && /watch-only/i.test(String(e.data?.reading))));
    await sleep(3000);
    expect(reading, `${AC[8]} session ${w.f.session} of ${provider} reads watch-only; its record: ${kinds((await events(w.home)).filter((e) => about(e, w.f.session)))}`).toBeDefined();
    for (const field of [provider, ...FIELDS]) expect(String(reading!.data.reading), `${AC[8]} the reading names ${field}`).toContain(field);
    expect(allowed(w, rm), `${AC[8]} ${provider}'s request is never approved by default`).toEqual([]);
  }, 300_000);

  it(`${AC[8]} Copilot, an ACP agent the facts cover with its bridge, quirks, model check and timeouts, gets no approval its resolver or you didn't give`, async () => {
    const entry = readFacts().providers?.copilot as Line | undefined;
    expect(entry, `${AC[8]} the facts hold Copilot's ACP entry`).toBeDefined();
    expect(String(entry!.bridge), `${AC[8]} Copilot's bridge is pinned to an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
    for (const field of ['permissions', 'modelCheck', 'timeouts']) expect(entry![field], `${AC[8]} Copilot's facts hold ${field}`).toBeTruthy();
    const w = await agentIn('copilot');
    const before = await lastPos(w);
    const rm = shell(w.f, 'rm -rf build');
    await w.host.settled(await permissionAsked(w.host, w.f, rm));
    const ask = await askAfter(w, 'rm -rf build', before, 20_000);
    await sleep(3000);
    expect(allowed(w, rm), `${AC[8]} with no decision, Copilot's request ${rm.id} is never approved`).toEqual([]);
    expect(ask, `${AC[8]} it goes to you as an ask`).toBeDefined();
  }, 300_000);
});

describe(`${AC[10]} In a Claude session deep-hook watches inside paseo, one permission prompt is one ask and one delivery, both deep-hook's`, () => {
  it(`${AC[10]} paseo and deep-hook both see one prompt; one ask is filed, your yes reaches Claude through deep-hook, and the plugin raises and answers nothing`, async () => {
    needPlugin();
    const { home } = makeHome();
    const repo = makeRepo(home);
    await startHub(home);
    await setup(home);
    const host = await Host.start(home);
    const claude = Claude.start(home);
    const s = newSession(home, repo.dir);
    const f = fakeAgent('claude', repo.dir, s.id);
    await create(host, f);
    const prompt = 'Deploy to staging.';
    const command = './scripts/deploy.sh staging';
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, prompt);
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
    await turnStarts(host, f, 't1', prompt);
    const call = `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const pre = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
    if (/"permissionDecision"\s*:\s*"deny"|"decision"\s*:\s*"block"/.test(replied(pre))) throw Error(`BLOCKED: the call itself was denied before any prompt: ${firedShown(pre)}`);
    const before = (await events(home)).at(-1)?.log_pos ?? 0;
    // Claude Code's prompt, through deep-hook, and the same prompt as paseo shows it, through the plugin.
    const hooked = claude.hook('PermissionRequest', payload(s, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: command }], behavior: 'allow', destination: 'localSettings' }] }));
    await host.settled(await permissionAsked(host, f, permissionOf(f, { kind: 'tool', name: 'Bash', title: `Run ${command}`, input: { command } })));
    const ask = await within(30_000, async () => asksNaming((await events(home)).filter((e) => e.log_pos > before), command)[0]);
    if (!ask) throw Error(`BLOCKED: the prompt opened no ask: ${kinds((await events(home)).filter((e) => e.log_pos > before))}`);
    await sleep(3000);
    expect(asksNaming((await events(home)).filter((e) => e.log_pos > before), command).map(said), `${AC[10]} one prompt is one ask in session ${s.id}`).toHaveLength(1);
    await answer(home, `ask:${ask.id}`, String((ask.data.options as Line[])[0]!.id));
    const fired = await hooked;
    await sleep(3000);
    expect(replied(fired), `${AC[10]} your yes reaches Claude through deep-hook's PermissionRequest reply: ${firedShown(fired)}`).toMatch(/"behavior"\s*:\s*"allow"/);
    expect(host.actionsOn(f), `${AC[10]} the plugin answers and sends nothing for session ${s.id}`).toEqual([]);
    expect(asksNaming((await events(home)).filter((e) => e.log_pos > before), command).map(said), `${AC[10]} and files no ask of its own`).toHaveLength(1);
  }, 400_000);
});
