// Proves the #339 tests themselves: each planted wrong spike must be rejected by the check its criterion
// names, and a right one, whichever way the sender question came out, must pass. These test the tests, so
// they pass on the base. They build a small git repo in a temporary folder.
// Run: node --test tests/acceptance/339/validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  captureProblems, CARD_ROW, cardRowProblems, cursorWindowProblems, heldProblems, liveProblems, movieDurationMs, NO_FRAME, parseReport, permissionProblems, reportProblems, SENDER,
  senderProblems, sha256,
} from './validate.mjs';

const rejects = (problems, pattern) => assert.ok(problems.some((problem) => pattern.test(problem)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
function g(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
// A PNG's signature and IHDR chunk, which is all the tests read.
function png(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12); ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}
// A QuickTime movie's `ftyp` and `moov/mvhd` atoms, which is all the tests read: a duration at a timescale.
function movie(durationMs, { version = 0, timescale = 600 } = {}) {
  const atom = (type, body) => { const header = Buffer.alloc(8); header.writeUInt32BE(8 + body.length, 0); header.write(type, 4, 'latin1'); return Buffer.concat([header, body]); };
  const ftyp = atom('ftyp', Buffer.concat([Buffer.from('qt  ', 'latin1'), Buffer.alloc(4), Buffer.from('qt  ', 'latin1')]));
  const units = Math.round((durationMs * timescale) / 1000);
  let mvhd;
  if (version === 0) { mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(timescale, 12); mvhd.writeUInt32BE(units, 16); }
  else { mvhd = Buffer.alloc(112); mvhd[0] = 1; mvhd.writeUInt32BE(timescale, 20); mvhd.writeBigUInt64BE(BigInt(units), 24); }
  return Buffer.concat([ftyp, atom('moov', atom('mvhd', mvhd))]);
}
const report = (fields) => JSON.stringify({ spike: 339, ...fields });
const SYNTHETIC_LOG = `deep-339: posting 200 synthetic presses of fn+shift+5\n${report({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'granted' })}\n`;
const HELD_LOG = `deep-339: hold fn+shift+5 within 30 s\n${report({ mode: 'held', presses: 0, frames: 1, held: true, permission: 'granted' })}\n`;
const FRAME = png(640, 400);
const MOVIE = movie(8000);

const API = 'AXUIElementCopyActionSenderPID';
const HEADER = 'ApplicationServices/AXUIElement.h';
const ABSENCE = 'the NSAccessibility protocol and the AXUIElement API deliver an action without its sender';
const NAMED_TEXT = `macOS names an accessibility action's sender through ${API} (${HEADER}), so VoiceOver's own actions answer the card directly and the input router marks every other accessibility client unknown.`;
const UNNAMED_TEXT = `The spike found that macOS doesn't name an accessibility action's sender: ${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h). The input router marks every accessibility input's client unknown, and VoiceOver's actions answer the card only after the OS confirms you.`;
const OPEN_ROW = `${CARD_ROW} Hardware input answers the card. VoiceOver's own actions answer it directly only where the platform names their sender, which the R1 toolkit spike finds out. | The spike finds that macOS names each client |`;
const namedRow = (text) => `${CARD_ROW} Hardware input answers the card: the pointer and keys. ${text} Any other input, a synthetic event or an accessibility action from a client the platform can't name, answers it only after the OS confirms you. | A macOS release drops the API |`;
const unnamedRow = (text) => `${CARD_ROW} Hardware input answers the card: the pointer and keys. ${text} Any other input, a synthetic event or an accessibility action from a client the platform can't name, answers it only after the OS confirms you. | A macOS release names the client |`;
const designWith = (row) => `# Design\n\n### Decided\n\n| Question | Decision | Reopens if |\n|---|---|---|\n${row}\n`;

function scratchRepo(t, row = unnamedRow(UNNAMED_TEXT)) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'deep-339-test-')));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  g(repo, 'init', '-q');
  put(join(repo, 'docs/technical-design.md'), designWith(OPEN_ROW));
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'base');
  put(join(repo, 'docs/technical-design.md'), designWith(row));
  put(join(repo, 'docs/spikes/339/synthetic-run.log'), SYNTHETIC_LOG);
  put(join(repo, 'docs/spikes/339/held-run.log'), HELD_LOG);
  put(join(repo, 'docs/spikes/339/held-frame.png'), FRAME);
  put(join(repo, 'docs/spikes/339/not-a-png.png'), 'hello');
  put(join(repo, 'docs/spikes/339/cursor-window.mov'), MOVIE);
  put(join(repo, 'docs/spikes/339/not-a-movie.mov'), 'hello');
  put(join(repo, 'docs/spikes/339/short.mov'), movie(1000));
  put(join(repo, 'docs/spikes/339/long.mp4'), movie(12_000, { version: 1 }));
  put(join(repo, 'docs/spikes/339/no-report.log'), 'deep-339: posting presses\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'spike');
  return repo;
}

function rightRecord() {
  return {
    spike: 339,
    measuredOn: '2026-10-22',
    machine: { model: 'Mac15,12', chip: 'Apple M3', macosBuild: '23H723' },
    capture: {
      api: 'ScreenCaptureKit: SCScreenshotManager.captureImage',
      shortcut: 'fn+shift+5',
      holdSource: 'the keyboard\'s own state through IOHIDManager, read at the capture, never the event stream',
      command: ['cargo', 'run', '-p', 'deep-app', '--bin', 'deep-339', '--', '--synthetic-presses', '200'],
      presses: { count: 200, source: 'synthetic', method: 'CGEventPost of the chord at the HID event tap, 200 times, each held 50 ms' },
      run: { log: 'docs/spikes/339/synthetic-run.log', presses: 200, frames: 0 },
      heldCommand: ['cargo', 'run', '-p', 'deep-app', '--bin', 'deep-339', '--', '--wait-for-hold', '30'],
      held: { log: 'docs/spikes/339/held-run.log', frames: 1, frame: 'docs/spikes/339/held-frame.png', sha256: sha256(FRAME) },
    },
    permission: { api: 'CGPreflightScreenCaptureAccess and CGRequestScreenCaptureAccess', prompt: 'the system\'s Screen Recording prompt naming deep-339', state: 'granted', whenDenied: 'no frame: the report says permission denied and frames 0' },
    cursorWindow: { recording: 'docs/spikes/339/cursor-window.mov', sha256: sha256(MOVIE), durationMs: 8000, sizePoints: { width: 160, height: 120 }, follows: 'an NSEvent global mouse-moved monitor moves the window to the pointer each event' },
    sender: { named: false, absence: ABSENCE, citations: ['https://developer.apple.com/documentation/applicationservices/axuielement_h', 'AppKit/NSAccessibilityProtocols.h'], rule: 'confirm', text: UNNAMED_TEXT },
  };
}

function namedRecord() {
  const record = rightRecord();
  record.sender = { named: true, api: API, citations: [HEADER], rule: 'direct', text: NAMED_TEXT };
  return record;
}

const all = (record, repo) => [
  ...captureProblems(record, repo), ...heldProblems(record, repo), ...senderProblems(record), ...cardRowProblems(record, repo),
  ...permissionProblems(record), ...cursorWindowProblems(record, repo),
];

test('a right record whose spike found the sender isn\'t named passes every check', (t) => {
  const repo = scratchRepo(t);
  holds(all(rightRecord(), repo));
});

test(`${SENDER} a right record whose spike found macOS names the sender passes every check`, (t) => {
  const repo = scratchRepo(t, namedRow(NAMED_TEXT));
  holds(all(namedRecord(), repo));
});

test('scope: a right record with a version-1 MP4 recording passes the cursor-window check', (t) => {
  const repo = scratchRepo(t);
  const record = rightRecord();
  record.cursorWindow = { ...record.cursorWindow, recording: 'docs/spikes/339/long.mp4', sha256: sha256(movie(12_000, { version: 1 })), durationMs: 12_000 };
  holds(cursorWindowProblems(record, repo));
});

// [criterion, name, check, plant, the problem it must raise]
const planted = [
  [NO_FRAME, '199 synthetic presses', captureProblems, (r) => { r.capture.presses.count = 199; }, /count is 199, not at least 200/],
  [NO_FRAME, 'a record claiming 200 presses over a log of 150', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/short-run.log'; }, /150 synthetic presses, fewer than 200/],
  [NO_FRAME, 'a record whose presses disagree with its kept output', captureProblems, (r) => { r.capture.run.presses = 250; }, /run\.presses is 250, but the kept output reports 200/],
  [NO_FRAME, 'a record whose press count exceeds its kept output', captureProblems, (r) => { r.capture.presses.count = 250; }, /count is 250, but the kept output reports 200 presses/],
  [NO_FRAME, 'a frame captured in the synthetic run', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/one-frame.log'; r.capture.run.frames = 1; }, /1 frame\(s\) captured without the shortcut held/],
  [NO_FRAME, 'a record hiding the frame its kept output reports', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/one-frame.log'; }, /run\.frames is 0, but the kept output reports 1/],
  [NO_FRAME, 'zero frames with the permission denied', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/denied.log'; }, /permission is denied, so capture was refused and zero frames prove nothing/],
  [NO_FRAME, 'zero frames with the permission undetermined', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/undetermined.log'; }, /permission is undetermined/],
  [NO_FRAME, 'a synthetic run during which a person held the shortcut', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/held-during.log'; }, /INVALID: the shortcut was held during the synthetic run/],
  [NO_FRAME, 'hardware presses passed off as synthetic', captureProblems, (r) => { r.capture.presses.source = 'hardware'; }, /source is "hardware", not synthetic/],
  [NO_FRAME, 'presses with no method named', captureProblems, (r) => { delete r.capture.presses.method; }, /presses\.method is missing/],
  [NO_FRAME, 'no hold source named', captureProblems, (r) => { delete r.capture.holdSource; }, /holdSource is missing/],
  [NO_FRAME, 'no synthetic-press command', captureProblems, (r) => { delete r.capture.command; }, /capture\.command must be the argv/],
  [NO_FRAME, 'a kept output that is not tracked', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/missing.log'; }, /isn't a tracked \.log or \.txt file/],
  [NO_FRAME, 'a kept output with no report line', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/no-report.log'; }, /no report line/],
  [NO_FRAME, 'a kept output whose report is a held run', captureProblems, (r) => { r.capture.run.log = 'docs/spikes/339/held-run.log'; }, /mode is "held", not synthetic/],
  [NO_FRAME, 'no macOS build', captureProblems, (r) => { delete r.machine.macosBuild; }, /macosBuild is missing/],
  [NO_FRAME, 'a spike that never captures: the held run took no frame', heldProblems, (r) => { r.capture.held.log = 'docs/spikes/339/held-none.log'; r.capture.held.frames = 0; }, /no frame captured while the shortcut was held, so capture never works/],
  [NO_FRAME, 'a held run in which the shortcut was never held', heldProblems, (r) => { r.capture.held.log = 'docs/spikes/339/held-unheld.log'; }, /1 frame\(s\) captured though the shortcut was never held/],
  [NO_FRAME, 'a held run with nothing held and nothing captured', heldProblems, (r) => { r.capture.held.log = 'docs/spikes/339/held-nothing.log'; r.capture.held.frames = 0; }, /the shortcut was never held, so nothing shows a frame can be captured at all/],
  [NO_FRAME, 'a held run with the permission denied', heldProblems, (r) => { r.capture.held.log = 'docs/spikes/339/held-denied.log'; r.capture.held.frames = 0; }, /permission is denied/],
  [NO_FRAME, 'a held run whose kept output is the synthetic run\'s', heldProblems, (r) => { r.capture.held.log = 'docs/spikes/339/synthetic-run.log'; }, /mode is "synthetic", not held/],
  [NO_FRAME, 'a held frame count that disagrees with its kept output', heldProblems, (r) => { r.capture.held.frames = 2; }, /held\.frames is 2, but the kept output reports 1/],
  [NO_FRAME, 'no held frame kept', heldProblems, (r) => { r.capture.held.frame = 'docs/spikes/339/missing.png'; }, /isn't a tracked PNG/],
  [NO_FRAME, 'a held frame that is not a PNG', heldProblems, (r) => { r.capture.held.frame = 'docs/spikes/339/not-a-png.png'; r.capture.held.sha256 = sha256('hello'); }, /isn't a PNG with a size/],
  [NO_FRAME, 'a held frame that is not the recorded one', heldProblems, (r) => { r.capture.held.sha256 = sha256('other'); }, /doesn't hash to its recorded sha256/],
  [NO_FRAME, 'no held command', heldProblems, (r) => { delete r.capture.heldCommand; }, /heldCommand must be the argv/],
  [NO_FRAME, 'a held command that is the synthetic-press command', heldProblems, (r) => { r.capture.heldCommand = [...r.capture.command]; }, /heldCommand is the synthetic-press command/],

  [SENDER, 'no answer', senderProblems, (r) => { delete r.sender.named; }, /sender\.named is undefined, not true/],
  [SENDER, 'an answer of "maybe"', senderProblems, (r) => { r.sender.named = 'maybe'; }, /sender\.named is "maybe"/],
  [SENDER, 'named, with no API cited', senderProblems, (r) => { Object.assign(r, namedRecord()); delete r.sender.api; }, /sender\.api must name the API/],
  [SENDER, 'not named, with no documented absence', senderProblems, (r) => { delete r.sender.absence; }, /sender\.absence must say where/],
  [SENDER, 'not named, yet naming an API', senderProblems, (r) => { r.sender.api = API; }, /sender\.api is only for an answer of true/],
  [SENDER, 'no citations', senderProblems, (r) => { r.sender.citations = []; }, /citations is empty/],
  [SENDER, 'a citation that is neither a URL nor a header', senderProblems, (r) => { r.sender.citations = ['I checked']; }, /not an https URL or an SDK header/],
  [SENDER, 'a citation over http', senderProblems, (r) => { r.sender.citations = ['http://developer.apple.com/documentation/x']; }, /not an https URL or an SDK header/],
  [SENDER, 'a text that cites nothing', senderProblems, (r) => { r.sender.text = `${ABSENCE}. The client is unknown.`; }, /cites none of sender\.citations/],
  [SENDER, 'not named, yet VoiceOver answers directly', senderProblems, (r) => { r.sender.rule = 'direct'; }, /sender\.rule is "direct", but with the sender not named/],
  [SENDER, 'named, yet VoiceOver must be confirmed', senderProblems, (r) => { Object.assign(r, namedRecord()); r.sender.rule = 'confirm'; }, /sender\.rule is "confirm", but with the sender named/],
  [SENDER, 'no rule', senderProblems, (r) => { delete r.sender.rule; }, /sender\.rule is undefined/],
  [SENDER, 'no written answer', senderProblems, (r) => { delete r.sender.text; }, /sender\.text is missing/],
  [SENDER, 'named, with a text that never names the API', senderProblems, (r) => { Object.assign(r, namedRecord()); r.sender.text = `macOS names the sender (${HEADER}), so VoiceOver answers directly.`; }, /sender\.text doesn't name the API/],
  [SENDER, 'not named, with a text that never gives the absence', senderProblems, (r) => { r.sender.text = 'The client is unknown (https://developer.apple.com/documentation/applicationservices/axuielement_h).'; }, /doesn't give the documented absence/],
  [SENDER, 'not named, with a text that never says so', senderProblems, (r) => { r.sender.text = `${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h). VoiceOver answers the card.`; }, /never says the sender can't be named/],
  [SENDER, 'no macOS build for the answer', senderProblems, (r) => { delete r.machine.macosBuild; }, /macosBuild is missing/],
  [SENDER, 'an answer not written in the technical design', cardRowProblems, (r) => { r.sender.text = `${UNNAMED_TEXT} More.`; }, /row doesn't hold sender\.text/],
  [SENDER, 'no sender decision for the row', cardRowProblems, (r) => { delete r.sender; }, /no sender decision recorded/],
];

for (const [id, name, check, plant, pattern] of planted) {
  test(`${id} rejects a planted wrong spike: ${name}`, (t) => {
    const repo = scratchRepo(t);
    put(join(repo, 'docs/spikes/339/short-run.log'), report({ mode: 'synthetic', presses: 150, frames: 0, held: false, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/one-frame.log'), report({ mode: 'synthetic', presses: 200, frames: 1, held: false, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/denied.log'), report({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'denied' }));
    put(join(repo, 'docs/spikes/339/undetermined.log'), report({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'undetermined' }));
    put(join(repo, 'docs/spikes/339/held-during.log'), report({ mode: 'synthetic', presses: 200, frames: 0, held: true, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/held-none.log'), report({ mode: 'held', presses: 0, frames: 0, held: true, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/held-unheld.log'), report({ mode: 'held', presses: 0, frames: 1, held: false, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/held-nothing.log'), report({ mode: 'held', presses: 0, frames: 0, held: false, permission: 'granted' }));
    put(join(repo, 'docs/spikes/339/held-denied.log'), report({ mode: 'held', presses: 0, frames: 0, held: true, permission: 'denied' }));
    g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'wrong runs');
    const record = rightRecord();
    plant(record);
    rejects(check(record, repo), pattern);
  });
}

// The Decided row, for each answer: it holds the text, names what the answer needs, and no longer waits on the spike.
for (const [name, record, row, pattern] of [
  ['a row that still says the spike finds out', rightRecord, `${CARD_ROW} ${UNNAMED_TEXT} VoiceOver's own actions answer it directly only where the platform names their sender, which the R1 toolkit spike finds out. | A macOS release names the client |`, /still waits on the spike/],
  ['a row whose "Reopens if" still waits on the spike', rightRecord, `${CARD_ROW} ${UNNAMED_TEXT} | The spike finds that macOS names each client |`, /still waits on the spike/],
  ['not named, with a row that never marks the client unknown', () => { const r = rightRecord(); r.sender.text = `${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h), so the sender can't be named and VoiceOver's actions answer only after the OS confirms you.`; return r; }, `${CARD_ROW} ${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h), so the sender can't be named and VoiceOver's actions answer only after the OS confirms you. | A macOS release names the client |`, /doesn't mark the accessibility client unknown/],
  ['not named, with a row where VoiceOver still answers directly', () => { const r = rightRecord(); r.sender.text = `${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h); the client is unknown.`; return r; }, `${CARD_ROW} ${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h); the client is unknown. VoiceOver's own actions answer it directly. | A macOS release names the client |`, /doesn't say VoiceOver's actions answer only after the OS confirms you/],
  ['named, with a row that never names the API', namedRecord, `${CARD_ROW} macOS names the sender, so VoiceOver's own actions answer the card directly. | A macOS release drops the API |`, /row doesn't hold sender\.text/],
  ['named, with a row where VoiceOver still waits for the OS to confirm you', () => { const r = namedRecord(); r.sender.text = `macOS names an accessibility action's sender through ${API} (${HEADER}).`; return r; }, `${CARD_ROW} macOS names an accessibility action's sender through ${API} (${HEADER}). VoiceOver's actions answer the card only after the OS confirms you. | A macOS release drops the API |`, /doesn't say VoiceOver's actions answer the card directly/],
  ['a row that never says what VoiceOver does', () => { const r = rightRecord(); r.sender.text = `${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h); the client is unknown.`; return r; }, `${CARD_ROW} ${ABSENCE} (https://developer.apple.com/documentation/applicationservices/axuielement_h); the client is unknown. | A macOS release names the client |`, /doesn't say what VoiceOver's actions do/],
]) test(`${SENDER} rejects a planted wrong spike: ${name}`, (t) => {
  const repo = scratchRepo(t, row);
  rejects(cardRowProblems(record(), repo), pattern);
});

test(`${SENDER} a design with no "Clicks on the question card" row is refused`, (t) => {
  const repo = scratchRepo(t, '| Another row | x | y |');
  rejects(cardRowProblems(rightRecord(), repo), /has no "\| Clicks on the question card \|" row/);
});

for (const [name, plant, pattern] of [
  ['no permission API', (r) => { delete r.permission.api; }, /permission\.api is missing/],
  ['no system prompt seen', (r) => { delete r.permission.prompt; }, /permission\.prompt is missing/],
  ['the permission denied', (r) => { r.permission.state = 'denied'; }, /permission\.state is denied/],
  ['a permission state of "yes"', (r) => { r.permission.state = 'yes'; }, /permission\.state is "yes", not one of/],
  ['nothing said about a denied permission', (r) => { delete r.permission.whenDenied; }, /whenDenied is missing/],
  ['no permission flow', (r) => { delete r.permission; }, /no permission flow recorded/],
]) test(`scope: rejects a planted wrong spike: ${name}`, () => {
  const record = rightRecord();
  plant(record);
  rejects(permissionProblems(record), pattern);
});

for (const [name, plant, pattern] of [
  ['no screen recording', (r) => { r.cursorWindow.recording = 'docs/spikes/339/missing.mov'; }, /isn't a tracked \.mov or \.mp4/],
  ['a recording that is a GIF', (r) => { r.cursorWindow.recording = 'docs/spikes/339/cursor.gif'; }, /isn't a tracked \.mov or \.mp4/],
  ['a recording that is not a movie', (r) => { r.cursorWindow.recording = 'docs/spikes/339/not-a-movie.mov'; r.cursorWindow.sha256 = sha256('hello'); }, /isn't a QuickTime or MP4 movie with a duration/],
  ['a recording that is not the recorded one', (r) => { r.cursorWindow.sha256 = sha256('other'); }, /doesn't hash to its recorded sha256/],
  ['a one-second recording', (r) => { r.cursorWindow.recording = 'docs/spikes/339/short.mov'; r.cursorWindow.sha256 = sha256(movie(1000)); r.cursorWindow.durationMs = 1000; }, /is 1000 ms long, under 2000 ms/],
  ['a duration that is not the recording\'s', (r) => { r.cursorWindow.durationMs = 30_000; }, /durationMs is 30000, but the recording is 8000 ms long/],
  ['an 800-point window', (r) => { r.cursorWindow.sizePoints.width = 800; }, /sizePoints\.width is 800, not over 0 and at most 400/],
  ['no window size', (r) => { delete r.cursorWindow.sizePoints; }, /sizePoints\.width is undefined/],
  ['nothing said about following the cursor', (r) => { delete r.cursorWindow.follows; }, /follows is missing/],
  ['no cursor window', (r) => { delete r.cursorWindow; }, /no cursor window recorded/],
]) test(`scope: rejects a planted wrong spike: ${name}`, (t) => {
  const repo = scratchRepo(t);
  const record = rightRecord();
  plant(record);
  rejects(cursorWindowProblems(record, repo), pattern);
});

test('movie durations are read from moov/mvhd, versions 0 and 1, and nothing else passes as a movie', () => {
  assert.equal(movieDurationMs(movie(8000)), 8000);
  assert.equal(movieDurationMs(movie(12_000, { version: 1 })), 12_000);
  assert.equal(movieDurationMs(movie(2500, { timescale: 1000 })), 2500);
  assert.equal(movieDurationMs(Buffer.from('hello')), null);
  assert.equal(movieDurationMs(FRAME), null);
  assert.equal(movieDurationMs(movie(8000).subarray(0, 20)), null);
});

test(`${NO_FRAME} the report line: the last JSON line naming spike 339, whatever is printed around it`, () => {
  assert.deepEqual(parseReport(SYNTHETIC_LOG), { spike: 339, mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'granted' });
  assert.deepEqual(parseReport(`${SYNTHETIC_LOG}warning: trailing\n{"spike": 1}\n`), { spike: 339, mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'granted' });
  assert.equal(parseReport('deep-339: nothing\n'), null);
  assert.equal(parseReport('{not json'), null);
  rejects(reportProblems({ spike: 339, mode: 'synthetic', presses: '200', frames: 0, held: false, permission: 'granted' }, 'synthetic'), /presses is "200", not a count/);
  rejects(reportProblems({ spike: 339, mode: 'synthetic', presses: 200, frames: -1, held: false, permission: 'granted' }, 'synthetic'), /frames is -1, not a count/);
  rejects(reportProblems({ spike: 339, mode: 'synthetic', presses: 200, frames: 0, held: 'no', permission: 'granted' }, 'synthetic'), /held is "no", not true or false/);
});

test(`${NO_FRAME} the live runs: a report of 200 presses and no frame passes, and each wrong outcome is named, with BLOCKED for what needs a person`, () => {
  const run = (fields, status = 0) => ({ status, stdout: `deep-339: run\n${report(fields)}\n`, stderr: '' });
  holds(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'granted' }), 'synthetic'));
  holds(liveProblems(run({ mode: 'synthetic', presses: 1000, frames: 0, held: false, permission: 'granted' }), 'synthetic'));
  holds(liveProblems(run({ mode: 'held', presses: 0, frames: 1, held: true, permission: 'granted' }), 'held'));
  rejects(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 3, held: false, permission: 'granted' }), 'synthetic'), /3 frame\(s\) captured without the shortcut held, over 200 synthetic presses/);
  rejects(liveProblems(run({ mode: 'synthetic', presses: 120, frames: 0, held: false, permission: 'granted' }), 'synthetic'), /120 synthetic presses, fewer than 200/);
  rejects(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 0, held: true, permission: 'granted' }), 'synthetic'), /INVALID: the shortcut was held/);
  rejects(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'denied' }), 'synthetic'), /^BLOCKED: the Screen Recording permission is denied; a person grants it/);
  rejects(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'undetermined' }), 'synthetic'), /^BLOCKED: the Screen Recording permission is undetermined/);
  rejects(liveProblems(run({ mode: 'held', presses: 0, frames: 0, held: true, permission: 'granted' }), 'held'), /no frame captured while the shortcut was held/);
  rejects(liveProblems(run({ mode: 'held', presses: 0, frames: 1, held: false, permission: 'granted' }), 'held'), /captured though the shortcut was never held/);
  rejects(liveProblems(run({ mode: 'held', presses: 0, frames: 1, held: true, permission: 'granted' }), 'synthetic'), /mode is "held", not synthetic/);
  rejects(liveProblems(run({ mode: 'synthetic', presses: 200, frames: 0, held: false, permission: 'granted' }, 101), 'synthetic'), /the synthetic run exited 101/);
  rejects(liveProblems({ status: 0, stdout: 'deep-339: nothing\n', stderr: '' }, 'synthetic'), /no report line/);
  rejects(liveProblems({ error: Error('spawn cargo ENOENT'), stdout: '', stderr: '' }, 'synthetic'), /^BLOCKED: the synthetic run didn't run: spawn cargo ENOENT/);
});
