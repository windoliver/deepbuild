// #3229 AC3: with the hub stopped, a session's `cat` and its Read of a path under ~/.deepbuild/checkouts are each denied,
// naming the guard. Each call is the PreToolUse payload Claude Code sends, run through `deep-hook claude-code PreToolUse`
// as the agent's hook entry runs it, on a home whose hub was started and then stopped by its PID, with the shipped
// default entries as its rules.json; the file is there, and no call is ever executed. The wrong program is the merge
// base's read entry: the shipped entries with every path under ~/.deepbuild/checkouts taken out of their matches, which
// is the shipped file itself at the base.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, Agent, cleanup, cut, decision, FIXTURE, LIMIT, makeWorld, REPO, Session, shown, startHub, stopHub, type Line, type Ran, type World } from './helpers.ts';

afterEach(cleanup, 120_000);

interface Rules { entries: { [name: string]: { match: string; mode: string; fail_closed: boolean } } }
const shipped = (): Rules => JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as Rules;
/** The merge base's read entries: the shipped ones with no path of ~/.deepbuild/checkouts; an entry left with no path is no entry. */
function without(rules: Rules): Rules {
  const entries = Object.entries(rules.entries).flatMap(([name, e]): [string, Rules['entries'][string]][] => {
    const read = /^read:(.*)$/.exec(e.match);
    if (!read) return [[name, e]];
    const paths = read[1]!.split(' ').filter((p) => !/^!?~\/\.deepbuild\/checkouts(\/|$)/.test(p));
    return paths.length ? [[name, { ...e, match: `read:${paths.join(' ')}` }]] : [];
  });
  return { ...rules, entries: Object.fromEntries(entries) };
}
/** The fail_closed block entries whose match reads a path: the guards a denied read may name. */
const readGuards = (rules: Rules): string[] => Object.entries(rules.entries).filter(([, g]) => g.mode === 'block' && g.fail_closed && /(^|\s)read:/.test(g.match)).map(([name]) => name);

interface Seen { calls: { what: string; ran: Ran }[]; own: Ran; guards: string[] }
/** The two calls, and a `cat` of a file of the session's own worktree, as deep-hook decides them with the hub stopped. */
async function observe(rules: Rules): Promise<Seen> {
  const w: World = makeWorld([]);
  await stopHub(await startHub(w));
  writeFileSync(join(w.root, 'rules.json'), JSON.stringify(rules));
  const rel = `checkouts/01M85874AWCWVMD017KJ9T8486/${FIXTURE}`;
  const file = join(w.root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'a held-out variant\n');
  const s = new Session(w, Agent.start(w), w.trees[0]!);
  const pre = (tool_name: string, tool_input: Line): Promise<Ran> => s.hook('PreToolUse', { tool_name, tool_input, tool_use_id: 'toolu_3229' });
  const line = `cat ~/.deepbuild/${rel}`;
  return {
    calls: [{ what: `\`${line}\``, ran: await pre('Bash', { command: line }) }, { what: `Read ${file}`, ran: await pre('Read', { file_path: file }) }],
    own: await pre('Bash', { command: `cat ${FIXTURE}` }),
    guards: readGuards(rules),
  };
}
/** What's wrong: a call allowed, or denied without naming a fail_closed read entry of the rules it ran under. */
function failures(seen: Seen): string[] {
  const out: string[] = [];
  for (const { what, ran } of seen.calls) {
    const named = [...`${ran.stdout}\n${ran.stderr}`.matchAll(/\(guard ([A-Za-z0-9_.:-]+)/g)].map((m) => m[1]!);
    if (decision(ran) !== 'deny') out.push(`${what} was allowed with the hub stopped: ${shown(ran)}`);
    else if (!named.some((g) => seen.guards.includes(g))) out.push(`${what} was denied without naming the guard (one of ${seen.guards.join(', ')}): ${shown(ran)}`);
  }
  return out;
}

describe(`${AC[3]} With the hub stopped, a session's cat and its Read of a path under ~/.deepbuild/checkouts are each denied, naming the guard`, () => {
  it(`${AC[3]} both calls are denied naming a fail-closed read entry, and a cat of the session's own file is allowed`, async () => {
    const seen = await observe(shipped());
    const said = failures(seen);
    expect(said, said.join('; ')).toEqual([]);
    expect(decision(seen.own), `a cat of ${FIXTURE} in the session's own worktree is no read of the hub's checkouts, so it is allowed: ${shown(seen.own)}`).toBe('allow');
  }, LIMIT);

  it(`${AC[3]} (wrong program) the merge base's read entries allow both and fail this test, naming both`, async () => {
    const seen = await observe(without(shipped()));
    for (const { what, ran } of seen.calls) expect(decision(ran), `the merge base's entries allow ${what} with the hub stopped: ${shown(ran)}`).toBe('allow');
    const said = failures(seen).join('\n');
    for (const { what } of seen.calls) expect(said, cut(said)).toContain(what);
  }, LIMIT);
});
