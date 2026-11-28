// Tools for the criteria read in the app's real, shown window (README: `deep-show live`): the scenario as #1551's
// and #140's suites send it, one run and its answer, the still minute's judge (criterion 4), the planted Notification
// Center and the withdrawals' judge (criterion 6), and a 300-frame animation's reading (criterion 7). Nothing here
// stands in for the window, its display link, the renderer or the notification code under test.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocked, clip, FIXTURES, inconclusive, REPO, SUITE, tempDir, tilde } from './common.mjs';

/** The issue's numbers. */
export const STILL_MS = 60_000;
export const WITHDRAWALS = 20;
export const CENTER_CALL_S = 2;
export const FRAMES = 2;
export const ANIMATION_FRAMES = 300;
export const DRAWABLE_WAIT_MS = 4;

const SESSION = 's1', PANEL = 'main';
const asAgent = (doc) => {
  const sent = structuredClone(doc);
  delete sent.id;
  delete sent.layers;
  for (const item of Object.values(sent.items)) delete item.layer;
  return sent;
};
/** The canvas-idle lane's still board as an agent sends it, labelled in words alone, as #1551's redraft labels it. */
export function stillBoard() {
  const doc = asAgent(JSON.parse(readFileSync(join(REPO, 'benchmarks/canvas/still.json'), 'utf8')));
  doc.items.label.params.text = 'Quarterly revenue';
  return doc;
}
/** A four-second film that loops: #140's moving film, kept in this suite's fixtures. */
export const film = () => asAgent(JSON.parse(readFileSync(join(FIXTURES, 'film.json'), 'utf8')));

/** One frame of the scenario's virtual clock at 60 Hz, in flicks (705,600,000 a second). */
const FRAME = 705_600_000 / 60;

/**
 * A `deep-show live` scenario (#393, #376, #140, #1551): one document in the main panel at t = 0, then `live`, and
 * `planted` for a wrong program. The still board is sent as #1551's suite sends it; the film as #140's sends it, with
 * the panel's `presented` call ten frames on, so its first revision has been presented.
 */
export function scenario(doc, live, planted) {
  const [width, height] = doc.size;
  const moving = doc.transport !== undefined;
  return {
    sessions: { [SESSION]: { thread: 'thread-a', name: 'agent-a', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }],
    panels: { [PANEL]: { rect: [0, 0, width, height] } },
    docs: { doc: { panel: PANEL } },
    window: [width, height + 40],
    clock: { refresh_hz: 60, lead: 0, check: 0 },
    calls: [{ call: 'deep_show', session: SESSION, doc: 'doc', document: doc, at: 0 }, ...(moving ? [{ call: 'presented', panel: PANEL, at: 10 * FRAME }] : [])],
    live,
    ...(planted ? { planted } : {}),
  };
}

/**
 * One `deep-show live` run: the app's real, shown window, one answer line, exit 0. Returns the answer's `live`. A
 * machine that can't show a window answers `no_display`, which is INCONCLUSIVE here; any other refusal fails.
 */
export function liveRun(bin, sent, { env = {}, timeoutMs = 600_000 } = {}) {
  const evidence = tempDir('evidence');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['live'], { cwd: REPO, input: `${JSON.stringify({ ...sent, evidence })}\n`, encoding: 'utf8', maxBuffer: 1 << 28, timeout: timeoutMs, killSignal: 'SIGKILL', env: { ...process.env, ...env } });
  const said = tilde(`stdout: ${clip(run.stdout ?? '', 1500)}; stderr: ${clip((run.stderr ?? '').slice(-2000), 2000)}`);
  if (run.error?.code === 'ETIMEDOUT') throw Error(`deep-show live didn't finish within ${timeoutMs} ms; ${said}`);
  if (run.error) blocked(`deep-show live could not run: ${run.error.message}`);
  const lines = (run.stdout ?? '').split('\n').filter((line) => line.trim());
  if (run.status !== 0 || lines.length !== 1) throw Error(`deep-show live exited ${run.status} ${run.signal ?? ''} with ${lines.length} answer lines; ${said}`);
  let answer;
  try { answer = JSON.parse(lines[0]); } catch { throw Error(`deep-show live answered no JSON; ${said}`); }
  if (answer?.ok === false && ['no_display', 'unsupported_platform'].includes(answer.code)) inconclusive(`deep-show live could not show a window here (${answer.code}); this needs a Mac with a display, logged in, its screen on`);
  if (answer?.ok !== true || typeof answer.live !== 'object' || answer.live === null) throw Error(`deep-show live refused the scenario: ${clip(lines[0], 1500)}`);
  return answer.live;
}

const number = (value, what) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${what} is no number: ${JSON.stringify(value ?? null)}`);
  return value;
};

/** #1551's reading of the window over the run: one that wasn't shown throughout says nothing of a shown window. */
export function requireShown(live, what) {
  const state = live.window?.state;
  if (typeof state !== 'string') throw Error(`${what}: the answer has no live.window.state: ${clip(JSON.stringify(live.window ?? null), 300)}`);
  if (state !== 'shown') inconclusive(`${what}: the window was ${state} during the run (shown ${Math.round(Number(live.window.shown_ms))} ms), so it says nothing of a shown window`);
}

/** A whole number as a message may print it: plain or grouped by threes, never part of a longer number. */
export function mentions(text, n) {
  const digits = String(Math.trunc(n)), head = digits.length % 3 || 3;
  const groups = [digits.slice(0, head)];
  for (let at = head; at < digits.length; at += 3) groups.push(digits.slice(at, at + 3));
  return RegExp(`(?<![\\d.])${groups.join('[,_ \\u2009\\u202f]?')}(?![\\d])`).test(text);
}

/** Criterion 4's check: a sentence naming the request-frame callbacks the still minute ran, or null for none. */
export function stillProblem(live) {
  const count = live.request_frames;
  if (!Number.isSafeInteger(count) || count < 0) throw Error(`the answer has no live.request_frames count: ${JSON.stringify(count ?? null)}`);
  return count === 0 ? null : `the still window ran ${count} request-frame callbacks in ${STILL_MS / 1000} s`;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6: the planted Notification Center (planted-center.m), put into a run by the loader.

/** The planted center, built once: a library the loader inserts into `deep-show`, and the log it writes its calls to. */
export function plantedCenter() {
  if (process.platform !== 'darwin') blocked(`Notification Center is macOS's; this is ${process.platform}`);
  const dir = tempDir('center');
  const [library, log] = [join(dir, 'planted-center.dylib'), join(dir, 'calls.jsonl')];
  const made = spawnSync('clang', ['-dynamiclib', '-fno-objc-arc', '-framework', 'Foundation', '-framework', 'UserNotifications', '-o', library, join(SUITE, 'planted-center.m')], { encoding: 'utf8' });
  if (made.error || made.status !== 0) blocked(`the planted Notification Center doesn't build (clang): ${made.error?.message ?? tilde(clip(made.stderr, 1500))}`);
  return { env: { DYLD_INSERT_LIBRARIES: library, DEEP_3502_CENTER_LOG: log }, log };
}

/** What the planted center logged: whether it was planted in the process, and each call's start with its thread. */
export function centerCalls(log) {
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { planted: lines.some(({ phase }) => phase === 'planted'), begun: lines.filter(({ phase }) => phase === 'begin') };
}

const WITHDRAWS = ['removePendingNotificationRequestsWithIdentifiers:', 'removeDeliveredNotificationsWithIdentifiers:'];

/**
 * Criterion 6's check on one run: `wake` is the answer's entry for the `withdrawals` wake, `calls` the planted
 * center's log. `waited` names each call of the center the UI thread made and so waited in; `late` says how far past
 * 2 frames the input's frame came, or null when it came within them. BLOCKED when the run never reached the center.
 */
export function judgeWithdrawals(wake, calls) {
  if (!calls.planted) blocked("the planted Notification Center wasn't in the run: the loader didn't insert it (a hardened build refuses one)");
  const withdrawals = calls.begun.filter(({ call }) => WITHDRAWS.includes(call));
  if (!withdrawals.length) blocked('no withdrawal reached the planted Notification Center, so the run says nothing of a slow one');
  const onMain = withdrawals.filter(({ main_thread: main }) => main);
  const waited = onMain.length
    ? [`the UI thread made ${onMain.length} of the planted center's calls, each ${CENTER_CALL_S} s to return, and waited in them: ${WITHDRAWS.map((call) => `${call} × ${onMain.filter((each) => each.call === call).length}`).join(', ')}`]
    : [];
  const [requested, refresh] = [number(wake?.requested_ns, 'the withdrawals wake: requested_ns'), number(wake?.refresh_ns, 'the withdrawals wake: refresh_ns')];
  let late = null;
  if (wake.presented_ns === null || wake.presented_ns === undefined) late = "no frame that read the input was presented before the run ended";
  else {
    const frames = (number(wake.presented_ns, 'the withdrawals wake: presented_ns') - requested) / refresh;
    if (frames <= 0) throw Error(`the input's frame ${wake.frame_seq} presented at ${wake.presented_ns} ns, before the input arrived at ${requested} ns`);
    if (frames > FRAMES) late = `the input's frame ${wake.frame_seq} presented ${frames.toFixed(2)} frames (${((wake.presented_ns - requested) / 1e6).toFixed(1)} ms) after the input arrived, past ${FRAMES} frames`;
  }
  return { waited, late };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: a 300-frame animation's reading, from the present times the carried hook reports.

/**
 * The film's span, in ns, from its own `transport.span`. The film loops: its first pass is the window's launch, and
 * the 300 frames read are the first presented once that pass is over.
 */
export function filmSpanNs() {
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(film().transport?.span ?? '')?.[1];
  if (!seconds) blocked('fixtures/film.json names no transport.span in seconds');
  return Number(seconds) * 1e9;
}

/**
 * One run's reading: how many of the display's refreshes 300 presented frames span (300 at the display's rate), and
 * the longest any of them waited for its drawable, in ms. The 300 are the first presented `leadInNs` or more after the
 * film's first frame. INCONCLUSIVE for a window that wasn't shown and focused throughout.
 */
export function animationReading(live, what, leadInNs = filmSpanNs()) {
  requireShown(live, what);
  if (live.window.focused !== true) {
    if (live.window.focused !== false) throw Error(`${what}: the answer has no live.window.focused: ${JSON.stringify(live.window.focused ?? null)}`);
    inconclusive(`${what}: the app's window wasn't the focused one throughout, and a window that isn't is capped by design`);
  }
  const hz = number(live.display?.refresh_hz, `${what}: live.display.refresh_hz`), period = 1e9 / hz;
  const all = Array.isArray(live.frames) ? live.frames : [];
  const from = all.length ? number(all[0].presented_ns, `${what}: frames[0].presented_ns`) + leadInNs : 0;
  const frames = all.filter((frame) => frame.presented_ns >= from);
  if (frames.length < ANIMATION_FRAMES) throw Error(`${what}: the animation presented ${frames.length} frames in the watch after the film's first pass of ${leadInNs / 1e9} s (${all.length} in all), fewer than ${ANIMATION_FRAMES}`);
  const first = frames.slice(0, ANIMATION_FRAMES).map((frame, index) => ({
    seq: frame.frame_seq, presented: number(frame.presented_ns, `${what}: frames[${index}].presented_ns`),
    paced: number(frame.refresh_ns, `${what}: frames[${index}].refresh_ns`), wait: number(frame.drawable_wait_ns, `${what}: frames[${index}].drawable_wait_ns`),
  }));
  const stray = first.find(({ paced, wait }, index) => Math.abs(paced - period) > 0.01 * period || wait < 0 || (index && first[index].presented <= first[index - 1].presented));
  if (stray) throw Error(`${what}: frame ${stray.seq} isn't a frame paced at the display's ${hz} Hz in presented order with a wait of 0 or more: ${JSON.stringify(stray)}`);
  const slowest = first.reduce((worst, frame) => (frame.wait > worst.wait ? frame : worst));
  return { hz, refreshes: Math.round((first.at(-1).presented - first[0].presented) / period) + 1, worstWaitMs: slowest.wait / 1e6, slowest: slowest.seq };
}

/**
 * "The merge base's reading is recorded beside it": the record (README: The records) holds a reading of the head and
 * one of the merge base, taken on one reference Mac, each of five runs with the refreshes its 300 frames spanned and
 * the longest wait for a drawable. `models` are the reference Macs' models.
 */
export function judgeFrameRecord(text, models, path) {
  if (text === null) return [`no reading is recorded: no ${path}`];
  let readings;
  try { readings = JSON.parse(text).readings; } catch { readings = null; }
  if (!Array.isArray(readings)) return [`${path} isn't {"readings": [{"side", "commit", "machine", "display_hz", "runs"}]}`];
  const failures = [];
  const sound = readings.filter((reading, index) => {
    const what = `${path}: readings[${index}]`;
    const before = failures.length;
    if (!['head', 'merge-base'].includes(reading?.side)) failures.push(`${what}.side is neither "head" nor "merge-base": ${JSON.stringify(reading?.side ?? null)}`);
    if (!/^[0-9a-f]{40}$/.test(reading?.commit ?? '')) failures.push(`${what}.commit is no commit`);
    if (!models.includes(reading?.machine)) failures.push(`${what}.machine is ${JSON.stringify(reading?.machine ?? null)}, none of the reference Macs' models (${models.join(', ')})`);
    if (!(reading?.display_hz > 0)) failures.push(`${what}.display_hz is no rate`);
    const runs = Array.isArray(reading?.runs) ? reading.runs : [];
    if (runs.length !== 5 || runs.some((run) => !Number.isSafeInteger(run?.refreshes) || run.refreshes < ANIMATION_FRAMES || !(run?.worst_wait_ms >= 0))) failures.push(`${what}.runs isn't five runs, each with the refreshes its ${ANIMATION_FRAMES} frames spanned and its worst_wait_ms`);
    return failures.length === before;
  });
  const beside = sound.filter(({ side }) => side === 'head').some((head) => sound.some((base) => base.side === 'merge-base' && base.machine === head.machine && base.commit !== head.commit));
  if (!failures.length && !beside) failures.push(`${path} holds no reading of the head with the merge base's beside it, taken on the same reference Mac`);
  return failures;
}
