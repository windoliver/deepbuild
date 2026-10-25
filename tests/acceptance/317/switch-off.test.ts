// #317 AC5, AC6, AC9: an agent can't switch DeepBuild off from its shell. Each call that would (deep off/on,
// deep hub stop, deep setup --undo, the login service, rules.json, the ledger, deep hub use, deep restore, a signal
// to the hub) is denied with the hub stopped and up, directly and through sh -c, nohup and a heredoc, naming the
// command for you to run; each twin is allowed. The wrong programs are the defaults with the entries that hold the
// named call left out. No planted call is ever run: deep-hook only decides.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SERVICE_LABEL, addWorktree, bash, buildDeepHook, cleanup, defaultRules, edit, eventTexts, expectAllowed,
  expectDenied, hook, makeRepo, newSession, payload, recorded, rootOf, sh, shForms, sleeper, startHub, without,
  world, type Call, type Mode, type World,
} from './helpers.ts';

beforeAll(async () => { await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const uid = process.getuid?.() ?? 501;
const LEDGER_WRITE = "sqlite3 ~/.deepbuild/ledger.db 'insert into events values (1)'";
/** The calls of AC5 as written, each to be denied in all four forms. */
const OFF = [
  'deep off',
  'deep on',
  'deep hub stop',
  'deep setup --undo',
  `launchctl bootout gui/${uid}/${SERVICE_LABEL}`,
  `rm ~/Library/LaunchAgents/${SERVICE_LABEL}.plist`,
  'sed -i s/block/watch/ ~/.deepbuild/rules.json',
  LEDGER_WRITE,
  'deep hub stop --root ~/.deepbuild',
];
const rulesEdit: Call = { label: 'Edit ~/.deepbuild/rules.json', body: (w) => edit(w.s, join(rootOf(w.home), 'rules.json')), naming: (w) => join(rootOf(w.home), 'rules.json') };
/** Every planted call of AC5, `first` moved to the front so a wrong program is caught at it. */
function planted(first?: string): Call[] {
  const order = first ? [first, ...OFF.filter((c) => c !== first)] : OFF;
  return [
    ...order.flatMap((c) => shForms(c)),
    rulesEdit,
    // The installed hub's own folder written out in full is still the installed hub's folder.
    { label: 'deep hub stop --root <home>/.deepbuild', body: (w) => bash(w.s, `deep hub stop --root ${rootOf(w.home)}`), naming: (w) => `deep hub stop --root ${rootOf(w.home)}` },
  ];
}
/** A dev hub's folder: not the installed hub's. */
const devRoot = (w: World) => join(dirname(w.home), 'dev');
function twins(w: World, pid: number): Call[] {
  mkdirSync(devRoot(w), { recursive: true });
  return [
    sh('deep status'),
    sh('deep doctor'),
    { label: 'deep hub stop --root <a dev hub folder>', body: (x) => bash(x.s, `deep hub stop --root ${devRoot(x)}`) },
    sh(`kill ${pid}`),
    sh("sqlite3 ./app.db 'insert into t values (1)'"),
  ];
}

describe('AC5 #317.fdb52438 an agent cannot switch DeepBuild off from its shell, with the hub stopped and up, directly and through sh -c, nohup and a heredoc; the twins are allowed; rules.json-only defaults and a missing deep off entry fail', () => {
  it.each(['stopped', 'up'] as Mode[])('AC5 every switch-off call is denied in every form, naming the command for you to run, %s; the twins are allowed', async (mode) => {
    const w = await world({ rules: defaultRules(), mode });
    await expectDenied(w, planted());
    await expectAllowed(w, twins(w, sleeper()));
  }, 900_000);

  it("AC5 with the hub up, kill -9 (or any signal) of the hub's PID is denied, naming the command, while kill of a PID the session started is allowed", async () => {
    const w = await world({ rules: defaultRules(), mode: 'up' });
    const pid = w.hub!.pid;
    await expectDenied(w, [...shForms(`kill -9 ${pid}`, ['direct', 'sh -c']), sh(`kill -TERM ${pid}`, `kill -TERM ${pid}`)]);
    await expectAllowed(w, [sh(`kill -9 ${sleeper()}`)]);
  }, 900_000);

  it('AC5 (wrong program) defaults that protect only rules.json let the sqlite3 write reach the ledger and fail, naming the call', async () => {
    const plant = await without(defaultRules(), sh(LEDGER_WRITE));
    const w = await world({ rules: plant.rules, mode: 'stopped' });
    await expect(expectDenied(w, planted(LEDGER_WRITE))).rejects.toThrow(`\`${LEDGER_WRITE}\` with the hub stopped must be denied`);
  }, 900_000);

  it('AC5 (wrong program) defaults without the deep off entry let the agent turn every gate watch-only and fail, naming the call', async () => {
    const plant = await without(defaultRules(), sh('deep off'));
    const w = await world({ rules: plant.rules, mode: 'stopped' });
    await expect(expectDenied(w, planted('deep off'))).rejects.toThrow('`deep off` with the hub stopped must be denied');
  }, 900_000);
});

describe('AC6 #317.b03220bf deep hub use --root <folder> is denied with the hub stopped and up, directly and through sh -c, naming the command; the next session still reaches the installed hub; a missing entry fails', () => {
  const use = (w: World) => `deep hub use --root ${devRoot(w)}`;
  const uses: Call[] = [
    { label: 'deep hub use --root <dev>', body: (x) => bash(x.s, use(x)), naming: use },
    { label: "sh -c 'deep hub use --root <dev>'", body: (x) => bash(x.s, `sh -c '${use(x)}'`), naming: use },
  ];

  it.each(['stopped', 'up'] as Mode[])('AC6 the agent\'s deep hub use is denied directly and through sh -c, naming the command, %s', async (mode) => {
    const repo = makeRepo();
    const tree = addWorktree(repo, 'wt');
    const w = await world({ rules: defaultRules(), mode, cwd: tree });
    await expectDenied(w, uses);
  }, 900_000);

  it("AC6 after the denial, the worktree's next session reaches the installed hub, not the dev hub the agent started", async () => {
    const repo = makeRepo();
    const tree = addWorktree(repo, 'wt');
    const w = await world({ rules: defaultRules(), mode: 'up', cwd: tree });
    const dev = await startHub(w.home, { root: devRoot(w) });   // the dev hub "the agent started"
    await expectDenied(w, uses);
    const next = newSession(w.home, tree);
    await hook(w.home, next, payload(next, 'SessionStart'));
    if (!(await recorded(w.hub!.root, [next.id]))) throw Error(`the worktree's next session ${next.id} never reached the installed hub`);
    if ((await eventTexts(dev.root)).some((t) => t.includes(next.id))) throw Error(`the worktree's next session ${next.id} reached the dev hub at ${dev.root}`);
  }, 900_000);

  it('AC6 (wrong program) defaults without the deep hub use entry let the agent send its sessions to its dev hub and fail, naming the call', async () => {
    const repo = makeRepo();
    const tree = addWorktree(repo, 'wt');
    const probe: Call = { label: 'deep hub use --root <dev>', body: (x) => bash(x.s, use(x)) };
    const plant = await without(defaultRules(), probe, tree);
    const w = await world({ rules: plant.rules, mode: 'stopped', cwd: tree });
    await expect(expectDenied(w, uses)).rejects.toThrow('`deep hub use --root <dev>` with the hub stopped must be denied');
  }, 900_000);
});

const RESTORE = 'deep restore ~/backup';
describe('AC9 #317.80848a53 deep restore ~/backup is denied with the hub stopped and up, directly and through sh -c, nohup and a heredoc, naming the command; git restore and deep status are allowed; a missing entry fails', () => {
  it.each(['stopped', 'up'] as Mode[])('AC9 deep restore is denied in every form, naming the command for you to run, %s; git restore src/cart.ts and deep status are allowed', async (mode) => {
    const repo = makeRepo({ README: 'shop\n', 'src/cart.ts': 'export const total = 0;\n' }).dir;
    const w = await world({ rules: defaultRules(), mode, cwd: repo });
    await expectDenied(w, shForms(RESTORE));
    await expectAllowed(w, [sh('git restore src/cart.ts'), sh('deep status')]);
  }, 900_000);

  it('AC9 (wrong program) defaults without the deep restore entry let the call through and fail, naming the call', async () => {
    const plant = await without(defaultRules(), sh(RESTORE));
    const w = await world({ rules: plant.rules, mode: 'stopped' });
    await expect(expectDenied(w, shForms(RESTORE))).rejects.toThrow(`\`${RESTORE}\` with the hub stopped must be denied`);
  }, 900_000);
});
