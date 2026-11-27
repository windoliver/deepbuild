import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import {
  allEvents, childEnv, CLI, deep, makeHome, NODE, own, parseObject, REPO, rootOf, settingsFile, shown, sleep,
  type Ev, type Home, type Hub, type Line, type Ran,
} from '../27/helpers.ts';

export { allEvents, cleanup, deep, loadReading, makeRepo, msOf, question, beginAsk, shown, sleep, stopHub, tag, waitFor, type Ev, type Hub, type Line, type Ran } from '../27/helpers.ts';
export { failureOf, Inconclusive, verdict } from '../29/h-d.ts';
import { Inconclusive } from '../29/h-d.ts';

export const AC1 = 'AC1 #1828.65fe62dd';
export const AC2 = 'AC2 #1828.6794e119';
export const AC3 = 'AC3 #1828.44a54c78';

export const PLANT = 'host-without-asks';
export const RELEASE_ENV = 'DEEP_HUB_TEST_RELEASE';

export const SENDER = 'acme/notify';
export const ANSWERER = 'acme/answers';
export const FEED = 'acme/feed';
export const BOARD = 'acme/board';
export const FEED_V1 = 'ext.feed.level@1';
export const FEED_V2 = 'ext.feed.level@2';
const PREVIEW = ['deep.send', 'deep.registerResolver', 'deep.provide', 'deep.use', 'deep.on', 'deep.record.append', 'deep.config.get'];
const READING = { type: 'object' };
const d1 = (value: unknown): string => `d1:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export interface Package { id: string; version: string; folder: string; entry: ReleaseEntry; grant: { record: string[]; hosts?: { host: string; quota: { calls: number; per_ms: number } }[] } }
function writePackage(dir: string, id: string, version: string, code: string, manifest: Line, grant: Package['grant'] = { record: [] }): Package {
  const folder = join(dir, `${id.replace('/', '-')}-${version}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'index.ts'), code);
  const m: Line = { id, version, digest: `d1:${'0'.repeat(64)}`, requires: { preview: PREVIEW }, ...manifest };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(m));
  m.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(m));
  return { id, version, folder, entry: { id, version, digest: String(m.digest) }, grant };
}

const NOTE = (log: string) => `import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';

const LOG = ${JSON.stringify(log)};
const note = (o: object): void => {
  try { appendFileSync(LOG, JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + '\\n'); } catch { /* not reachable from here */ }
};
`;
export function logOf(file: string): Line[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((raw) => { const o = parseObject(raw); return o ? [o] : []; });
}

export function senderPackage(dir: string, host: string, trigger: string, log: string): Package {
  const code = `${NOTE(log)}
const TRIGGER = ${JSON.stringify(trigger)};
export default function (deep: any): void {
  note({ started: true });
  const timer = setInterval(() => {
    let message: any;
    try {
      if (!existsSync(TRIGGER)) return;
      message = JSON.parse(readFileSync(TRIGGER, 'utf8'));
      rmSync(TRIGGER);
    } catch { return; }
    note({ sending: message.key });
    Promise.resolve().then(() => deep.send(message)).then(
      (result: unknown) => note({ sent: message.key, result }),
      (error: any) => note({ refused: message.key, error: String(error?.message ?? error) }),
    );
  }, 100);
  (timer as any).unref?.();
}
`;
  return writePackage(dir, SENDER, '1.0.0', code, { access: { words: ['hosts'] } }, { record: [], hosts: [{ host, quota: { calls: 100, per_ms: 60_000 } }] });
}

export function answererPackage(dir: string, rule: string, log: string): Package {
  const code = `${NOTE(log)}
const RULE = ${JSON.stringify(rule)};
export default async function (deep: any): Promise<void> {
  try {
    await deep.registerResolver(async (ask: any) => {
      let r: any = null;
      try { r = JSON.parse(readFileSync(RULE, 'utf8')); } catch { /* no rule yet */ }
      const answer = r && ask?.key === r.key ? { answer: r.answer, because: r.decision } : undefined;
      note({ consulted: ask?.ask ?? null, key: ask?.key ?? null, answered: answer ?? null });
      return answer;
    });
    note({ registered: true });
  } catch (error: any) {
    note({ register_refused: String(error?.message ?? error) });
  }
}
`;
  return writePackage(dir, ANSWERER, '1.0.0', code, {});
}

export function feedPackage(dir: string, version: '1.0.0' | '2.0.0'): Package {
  const iface = version === '1.0.0' ? FEED_V1 : FEED_V2;
  const code = `export default function (deep: any): void {
  void Promise.resolve().then(() => deep.provide(${JSON.stringify(iface)}, 'reading', ${JSON.stringify(READING)}, () => ({ level: 1 }))).catch(() => undefined);
}
`;
  return writePackage(dir, FEED, version, code, { provides: [{ interface: iface, kind: 'reading', minor: 0 }] });
}
export function boardPackage(dir: string): Package {
  const code = `export default function (deep: any): void {
  void Promise.resolve().then(() => deep.use(${JSON.stringify(FEED_V1)})).catch(() => undefined);
}
`;
  return writePackage(dir, BOARD, '1.0.0', code, { uses: [{ interface: FEED_V1, minor: 0, digest: d1(READING) }] });
}

export async function installAll(w: Home, packages: readonly Package[], release: readonly Package[]): Promise<void> {
  const pre = join(w.tmp, `pre-${Date.now()}`);
  const evidence = await openEvidenceStore({ root: join(pre, 'evidence') });
  const record = await openRecord({ path: join(pre, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home: rootOf(w.home), release: release.map((p) => p.entry), now: Date.now });
  try {
    await host.ready();
    for (const p of packages) {
      const installed = await host.install({ from: p.folder, builtBy: null, grant: p.grant });
      const checked = await host.check(installed);
      if (!checked.passed) throw Error(`BLOCKED: the test package ${p.id}@${p.version} must pass its conformance: ${checked.reasons.join('; ')}`);
    }
  } finally {
    await host.close();
    await sup.close();
    await record.close();
  }
}

export function installedVersion(w: Home, id: string): string | undefined {
  const file = join(rootOf(w.home), 'extensions', 'installed.json');
  if (!existsSync(file)) return undefined;
  const entry = (parseObject(readFileSync(file, 'utf8')) ?? {})[id] as Line | undefined;
  return typeof entry?.version === 'string' ? entry.version : undefined;
}

export function built(): string | null {
  const hook = join(REPO, 'target/debug/deep-hook');
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', hook]] as const) {
    if (!existsSync(path)) return `${what} is not built at ${path}`;
  }
  if (spawnSync('openssl', ['version']).status !== 0) return 'openssl, which makes the HTTPS stand-in\'s certificate, is not on PATH';
  return null;
}

export interface HubSettings { plant?: string; release: readonly Package[]; ca?: string }
export async function startHub(w: Home, o: HubSettings): Promise<Hub> {
  const releaseFile = join(w.tmp, 'release.json');
  writeFileSync(releaseFile, `${JSON.stringify(o.release.map((p) => p.entry), null, 2)}\n`);
  const env = childEnv(w.home, { [RELEASE_ENV]: releaseFile, DEEP_HUB_PLANT: o.plant, NODE_EXTRA_CA_CERTS: o.ca });
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(undefined), 240_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${out.slice(-2000)}`);
  return { pid: Number(ready.pid ?? child.pid), home: w.home, socket: join(rootOf(w.home), 'hub.sock'), root: rootOf(w.home), child, output: () => out };
}

export async function setup(w: Home): Promise<void> {
  const r = await deep(w.home, ['setup']);
  if (r.code !== 0 || !existsSync(settingsFile(w.home))) throw Error(`BLOCKED: deep setup must exit 0 and write Claude Code's settings: ${shown(r)}`);
}

export const answer = (w: Home, handle: string, option: string): Promise<Ran> => deep(w.home, ['inbox', 'answer', handle, option]);

export interface Provider { host: string; ca: string; requests: { at: number; path: string; body: string }[]; close(): Promise<void> }
export async function provider(dir: string): Promise<Provider> {
  const key = join(dir, 'provider.key');
  const ca = join(dir, 'provider.crt');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', ca, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
  if (made.status !== 0) throw Error(`BLOCKED: openssl could not make the stand-in's certificate: ${made.stderr}`);
  const requests: Provider['requests'] = [];
  const server: Server = createServer({ key: readFileSync(key), cert: readFileSync(ca) }, (req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (d: string) => (body += d)).on('end', () => {
      requests.push({ at: Date.now(), path: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `m-${requests.length}` }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { host, ca, requests, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
export const carrying = (p: Provider, key: string) => p.requests.filter((r) => r.body.includes(key));

export const asksNaming = (events: readonly Ev[], text: string): Ev[] => events.filter((e) => e.kind === 'ask.created' && JSON.stringify(e.data ?? {}).includes(text));
export const authorityShape = (ask: Ev): boolean => ask.data?.kind === 'authority'
  && (ask.data.options as Line[] | undefined)?.some((o) => o.id === 'approve' && o.decision === 'allow') === true
  && (ask.data.options as Line[] | undefined)?.some((o) => o.id === 'decline' && o.decision === 'deny') === true;
export const ofAsk = (events: readonly Ev[], ask: Ev): Ev[] => events.filter((e) => e.log_pos > ask.log_pos && (e.subject === `ask:${ask.id}` || JSON.stringify(e.data ?? {}).includes(ask.id)) && /^(ask\.|decision\.applied|approval\.)/.test(e.kind));
export const said = (e: Ev): string => `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data ?? {}).slice(0, 400)}`;

export async function poll<T>(ms: number, probe: () => Promise<T | undefined> | T | undefined, everyMs = 100): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined || Date.now() > deadline) return value;
    await sleep(everyMs);
  }
}

export interface SendScene {
  key: string;
  asks: Ev[];
  after: Ev[];
  beforeYes: number;
  reached: number;
  yes?: Ran;
  notes: Line[];
}
export async function sendScene(w: Home, hub: Hub, p: Provider, trigger: string, log: string): Promise<SendScene> {
  const key = `notify-${randomBytes(6).toString('hex')}`;
  const message = { kind: 'email', key, to: ['you@example.invalid'], host: p.host, path: '/send', subject: 'Your build is green', body: `All checks passed (${key}).` };
  writeFileSync(`${trigger}.tmp`, JSON.stringify(message));
  renameSync(`${trigger}.tmp`, trigger);
  const mine = () => logOf(log).filter((n) => n.sending === key || n.sent === key || n.refused === key);
  const ended = () => mine().some((n) => n.sent === key || n.refused === key);
  const ask = await poll(30_000, async () => asksNaming(await allEvents(hub), key)[0] ?? (ended() ? null : undefined));
  if (ask === undefined && !mine().length) throw Error(`BLOCKED: ${SENDER} never took the send ${key} from its trigger in 30 s: is it loaded? Its log: ${JSON.stringify(logOf(log)).slice(0, 800)}; hub stderr: ${hub.output().slice(-800)}`);
  let yes: Ran | undefined;
  let beforeYes = carrying(p, key).length;
  if (ask) {
    beforeYes = carrying(p, key).length;
    yes = await answer(w, `ask:${ask.id}`, 'approve');
    await poll(60_000, () => (carrying(p, key).length || ended() ? true : undefined));
    await sleep(3000);
  }
  const events = await allEvents(hub);
  const asks = asksNaming(events, key);
  const after = asks.flatMap((a) => ofAsk(events, a));
  if (ask && yes?.code !== 0) {
    const defaulted = after.find((e) => e.kind === 'ask.defaulted' || e.kind === 'ask.escalated');
    if (defaulted) throw new Inconclusive(`${key}'s ask closed at its deadline (${said(defaulted)}) before deep inbox answer landed (${shown(yes!)}); the machine was too slow to answer within the send's call limit`);
    throw Error(`BLOCKED: deep inbox answer ask:${ask.id} approve must exit 0: ${shown(yes!)}`);
  }
  return { key, asks, after, beforeYes, reached: carrying(p, key).length, ...(yes ? { yes } : {}), notes: mine() };
}
export function judgeSend(s: SendScene): string[] {
  const heard = s.notes.filter((n) => n.refused || n.sent).map((n) => (n.refused ? `refused: ${String(n.error)}` : `sent: ${JSON.stringify(n.result)}`)).join('; ') || 'nothing yet';
  const lead = `\`deep.send\` of ${s.key} by ${SENDER} (it heard: ${heard})`;
  const problems: string[] = [];
  if (s.asks.length !== 1) problems.push(`${lead} raised ${s.asks.length} asks naming it, not one from action.send${s.asks.length ? `: ${s.asks.map(said).join('; ')}` : ''}`);
  const [ask] = s.asks;
  if (ask && !authorityShape(ask)) problems.push(`${lead} raised an ask without action.send's options (approve to send, decline not to): ${said(ask)}`);
  if (s.beforeYes) problems.push(`${lead} reached the provider ${s.beforeYes} times before your yes`);
  if (ask && s.reached !== 1) problems.push(`${lead} reached the provider ${s.reached} times after your yes, not once (what followed the ask: ${s.after.map(said).join('; ') || 'nothing'})`);
  return problems;
}
export { makeHome, type Home };

export async function sendWorld(o: { plant?: string } = {}): Promise<{ w: Home; hub: Hub; p: Provider; trigger: string; log: string }> {
  const w = makeHome();
  const p = await provider(w.tmp);
  const trigger = join(w.tmp, 'notify-trigger.json');
  const log = join(w.tmp, 'notify-log.jsonl');
  const sender = senderPackage(join(w.tmp, 'test-packages'), p.host, trigger, log);
  await installAll(w, [sender], [sender]);
  try {
    return { w, hub: await startHub(w, { release: [sender], ca: p.ca, ...(o.plant ? { plant: o.plant } : {}) }), p, trigger, log };
  } catch (error) {
    await p.close();
    throw error;
  }
}
