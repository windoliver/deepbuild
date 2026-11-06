// @deepbuild/checks-journey: the first-party journey check kind (#37). It drives a browser journey with Playwright
// against a stack env-local starts from the run's own checkout, through host@1, and checks the end state; an API
// journey drives that stack's service with real requests, with no browser, and reads the end state back from it.
// Everything it saw is evidence by hash: screenshots, the video with each step's span, the trace, the saved script
// and the recording. It reports a closed run outcome, never a verdict; `requirementCover` says what the core would
// make of a run. The feature list, the changed features' journeys with their neighbors, the comparison with the last
// PASS, screens against the merge base rendered here, the latency check and motion assertions live beside it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { runCommandCheck } from '@deepbuild/checks-command';
import type { CheckResult, CheckRunnerFill } from '@deepbuild/conformance';
import { downStack, newRun, upStack } from '@deepbuild/env-local';
import { openEvidenceStore, scrubValues, type EvidenceStore, type Redaction, type Writer } from '@deepbuild/evidence';
import { attributeStack, type Served, type StackRecords, type Trees } from '@deepbuild/gate';
import type { Host, Supervisor } from '@deepbuild/supervisor';
import type { Depth } from '@deepbuild/verdicts';
import { parse, stringify } from 'yaml';
import { runApiJourney } from './api.js';
import { firstDiffering } from './compare.js';
import { listFeatures as readFeatures, selectJourneys as select } from './features.js';
import { parseJourney, refusals, timeoutUnder, toDriver, unrunnable, type Journey, type Locator as JourneyLocator } from './journey.js';
import { judgeLatency } from './latency.js';
import { assertMotion, assertReducedMotion } from './motion.js';
import { comparePixels as compareImages, decodePng, encodePng, highlight, paintMasks, type Box, type Image } from './png.js';
import { quoteIn } from './reading.js';
import { embeddedJourney, saveScript } from './replay.js';
import { cancel, discard, drive, playwrightVersion, prestart, PROFILE, type DriverRun, type Job, type Prestarted, type Profile, type Report } from './run.js';
import { baseDisagreement, describeLocator, domDelta, masked, renderKey, resolveMask, routesOf, sideBySide, smallestHolding, type Capture, type Delta, type Difference, type MaskAsk, type Render } from './screens.js';

export { reviewJourney } from './journey.js';
export type { Box } from './png.js';
export type { Delta, Difference, MaskAsk } from './screens.js';

/** The planted wrong programs the criteria name, selected per run; tests only. */
export type Plant = 'end-state-only' | 'response-as-end-state' | 'deadline-under-expect' | 'checkout-as-asked' | 'reading-as-pass' | 'raw-url'
  | 'every-replay-recorded' | 'tolerates-16-pixels' | 'unstable-base-as-difference';

/** A model an end-state check with oracle `model` reads with; the tests supply a fake. */
export interface Model { read(input: ModelInput): Promise<ModelReading> }
/** All the model gets: the requirement and the end step's redacted screen (the text snapshot, and a screenshot only when none of the run's is incomplete). */
export interface ModelInput { requirement: string; snapshot: string; screenshot: Uint8Array | null }
export interface ModelReading { answer: boolean; quote: string }

export interface JourneyRunOptions {
  host: Host;
  evidence: EvidenceStore;
  run: string;
  checkout: string;
  journey: string;
  trees: Trees;
  secrets?: Record<string, string>;
  reducedMotion?: 'reduce' | 'no-preference';
  model?: Model;
  stop?: AbortSignal;
  environment?: { plant: 'swap-partway'; to: string };
  plant?: Plant;
}
export type Locator = JourneyLocator;
export interface Control { role: string; name: string; testId?: string }
export type PageError =
  | { kind: 'uncaught'; message: string; step: string }
  | { kind: 'request'; url: string; status: number | null; unfinished: boolean; step: string };
export interface Animation { target: Control; property: string; from: string; to: string; duration: number; delay: number; easing: string }
export interface StepRecord {
  id: string;
  outcome: 'passed' | 'failed' | 'overran' | 'stopped' | 'unrun';
  startMs: number; endMs: number;
  route: string;
  /** The route as the page had it, which only the planted raw-URL comparison reads. */
  raw?: string;
  controls: { appeared: Control[]; left: Control[]; changed: Control[] };
  screenshot: string | null;
  errors: PageError[];
  animations: Animation[];
  firstFrame: { opacity: number; transform: string } | null;
}
export interface EndStateRecord {
  id: string;
  oracle: 'code' | 'model' | 'person';
  outcome: 'passed' | 'failed' | 'reading';
  selector: Locator | null;
  box: Box | null;
  screenshot: string | null;
  readback?: unknown;
  reading?: { answer: boolean; quote: string; found: boolean; counted: boolean; sendBack: boolean };
}
/** A closed run outcome, check.kind@1's CheckResult plus the run record's fields. Never a verdict. */
export interface JourneyRun extends CheckResult {
  run: string;
  stack: { run: string; pid: number; ports: Record<string, number> } | null;
  served: Served;
  tree: string | null;
  steps: StepRecord[];
  endState: EndStateRecord[];
  video: string | null; trace: string | null;
  script: string | null;
  recording: string | null;
  expectedErrors: PageError[];
  cause: string | null;
  depth: Depth;
  recorded: boolean;
  reducedMotion: 'reduce' | 'no-preference';
  redaction: Redaction;
  timing: { total: number; playwright: number };
}
export type Review = { ok: true } | { ok: false; reasons: string[] };
export interface Feature { feature: string; name: string; files: string[]; journeys: string[] }
export interface Requirement { req: string; depth: Depth; oracle: 'code' | 'model' | 'person' }
export interface TasteAsk { kind: 'taste'; screenshot: string; reading: string }
/** What the core would make of the run for a requirement: the checks that count, and the verdict row that applies. */
export interface Cover { counted: string[]; wouldBe: 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE'; reasons: string[]; ask?: TasteAsk; sendBack: boolean }
export interface ScreenOptions {
  host: Host; evidence: EvidenceStore;
  journey: string;
  base: { checkout: string; commit: string };
  head: { checkout: string };
  cache: string;
  spec: string;
  requirement: 'no-visible-change' | 'visual';
  answer: (ask: MaskAsk) => Promise<boolean>;
  plant?: Plant;
}
export interface ScreenResult {
  outcome: 'passed' | 'failed' | 'uncounted' | 'INVALID';
  named: string[];
  differences: Difference[];
  deltas: Delta[];
  screens: { step: string; base: [string, string]; head: string }[];
  sideBySide: string | null;
  highlighted: string | null;
  taste: boolean;
  renders: { base: number; head: number };
  spec: string;
}
export interface Latency { outcome: 'passed' | 'failed'; base: number[]; head: number[]; shown: string }
export interface Motion { normal: JourneyRun; reduced: JourneyRun; outcome: 'passed' | 'failed' | 'inconclusive'; named: string[] }

/** The environment profile every run is keyed by, and the tool versions. */
const environmentOf = (profile: Profile): Record<string, string> => ({ browser: 'chromium', viewport: `${profile.width}x${profile.height}`, locale: profile.locale, timezone: profile.timezone, color_scheme: profile.colorScheme, reduced_motion: profile.reducedMotion, service_workers: 'off', scale: '1' });
const toolsOf = (): Record<string, string> => ({ playwright: playwrightVersion(), node: process.version });
const LICENSE = { name: 'local', allows: ['export', 'report'] as const };
const first = (s: string): string => s.split('\n')[0]!.slice(0, 500);

/** A tree's identity as a receipt names it: the SHA-256 over every file's path and bytes, `.pids` (what the app writes) left out. */
export function treeDigest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string, rel: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.pids') continue;
      const path = join(d, entry.name);
      const at = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, at);
      else { hash.update(`${at}\0`); hash.update(readFileSync(path)); hash.update('\0'); }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}
/** A free port on 127.0.0.1, found by binding one; the stack listens on it under its grant. */
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); });
});
const environmentBlock = (checkout: string): { up?: string; ports: string[] } => {
  try {
    const doc = parse(readFileSync(join(checkout, '.deepbuild/done.yaml'), 'utf8')) as { environment?: { up?: unknown; ports?: unknown } } | null;
    const e = doc?.environment;
    return { ...(typeof e?.up === 'string' ? { up: e.up } : {}), ports: Array.isArray(e?.ports) ? e!.ports.filter((p): p is string => typeof p === 'string') : [] };
  } catch { return { ports: [] }; }
};
const cwdOf = (pid: number, fallback: string): string => { try { return realpathSync(`/proc/${pid}/cwd`); } catch { return fallback; } };

// ---- The stack: env-local's, from the checkout, on ports this kind leases, torn down by run after the run.
interface Stack { run: string; pid: number; ports: Record<string, number>; url: string; processes: { name: string; pid: number; cwd: string }[] }
async function leasePorts(checkout: string): Promise<Record<string, number>> {
  const ports: Record<string, number> = {};
  for (const name of environmentBlock(checkout).ports) ports[name] = await freePort();
  return ports;
}
async function up(host: Host, checkout: string, ports: Record<string, number>): Promise<{ stack: Stack } | { cause: string }> {
  const run = newRun();
  const result = await upStack(host, { run, folder: checkout, ports }).catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }));
  if (result.status === 'BLOCKED') { await down(host, run); return { cause: result.cause }; }
  const s = result.stack;
  const url = new URL(s.url);
  return { stack: { run, pid: s.pid, ports: s.ports, url: `${url.protocol}//${url.host}`, processes: [{ name: 'sh', pid: s.pid, cwd: cwdOf(s.pid, checkout) }] } };
}
async function down(host: Host, run: string): Promise<void> {
  await downStack(host, run).catch(() => undefined);
  await (host as Partial<Supervisor>).cleanup?.(run)?.catch(() => undefined);
}
async function healthy(url: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`${url}/health`); if (r.status === 200) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// ---- One run.
const journeyText = (checkout: string, file: string): string => readFileSync(isAbsolute(file) ? file : join(checkout, file), 'utf8');
const empty = (run: string, o: { depth: Depth; reducedMotion: 'reduce' | 'no-preference' }): JourneyRun => ({
  run, outcome: 'failed', testsRun: 0, failures: [], evidence: [], read: [], mask: null, stack: null, served: { served: 'checkout' }, tree: null, steps: [], endState: [],
  video: null, trace: null, script: null, recording: null, expectedErrors: [], cause: null, depth: o.depth, recorded: false, reducedMotion: o.reducedMotion, redaction: 'complete', timing: { total: 0, playwright: 0 },
});
const unrun = (journey: Journey): StepRecord[] => journey.steps.map((s) => ({ id: s.id, outcome: 'unrun', startMs: 0, endMs: 0, route: '', controls: { appeared: [], left: [], changed: [] }, screenshot: null, errors: [], animations: [], firstFrame: null }));
const expectedBy = (journey: Journey, e: PageError): boolean => journey.expectedErrors.some((x) => x.step === e.step && (e.kind === 'uncaught' ? x.message !== undefined && e.message.includes(x.message) : x.url !== undefined && e.url.includes(x.url) && (x.status === undefined || x.status === e.status)));
const at = (body: unknown, field: string): unknown => field.split('.').reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), body);
interface Internal { settle?: boolean; masks?: JourneyLocator[] }
interface Ran { run: JourneyRun; report: Report | null; render: Render | null }

/** One journey against a stack env-local starts from the checkout through `host`, torn down after; the run's evidence stored. */
export async function runJourney(o: JourneyRunOptions): Promise<JourneyRun> {
  return (await runInternal(o, {})).run;
}
async function runInternal(o: JourneyRunOptions, extra: Internal): Promise<Ran> {
  const reducedMotion = o.reducedMotion ?? 'reduce';
  // Reading and checking the journey file is the runner's time too, and counts with what it spends once the stack is ready.
  const reading = Date.now();
  let text: string;
  try { text = journeyText(o.checkout, o.journey); } catch (error) { return { run: { ...empty(o.run, { depth: 'journey', reducedMotion }), outcome: 'missing', cause: (error as Error).message }, report: null, render: null }; }
  let journey: Journey;
  try { journey = parseJourney(text); } catch (error) { return { run: { ...empty(o.run, { depth: 'journey', reducedMotion }), outcome: 'failed', cause: (error as Error).message, failures: [{ test: o.journey, file: o.journey, line: 0, stack: null, assertion: false, message: (error as Error).message }] }, report: null, render: null }; }
  const refused = [...unrunnable(journey), ...refusals(journey)];
  if (refused.length) {
    // A file that carries a credential, or names what a run can't drive, never runs: no stack starts for it, and the refusal names the step, never a value.
    return { run: { ...empty(o.run, { depth: journey.depth, reducedMotion }), outcome: 'failed', cause: refused.join('; '), failures: refused.map((r) => ({ test: journey.id, file: o.journey, line: 0, stack: null, assertion: false, message: r })) }, report: null, render: null };
  }
  if (extra.masks) journey.masks = extra.masks;
  const held = Object.values(o.secrets ?? {}).filter(Boolean);
  const scrub = (s: string): string => (held.length ? scrubValues(s, { env: o.secrets ?? {}, held }) : s);
  const run = empty(o.run, { depth: journey.depth, reducedMotion });
  run.steps = unrun(journey);
  const readMs = Date.now() - reading;
  const ports = await leasePorts(o.checkout);
  // A browser journey's driver boots while the stack comes up, and waits for its job until the stack is ready.
  const pre = journey.api ? null : prestart({ host: o.host, run: o.run, hosts: Object.values(ports).map((p) => `127.0.0.1:${p}`), ...(o.secrets ? { secrets: o.secrets } : {}), ...(o.stop ? { stop: o.stop } : {}) });
  const brought = await up(o.host, o.checkout, ports);
  if ('cause' in brought) { if (pre) await cancel(pre); return { run: { ...run, outcome: 'missing', cause: brought.cause }, report: null, render: null }; }
  const stack = brought.stack;
  // The run's time is the runner's, from the stack being ready to its teardown: env-local's start and stop are its own (#331).
  const ready = Date.now();
  run.stack = { run: stack.run, pid: stack.pid, ports: stack.ports };
  const records: StackRecords = { processes: stack.processes.map((p) => ({ ...p, reads: [] })), containers: [] };
  const swaps: string[] = [];
  const reaping: Promise<void>[] = [];
  let out: { report: Report | null; render: Render | null } = { report: null, render: null };
  try {
    const writer = o.evidence.connect({ role: 'deepbuild', via: 'journey' });
    if (journey.api) await runApi(o, journey, text, stack.url, run, scrub, writer);
    else out = await runBrowser(o, journey, text, stack, run, writer, scrub, records, swaps, reducedMotion, extra, pre!, reaping);
  } finally {
    run.timing.total = readMs + Date.now() - ready;
    // A driver whose job was never written (something threw first) is told to go, so nothing waits on it.
    if (pre && !pre.used) reaping.push(cancel(pre));
    for (const s of swaps) await down(o.host, s);
    await Promise.all([down(o.host, stack.run), ...reaping]);
  }
  return { run, ...out };
}

/** An API journey: real requests to the running service, no browser, the end state read back from the real system. */
async function runApi(o: JourneyRunOptions, journey: Journey, text: string, url: string, run: JourneyRun, scrub: (s: string) => string, writer: Writer): Promise<void> {
  const steps = journey.steps.filter((s) => s.request).map((s) => ({ id: s.id, line: s.line ?? 0, deadlineMs: s.deadlineMs, method: s.request!.method, path: s.request!.path, body: s.request!.body, expect: { status: s.request!.status } }));
  const r = await runApiJourney({ run: o.run, journey: { id: journey.id, steps, endState: [] }, url, file: o.journey, ...(o.secrets ? { secrets: o.secrets } : {}) });
  run.steps = journey.steps.map((s) => {
    const done = r.steps.find((x) => x.id === s.id);
    const failed = r.failures.some((f) => f.test.endsWith(`› ${s.id}`));
    return { id: s.id, outcome: done ? (failed ? (r.outcome === 'overran' ? 'overran' : 'failed') : 'passed') : 'unrun', startMs: done?.startMs ?? 0, endMs: done?.endMs ?? 0, route: s.request?.path ?? '', controls: { appeared: [], left: [], changed: [] }, screenshot: null, errors: [], animations: [], firstFrame: null };
  });
  run.outcome = r.outcome; run.failures = r.failures.map((f) => ({ ...f, message: scrub(f.message) })); run.testsRun = r.testsRun; run.cause = r.message && r.outcome === 'missing' ? r.message : null;
  if (run.outcome === 'passed') await readbacks(o, journey, url, run, r.last);
  if (run.outcome === 'passed') await keepScript(o, journey, text, run, writer);
}
/** The end state read back from the real system, never from a step's response; the planted runner reads the last response. */
async function readbacks(o: JourneyRunOptions, journey: Journey, url: string, run: JourneyRun, last: unknown): Promise<void> {
  for (const c of journey.endState.filter((x) => x.readback)) {
    let body: unknown;
    let why: string | null = null;
    try {
      if (o.plant === 'response-as-end-state') body = last;
      else { const res = await fetch(new URL(c.readback!.path, url), { method: c.readback!.method }); body = await res.json().catch(() => null); }
      if (c.equals !== undefined) {
        for (const [k, v] of Object.entries(c.equals as Record<string, unknown>)) if (JSON.stringify(at(body, k)) !== JSON.stringify(v)) { why = `${c.readback!.method} ${c.readback!.path} ${k} is ${JSON.stringify(at(body, k))}, expected ${JSON.stringify(v)}`; break; }
      }
      if (!why && c.count) {
        for (const [k, n] of Object.entries(c.count)) { const v = at(body, k); const have = Array.isArray(v) ? v.length : -1; if (have !== n) { why = `${c.readback!.method} ${c.readback!.path} holds ${have < 0 ? 'no list of' : have} ${k}, expected ${n}`; break; } }
      }
    } catch (error) { why = first((error as Error).message); }
    run.endState.push({ id: c.id, oracle: 'code', outcome: why ? 'failed' : 'passed', selector: null, box: null, screenshot: null, readback: body });
    run.testsRun += 1;
    if (why) { run.outcome = 'failed'; run.failures.push({ test: `${journey.id} › ${c.id}`, file: o.journey, line: c.line ?? 0, stack: null, assertion: true, message: why }); }
  }
}
/** A journey that passes is saved as a replayable script, a plain Playwright script with its values scrubbed. */
async function keepScript(o: JourneyRunOptions, journey: Journey, text: string, run: JourneyRun, writer: Writer): Promise<void> {
  const sink = writer.text({ kind: 'journey.script', source: o.run, redaction: 'complete', license: LICENSE, run: { env: o.secrets ?? {}, held: Object.values(o.secrets ?? {}) } });
  await sink.write(saveScript(journey, text, o.secrets ?? {}));
  const put = await sink.close();
  run.script = put.status === 'stored' ? put.evidence.sha256 : null;
  if (run.script) run.evidence.push(run.script);
}

/** A step's deadline; the planted runner sets it under its expect's timeout. */
const stepDeadline = (o: JourneyRunOptions, s: Journey['steps'][number]): number => (o.plant === 'deadline-under-expect' ? Math.floor(s.timeoutMs / 2) : s.deadlineMs);
const browserDeadline = (o: JourneyRunOptions, journey: Journey, extra: Internal): number =>
  journey.steps.reduce((sum, s) => sum + stepDeadline(o, s), 0) + 30_000 + journey.endState.length * 3000 + (extra.settle ? journey.steps.length * 5000 : 0);
/** A browser journey through the driver, its report read as the run's record and its files stored as evidence. */
async function runBrowser(o: JourneyRunOptions, journey: Journey, text: string, stack: Stack, run: JourneyRun, writer: Writer, scrub: (s: string) => string, records: StackRecords, swaps: string[], reducedMotion: 'reduce' | 'no-preference', extra: Internal, pre: Prestarted, reaping: Promise<void>[]): Promise<{ report: Report | null; render: Render | null }> {
  const plantedDeadline = o.plant === 'deadline-under-expect';
  const deadlineOf = (s: Journey['steps'][number]): number => stepDeadline(o, s);
  const job: Job = {
    url: stack.url, profile: { ...PROFILE, reducedMotion }, video: true, trace: true, settle: extra.settle ?? false, settleMs: 4000, hold: o.environment?.plant === 'swap-partway', masks: journey.masks.map((m) => toDriver(m)!),
    // The planted runner sets each step's deadline under its expect's timeout, so an element that never shows overruns the step.
    steps: journey.steps.map((s) => ({ id: s.id, line: s.line, deadlineMs: deadlineOf(s), timeoutMs: plantedDeadline ? s.timeoutMs : timeoutUnder(s.deadlineMs, s.timeoutMs), actions: s.actions, expects: s.expects })),
    endState: journey.endState.filter((c) => !c.readback).map((c) => ({ id: c.id, line: c.line, oracle: c.oracle, ...(c.driverLocator ? { locator: c.driverLocator } : {}), ...(c.text !== undefined ? { text: c.text } : {}), ...(c.visible !== undefined ? { visible: c.visible } : {}) })),
  };
  const deadline = browserDeadline(o, journey, extra);
  // The planted environment: once the first step has run, the stack's app is served from another tree, as a newer snapshot would be.
  const between = o.environment?.plant === 'swap-partway' ? async (out: string, report: () => Report | null, exited: () => boolean): Promise<void> => {
    const to = o.environment!.to;
    while (!exited() && !(report()?.steps.some((s) => s.endMs !== null))) await new Promise((r) => setTimeout(r, 50));
    if (exited()) return;
    await down(o.host, stack.run);
    const swap = newRun();
    swaps.push(swap);
    const listen = Object.values(stack.ports).map((p) => `127.0.0.1:${p}`);
    const started = await o.host.start({ run: swap, argv: ['/bin/sh', '-c', environmentBlock(to).up ?? 'exit 64', swap], cwd: to, grant: { run_as_you: true, listen, hosts: listen }, env: Object.fromEntries(Object.entries(stack.ports).map(([k, v]) => [k, String(v)])) });
    if (started.status === 'started') { records.processes.push({ name: 'sh', pid: started.pid, cwd: cwdOf(started.pid, to), reads: [] }); await healthy(stack.url, 10_000); }
    for (let i = 1; i < journey.steps.length; i++) writeFileSync(join(out, `go-${i}`), '');
  } : undefined;
  const driven = await drive({ host: o.host, run: o.run, job, deadline, pre, ...(o.secrets ? { secrets: o.secrets } : {}), ...(o.stop ? { stop: o.stop } : {}), ...(between ? { between } : {}) });
  // The tree the stack served, from the records of every process it ran, placed by the core: a run whose stack
  // served another tree is uncounted, naming the process and the tree; the planted runner takes the checkout it asked for.
  run.served = o.plant === 'checkout-as-asked' ? { served: 'checkout' } : attributeStack(records, o.trees);
  run.tree = run.served.served === 'checkout' ? treeDigest(o.checkout) : null;
  try {
    await record(o, journey, text, stack.url, run, driven, writer, scrub);
    return { report: driven.report, render: driven.report ? renderOf(driven) : null };
  } finally {
    // The driver's process is reaped with the stack's teardown, after the run's time: its report and files are read.
    reaping.push(driven.settled.then(() => discard(driven)));
  }
}
/** What a screen comparison reads of a run: each step's frame, stillness, elements and DOM, with the requests, bundle and timings. */
function renderOf(driven: DriverRun): Render {
  const report = driven.report!;
  const image = (name: string | null): Image | null => { const a = driven.artifacts.find((x) => x.name === name); try { return a ? decodePng(readFileSync(a.path)) : null; } catch { return null; } };
  return {
    captures: report.steps.map((s): Capture => ({ step: s.id, image: image(s.screenshot), still: s.still, unstable: s.unstable, elements: s.elements, dom: s.dom, tookMs: (s.endMs ?? s.startMs) - s.startMs })),
    requests: routesOf(report.requests), bundle: report.bundle,
  };
}

/** The report as the run's record: steps, end state, errors, failures, and every file as evidence by hash. */
async function record(o: JourneyRunOptions, journey: Journey, text: string, url: string, run: JourneyRun, driven: DriverRun, writer: Writer, scrub: (s: string) => string): Promise<void> {
  const report = driven.report;
  const file = o.journey;
  const stopped = driven.exit.cause === 'stop';
  const uncounted = run.served.served !== 'checkout';
  // Playwright's own time, as the driver counted it: what a plain Playwright script of the journey would spend in it.
  run.timing.playwright = report ? Math.round(report.playwright.own) : 0;
  if (driven.exit.failed) { run.outcome = 'missing'; run.cause = driven.exit.failed; return; }
  if (!report) { run.outcome = stopped ? 'stopped' : 'failed'; run.cause = `the driver wrote no report (exit ${driven.exit.code})`; run.failures.push({ test: journey.id, file, line: 0, stack: scrub(driven.exit.output.slice(-2000)) || null, assertion: false, message: run.cause }); return; }
  const incompleteFrom = report.redaction.state === 'incomplete' ? report.steps.findIndex((s) => s.id === report.redaction.since) : -1;
  const redactionOf = (i: number): Redaction => (incompleteFrom >= 0 && i >= incompleteFrom ? 'incomplete' : 'complete');
  run.redaction = incompleteFrom >= 0 ? 'incomplete' : 'complete';
  const bytes = (name: string | null): Uint8Array | null => { const a = driven.artifacts.find((x) => x.name === name); return a ? readFileSync(a.path) : null; };
  const store = async (name: string | null, kind: string, redaction: Redaction, extra: { steps?: { step: string; startMs: number; endMs: number }[] } = {}): Promise<string | null> => {
    const b = bytes(name);
    if (!b) return null;
    const put = await writer.put({ kind: uncounted ? `${kind}.uncounted` : kind, source: o.run, redaction, license: LICENSE, bytes: b, ...extra });
    return put.status === 'stored' ? put.evidence.sha256 : null;
  };
  // Evidence an uncounted run keeps stays in the record, marked uncounted, and never stands as the claim's evidence.
  const cite = (sha: string | null): void => { if (sha && !uncounted && !run.evidence.includes(sha)) run.evidence.push(sha); };
  const pageErrors: PageError[] = report.errors.map((e) => (e.kind === 'uncaught' ? { kind: 'uncaught', message: scrub(e.message), step: e.step ?? '' } : { kind: 'request', url: e.url, status: e.status, unfinished: e.unfinished, step: e.step ?? '' }));
  run.expectedErrors = pageErrors.filter((e) => expectedBy(journey, e));
  const failedErrors = pageErrors.filter((e) => !expectedBy(journey, e));
  const ran = new Map(report.steps.map((s) => [s.id, s]));
  const videoSteps = journey.steps.flatMap((s) => { const r = ran.get(s.id); return r && r.endMs !== null ? [{ step: s.id, startMs: r.startMs, endMs: r.endMs }] : []; });
  // Every file goes into the store at once, each put once, and is cited in the run's order as it lands.
  const puts = new Map<string, Promise<string | null>>();
  const once = (name: string | null, kind: string, redaction: Redaction, extra: { steps?: typeof videoSteps } = {}): Promise<string | null> => {
    const key = `${name}|${kind}|${redaction}`;
    let put = puts.get(key);
    if (!put) {
      put = store(name, kind, redaction, extra);
      // Each is awaited where it is cited; a store that fails is handled there, never left unhandled meanwhile.
      put.catch(() => undefined);
      puts.set(key, put);
    }
    return put;
  };
  const shots = journey.steps.map((s, i) => { const r = ran.get(s.id); return r ? once(r.screenshot, 'journey.screenshot', redactionOf(i)) : Promise.resolve(null); });
  const video = once(report.video, 'journey.video', run.redaction, { steps: videoSteps });
  // The trace holds every action's values, a typed secret among them, so it is incomplete once one was typed.
  const trace = once(report.trace, 'journey.trace', report.secretTyped ? 'incomplete' : run.redaction);
  run.steps = [];
  for (const [i, s] of journey.steps.entries()) {
    const r = ran.get(s.id);
    if (!r) { run.steps.push({ ...unrun(journey)[i]!, outcome: stopped ? 'stopped' : 'unrun' }); continue; }
    const screenshot = await shots[i]!;
    cite(screenshot);
    run.steps.push({
      id: s.id, outcome: r.outcome, startMs: r.startMs, endMs: r.endMs ?? r.startMs, route: r.route ? `${r.route.path}${r.route.query ? `?${r.route.query}` : ''}` : '', raw: r.route?.raw ?? '',
      controls: r.controls ?? { appeared: [], left: [], changed: [] }, screenshot, errors: pageErrors.filter((e) => e.step === s.id),
      animations: r.animations.filter((a) => a.target).map((a) => ({ target: a.target!, property: a.property, from: a.from, to: a.to, duration: a.duration ?? 0, delay: a.delay, easing: a.easing })),
      firstFrame: r.firstFrame,
    });
  }
  run.testsRun = report.steps.length;
  // The end-state screen is put once the steps' have landed, so a file both name keeps one kind, the step's.
  const ends = new Map(report.endState.map((r) => [r.id, once(r.screenshot, 'journey.end-state', run.redaction)]));
  const endFailures: JourneyRun['failures'] = [];
  for (const c of journey.endState) {
    const r = report.endState.find((e) => e.id === c.id);
    if (!r) continue;
    const screenshot = await ends.get(r.id)!;
    cite(screenshot);
    // A reading (a model's, or a person's to come) is never one of the tests the run ran.
    run.testsRun += r.outcome === 'reading' ? 0 : 1;
    const entry: EndStateRecord = { id: c.id, oracle: c.oracle, outcome: r.outcome, selector: c.locator ?? null, box: r.box, screenshot };
    if (c.oracle === 'model') {
      // The model reads only the requirement and the end step's redacted screen: the snapshot, and a screenshot only
      // when none of the run's is incomplete; never the steps before it or anyone's words about the run.
      if (o.model && c.requirement !== undefined) {
        const snapshot = scrub(r.snapshot ?? '');
        const reading = await o.model.read({ requirement: c.requirement, snapshot, screenshot: run.redaction === 'complete' ? bytes(r.screenshot) : null });
        const found = quoteIn(reading.quote, snapshot);
        entry.reading = { answer: reading.answer, quote: reading.quote, found, counted: !reading.answer && !found, sendBack: !reading.answer && found };
      }
      entry.outcome = 'reading';
    } else if (r.outcome === 'failed' && r.message) endFailures.push({ test: `${journey.id} › ${c.id}`, file, line: c.line ?? 0, stack: null, assertion: true, message: scrub(r.message) });
    run.endState.push(entry);
  }
  const allRan = report.steps.length === journey.steps.length && report.steps.every((s) => s.outcome === 'passed');
  if (allRan) await readbacks(o, journey, url, run, null);
  run.video = await video;
  run.trace = await trace;
  cite(run.video); cite(run.trace);
  const recording = writer.text({ kind: 'journey.recording', source: o.run, redaction: 'complete', license: LICENSE, run: { env: o.secrets ?? {}, held: Object.values(o.secrets ?? {}) } });
  await recording.write(JSON.stringify({ journey: journey.id, requests: report.requests.map((r) => ({ url: r.url, method: r.method, status: r.status, size: r.size, type: r.type, unfinished: r.unfinished })) }));
  const rec = await recording.close();
  run.recording = rec.status === 'stored' ? rec.evidence.sha256 : null;
  cite(run.recording);
  // The outcome, from the report: stopped, overran, failed on a step, failed on the page's own errors, failed on the end state, or passed.
  const overran = report.steps.find((s) => s.outcome === 'overran');
  const failedStep = report.steps.find((s) => s.outcome === 'failed');
  const fail = (test: string, line: number | null, assertion: boolean, message: string, stack: string | null = null): void => { run.failures.push({ test, file, line: line ?? 0, stack, assertion, message: scrub(message) }); };
  if (stopped) { run.outcome = 'stopped'; run.cause = 'the hub stopped the run'; }
  else if (driven.exit.cause === 'deadline' || overran) {
    run.outcome = 'overran';
    run.cause = overran ? overran.failure?.message ?? `step ${overran.id} overran its deadline` : 'the run overran its deadline';
    fail(`${journey.id} › ${overran?.id ?? journey.id}`, overran?.failure?.line ?? null, false, run.cause);
  } else if (failedStep?.failure?.outside) { run.outcome = 'missing'; run.cause = failedStep.failure.message; }
  else if (failedStep) {
    run.outcome = 'failed';
    const f = failedStep.failure!;
    fail(`${journey.id} › ${failedStep.id}`, f.line, f.assertion, f.message, f.stack ?? null);
  } else if (report.died) { run.outcome = 'failed'; run.cause = `the run died: ${first(report.died)}`; fail(journey.id, null, false, run.cause, scrub(report.died)); }
  else if (o.plant !== 'end-state-only' && failedErrors.length) {
    // The page's own errors fail the step they happened in, unless the journey declares them expected.
    run.outcome = 'failed';
    for (const e of failedErrors) {
      const step = run.steps.find((s) => s.id === e.step);
      if (step) step.outcome = 'failed';
      fail(`${journey.id} › ${e.step || 'page'}`, journey.steps.find((s) => s.id === e.step)?.line ?? null, false, e.kind === 'uncaught' ? `the page threw an uncaught error at step ${e.step}: ${e.message}` : `a request the page made at step ${e.step} ${e.unfinished ? 'never finished' : `answered ${e.status}`}: ${e.url}`);
    }
  } else if (run.failures.length || endFailures.length) run.outcome = 'failed';
  else if (!run.video) { run.outcome = 'failed'; run.cause = 'the run kept no video'; fail(journey.id, null, false, run.cause); }
  else if (!journey.steps.length && !journey.endState.length) { run.outcome = 'ran_nothing'; run.cause = 'the journey has no step and no end-state check'; }
  // A model's reading and a person's answer to come are never a pass: with no code check of the end state, nothing counted.
  else if (!run.endState.some((e) => e.oracle === 'code' && e.outcome === 'passed')) { run.outcome = 'uncounted'; run.mask = 'no code check of the end state ran: a model\'s reading or a person\'s answer never passes a journey on its own'; run.cause = run.mask; }
  else run.outcome = 'passed';
  run.failures.push(...endFailures);
  if (uncounted && run.outcome !== 'stopped') { run.outcome = 'uncounted'; run.mask = `the stack served another tree: ${run.served.served === 'checkout' ? '' : run.served.named}`; run.cause = run.mask; }
  if (run.outcome === 'passed') await keepScript(o, journey, text, run, writer);
  run.failures = run.failures.map((f) => ({ ...f, message: scrub(f.message), stack: f.stack === null ? null : scrub(f.stack) }));
}

/** A saved script replayed against the stack (a real run), or, with `recording`, answered from it (a recorded run). */
export async function replayJourney(o: JourneyRunOptions & { script: string; recording?: string }): Promise<JourneyRun | { status: 'refused'; reason: string }> {
  const text = Buffer.from(await o.evidence.read(o.script)).toString('utf8');
  const journey = embeddedJourney(text);
  if (!journey) return { status: 'refused', reason: 'the script carries no journey to replay' };
  if (o.recording !== undefined) return { status: 'refused', reason: 'a replay whose requests are answered from a recording is a recorded run, which can\'t pass a requirement at live depth; a run against the stack is a real run at journey depth' };
  // The journey the script carries, written outside the checkout so the tree the run cites stays the checkout's.
  const dir = mkdtempSync(join(tmpdir(), 'deep-replay-'));
  const file = join(dir, `${journey.id}.yaml`);
  writeFileSync(file, stringify(journey.doc));
  const { script: _script, recording: _recording, ...rest } = o;
  try {
    const run = await runJourney({ ...rest, journey: file });
    return { ...run, recorded: o.plant === 'every-replay-recorded', depth: 'journey' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The receipt for a step: the video, where to open it, and the line naming the tree the stack served. */
export function receiptFor(run: JourneyRun, step: string): { video: string; atMs: number; line: string } {
  const s = run.steps.find((x) => x.id === step);
  const tree = run.served.served === 'checkout' ? `tree ${run.tree ?? 'unknown'}` : `${run.served.served === 'other' ? `another tree, ${run.served.tree}` : 'a tree the records can\'t place'} (${run.served.named})`;
  return { video: run.video ?? '', atMs: s?.startMs ?? 0, line: `${step}: ${s?.outcome ?? 'unrun'} at ${s?.startMs ?? 0} ms, on a stack that served ${tree}` };
}
export function listFeatures(checkout: string): { features: Feature[]; withoutJourney: string[] } {
  const features = readFeatures(checkout).map((f) => ({ feature: f.id, name: f.name, files: f.files, journeys: f.journeys }));
  return { features, withoutJourney: features.filter((f) => !f.journeys.length).map((f) => f.feature) };
}
/** The changed features' journeys plus their nearest neighbors, the features that share changed files. */
export function selectJourneys(checkout: string, changed: string[]): { features: string[]; journeys: string[] } {
  const s = select(readFeatures(checkout), changed);
  return { features: s.changed, journeys: s.journeys };
}
/** The first step whose route or changes differ from the last PASS, or null. */
export function compareSteps(last: JourneyRun, next: JourneyRun, options: { plant?: Plant } = {}): { step: string | null; why: string | null } {
  return firstDiffering(last.steps, next.steps, options.plant === 'raw-url' ? 'raw-url' : undefined);
}
export function requirementCover(run: JourneyRun, requirement: Requirement, options: { plant?: Plant } = {}): Cover {
  const readings = run.endState.filter((e) => e.reading);
  const counted = run.endState.filter((e) => e.outcome === 'passed' && e.oracle !== 'model').map((e) => e.id);
  if (options.plant === 'reading-as-pass') counted.push(...readings.filter((e) => e.reading!.answer).map((e) => e.id));
  const reasons: string[] = [];
  const sendBack = readings.some((e) => e.reading!.sendBack);
  let wouldBe: Cover['wouldBe'];
  // The rows in the order the table ranks what this run can say: missing is BLOCKED; a run that can't decide, a
  // recorded one, or a requirement no counted check covers is INCONCLUSIVE; a failure the counted checks showed is FAIL.
  if (run.outcome === 'missing') { wouldBe = 'BLOCKED'; reasons.push(run.cause ?? 'the run is missing'); }
  else if (run.outcome === 'uncounted' || run.outcome === 'stopped') { wouldBe = 'INCONCLUSIVE'; reasons.push(run.mask ?? run.cause ?? run.outcome); }
  else if (run.recorded) { wouldBe = 'INCONCLUSIVE'; reasons.push(`a recorded run, answered from a recording, can't pass a requirement at ${requirement.depth} depth; it needs a real run`); }
  else if (!counted.length) { wouldBe = 'INCONCLUSIVE'; reasons.push(readings.length ? 'a model reading is never one of the assertions a check names; a requirement it alone covers waits on one taste call' : 'no counted check covers the requirement'); }
  else if (run.outcome === 'failed' || run.outcome === 'overran') { wouldBe = 'FAIL'; reasons.push(run.failures[0]?.message ?? run.outcome); }
  else wouldBe = 'PASS';
  const reading = readings[0];
  const ask: TasteAsk | undefined = wouldBe === 'INCONCLUSIVE' && reading && !counted.length ? { kind: 'taste', screenshot: reading.screenshot ?? run.steps.map((s) => s.screenshot).filter(Boolean).at(-1) ?? '', reading: `the model read "${requirement.req}" as ${reading.reading!.answer}, quoting "${reading.reading!.quote}"` } : undefined;
  return { counted, wouldBe, reasons, ...(ask ? { ask } : {}), sendBack };
}
/** Two PNGs, equal only when every pixel outside the masks is equal; a size change is a difference. */
export function comparePixels(base: Uint8Array, head: Uint8Array, masks: Box[], options: { plant?: Plant } = {}): { equal: boolean; boxes: Box[]; sizeChanged: boolean } {
  const c = compareImages(paintMasks(decodePng(head), masks), paintMasks(decodePng(base), masks), options.plant === 'tolerates-16-pixels' ? { tolerance: 16 } : {});
  return c.same ? { equal: true, boxes: [], sizeChanged: false } : { equal: false, boxes: c.reason === 'pixels' ? c.boxes : [], sizeChanged: c.reason === 'size' };
}

// ---- Screens: the journey's screens on the head against the merge base rendered here, twice, under the same profile.
const masksOf = (spec: string): JourneyLocator[] => {
  try { return parseJourney(readFileSync(spec, 'utf8')).masks; } catch { return []; }
};
interface Kept { captures: (Omit<Capture, 'image'> & { file: string | null })[]; requests: Record<string, number>; bundle: Record<string, number> }
function keepRender(dir: string, n: number, render: Render): void {
  mkdirSync(dir, { recursive: true });
  const kept: Kept = { captures: render.captures.map((c, i) => { const file = c.image ? `render-${n}-${i}.png` : null; if (c.image && file) writeFileSync(join(dir, file), encodePng(c.image)); const { image: _image, ...rest } = c; return { ...rest, file }; }), requests: render.requests, bundle: render.bundle };
  writeFileSync(join(dir, `render-${n}.json`), JSON.stringify(kept));
}
function loadRender(dir: string, n: number): Render | null {
  const file = join(dir, `render-${n}.json`);
  if (!existsSync(file)) return null;
  // A kept render that can't be read back is rendered again, never trusted.
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Kept;
    return { captures: kept.captures.map(({ file: f, ...c }) => ({ ...c, image: f ? decodePng(readFileSync(join(dir, f))) : null })), requests: kept.requests, bundle: kept.bundle };
  } catch { return null; }
}
export async function compareScreens(o: ScreenOptions): Promise<ScreenResult> {
  const masks = masksOf(o.spec);
  const profile = PROFILE;
  const dir = join(o.cache, renderKey(o.base.commit, o.journey, environmentOf(profile), toolsOf(), hostname()));
  // A side's screens count only from a run that passed: a journey that failed, overran or never ran its steps rendered no screen to compare.
  const render = async (checkout: string): Promise<Render | { cause: string }> => {
    const ran = await runInternal({ host: o.host, evidence: o.evidence, run: newRun(), checkout, journey: o.journey, trees: { checkout, worktree: '', others: [], digests: {} } }, { settle: true, masks });
    if (ran.run.outcome !== 'passed' || !ran.render) return { cause: `the journey ${ran.run.outcome}: ${ran.run.cause ?? ran.run.failures[0]?.message ?? 'no record'}` };
    return ran.render;
  };
  const renders = { base: 0, head: 0 };
  const invalid = (named: string): ScreenResult => ({ outcome: 'INVALID', named: [named], differences: [], deltas: [], screens: [], sideBySide: null, highlighted: null, taste: false, renders, spec: o.spec });
  let base: [Render, Render];
  const cached = [loadRender(dir, 1), loadRender(dir, 2)];
  if (cached[0] && cached[1]) base = [cached[0], cached[1]];
  else {
    const r1 = await render(o.base.checkout); renders.base++;
    if ('cause' in r1) return invalid(`the base couldn't be rendered: ${r1.cause}`);
    const r2 = await render(o.base.checkout); renders.base++;
    if ('cause' in r2) return invalid(`the base couldn't be rendered: ${r2.cause}`);
    keepRender(dir, 1, r1); keepRender(dir, 2, r2);
    base = [r1, r2];
  }
  const head = await render(o.head.checkout); renders.head++;
  if ('cause' in head) return invalid(`the head couldn't be rendered: ${head.cause}`);
  if (!head.captures.length) return invalid('the journey captured no screen');
  const writer = o.evidence.connect({ role: 'deepbuild', via: 'journey' });
  const put = async (image: Image | null, kind: string): Promise<string> => {
    if (!image) return '';
    const r = await writer.put({ kind, source: o.journey, redaction: 'complete', license: LICENSE, bytes: encodePng(image) });
    return r.status === 'stored' ? r.evidence.sha256 : '';
  };
  const result: ScreenResult = { outcome: 'passed', named: [], differences: [], deltas: [], screens: [], sideBySide: null, highlighted: null, taste: false, renders, spec: o.spec };
  // One ask per mask: a region that keeps moving on every screen is asked about once, and the mask you say yes to
  // applies to the screens after it in this comparison too.
  const asked = new Set<string>();
  for (const h of head.captures) {
    const b = base.map((r) => r.captures.find((c) => c.step === h.step));
    if (!b[0] || !b[1]) return { ...result, outcome: 'INVALID', named: [`the base rendered no screen for step ${h.step}`] };
    const bs: [Capture, Capture] = [b[0], b[1]];
    const sides = [h, ...bs];
    result.screens.push({ step: h.step, base: [await put(bs[0].image, 'journey.screen.base'), await put(bs[1].image, 'journey.screen.base')], head: await put(h.image, 'journey.screen') });
    // Masks, resolved on each side among the elements it recorded; one that matches nothing, or more than one, is INVALID naming it.
    const boxes: Box[][] = [];
    for (const [i, side] of sides.entries()) {
      const own: Box[] = [];
      for (const m of masks) {
        const r = resolveMask(side.elements, m);
        if (r.count !== 1) return { ...result, outcome: 'INVALID', named: [`the mask ${describeLocator(m)} matches ${r.count === 0 ? 'nothing' : `${r.count} elements`} on ${i === 0 ? 'the head' : 'the base'} at step ${h.step}`] };
        own.push(r.box!);
      }
      boxes.push(own);
    }
    const all = boxes.flat();
    // The base decides only where it holds still and its two renders agree outside the masks.
    const unstableBase = bs.find((c) => !c.still && !masked(c.unstable, all));
    const region = unstableBase ? unstableBase.unstable : bs[0].image && bs[1].image ? baseDisagreement(paintMasks(bs[0].image, all), paintMasks(bs[1].image, all), []) : null;
    if (unstableBase || region) {
      const message = unstableBase ? `the base screen at step ${h.step} never holds still${region ? ` at ${region.x}, ${region.y} (${region.width}×${region.height})` : ''}` : `the base screen at step ${h.step} differs between its two renders at ${region!.x}, ${region!.y} (${region!.width}×${region!.height})`;
      if (o.plant === 'unstable-base-as-difference') { result.outcome = 'failed'; result.named.push(message); result.differences.push({ step: h.step, boxes: region ? [region] : [], sizeChanged: false }); continue; }
      const mask = region ? smallestHolding(bs[0].elements, region) : null;
      result.outcome = 'uncounted';
      result.named.push(message);
      if (mask && region && !asked.has(JSON.stringify(mask))) {
        asked.add(JSON.stringify(mask));
        const screenshot = result.screens.at(-1)!.base[0];
        if (await o.answer({ kind: 'taste', step: h.step, region, mask, screenshot })) {
          let doc: Record<string, unknown> = {};
          try { doc = (parse(readFileSync(o.spec, 'utf8')) as Record<string, unknown> | null) ?? {}; } catch { /* a spec not written yet starts with the mask */ }
          doc.masks = [...(Array.isArray(doc.masks) ? doc.masks : []), mask];
          writeFileSync(o.spec, stringify(doc));
          masks.push(mask);
          result.named.push(`mask ${describeLocator(mask)} saved to ${o.spec}`);
        }
      }
      continue;
    }
    if (!h.still && !masked(h.unstable, all)) {
      result.outcome = 'failed';
      result.named.push(`the head screen at step ${h.step} never holds still where the base did${h.unstable ? `, at ${h.unstable.x}, ${h.unstable.y}` : ''}`);
      result.differences.push({ step: h.step, boxes: h.unstable ? [h.unstable] : [], sizeChanged: false });
      continue;
    }
    if (!h.image || !bs[0].image) { result.outcome = 'INVALID'; result.named.push(`the screen at step ${h.step} wasn't captured`); continue; }
    const c = compareImages(paintMasks(h.image, all), paintMasks(bs[0].image, all));
    if (!c.same) {
      const dboxes = c.reason === 'pixels' ? c.boxes : [{ x: 0, y: 0, width: Math.max(c.head.width, c.base.width), height: Math.max(c.head.height, c.base.height) }];
      result.differences.push({ step: h.step, boxes: dboxes, sizeChanged: c.reason === 'size' });
      result.deltas.push({ kind: 'screen', step: h.step, what: c.reason === 'size' ? `the screen's size, ${c.base.width}×${c.base.height} to ${c.head.width}×${c.head.height}` : `${c.differing} pixels in ${dboxes.map((x) => `${x.x},${x.y} ${x.width}×${x.height}`).join('; ')}`, base: result.screens.at(-1)!.base[0], head: result.screens.at(-1)!.head });
      result.named.push(`step ${h.step}: ${dboxes.map((x) => `box ${x.x},${x.y} ${x.width}×${x.height}`).join(', ')}`);
      if (!result.sideBySide) {
        result.sideBySide = await put(sideBySide(bs[0].image, h.image, dboxes), 'journey.screen.side-by-side');
        result.highlighted = await put(highlight(h.image, dboxes), 'journey.screen.highlighted');
      }
    }
    const dom = domDelta(bs[0].dom, h.dom);
    if (dom) result.deltas.push({ kind: 'dom', step: h.step, what: `${dom.head} (base: ${dom.base})`, base: dom.base, head: dom.head });
    if (h.tookMs > bs[0].tookMs * 1.5 + 250) result.deltas.push({ kind: 'timing', step: h.step, what: 'the step took longer', base: bs[0].tookMs, head: h.tookMs });
  }
  for (const k of new Set([...Object.keys(base[0].requests), ...Object.keys(head.requests)])) if ((base[0].requests[k] ?? 0) !== (head.requests[k] ?? 0)) result.deltas.push({ kind: 'request', what: k, base: base[0].requests[k] ?? 0, head: head.requests[k] ?? 0 });
  for (const k of new Set([...Object.keys(base[0].bundle), ...Object.keys(head.bundle)])) if (base[0].bundle[k] !== head.bundle[k]) result.deltas.push({ kind: 'bundle', what: k, base: base[0].bundle[k] ?? null, head: head.bundle[k] ?? null });
  if (result.outcome === 'passed' && result.differences.length) {
    // A difference fails a "no visible change" requirement; for any other it is evidence for the taste call, and a screen never passes one.
    if (o.requirement === 'no-visible-change') result.outcome = 'failed';
    else { result.outcome = 'uncounted'; result.taste = true; }
  }
  return result;
}

export async function latencyCheck(o: { host: Host; evidence: EvidenceStore; journey: string; base: string; head: string; runs: number; margin: string }): Promise<Latency> {
  const margin = Number(o.margin.replace('%', '')) / 100;
  // Only a run that passed has a time: a side whose run failed or never ran has none, and the check can't pass on it.
  const unrun: string[] = [];
  const side = async (name: string, checkout: string): Promise<number[]> => {
    const times: number[] = [];
    for (let i = 0; i < o.runs; i++) {
      const run = await runJourney({ host: o.host, evidence: o.evidence, run: newRun(), checkout, journey: o.journey, trees: { checkout, worktree: '', others: [], digests: {} } });
      if (run.outcome !== 'passed') { unrun.push(`the ${name}'s run ${i + 1} ${run.outcome}: ${run.cause ?? run.failures[0]?.message ?? ''}`); continue; }
      times.push(run.steps.reduce((ms, s) => ms + (s.endMs - s.startMs), 0));
    }
    return times;
  };
  const base = await side('base', o.base);
  const head = await side('head', o.head);
  if (unrun.length) return { outcome: 'failed', base, head, shown: unrun.join('; ') };
  const judged = judgeLatency(head, base, margin);
  return { outcome: judged.outcome === 'passed' ? 'passed' : 'failed', base, head, shown: judged.message };
}
/** A motion journey run twice, with reduced motion off and on. */
export async function motionCheck(o: JourneyRunOptions): Promise<Motion> {
  const normal = await runJourney({ ...o, reducedMotion: 'no-preference' });
  const reduced = await runJourney({ ...o, run: newRun(), reducedMotion: 'reduce' });
  let steps: Journey['steps'] = [];
  try { steps = parseJourney(journeyText(o.checkout, o.journey)).steps; } catch { /* the runs above carry the file's failure */ }
  const named: string[] = [];
  let outcome: Motion['outcome'] = 'passed';
  for (const step of steps) {
    if (!step.motion.length) continue;
    const n = normal.steps.find((s) => s.id === step.id), r = reduced.steps.find((s) => s.id === step.id);
    const byTarget = new Map<string, typeof step.motion>();
    for (const m of step.motion) { const k = JSON.stringify(m.target); byTarget.set(k, [...(byTarget.get(k) ?? []), m]); }
    for (const reqs of byTarget.values()) {
      const target = reqs[0]!.target;
      const a = assertMotion(n?.animations ?? [], { target, properties: Object.fromEntries(reqs.map((m) => [m.property, { from: m.from, to: m.to }])), durationMs: reqs[0]!.duration, delayMs: reqs[0]!.delay, easing: reqs[0]!.easing });
      if (a.outcome === 'failed') { outcome = 'failed'; named.push(a.message); }
      else if (a.outcome === 'INCONCLUSIVE') { if (outcome !== 'failed') outcome = 'inconclusive'; named.push(a.message); }
      const still = assertReducedMotion(r?.animations ?? [], target);
      if (still.outcome === 'failed') { outcome = 'failed'; named.push(still.message); }
    }
  }
  if (normal.outcome !== 'passed' && outcome === 'passed') { outcome = 'failed'; named.push(normal.failures[0]?.message ?? `the journey ${normal.outcome}`); }
  // A reduced-motion run that never reached the step recorded no animation; that silence is no proof it stayed still.
  if (reduced.outcome !== 'passed' && outcome === 'passed') { outcome = 'inconclusive'; named.push(`with reduced motion the journey ${reduced.outcome}: ${reduced.cause ?? reduced.failures[0]?.message ?? ''}`); }
  return { normal, reduced, outcome, named };
}
/** Playwright's own time in a run, ms (AC16). */
export const playwrightTime = (run: JourneyRun): number => run.timing.playwright;

/** The check.kind@1 fill (#13, kit from #314) for the kind `journey`: a journey spec runs a journey; the kit's command cases run as the command kind does. */
export function journeyCheckKind(host: Host): CheckRunnerFill {
  return {
    slot: 'check.kind@1', revision: 1, kind: 'journey',
    run: async (spec, ctx): Promise<CheckResult> => {
      if (spec.kind !== 'journey') {
        const r = await runCommandCheck({ host, run: newRun(), spec, checkout: ctx.checkout, deadline: ctx.deadline });
        return { outcome: r.outcome, testsRun: r.testsRun, failures: r.failures, evidence: r.evidence, read: r.read, mask: r.mask };
      }
      const evidence = await openEvidenceStore({ root: join(ctx.checkout, '.deepbuild', 'evidence') });
      const run = await runJourney({ host, evidence, run: newRun(), checkout: ctx.checkout, journey: spec.runner, trees: { checkout: ctx.checkout, worktree: '', others: [], digests: {} } });
      return { outcome: run.outcome, testsRun: run.testsRun, failures: run.failures, evidence: run.evidence, read: [spec.runner, ...spec.inputs], mask: run.mask };
    },
  };
}
