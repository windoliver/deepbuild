// #2648 AC3: "`deep off` written to `gates.json` is recorded within 1 s. A notice saved by a package changes the next
// while-shown cadence. An agent's hook entry removed from its settings turns its reach to unreachable within 2 s. A
// planted hub that reads each file once at start fails all three, naming the file."
//
// A hub on a set-up home (Claude Code's hooks in its settings) with a test package in DeepBuild's release (a polled
// source that runs only while a view binding it is shown, every 10 s). After 15 s to settle, each change comes while
// the hub is idle: `deep off`, then Claude Code's PreToolUse entry removed from its settings, then, with the app
// reporting the view shown, a notice saved on the source. Each is judged by what the record holds: `holds.watch` for
// `deep off`, `agent.reach` for Claude Code, `source.called` for the source's reads. The wrong program is the planted
// hub `reads-files-at-start-only` (README, Choices).
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { AC3, cleanup, control, deep, eventsAfter, logEnd, setUpWorld, sleep, startHub, stopHub, tempDir, ulid, type Ev, type Hub, type World } from './helpers.ts';

/** The sources' hosts this file listens as, closed with its processes and folders. */
const listeners: net.Server[] = [];
afterAll(async () => {
  for (const listener of listeners.splice(0)) await new Promise<void>((resolve) => listener.close(() => resolve()));
  await cleanup();
}, 120_000);

/** The planted hub (README, Choices): it reads gates.json, notices.json and each agent's settings once, at its start. */
const PLANT = 'reads-files-at-start-only';
const SETTLE_MS = 15_000;
/** "recorded within 1 s"; "unreachable within 2 s". */
const OFF_MS = 1000;
const REACH_MS = 2000;
/** How long a change is waited for before it reads as not recorded at all. */
const WAIT_MS = 10_000;

// ---- The test package: a source read only while a view binding it is shown, every 10 s (#262).
const PACKAGE = 'test/glance';
const SOURCE = 'ext.glance.errors';
const VIEW = 'ext.glance.board';
const NOTICE_KIND = 'ext.glance.rate_passed';
const EVERY_MS = 10_000;
const SHOWN = { view: VIEW, window: `window:${VIEW}`, visible: true, minimized: false, display_awake: true, session_locked: false, replica: false };

/**
 * The package, written for the source's host, sealed with the host's own packageDigest. The host is the test's own
 * listener, which closes each connection: every read of the source is one call the record keeps as `source.called`.
 */
function writePackage(dir: string, host: string): { folder: string; entry: ReleaseEntry } {
  const folder = join(dir, 'glance');
  mkdirSync(join(folder, 'panel'), { recursive: true });
  writeFileSync(join(folder, 'index.ts'), `// The test glance package (#2648 AC3): a source read only while a view binding it is shown, every 10 s.
export default async function (deep: any): Promise<void> {
  await deep.registerSource(${JSON.stringify(SOURCE)}, {
    variant: 'polled', host: ${JSON.stringify(host)}, path: '/errors', quota: { per_minute: 600, per_day: 100_000 },
    timeout: 2_000, freshFor: 1_000, while_shown: { every: ${EVERY_MS} },
    parse(answer: { status: number; body: string }): { value: number; unit: string } { return { value: Number(JSON.parse(answer.body).value), unit: '%' }; },
  });
  await deep.registerView(${JSON.stringify(VIEW)}, 'panel', 'home', { binds: [${JSON.stringify(`reading:${SOURCE}`)}] });
}
`);
  writeFileSync(join(folder, 'panel', 'main.js'), `// The glance view's panel: the error rate its view binds.
import { View, div } from "gpui-kit";
export default class Glance extends View {
  init(props) { this.rate = props && props.values && props.values[0] ? props.values[0].value : null; }
  render() { return div().child(\`Error rate \${this.rate ?? "-"}%\`); }
}
`);
  const manifest: Record<string, unknown> = {
    id: PACKAGE, version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, access: { words: ['hosts'] }, notices: [NOTICE_KIND],
    sources: [{ name: SOURCE, variant: 'polled' }], requires: { preview: ['deep.registerSource', 'deep.registerView'] },
  };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { folder, entry: { id: PACKAGE, version: '1.0.0', digest: String(manifest.digest) } };
}

/** Installs and checks the package under the world's hub folder, with no hub running, through the host's public entry (as #2402's suite does). */
async function install(w: World, pkg: { folder: string; entry: ReleaseEntry }, host: string): Promise<void> {
  const pre = tempDir('dh2648-pre-');
  const evidence = await openEvidenceStore({ root: join(pre, 'evidence') });
  const record = await openRecord({ path: join(pre, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const extensions = await openExtensionHost({ record, supervisor, trust, home: w.root, release: [pkg.entry], now: Date.now });
  try {
    await extensions.ready();
    const installed = await extensions.install({ from: pkg.folder, builtBy: null, grant: { hosts: [{ host, quota: { calls: 1_000_000, per_ms: 3_600_000 } }] } });
    const checked = await extensions.check(installed);
    if (!checked.passed) throw Error(`BLOCKED: the test package must pass its conformance: ${checked.reasons.join('; ')}`);
  } finally {
    await extensions.close();
    await supervisor.close();
    await record.close();
  }
}

interface Scene { w: World; release: string }
/** A set-up home with the package installed, and the source's host listening: one for each hub. */
async function world(): Promise<Scene> {
  const listener = net.createServer((socket) => socket.destroy());
  listeners.push(listener);
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', () => resolve()));
  const host = `127.0.0.1:${(listener.address() as net.AddressInfo).port}`;
  const w = await setUpWorld();
  const pkg = writePackage(w.tmp, host);
  await install(w, pkg, host);
  const release = join(w.tmp, 'release.json');
  writeFileSync(release, `${JSON.stringify([pkg.entry])}\n`);
  return { w, release };
}

const at = (ms: number) => new Date(ms).toISOString().slice(11, 23);
/** The first event after `after` of `kind` that `match` takes, waited for up to WAIT_MS. */
async function recorded(hub: Hub, after: number, kind: string, match: (e: Ev) => boolean): Promise<Ev | undefined> {
  const cli = await control(hub);
  try {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const found = (await eventsAfter(cli, after, [kind])).find(match);
      if (found || Date.now() > deadline) return found;
      await sleep(50);
    }
  } finally {
    cli.close();
  }
}
async function end(hub: Hub): Promise<number> {
  const cli = await control(hub);
  try { return await logEnd(cli); } finally { cli.close(); }
}

/** `deep off`, run as a person runs it: the hub writes gates.json, and the record holds `deep off` within 1 s of that write. */
async function judgeOff(hub: Hub, w: World): Promise<void> {
  const after = await end(hub);
  const off = await deep(w, ['off']);
  if (off.code !== 0) throw Error(`BLOCKED: deep off must turn the gates off: exit ${off.code}: ${off.stderr}`);
  const file = join(w.root, 'gates.json');
  if ((JSON.parse(readFileSync(file, 'utf8')) as { off?: unknown }).off !== true) throw Error(`BLOCKED: deep off exited 0 but gates.json says ${readFileSync(file, 'utf8')}`);
  const written = statSync(file).mtimeMs;
  const event = await recorded(hub, after, 'holds.watch', (e) => !e.session && e.data.cause === 'off' && e.data.on === true);
  const took = event ? event.ts - written : undefined;
  if (took === undefined || took > OFF_MS) {
    throw Error(`AC3 ${AC3}: \`deep off\` written to gates.json at ${at(written)} was ${took === undefined ? `not recorded within ${WAIT_MS / 1000} s` : `recorded ${Math.round(took)} ms later`}: no holds.watch with cause off within ${OFF_MS} ms of the write to gates.json`);
  }
  console.log(`AC3 reading: deep off recorded ${Math.round(took)} ms after gates.json was written`);
}

/** Claude Code's PreToolUse entry of DeepBuild's taken out of its settings, as you'd edit the file: its reach reads unreachable within 2 s. */
async function judgeHookEntry(hub: Hub, w: World): Promise<void> {
  const cli = await control(hub);
  let before: Ev | undefined;
  let after: number;
  try {
    before = (await eventsAfter(cli, 0, ['agent.reach'])).filter((e) => e.data.agent === 'claude-code').at(-1);
    after = await logEnd(cli);
  } finally {
    cli.close();
  }
  if (!before || before.data.state === 'unreachable') throw Error(`BLOCKED: before its entry is removed, Claude Code's reach must not read unreachable: ${JSON.stringify(before?.data ?? 'no agent.reach')}`);
  const file = join(w.home, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(file, 'utf8')) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };
  const groups = settings.hooks?.PreToolUse ?? [];
  const kept = groups.filter((g) => !(g.hooks ?? []).some((h) => String(h.command).includes('deep-hook')));
  if (kept.length === groups.length) throw Error(`BLOCKED: setup wrote no PreToolUse entry of DeepBuild's into ${file}`);
  settings.hooks!.PreToolUse = kept;
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  const written = statSync(file).mtimeMs;
  const event = await recorded(hub, after, 'agent.reach', (e) => e.data.agent === 'claude-code' && e.data.state === 'unreachable');
  const took = event ? event.ts - written : undefined;
  if (took === undefined || took > REACH_MS) {
    throw Error(`AC3 ${AC3}: Claude Code's PreToolUse entry removed from ${file} (its settings.json) at ${at(written)}: its reach ${took === undefined ? `still read ${String(before.data.state)} ${WAIT_MS / 1000} s later` : `read unreachable ${Math.round(took)} ms later`}; within ${REACH_MS} ms passes`);
  }
  console.log(`AC3 reading: Claude Code's reach read unreachable (${String(event!.data.code)}) ${Math.round(took)} ms after its settings.json lost the entry`);
}

/**
 * The view reported shown as the app reports it, at once and every 5 s: the source is read at once and every 10 s.
 * After its second read, a notice on the source at its own cadence is saved in extensions/notices.json, as the host
 * saves one (a temp file renamed into place): it stands in for the while-shown cadence, so the next read, due 10 s
 * after the second, doesn't come.
 */
async function judgeNotice(hub: Hub, w: World): Promise<void> {
  const app = await control(hub, 'app');
  const after = await logEnd(app);
  const show = () => app.call('views.shown', SHOWN).catch(() => undefined);
  await show();
  const timer = setInterval(() => void show(), 5000);
  try {
    const reads = async () => (await eventsAfter(app, after, ['source.called'])).filter((e) => e.data.source === SOURCE);
    let seen: Ev[] = [];
    const deadline = Date.now() + 4 * EVERY_MS;
    while ((seen = await reads()).length < 2 && Date.now() < deadline) await sleep(100);
    if (seen.length < 2) throw Error(`BLOCKED: with ${VIEW} shown, ${SOURCE} must be read while shown, at once and every ${EVERY_MS / 1000} s: ${seen.length} reads in ${(4 * EVERY_MS) / 1000} s; the hub said ${hub.stderr().slice(-800)}`);
    const [, second] = seen as [Ev, Ev];
    const file = join(w.root, 'extensions', 'notices.json');
    const notices = { ...(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>), [ulid(Date.now())]: {
      kind: NOTICE_KIND, key: 'board', source: SOURCE, words: 'the error rate passes 2%', every: EVERY_MS,
      sentence: `the error rate passes 2%: checked every ${EVERY_MS / 1000} s, reading ${SOURCE} each time, since it runs only while a view is shown`,
    } };
    writeFileSync(`${file}.tmp`, JSON.stringify(notices, null, 2));
    renameSync(`${file}.tmp`, file);
    const written = statSync(file).mtimeMs;
    const due = second.ts + EVERY_MS;
    await sleep(Math.max(0, due + EVERY_MS / 2 - Date.now()));
    const later = (await reads()).filter((e) => e.ts > written);
    if (later.length) {
      throw Error(`AC3 ${AC3}: a notice on ${SOURCE} saved to extensions/notices.json at ${at(written)}, at the source's own ${EVERY_MS / 1000} s, didn't change its next while-shown cadence: it was read while shown at ${later.map((e) => at(e.ts)).join(', ')}, its next read due at ${at(due)}`);
    }
    console.log(`AC3 reading: reads at ${seen.map((e) => at(e.ts)).join(', ')}; the notice saved at ${at(written)}; no read by ${at(Date.now())}, the next was due at ${at(due)}`);
  } finally {
    clearInterval(timer);
    app.close();
  }
}

/** The three changes, one after another on one idle hub, each judged on its own: what each judge threw, by name. */
async function scenario(plant?: string): Promise<{ name: string; failure: string | null }[]> {
  const { w, release } = await world();
  const hub = await startHub(w, { ...(plant ? { plant } : {}), env: { DEEP_HUB_TEST_RELEASE: release } });
  const out: { name: string; failure: string | null }[] = [];
  try {
    for (const [name, judge] of [['deep off', judgeOff], ['the hook entry', judgeHookEntry], ['the notice', judgeNotice]] as const) {
      await sleep(SETTLE_MS);
      try {
        await judge(hub, w);
        out.push({ name, failure: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('BLOCKED')) throw error;
        out.push({ name, failure: message });
        console.log(`AC3${plant ? ` on the planted ${plant}` : ''}, ${name}: ${message}`);
      }
    }
  } finally {
    await stopHub(hub);
  }
  return out;
}

describe(`AC3 ${AC3} deep off, a saved notice and a removed hook entry are each seen as soon as today`, () => {
  it(`AC3 ${AC3} deep off is recorded within 1 s, a saved notice changes the next while-shown cadence, and a removed hook entry turns Claude Code's reach unreachable within 2 s`, async () => {
    const results = await scenario();
    for (const r of results) expect(r.failure, `${r.name}: ${r.failure}`).toBeNull();
  }, 900_000);

  it(`AC3 ${AC3} the planted hub that reads each file once at start fails all three, naming gates.json, notices.json and the settings`, async () => {
    const results = await scenario(PLANT);
    const names: Record<string, RegExp> = { 'deep off': /gates\.json/, 'the hook entry': /settings\.json/, 'the notice': /notices\.json/ };
    for (const r of results) {
      expect(r.failure, `the planted hub ${PLANT} passed ${r.name}: a check that can't fail on it proves nothing`).not.toBeNull();
      expect(r.failure!, `${r.name} fails on the planted hub, naming its file`).toMatch(names[r.name]!);
    }
  }, 900_000);
});
