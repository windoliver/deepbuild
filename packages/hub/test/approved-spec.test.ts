// #3466: the revision of a repo's spec you approved is kept by digest, apart from the repo's history. A change you
// approve is made to the revision you approved, never to the file on disk, whose bytes nobody approved; the kept
// revision answers in every worktree of the repo and for a hub that starts later; and its bytes outlive the retention
// pass, as what a decision cites does.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { citedEvidence } from '@deepbuild/extension-host';
import { openRecord, ulid } from '@deepbuild/record';
import { approveChange, approvedSpec, SPEC, specDrift } from '../src/approved-spec.js';
import { releaseSpec } from '../src/release.js';
import { outsideOf } from '../src/spec-entries.js';

const WITH = 'claims:\n  done:\n    checks: [lint, typecheck, unit]\nchecks:\n  lint: { type: command, run: "npm run lint" }\n  typecheck: { type: command, run: "npm run typecheck" }\n  unit: { type: command, run: "npm test" }\n';
const WITHOUT = WITH.replace('[lint, typecheck, unit]', '[typecheck, unit]');
const noLint = (text: string): string | undefined => (text.includes('[lint, ') ? text.replace('[lint, typecheck, unit]', '[typecheck, unit]') : undefined);
const CORE = { writer: 'core', actor: 'you', scope: 'you' };
const DAY = 86_400_000;

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** A temporary home with a clock of its own, and repos whose one commit holds the spec that lists lint. */
function scene() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'approved-spec-')));
  dirs.push(tmp);
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  const repo = (name: string): { dir: string; base: string } => {
    const dir = join(tmp, name);
    mkdirSync(join(dir, '.deepbuild'), { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, SPEC), WITH);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    return { dir, base: git(dir, 'rev-parse', 'HEAD') };
  };
  const clock = { t: Date.UTC(2026, 10, 26) };
  const now = (): number => ++clock.t;
  const open = async () => {
    const store = await openEvidenceStore({ root: join(tmp, 'home', 'evidence'), now });
    return { store, record: await openRecord({ path: join(tmp, 'home', 'ledger.db'), now, evidence: store }) };
  };
  return { tmp, git, repo, clock, now, open };
}

it('a change you approved is made to the revision you approved, never to the bytes a write left on disk, and is read back in every worktree by a hub that starts later', async () => {
  const s = scene();
  const shop = s.repo('shop');
  const cart = s.repo('cart');
  const second = join(s.tmp, 'second');
  s.git(shop.dir, 'worktree', 'add', '-q', '-b', 'second', second, 'HEAD');
  let { record } = await s.open();
  // A write nobody approved rewrote unit's line on disk before the approval.
  writeFileSync(join(shop.dir, SPEC), WITH.replace('run: "npm test"', 'run: "true"'));
  await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
  expect((await approvedSpec(shop.dir, shop.base, record)).text, 'the kept revision is the base commit\'s with lint taken out: unit\'s rewritten line was never approved').toBe(WITHOUT);
  expect((await approvedSpec(cart.dir, cart.base, record)).text, 'a repo with no approval keeps none: its base commit stands in').toBe(WITH);
  // A change that changes nothing in the approved revision keeps nothing new.
  await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
  expect(await record.raw("SELECT 1 FROM events WHERE kind = 'decision.created'")).toHaveLength(1);
  await record.close();
  ({ record } = await s.open());
  try {
    expect((await approvedSpec(second, shop.base, record)).text, 'the second worktree, whose own file and base commit list lint, after the record is opened again').toBe(WITHOUT);
  } finally {
    await record.close();
  }
}, 60_000);

it('the kept revision\'s bytes outlive the retention pass that removes a file nothing cites', async () => {
  const s = scene();
  const shop = s.repo('shop');
  const { store, record } = await s.open();
  try {
    await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
    const uncited = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new TextEncoder().encode('a file nothing cites\n'), kind: 'file', source: 'test', redaction: 'complete', license: { name: 'session', allows: [] } });
    if (uncited.status !== 'stored') throw Error(uncited.reason);
    s.clock.t += 100 * DAY;
    const { removed } = await store.retain({ cited: await citedEvidence(record, s.now()), archived: new Set() });
    expect(removed, 'the pass ran: the uncited file is gone').toContain(uncited.evidence.sha256);
    expect((await approvedSpec(shop.dir, shop.base, record)).text).toBe(WITHOUT);
  } finally {
    await record.close();
  }
}, 60_000);

it('the change you approved is not proposed again in a worktree it has not reached, and a write or a later commit that takes the kept revision out is one difference wherever it is', async () => {
  const s = scene();
  const shop = s.repo('shop');
  const second = join(s.tmp, 'second');
  s.git(shop.dir, 'worktree', 'add', '-q', '-b', 'second', second, 'HEAD');
  const { record } = await s.open();
  try {
    const drift = async (folder: string) => specDrift(folder, await approvedSpec(folder, shop.base, record));
    await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
    writeFileSync(join(shop.dir, SPEC), WITHOUT);
    expect(await drift(shop.dir), 'the written file equals the kept revision').toBeUndefined();
    expect(await drift(second), 'the second worktree holds the revision the approval replaced, as its commit has it').toBeUndefined();
    // The same bytes in the checkout the approved file was written in are a write that took it out.
    writeFileSync(join(shop.dir, SPEC), WITH);
    const written = await drift(shop.dir);
    expect(written?.is, 'lint put back on disk where the approved file was written').toBe(s.git(shop.dir, 'rev-parse', `HEAD:${SPEC}`));
    // A write in the second worktree is a difference there too.
    writeFileSync(join(second, SPEC), WITH.replace('npm test', 'true'));
    expect(await drift(second), 'a file the second worktree\'s commit does not hold').toBeDefined();
    // Once the kept revision is in a history, a later commit that takes it out is the same difference as the write.
    writeFileSync(join(second, SPEC), WITHOUT);
    s.git(second, 'commit', '-q', '-am', 'stop checking lint');
    expect(await drift(second)).toBeUndefined();
    writeFileSync(join(second, SPEC), WITH);
    const before = await drift(second);
    s.git(second, 'commit', '-q', '-am', 'check lint again');
    expect(await drift(second), 'the commit holds the difference the write made').toEqual(before);
    expect(before?.is).toBe(written?.is);
  } finally {
    await record.close();
  }
}, 60_000);

it('release checks and the outside block are the kept revision\'s, whatever a write put on disk or a commit holds', async () => {
  const s = scene();
  const shop = s.repo('shop');
  const { record } = await s.open();
  try {
    writeFileSync(join(shop.dir, SPEC), `${WITH}release:\n  checks: [unit]\n`);
    s.git(shop.dir, 'commit', '-q', '-am', 'a release check');
    const base = s.git(shop.dir, 'rev-parse', 'HEAD');
    await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
    // A write nobody approved, then committed: another release check, and unit moved out of the sandbox.
    writeFileSync(join(shop.dir, SPEC), `${WITH}release:\n  checks: [lint]\noutside:\n  checks: [unit]\n  build: "true"\n`);
    s.git(shop.dir, 'commit', '-q', '-am', 'nobody approved this');
    const { spec } = await approvedSpec(shop.dir, s.git(shop.dir, 'rev-parse', 'HEAD'), record);
    expect(releaseSpec(spec).checks).toEqual(['unit']);
    expect(outsideOf(spec, 'unit')).toBeUndefined();
    expect(releaseSpec((await approvedSpec(shop.dir, base, record)).spec).checks).toEqual(['unit']);
  } finally {
    await record.close();
  }
}, 60_000);

it('a second approval is made to the first one\'s revision, and a worktree two approvals behind is still not proposed', async () => {
  const s = scene();
  const shop = s.repo('shop');
  const second = join(s.tmp, 'second');
  s.git(shop.dir, 'worktree', 'add', '-q', '-b', 'second', second, 'HEAD');
  const { record } = await s.open();
  try {
    const noTypecheck = (text: string): string | undefined => (text.includes('typecheck, ') ? text.replace('typecheck, unit]', 'unit]') : undefined);
    await approveChange(record, CORE, s.now, shop.dir, noLint, `ask:${ulid(s.now())}`);
    await approveChange(record, CORE, s.now, shop.dir, noTypecheck, `ask:${ulid(s.now())}`);
    const kept = await approvedSpec(second, shop.base, record);
    expect(kept.text, 'the second change is made to the first approval\'s revision, not to the base commit\'s').toBe(WITH.replace('[lint, typecheck, unit]', '[unit]'));
    expect(await specDrift(second, kept), 'the second worktree still holds the revision the first approval replaced').toBeUndefined();
    writeFileSync(join(shop.dir, SPEC), WITHOUT);
    expect(await specDrift(shop.dir, kept), 'the first approval\'s file, in the checkout the approved file is written in, differs from the kept revision').toBeDefined();
  } finally {
    await record.close();
  }
}, 60_000);
