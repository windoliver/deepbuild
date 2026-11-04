// AC3: a 20-task replay finishes in a sandbox that denies every host but the model endpoint and loopback, and its home
// holds no credential but the model sign-in. Each replayed agent (and a process it starts) tries an outside host by
// address, reads the user's settings, MCP config and gh config by their paths, and reads every file under its own
// home and config home; it reaches its model endpoint (a loopback fixture named by ANTHROPIC_BASE_URL) with whatever
// sign-in it was handed.
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, CHAT_TOKEN, FORGE_TOKEN, SIGN_IN, USER_PLUGIN, USER_RULE, cleanup, shown, world } from './helpers.ts';

afterEach(cleanup);

/** An outside host by address (TEST-NET-1, RFC 5737): a sandbox refuses the connect at once; with none, it hangs until the probe's time is up. */
const OUTSIDE = { host: '192.0.2.1', port: 443, ms: 2_000 };
/** The sandboxes' word for a refused connect, as the supervisor's suite reads one: a missing route or a time-out is not a refusal. */
const REFUSED = ['EPERM', 'EACCES'];
const SECRETS: [string, string][] = [
  [FORGE_TOKEN, 'your forge token'], [CHAT_TOKEN, 'your chat token'], [USER_RULE, `your settings' allow rule ${USER_RULE}`], [USER_PLUGIN, `your plug-in ${USER_PLUGIN}`],
];
const PROMPTS = Array.from({ length: 20 }, (_, i) => `Check whether PR ${100 + i} merged, then tidy cart module ${i + 1}.`);

describe(`AC3 ${AC3} a 20-task replay runs in a sandbox that denies every host but the model endpoint and loopback, with no credential but the model sign-in`, () => {
  it('every run finishes on its recorded calls; no agent or child of one reaches an outside host, and nothing it can read holds your allow rules, plug-ins or tokens', async () => {
    const w = await world(Object.fromEntries(PROMPTS.map((p, i) => [p, { steps: [{ tool: 'Bash', input: { command: `gh pr view ${100 + i} --json state` } }] }])), { probes: [OUTSIDE] });
    const tasks = PROMPTS.map((p, i) => w.task(`t${String(i + 1).padStart(2, '0')}`, p, [{ tool: 'Bash', input: { command: `gh pr view ${100 + i} --json state` }, result: '{"state":"MERGED"}' }]));
    const report = await w.run(w.plan(tasks.map((t) => t.id)), tasks);
    const seen = w.observations();

    // It finishes: every run of every task, each on its recorded result, none diverged, none reaching the forge.
    expect.soft(report.runs.filter((r) => r.ok).length, 'all 40 runs (20 tasks, both sides) finish').toBe(40);
    expect.soft(report.after.n, 'all 20 tasks are compared').toBe(20);
    expect.soft(report.diverged, 'no pair diverged: every call was in its recording').toEqual([]);
    expect.soft(seen.length, 'every run reached its model endpoint').toBe(40);
    expect.soft(w.forge.hits.length, 'no replayed call reached the forge').toBe(0);

    // Each problem once, however many of the 40 runs had it; a run's own folder is left out so they group.
    const signIn = new Set<string>();
    const unanswered: string[] = [];
    const reached = new Set<string>();
    const leaked = new Set<string>();
    for (const { auth, obs } of seen) {
      if (auth !== `Bearer ${SIGN_IN}`) signIn.add(`a replayed agent reached its model endpoint with ${auth ? 'another sign-in' : 'no sign-in'}, not your model sign-in`);
      const view = obs.calls.find((c) => String(c.input.command).startsWith('gh pr view'));
      if (!(view && !view.is_error && view.content.trim() === '{"state":"MERGED"}')) unanswered.push(shown(view));
      // The sandbox refuses an outside host, to the agent and to a process it starts.
      for (const from of ['agent', 'child']) {
        const tried = obs.net.find((n) => n.from === from && n.target === `${OUTSIDE.host}:${OUTSIDE.port}`);
        if (!(tried !== undefined && !tried.ok && REFUSED.includes(String(tried.errno)))) {
          reached.add(`no sandbox refused ${from === 'agent' ? 'the replayed agent\'s' : 'its child process\'s'} connect to ${OUTSIDE.host}:${OUTSIDE.port} (${tried ? (tried.ok ? 'connected' : tried.errno) : 'not tried'})`);
        }
      }
      // Nothing it can read holds your settings' allow rules, your plug-ins or a tool credential.
      const readable: { where: string; text: string }[] = [
        ...obs.reads.filter((r) => r.ok).map((r) => ({ where: r.path, text: r.text ?? '' })),
        ...obs.home.filter((f) => typeof f.text === 'string').map((f) => ({ where: f.path, text: f.text as string })),
        ...obs.settings.map((x) => ({ where: x.path ?? `its --settings value (${x.source})`, text: JSON.stringify(x.json) })),
        ...Object.entries(obs.servers).map(([name, cfg]) => ({ where: `its MCP server "${name}"`, text: JSON.stringify(cfg) })),
        ...Object.entries(obs.env).map(([k, v]) => ({ where: `its environment variable ${k}`, text: String(v) })),
      ];
      for (const { where, text } of readable) {
        for (const [secret, what] of SECRETS) if (text.includes(secret)) leaked.add(`${where.replace(obs.cwd, '<checkout>')} is readable by the replayed agent and holds ${what}`);
      }
    }
    expect.soft([...signIn], 'every replayed agent signs in to its model with your model sign-in').toEqual([]);
    expect.soft(unanswered.length, `every recorded call gets its recorded result; ${unanswered.length} didn't, such as ${unanswered[0]}`).toBe(0);
    expect.soft([...reached], `the replay's sandbox refuses every host but the model endpoint and loopback (a refusal is ${REFUSED.join(' or ')})`).toEqual([]);
    expect.soft([...leaked].sort(), 'the replayed agent can read no credential but the model sign-in, and none of your settings\' allow rules or plug-ins').toEqual([]);
  }, 300_000);
});
