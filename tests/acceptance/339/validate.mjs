// Shared by the #339 acceptance tests: reads the trusted-input spike's record (docs/spikes/339/record.json),
// the files it names and the technical design, and recomputes what a test can recompute instead of taking
// the spike's word: the press run's counts from its kept output, the held frame's hash and PNG header, the
// cursor-window recording's hash and duration from its container, and the sender decision's text in the
// Decided row. The live tests run the record's commands and read the same report line those print.
// Each check returns a list of problems; an empty list means it holds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'docs/spikes/339/record.json';
export const DESIGN = 'docs/technical-design.md';
export const CARD_ROW = '| Clicks on the question card |';

// Criterion IDs, by the rule in tests/acceptance/48/README.md.
export const NO_FRAME = '#339.8d46a78e';
export const SENDER = '#339.da6a6508';

export const MIN_PRESSES = 200;
// "A small window that follows the cursor": at most this many points on a side.
export const MAX_WINDOW_POINTS = 400;
// A screen recording of the window following the cursor is at least this long.
export const MIN_RECORDING_MS = 2000;
export const PERMISSION_STATES = ['granted', 'denied', 'undetermined'];
// The two rules the design's Decided row leaves open for VoiceOver's own actions on the card: they answer it
// directly where macOS names their sender, and only after the OS confirms you where it can't.
export const RULES = { named: 'direct', unnamed: 'confirm' };
const CITATION_URL = /^https:\/\/[^\s]+$/;
const CITATION_HEADER = /^[A-Za-z][A-Za-z0-9]*\/[A-Za-z][A-Za-z0-9+]*\.h$/;
// The row no longer waits on the spike once the answer is written.
const OPEN_QUESTION = /spike finds/i;
// A sentence that denies the sender is named: a negation and "name", "sender" or "client" in the same sentence.
const NEGATED = /\b(can't|cannot|can not|doesn't|does not|isn't|is not|never|no|not)\b[^.]*\b(name[sd]?|sender|client)\b/i;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const list = (value) => (Array.isArray(value) ? value : []);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
const count = (value) => Number.isInteger(value) && value >= 0;
const argv = (value) => Array.isArray(value) && value.length > 0 && value.every(nonEmpty);

export function loadRecord(path = join(root, RECORD)) {
  if (!existsSync(path)) assert.fail(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function git(repo, ...args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const tracked = (repo, path) => nonEmpty(path) && !path.startsWith('/') && !path.split('/').includes('..') && git(repo, 'ls-files', '--error-unmatch', '--', path).status === 0;
const readTracked = (repo, path) => readFileSync(join(repo, path));

// ------------------------------------------------------------------ file headers

export function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Walks the atoms of an ISO base media file (a .mov or .mp4) between `start` and `end`.
function* atoms(bytes, start = 0, end = bytes.length) {
  let at = start;
  while (at + 8 <= end) {
    let size = bytes.readUInt32BE(at), header = 8;
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    if (size === 1) { if (at + 16 > end) return; size = Number(bytes.readBigUInt64BE(at + 8)); header = 16; }
    else if (size === 0) size = end - at;
    if (size < header || at + size > end) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}

// The movie's duration in milliseconds from its `moov/mvhd` atom, or null when the bytes aren't such a file.
export function movieDurationMs(bytes) {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  for (const atom of atoms(bytes)) {
    if (atom.type !== 'moov') continue;
    for (const inner of atoms(bytes, atom.body, atom.end)) {
      if (inner.type !== 'mvhd') continue;
      const version = bytes[inner.body];
      if (version === 0 && inner.end - inner.body >= 20) return (bytes.readUInt32BE(inner.body + 16) * 1000) / bytes.readUInt32BE(inner.body + 12);
      if (version === 1 && inner.end - inner.body >= 32) return (Number(bytes.readBigUInt64BE(inner.body + 24)) * 1000) / bytes.readUInt32BE(inner.body + 20);
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------ the press run's report

// The commands the record names print, as their last line of JSON on stdout, one report:
// {"spike": 339, "mode": "synthetic" | "held", "presses": n, "frames": n, "held": bool, "permission": "granted" | "denied" | "undetermined"}
// `presses` counts the presses the run made (synthetic mode), `frames` the frames captured, `held` whether the
// hardware shortcut was observed held at any point in the run, and `permission` the Screen Recording state.
export function parseReport(output) {
  const lines = String(output).split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { const report = JSON.parse(lines[index]); if (report?.spike === 339) return report; } catch { /* not the report */ }
  }
  return null;
}

// What a report must say. A synthetic run: at least 200 presses, no hold, the permission granted (zero frames
// with capture refused proves nothing) and zero frames. A held run: the hardware shortcut held, the permission
// granted and at least one frame, which is what makes the synthetic run's zero mean anything.
export function reportProblems(report, mode, at = 'the report') {
  if (!report || typeof report !== 'object') return [`${at}: no report line ({"spike": 339, ...}) was printed`];
  const problems = [];
  if (report.mode !== mode) problems.push(`${at}: mode is ${JSON.stringify(report.mode)}, not ${mode}`);
  if (!PERMISSION_STATES.includes(report.permission)) problems.push(`${at}: permission is ${JSON.stringify(report.permission)}, not one of ${PERMISSION_STATES.join(', ')}`);
  else if (report.permission !== 'granted') problems.push(`${at}: the Screen Recording permission is ${report.permission}, so capture was refused and zero frames prove nothing`);
  if (typeof report.held !== 'boolean') problems.push(`${at}: held is ${JSON.stringify(report.held)}, not true or false`);
  if (!count(report.presses)) problems.push(`${at}: presses is ${JSON.stringify(report.presses)}, not a count`);
  if (!count(report.frames)) problems.push(`${at}: frames is ${JSON.stringify(report.frames)}, not a count`);
  if (problems.length) return problems;
  if (mode === 'synthetic') {
    if (report.held) problems.push(`${at}: INVALID: the shortcut was held during the synthetic run, so a frame proves nothing either way`);
    if (report.presses < MIN_PRESSES) problems.push(`${at}: ${report.presses} synthetic presses, fewer than ${MIN_PRESSES}`);
    if (report.frames !== 0) problems.push(`${at}: ${report.frames} frame(s) captured without the shortcut held, over ${report.presses} synthetic presses`);
  } else {
    if (!report.held) problems.push(report.frames > 0 ? `${at}: ${report.frames} frame(s) captured though the shortcut was never held` : `${at}: the shortcut was never held, so nothing shows a frame can be captured at all`);
    else if (report.frames < 1) problems.push(`${at}: no frame captured while the shortcut was held, so capture never works and zero frames without it prove nothing`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 1: no frame without the shortcut held

function machineProblems(record) {
  const problems = [];
  if (!nonEmpty(record?.machine?.model)) problems.push('machine.model is missing');
  if (!nonEmpty(record?.machine?.macosBuild)) problems.push('machine.macosBuild is missing: the capture APIs, the permission flow and the accessibility APIs are each a macOS version\'s');
  return problems;
}

function loggedReport(repo, log, mode, at) {
  if (!/\.(log|txt)$/.test(log ?? '') || !tracked(repo, log)) return { problems: [`${at}.log ${JSON.stringify(log)} isn't a tracked .log or .txt file holding the command's output`] };
  const report = parseReport(readTracked(repo, log).toString('utf8'));
  return { report, problems: reportProblems(report, mode, `${at}.log ${log}`) };
}

export function captureProblems(record, repo = root) {
  const problems = machineProblems(record);
  const capture = record?.capture;
  if (!capture || typeof capture !== 'object') return [...problems, 'no capture recorded'];
  if (!nonEmpty(capture.api)) problems.push('capture.api is missing: name the macOS API the frame is taken with');
  if (!nonEmpty(capture.shortcut)) problems.push('capture.shortcut is missing: name the shortcut that must be held');
  if (!nonEmpty(capture.holdSource)) problems.push('capture.holdSource is missing: say where the hold is read from, so a synthetic press can\'t fake it');
  if (!argv(capture.command)) problems.push('capture.command must be the argv of the synthetic-press run, from the repo root');
  const presses = capture.presses;
  if (presses?.source !== 'synthetic') problems.push(`capture.presses.source is ${JSON.stringify(presses?.source)}, not synthetic: the criterion counts presses made by software, never by hardware`);
  if (!nonEmpty(presses?.method)) problems.push('capture.presses.method is missing: say how the synthetic presses were made');
  if (!(count(presses?.count) && presses.count >= MIN_PRESSES)) problems.push(`capture.presses.count is ${JSON.stringify(presses?.count)}, not at least ${MIN_PRESSES}`);
  const run = capture.run;
  const { report, problems: logged } = loggedReport(repo, run?.log, 'synthetic', 'capture.run');
  problems.push(...logged);
  if (report) {
    if (run?.presses !== report.presses) problems.push(`capture.run.presses is ${JSON.stringify(run?.presses)}, but the kept output reports ${report.presses}`);
    if (run?.frames !== report.frames) problems.push(`capture.run.frames is ${JSON.stringify(run?.frames)}, but the kept output reports ${report.frames}`);
    if (count(presses?.count) && report.presses < presses.count) problems.push(`capture.presses.count is ${presses.count}, but the kept output reports ${report.presses} presses`);
  }
  return problems;
}

// The control: one frame captured while a person held the shortcut, kept as a tracked PNG with its hash, and the
// run's output. Without it a spike that never captures anything would pass the synthetic run with zero frames.
export function heldProblems(record, repo = root) {
  const problems = [];
  const capture = record?.capture;
  if (!capture || typeof capture !== 'object') return ['no capture recorded'];
  if (!argv(capture.heldCommand)) problems.push('capture.heldCommand must be the argv of the run that waits for a person to hold the shortcut and captures one frame');
  else if (argv(capture.command) && JSON.stringify(capture.heldCommand) === JSON.stringify(capture.command)) problems.push('capture.heldCommand is the synthetic-press command; the held run is its own command');
  const held = capture.held;
  const { report, problems: logged } = loggedReport(repo, held?.log, 'held', 'capture.held');
  problems.push(...logged);
  if (report && held?.frames !== report.frames) problems.push(`capture.held.frames is ${JSON.stringify(held?.frames)}, but the kept output reports ${report.frames}`);
  if (!/\.png$/.test(held?.frame ?? '') || !tracked(repo, held.frame)) problems.push(`capture.held.frame ${JSON.stringify(held?.frame)} isn't a tracked PNG`);
  else {
    const bytes = readTracked(repo, held.frame);
    if (!pngSize(bytes)) problems.push(`capture.held.frame ${held.frame} isn't a PNG with a size`);
    if (sha256(bytes) !== held.sha256) problems.push(`capture.held.frame ${held.frame} doesn't hash to its recorded sha256`);
  }
  return problems;
}

// ------------------------------------------------------------------ scope: the macOS permission flow

export function permissionProblems(record) {
  const problems = [];
  const permission = record?.permission;
  if (!permission || typeof permission !== 'object') return ['no permission flow recorded'];
  if (!nonEmpty(permission.api)) problems.push('permission.api is missing: name the API the Screen Recording permission is asked and read through');
  if (!nonEmpty(permission.prompt)) problems.push('permission.prompt is missing: say what the system prompt showed');
  if (!PERMISSION_STATES.includes(permission.state)) problems.push(`permission.state is ${JSON.stringify(permission.state)}, not one of ${PERMISSION_STATES.join(', ')}`);
  else if (permission.state !== 'granted') problems.push(`permission.state is ${permission.state}: the recorded runs need the permission granted`);
  if (!nonEmpty(permission.whenDenied)) problems.push('permission.whenDenied is missing: say what the capture does while the permission is denied (no frame, and what it reports)');
  return problems;
}

// ------------------------------------------------------------------ scope: the cursor window

export function cursorWindowProblems(record, repo = root) {
  const problems = [];
  const window = record?.cursorWindow;
  if (!window || typeof window !== 'object') return ['no cursor window recorded'];
  if (!nonEmpty(window.follows)) problems.push('cursorWindow.follows is missing: say how the window follows the cursor');
  for (const side of ['width', 'height']) {
    const points = window.sizePoints?.[side];
    if (!(typeof points === 'number' && points > 0 && points <= MAX_WINDOW_POINTS)) problems.push(`cursorWindow.sizePoints.${side} is ${JSON.stringify(points)}, not over 0 and at most ${MAX_WINDOW_POINTS} points: a small window`);
  }
  if (!/\.(mov|mp4)$/.test(window.recording ?? '') || !tracked(repo, window.recording)) { problems.push(`cursorWindow.recording ${JSON.stringify(window.recording)} isn't a tracked .mov or .mp4 screen recording`); return problems; }
  const bytes = readTracked(repo, window.recording);
  if (sha256(bytes) !== window.sha256) problems.push(`cursorWindow.recording ${window.recording} doesn't hash to its recorded sha256`);
  const duration = movieDurationMs(bytes);
  if (duration === null) problems.push(`cursorWindow.recording ${window.recording} isn't a QuickTime or MP4 movie with a duration`);
  else {
    if (duration < MIN_RECORDING_MS) problems.push(`cursorWindow.recording ${window.recording} is ${duration} ms long, under ${MIN_RECORDING_MS} ms`);
    if (!(typeof window.durationMs === 'number' && Math.abs(window.durationMs - duration) <= 50)) problems.push(`cursorWindow.durationMs is ${JSON.stringify(window.durationMs)}, but the recording is ${duration} ms long`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 2: the sender decision

export function senderProblems(record) {
  const problems = machineProblems(record);
  const sender = record?.sender;
  if (!sender || typeof sender !== 'object') return [...problems, 'no sender decision recorded'];
  if (typeof sender.named !== 'boolean') return [...problems, `sender.named is ${JSON.stringify(sender.named)}, not true (macOS names an accessibility action's sender) or false (it doesn't)`];
  if (sender.named) {
    if (!nonEmpty(sender.api)) problems.push('sender.named is true, so sender.api must name the API that names the sender');
    if (sender.absence !== undefined) problems.push('sender.absence is only for an answer of false');
  } else {
    if (!nonEmpty(sender.absence)) problems.push('sender.named is false, so sender.absence must say where the API\'s absence is documented');
    if (sender.api !== undefined) problems.push('sender.api is only for an answer of true');
  }
  const citations = list(sender.citations);
  if (!citations.length) problems.push('sender.citations is empty: cite the API or its documented absence');
  for (const citation of citations) if (!(nonEmpty(citation) && (CITATION_URL.test(citation) || CITATION_HEADER.test(citation)))) problems.push(`sender.citations holds ${JSON.stringify(citation)}, not an https URL or an SDK header (<Framework>/<Header>.h)`);
  const rule = sender.named ? RULES.named : RULES.unnamed;
  if (sender.rule !== rule) problems.push(`sender.rule is ${JSON.stringify(sender.rule)}, but with the sender ${sender.named ? 'named' : 'not named'} VoiceOver's actions answer the card ${rule === 'direct' ? 'directly (direct)' : 'only after the OS confirms you (confirm)'}`);
  if (!nonEmpty(sender.text)) problems.push('sender.text is missing: the written answer, as it appears in the Decided row');
  else {
    const text = squash(sender.text);
    if (sender.named && nonEmpty(sender.api) && !text.includes(squash(sender.api))) problems.push(`sender.text doesn't name the API, ${sender.api}`);
    if (!sender.named && nonEmpty(sender.absence) && !text.includes(squash(sender.absence))) problems.push('sender.text doesn\'t give the documented absence (sender.absence)');
    if (!sender.named && !/\bunknown\b/i.test(text) && !NEGATED.test(text)) problems.push('sender.text answers false but never says the sender can\'t be named or that the client is unknown');
    if (!citations.some((citation) => text.includes(citation))) problems.push('sender.text cites none of sender.citations');
  }
  return problems;
}

export function cardRow(repo = root) {
  const path = join(repo, DESIGN);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split('\n').find((line) => line.startsWith(CARD_ROW)) ?? null;
}

// The Decided row "Clicks on the question card" holds the written answer, and its input rule follows it:
// named, VoiceOver's actions answer the card directly and the row names the API; not named, the row marks the
// client unknown and VoiceOver's actions answer only after the OS confirms you. Either way the row no longer
// waits on the spike, in its decision or in its "Reopens if".
export function cardRowProblems(record, repo = root) {
  const problems = [];
  const sender = record?.sender;
  if (!sender || typeof sender !== 'object' || typeof sender.named !== 'boolean') return ['no sender decision recorded'];
  const row = cardRow(repo);
  if (!row) return [`${DESIGN} has no "${CARD_ROW}" row under Decided`];
  const squashed = squash(row);
  if (nonEmpty(sender.text) && !squashed.includes(squash(sender.text))) problems.push(`${DESIGN}'s "${CARD_ROW}" row doesn't hold sender.text`);
  if (OPEN_QUESTION.test(squashed)) problems.push(`the "${CARD_ROW}" row still waits on the spike ("${squashed.match(OPEN_QUESTION)[0]}..."); the answer is in, so the row decides and its "Reopens if" names what would reopen it now`);
  if (!/\bVoiceOver\b/.test(squashed)) problems.push(`the "${CARD_ROW}" row doesn't say what VoiceOver's actions do`);
  if (sender.named) {
    if (nonEmpty(sender.api) && !squashed.includes(squash(sender.api))) problems.push(`the "${CARD_ROW}" row doesn't name the API, ${sender.api}`);
    if (!/\bVoiceOver\b[^.|]*\bdirectly\b/.test(squashed)) problems.push(`the "${CARD_ROW}" row doesn't say VoiceOver's actions answer the card directly, though the sender is named`);
  } else {
    if (!/\bunknown\b/.test(squashed)) problems.push(`the "${CARD_ROW}" row doesn't mark the accessibility client unknown, though the sender isn't named`);
    if (!/\bVoiceOver\b[^.|]*\bconfirm/.test(squashed)) problems.push(`the "${CARD_ROW}" row doesn't say VoiceOver's actions answer only after the OS confirms you, though the sender isn't named`);
  }
  return problems;
}

// ------------------------------------------------------------------ the live runs

export function runCommand(command, repo = root) {
  if (!argv(command)) return { error: Error('the command is missing from the record'), stdout: '', stderr: '' };
  return spawnSync(command[0], command.slice(1), { cwd: repo, env: { ...process.env }, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 });
}

// A run that couldn't start, or ran with the permission not granted, is BLOCKED: it needs a person.
export function liveProblems(run, mode) {
  if (run.error) return [`BLOCKED: the ${mode} run didn't run: ${run.error.message}`];
  const report = parseReport(`${run.stdout}\n${run.stderr}`);
  if (report && PERMISSION_STATES.includes(report.permission) && report.permission !== 'granted') return [`BLOCKED: the Screen Recording permission is ${report.permission}; a person grants it in System Settings, then the run counts`];
  const problems = reportProblems(report, mode, `the ${mode} run`);
  if (run.status !== 0) problems.push(`the ${mode} run exited ${run.signal ?? run.status}`);
  return problems;
}
