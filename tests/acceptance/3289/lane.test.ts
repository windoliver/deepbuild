import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HOURS = 3_600_000;
const LANE_CAP = 5.5 * HOURS;
const TEST_TIMEOUT = 6 * HOURS;

const of25 = (hex: string): string => `#${25}.${hex}`;
const AC2 = { label: 'AC2', tag: of25('ee0f30b0'), original: 'tests/acceptance/25/routes/wake.test.ts' };
const AC3 = { label: 'AC3', tag: of25('008fdf08'), original: 'tests/acceptance/25/routes/session-end.test.ts' };
const AC5 = { label: 'AC5', tag: of25('c5d6abef'), original: 'tests/acceptance/25/fallbacks/flags.test.ts' };
type Criterion = typeof AC2;
const TWINS_25 = 'tests/acceptance/25/twins';

const lanes = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { byHand: string[]; redrafted?: Record<string, string>; listed: (list: string[], file: string) => boolean };
const { tagsWithImports } = (await import(pathToFileURL(join(REPO, 'scripts/proof-change.mjs')).href)) as { tagsWithImports: (root: string, rev: string | null, path: string) => string[] };

function testFiles(folder: string): string[] {
  const at = join(REPO, folder);
  if (!existsSync(at) || !statSync(at).isDirectory()) return [];
  return readdirSync(at).flatMap((name) => {
    if (['node_modules', 'twins', 'fixtures'].includes(name)) return [];
    const path = `${folder.replace(/\/$/, '')}/${name}`;
    return statSync(join(REPO, path)).isDirectory() ? testFiles(path) : /\.test\.(?:ts|mjs|js)$/.test(name) ? [path] : [];
  });
}

function redraftFolders(): string[] {
  const under = (folder: string): string[] => readdirSync(join(REPO, folder)).filter((name) => statSync(join(REPO, folder, name)).isDirectory() && !['twins', 'fixtures', 'node_modules'].includes(name))
    .flatMap((name) => (/redraft/.test(name) ? [`${folder}/${name}/`] : under(`${folder}/${name}`)));
  const siblings = readdirSync(join(REPO, 'tests/acceptance')).filter((name) => name.startsWith('25-') && /redraft/.test(name)).map((name) => `tests/acceptance/${name}/`);
  return [...under('tests/acceptance/25'), ...siblings];
}

interface Found { folders: string[]; files: string[]; problems: string[] }
function redraftOf(c: Criterion): Found {
  const problems: string[] = [];
  const named = lanes.redrafted?.[c.original];
  const folders = named ? [named] : redraftFolders();
  if (existsSync(join(REPO, c.original)) && !lanes.listed(lanes.byHand, c.original)) problems.push(`${c.original} is still run by the lanes (scripts/lanes.mjs byHand doesn't list it), so no redraft runs in its place`);
  if (named && !existsSync(join(REPO, named))) problems.push(`scripts/lanes.mjs \`redrafted\` names ${named} in place of ${c.original}, and the checkout has no such folder`);
  const files = folders.flatMap(testFiles).filter((path) => !lanes.listed(lanes.byHand, path) && tagsWithImports(REPO, null, path).includes(c.tag));
  if (!files.length) problems.push(`no test file the lanes run in ${folders.join(', ') || 'a redraft folder of suite 25'} carries the redrafted ${c.label} test's tag ${c.tag}`);
  return { folders, files, problems };
}

function expectRedraft(c: Criterion): Found {
  const found = redraftOf(c);
  expect(found.problems, `#3289 no blind redraft of ${c.label} replaces ${c.original}: ${found.problems.join('; ')}`).toEqual([]);
  return found;
}

interface Result { status: string; failure: { atAssertion: boolean; cause: string } | null }
interface TwinRun { tag: string; twin: string; key: string; ran: boolean; stale: string | null; refused: string | null; unrunnable: string | null; fileError: string | null; result: Result | null }
interface LaneTest { key: string; path: string; name: string; tags: string[]; status: string; failure: Result['failure']; twinsError: string | null; base: Result | null; twins: TwinRun[] }
interface Lane {
  error?: string; log: string; lines: string[]; files: string[]; unrun: string[]; tests: LaneTest[];
  base: { blocked: string | null }; head: { unrunnable: Record<string, string>; fileErrors: Record<string, string> };
}

let child: ReturnType<typeof spawn> | undefined;
let lane: Promise<Lane> | undefined;
function stopProcessGroupThisFileStarted(pid: number): boolean {
  try { return process.kill(-pid, 'SIGTERM'); } catch { return false; }
}
afterAll(() => {
  if (child?.pid && child.exitCode === null && child.signalCode === null) stopProcessGroupThisFileStarted(child.pid);
});

function runLane(): Promise<Lane> {
  lane ??= (async () => {
    const files = [...new Set([AC2, AC3, AC5].flatMap((c) => redraftOf(c).files))];
    const dir = mkdtempSync(join(tmpdir(), 'dh3289-'));
    const out = join(dir, 'lane.json');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|TINYPOOL|DEEP_HUB_PLANT$|DEEP_PROOF_VITEST_REPORT$|NODE_V8_COVERAGE$|DEEP_BIN_DIR$)/.test(k)) env[k] = v;
    try {
      const log = await new Promise<string>((resolve) => {
        const started = spawn(process.execPath, [fileURLToPath(new URL('./run-lane.mjs', import.meta.url)), REPO, out, ...files], { cwd: REPO, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child = started;
        let text = '';
        const keep = (d: string) => { text = (text + d).slice(-20_000); };
        started.stdout!.setEncoding('utf8').on('data', keep);
        started.stderr!.setEncoding('utf8').on('data', keep);
        // deadline: caps the lane run, so a lane that hangs ends INCONCLUSIVE instead of holding the file open
        const cap = setTimeout(() => { stopProcessGroupThisFileStarted(started.pid!); }, LANE_CAP);
        started.on('close', (code, signal) => { clearTimeout(cap); resolve(`${text}\n(exit ${code}${signal ? `, ${signal}` : ''})`); });
      });
      if (!existsSync(out)) return { error: `INCONCLUSIVE the before lane wrote nothing (stopped after ${LANE_CAP / HOURS} h, or crashed): ${log.slice(-1500)}`, log, lines: [], files, unrun: [], tests: [], base: { blocked: null }, head: { unrunnable: {}, fileErrors: {} } };
      const read = JSON.parse(readFileSync(out, 'utf8')) as Lane;
      return { ...read, log, ...(read.error ? { error: `BLOCKED the before lane threw: ${read.error.split('\n').slice(0, 4).join(' | ')}` } : {}) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return lane;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const BLOCKED_OR_INCONCLUSIVE_FIRST_IN_CAUSE = /^(?:\w+(?: \[[^\]]*\])?: )?(BLOCKED|INCONCLUSIVE)\b/;
const unrunWord = (cause: string): 'INCONCLUSIVE' | 'BLOCKED' => (BLOCKED_OR_INCONCLUSIVE_FIRST_IN_CAUSE.exec(cause)?.[1] === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'BLOCKED');
const endedUnrun = (r: Result | null | undefined): boolean => r?.status === 'fail' && BLOCKED_OR_INCONCLUSIVE_FIRST_IN_CAUSE.test(r.failure?.cause ?? '');
const onMain = (t: LaneTest): Result => ({ status: t.status, failure: t.failure });
const wordOf = (reasons: readonly string[]): 'INCONCLUSIVE' | 'BLOCKED' => (reasons.some((u) => unrunWord(u) === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'BLOCKED');
const shown = (r: Result | null): string => (!r ? 'no result' : `${r.status}${r.failure ? ` ${r.failure.atAssertion ? 'at its assertion' : 'before its assertion'} (${r.failure.cause})` : ''}`);
const linesOf = (l: Lane, t: LaneTest): string[] => l.lines.filter((line) => line.includes(` before: ${t.key}: `));

function filesOf(folder: string): Map<string, string> {
  const walk = (at: string): string[] => readdirSync(at).flatMap((name) => (statSync(join(at, name)).isDirectory() ? walk(join(at, name)) : [join(at, name)]));
  const abs = join(REPO, folder);
  return new Map(existsSync(abs) ? walk(abs).map((path) => [relative(abs, path), readFileSync(path, 'base64')]) : []);
}
function sameAs25(key: string, twin: string): string | null {
  if (key === `${TWINS_25}/${twin}`) return null;
  const [laid, own] = [filesOf(key), filesOf(`${TWINS_25}/${twin}`)];
  const same = laid.size === own.size && [...own].every(([path, bytes]) => laid.get(path) === bytes);
  return same ? null : `the lane laid ${key}, which is not ${TWINS_25}/${twin} as main holds it`;
}

type Verdict = { state: 'proven'; detail: string } | { state: 'failed' | 'unrun'; detail: string };

function judgeTwin(l: Lane, c: Criterion, twin: string, naming: RegExp[], withoutTwin: string[]): Verdict {
  const mine = l.tests.filter((t) => t.tags.includes(c.tag));
  const table = (): string => mine.map((t) => {
    const e = t.twins.find((x) => x.twin === twin);
    const onTwin = !e ? `its criterion names no twin ${twin}` : e.stale ? `stale: ${e.stale}` : e.refused ? `refused: ${e.refused}` : e.unrunnable ? `not run: ${e.unrunnable}` : e.fileError ? `its file failed outside its tests: ${e.fileError}` : !e.ran ? 'not laid (the test failed on the merge base)' : shown(e.result);
    return `- ${t.key}\n    on main: ${shown({ status: t.status, failure: t.failure })}\n    on ${twin}: ${onTwin}`;
  }).join('\n');
  const files = [...new Set(redraftOf(c).files)];
  const headUnrun = files.filter((f) => l.head.unrunnable[f]).map((f) => `${f}: ${l.head.unrunnable[f]}`);
  const headErrors = files.filter((f) => l.head.fileErrors[f]).map((f) => `${f}: ${l.head.fileErrors[f]}`);
  if (!mine.length) {
    if (headUnrun.length && !headErrors.length) return { state: 'unrun', detail: `${wordOf(headUnrun.map((u) => u.split(': ').slice(1).join(': ')))} the lane couldn't run the redraft on main: ${headUnrun.join('; ')}` };
    return { state: 'failed', detail: `the lane ran no test carrying ${c.tag} on main${headErrors.length ? `; files failed there outside their tests: ${headErrors.join('; ')}` : ''}${headUnrun.length ? `; not run: ${headUnrun.join('; ')}` : ''}` };
  }
  const laid = mine.flatMap((t) => t.twins.filter((x) => x.twin === twin));
  const hard = [
    ...new Set([...laid.flatMap((e) => [e.stale && `${e.key}'s lines don't apply to main: ${e.stale}`, e.refused && `${e.key} was refused: ${e.refused}`, sameAs25(e.key, twin)])].filter((x): x is string => Boolean(x))),
    ...mine.filter((t) => t.twinsError).map((t) => `${t.key}: ${t.twinsError}`),
  ];
  if (!laid.length) hard.push(`the twins.json of the redraft's folder names no twin ${twin} for ${c.tag}, so the lane never lays it`);
  if (hard.length) return { state: 'failed', detail: `${hard.join('; ')}\n${table()}` };
  const proofs = mine.filter((t) => {
    const r = t.twins.find((x) => x.twin === twin)?.result;
    return withoutTwin.includes(t.status) && r?.status === 'fail' && r.failure?.atAssertion && naming.every((n) => n.test(r.failure!.cause));
  });
  if (proofs.length) return { state: 'proven', detail: proofs.map((t) => t.key).join(', ') };
  const twinUnrun = laid.filter((e) => e.unrunnable).map((e) => e.unrunnable!);
  const skippedOnMain = mine.filter((t) => t.status === 'skip' && !withoutTwin.includes('skip') && (() => { const r = t.twins.find((x) => x.twin === twin)?.result; return r?.status === 'fail' && r.failure?.atAssertion; })());
  const endedOnTwin = mine.filter((t) => endedUnrun(t.twins.find((x) => x.twin === twin)?.result)).map((t) => `${t.twins.find((x) => x.twin === twin)!.result!.failure!.cause} (${t.key}, on ${twin})`);
  const endedOnMain = mine.filter((t) => endedUnrun(onMain(t))).map((t) => `${t.failure!.cause} (${t.key}, on main)`);
  const unrun = [...twinUnrun, ...headUnrun, ...endedOnTwin, ...endedOnMain, ...skippedOnMain.map((t) => `INCONCLUSIVE ${t.key} was skipped on main, so whether it passes without ${twin} is unread`)];
  if (unrun.length) return { state: 'unrun', detail: `${wordOf(unrun)} ${unrun.join('; ')}\n${table()}` };
  return { state: 'failed', detail: table() };
}

function settle(ctx: TestContext, l: Lane, verdicts: Record<string, Verdict>, what: string): void {
  if (l.error) ctx.skip(`${l.error}`);
  const failed = Object.entries(verdicts).filter(([, v]) => v.state === 'failed');
  const unrun = Object.entries(verdicts).filter(([, v]) => v.state === 'unrun');
  const told = Object.entries(verdicts).map(([twin, v]) => `${twin}: ${v.state}: ${v.detail}`).join('\n');
  if (!failed.length && unrun.length) ctx.skip(`${wordOf(unrun.map(([, v]) => v.detail))} ${what}: ${unrun.map(([twin]) => twin).join(', ')} kept from a verdict by the machine\n${told}`);
  expect(Object.fromEntries(Object.entries(verdicts).map(([twin, v]) => [twin, v.state])), `#3289 ${what}\n${told}\n\nlane lines:\n${l.lines.join('\n').slice(-6000)}`)
    .toEqual(Object.fromEntries(Object.keys(verdicts).map((twin) => [twin, 'proven'])));
}

describe('#3289 #25\'s twins counted by the before lane', () => {
  it('#3289.4d4ebb87 with waiter-never-wakes laid on main, the redrafted AC2 test fails at its assertion naming the session that never woke within 30 s; without it, it does not fail', async (ctx) => {
    expectRedraft(AC2);
    const l = await runLane();
    settle(ctx, l, { 'waiter-never-wakes': judgeTwin(l, AC2, 'waiter-never-wakes', [/wak|woke/i, /\b30 ?s\b/, UUID], ['pass', 'skip']) },
      'with waiter-never-wakes laid on main, a redrafted AC2 test that does not fail on main must fail at its assertion, its first line naming the session (its ID) that never woke within 30 s');
  }, TEST_TIMEOUT);

  it('#3289.0057f123 with waiter-outlives-session laid on main, the redrafted AC3 test fails at its assertion naming the waiter\'s pid still running 10 s after its session ended; without it, it passes', async (ctx) => {
    expectRedraft(AC3);
    const l = await runLane();
    settle(ctx, l, { 'waiter-outlives-session': judgeTwin(l, AC3, 'waiter-outlives-session', [/\bpid\D{0,3}\d+/i, /\b10 ?s\b/, /session/i], ['pass']) },
      'with waiter-outlives-session laid on main, a redrafted AC3 test that passes on main must fail at its assertion, its first line naming the waiter\'s pid and that it still ran 10 s after its session ended');
  }, TEST_TIMEOUT);

  it('#3289.4932b560 with only routes-from-settings laid on main, the redrafted AC5 test fails at its assertion naming the ask whose next_prompt delivery to session A is missing; without it, it passes', async (ctx) => {
    expectRedraft(AC5);
    const l = await runLane();
    settle(ctx, l, { 'routes-from-settings': judgeTwin(l, AC5, 'routes-from-settings', [/\bask:[0-9A-Za-z]{10,}/, /next_prompt/, /delivered/], ['pass']) },
      'with only routes-from-settings laid on main, a redrafted AC5 test that passes on main must fail at its assertion, its first line naming the ask (ask:<id>) whose delivery outcome must read next_prompt delivered by A\'s next prompt');
  }, TEST_TIMEOUT);

  it('#3289.1de37162 with only routes-kept-across-sessions laid on main, the redrafted AC5 test still fails at its assertion', async (ctx) => {
    expectRedraft(AC5);
    const l = await runLane();
    settle(ctx, l, { 'routes-kept-across-sessions': judgeTwin(l, AC5, 'routes-kept-across-sessions', [], ['pass']) },
      'with only routes-kept-across-sessions laid on main, a redrafted AC5 test that passes on main must fail at its assertion');
  }, TEST_TIMEOUT);

  it('#3289.24701d6f the before lane on main reads waiter-never-wakes, waiter-outlives-session and routes-from-settings, each laid alone, as failed on the twin at its assertion, never fails on neither', async (ctx) => {
    for (const c of [AC2, AC3, AC5]) expectRedraft(c);
    const l = await runLane();
    const verdicts: Record<string, Verdict> = {};
    for (const [c, twin] of [[AC2, 'waiter-never-wakes'], [AC3, 'waiter-outlives-session'], [AC5, 'routes-from-settings']] as const) {
      const mine = l.tests.filter((t) => t.tags.includes(c.tag));
      const onTwin = (t: LaneTest) => t.twins.find((x) => x.twin === twin);
      const table = mine.map((t) => `- ${t.key} (main ${t.status}, on ${twin} ${shown(onTwin(t)?.result ?? null)}):\n${linesOf(l, t).map((line) => `    ${line}`).join('\n') || '    no line'}`).join('\n');
      const proven = mine.filter((t) => linesOf(l, t).includes(`PASS before: ${t.key}: failed on ${twin} at its assertion`));
      const ended = (t: LaneTest) => endedUnrun(onTwin(t)?.result);
      const miscounted = mine.filter((t) => t.status === 'pass' && onTwin(t)?.result?.status === 'fail' && !ended(t) && !linesOf(l, t).some((line) => /^PASS before: .*: failed on \S+ at its assertion$/.test(line)));
      const neither = mine.filter((t) => onTwin(t)?.result?.status === 'fail' && !ended(t) && linesOf(l, t).some((line) => line.includes('fails on neither the merge base nor its planted wrong program')));
      const stale = mine.flatMap((t) => linesOf(l, t).filter((line) => line.startsWith('BLOCKED before: ') && line.includes(`/twins/${twin} does not apply`)));
      const unrun = [...mine.flatMap((t) => (onTwin(t)?.unrunnable ? [onTwin(t)!.unrunnable!] : [])), ...redraftOf(c).files.filter((f) => l.head.unrunnable[f]).map((f) => l.head.unrunnable[f]!),
        ...mine.filter((t) => t.status === 'skip' && onTwin(t)?.result?.status === 'fail').map((t) => `INCONCLUSIVE ${t.key} was skipped on main, so the lane read nothing of it`),
        ...mine.filter(ended).map((t) => `${onTwin(t)!.result!.failure!.cause} (${t.key}, on ${twin})`),
        ...mine.filter((t) => endedUnrun(onMain(t))).map((t) => `${t.failure!.cause} (${t.key}, on main)`)];
      if (proven.length && !miscounted.length && !neither.length && !stale.length) verdicts[twin] = { state: 'proven', detail: proven.map((t) => t.key).join(', ') };
      else if (!miscounted.length && !neither.length && !stale.length && unrun.length) verdicts[twin] = { state: 'unrun', detail: `${wordOf(unrun)} ${unrun.join('; ')}\n${table}` };
      else verdicts[twin] = { state: 'failed', detail: `${proven.length ? '' : `no test carrying ${c.tag} reads "failed on ${twin} at its assertion"; `}${[...miscounted, ...neither].map((t) => `${t.key} fails on ${twin} but the lane doesn't count it`).join('; ')}${stale.length ? `; ${stale.join('; ')}` : ''}\n${table}` };
    }
    settle(ctx, l, verdicts, 'the before lane on main must read each twin, laid alone, as "failed on <twin> at its assertion" for a redraft test of its criterion, and never read a test that fails on it as "fails on neither"');
  }, TEST_TIMEOUT);
});
