// #3229 AC7: a session DeepBuild starts can't read the store where its agent's facts name the wall of unreadable folders,
// and its row says so. The world, the approval, the start and the Claude Code stand-in, which enforces the sandbox
// settings it is launched with by macOS Seatbelt, are #1330's (../1330/helpers.ts, imported; its README says what the
// stand-in does). Only the repo's `npm test` is this suite's: a child of the started session's Bash tool that tries to
// read a file of the store and a file under the checkouts, and writes what happened to probe-in.json in its worktree.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approve, git, mentions, mustStart, openWorld, shippedNamesAllWalls, standInIn, start, waitFor, withoutSandbox, type Line, type World } from '../1330/helpers.ts';
import { AC, cut, FIXTURE, LIMIT, sha256 } from './helpers.ts';

const PROBE = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "const { paths } = JSON.parse(readFileSync(new URL('./probe-config.json', import.meta.url), 'utf8'));",
  'const tried = paths.map((path) => { try { return { path, text: readFileSync(path, \'utf8\') }; } catch (error) { return { path, code: error.code }; } });',
  "writeFileSync('probe-in.json', JSON.stringify(tried));",
  '',
].join('\n');
interface Tried { path: string; text?: string; code?: string }
interface Started { w: World; row: Line; tried: Tried[]; planted: { path: string; text: string }[] }
/**
 * A session started on a repo whose `npm test` is the probe, on Claude Code's shipped facts or on `facts` of them; its
 * turn runs `npm test`. The files it tries are this test's own, laid where the hub keeps evidence and checkouts.
 */
async function started(facts?: (f: Line) => Line): Promise<Started> {
  const w = await openWorld(facts ? { claudeFacts: facts } : {});
  const bytes = `kept by the hub, read by no session (${w.home})\n`;
  const digest = sha256(bytes);
  const planted = [join(w.root, 'evidence', digest.slice(0, 2), digest.slice(2)), join(w.root, 'checkouts', '01M85874AWCWVMD017KJ9T8486', FIXTURE)].map((path) => ({ path, text: bytes }));
  for (const p of planted) {
    mkdirSync(dirname(p.path), { recursive: true });
    writeFileSync(p.path, p.text);
  }
  writeFileSync(join(w.repo, 'probe.mjs'), PROBE);
  writeFileSync(join(w.repo, 'probe-config.json'), `${JSON.stringify({ paths: planted.map((p) => p.path) })}\n`);
  git(w.repo, 'commit', '-q', '-am', 'the probe');
  git(w.repo, 'push', '-q', 'origin', 'main');
  await approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50 });
  const s = mustStart(await start(w, { issue: 41, prompt: 'Run the tests. [standin:npm-test]' }), 'the start of the session');
  const agent = await standInIn(w, s.worktree, { done: true, ms: 300_000 });
  const row = await waitFor(async () => ((await w.client.call('sessions.read')).sessions as Line[]).find((r) => mentions(r, String(agent.session)) || mentions(r, s.run)), 30_000, `the row of session ${String(agent.session)} in sessions.read`);
  const report = join(s.worktree, 'probe-in.json');
  if (!existsSync(report)) throw Error(`BLOCKED: npm test ran no probe in the started session: ${cut(JSON.stringify(agent.bash))}`);
  return { w, row, tried: JSON.parse(readFileSync(report, 'utf8')) as Tried[], planted };
}
/** What a row says of the wall of unreadable folders: every value under `sandbox` whose name is that wall's (README, Readings). */
function wall(row: Line): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (v && typeof v === 'object') for (const [key, x] of Object.entries(v)) { if (/credential|store|evidence|checkout|unreadable/i.test(key) && (typeof x === 'boolean' || typeof x === 'string')) out.push(x); else walk(x); }
  };
  walk(row.sandbox);
  return out;
}

describe(`${AC[7]} A session started from the app, on an agent whose facts name the wall, can't read the store and its row says held; on one whose facts name none, the row says not held`, () => {
  it(`${AC[7]} a started session's read of the store, and of a checkout, fails by its sandbox, and its row says the wall is held`, async () => {
    if (!shippedNamesAllWalls()) throw Error("BLOCKED: the shipped Claude Code facts don't name the wall of unreadable folders under `sandbox`");
    const s = await started();
    for (const { path, text } of s.planted) {
      expect(readFileSync(path, 'utf8'), `${path} is there for you to read, so only the sandbox can refuse it`).toBe(text);
      const t = s.tried.find((x) => x.path === path);
      expect(t?.text === undefined ? t?.code : 'read whole', `a child of the started session's npm test must fail to read ${path} by its sandbox (EPERM): ${cut(JSON.stringify(t))}`).toBe('EPERM');
    }
    const says = wall(s.row);
    expect(says.length > 0 && says.every((v) => v === true || v === 'held'), `its row says the wall is held: ${cut(JSON.stringify(s.row.sandbox))}`).toBe(true);
  }, LIMIT);

  it(`${AC[7]} on an agent whose facts name no wall, the row says not held`, async () => {
    const s = await started(withoutSandbox);
    const says = wall(s.row);
    expect(says.length > 0 && says.every((v) => v === false || v === 'not held'), `its row says the wall is not held: ${cut(JSON.stringify(s.row.sandbox))}`).toBe(true);
  }, LIMIT);
});
