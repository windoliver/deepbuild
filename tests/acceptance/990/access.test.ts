// AC7: with VoiceOver on, the tab reads the program's last line and the cursor's row; a dictation app's 200-character
// insert lands in the session's box naming the app and reaches the program once on Enter; a planted tab that drops it,
// or types it straight in, fails.
//
// The insert half runs everywhere: a text insert from another app (a dictation or text-expansion app inserting through
// the platform's accessibility, not keys) comes through the input seam's test backend as `insert`, with the app's name,
// to the focused terminal; the terminal's box (`cells`: `box`) holds it with its source named, the real program on its
// real PTY reads none of it until your Enter, and then all of it, once. The VoiceOver half reads the terminal tab through
// macOS accessibility from the app's own window at the reference window (`ax`), and asks VoiceOver what it read; it needs
// the reference Mac with VoiceOver on and a person there (DEEP_990_LIVE=1), and is INCONCLUSIVE anywhere else, never a
// pass or a skip.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TERMINAL, inconclusive, keyEvent, newBytes, openFocused, readBytes, referenceMacProblem, script, seam, setup, shown, sleep, tmp, useShow,
  waitScreen, withServe, type JsonObject,
} from './helpers.ts';

const show = useShow();
const APP = 'Superwhisper';
/** What the dictation app inserts: exactly 200 characters, one of them not ASCII. */
const DICTATED = (() => {
  const base = 'Please rename the billing totals helper, keep the old export for one release, and add a test for the rounding of café receipts over one hundred lines so the regression stays fixed for good this time. ';
  return [...base.repeat(2)].slice(0, 199).join('') + '.';
})();

interface Played { reply: JsonObject; box: JsonObject | null; beforeEnter: Buffer; afterEnter: Buffer; boxAfter: JsonObject | null }

async function play(bin: string, planted?: string): Promise<Played> {
  const dir = tmp('dictation');
  const log = join(dir, 'in.log');
  return withServe(bin, setup(dir, planted), async (s) => {
    await openFocused(s, script(dir, 'recorder', log, { out: 'READY-dictation' }));
    await waitScreen(s, (rows) => rows.some((r) => r.includes('READY-dictation')), 'the program is up');
    const reply = await s.ok(seam({ type: 'insert', text: DICTATED, app: APP }), `${APP}'s insert of ${[...DICTATED].length} characters`);
    await sleep(1000);
    const cells = await s.ok({ call: 'cells', terminal: TERMINAL }, 'the grid and its box after the insert');
    const beforeEnter = readBytes(log);
    await s.ok(keyEvent('enter', [], 'Enter'), 'your Enter');
    await newBytes(log, beforeEnter.length, 5000);
    await sleep(500);
    const after = await s.ok({ call: 'cells', terminal: TERMINAL }, 'the grid and its box after Enter');
    return { reply, box: (cells['box'] ?? null) as JsonObject | null, beforeEnter, afterEnter: readBytes(log).subarray(beforeEnter.length), boxAfter: (after['box'] ?? null) as JsonObject | null };
  });
}

/** What "lands in the box naming the app and reaches the program once on Enter" asks. */
function insertProblems(p: Played): string[] {
  const f: string[] = [];
  const text = p.box && typeof p.box['text'] === 'string' ? p.box['text'] : '';
  if (text !== DICTATED) f.push(`the insert was dropped from the session's box: it holds ${JSON.stringify(text.slice(0, 60))} (${[...text].length} characters), not the ${[...DICTATED].length} inserted`);
  if (!String(p.box?.['source'] ?? '').includes(APP)) f.push(`the box doesn't name the app the text came from (${APP}): ${JSON.stringify(p.box?.['source'] ?? null)}`);
  if (p.beforeEnter.length > 0) f.push(`the insert was typed straight into the program before your Enter: it read "${shown(p.beforeEnter.subarray(0, 60))}"…`);
  const got = p.afterEnter.toString('utf8');
  const times = got.split(DICTATED).length - 1;
  const rest = got.replace(DICTATED, '');
  if (times !== 1) f.push(`on your Enter the program read the inserted text ${times} times, not once: "${shown(p.afterEnter.subarray(0, 60))}"…`);
  else if (rest !== '' && rest !== '\r') f.push(`on your Enter the program read more than the text and a carriage return: "${shown(rest)}"`);
  if (p.boxAfter && String(p.boxAfter['text'] ?? '') !== '') f.push('the box still holds the text after it was sent');
  return f;
}

describe('AC7 text another app inserts goes to the session\'s box, naming the app, and to the program only on your Enter', () => {
  it(`AC7 ${APP}'s 200-character insert lands in the box with ${APP} named, reaches the program not at all before your Enter, and whole and once on it`, async () => {
    expect([...DICTATED].length, 'the insert is 200 characters').toBe(200);
    const p = await play(show());
    expect(insertProblems(p), 'in the box, named, sent once on Enter').toEqual([]);
  }, 600_000);

  it('AC7 a planted tab that drops the insert, and one that types it straight in, each fail', async () => {
    const dropped = insertProblems(await play(show(), 'insert_dropped'));
    expect(dropped.some((m) => m.startsWith('the insert was dropped')), `the planted insert_dropped fails, naming the dropped insert: ${JSON.stringify(dropped)}`).toBe(true);
    const typed = insertProblems(await play(show(), 'insert_typed_straight'));
    expect(typed.some((m) => m.startsWith('the insert was typed straight into the program')), `the planted insert_typed_straight fails: ${JSON.stringify(typed)}`).toBe(true);
  }, 900_000);
});

describe('AC7 VoiceOver reads the terminal tab', () => {
  it('AC7 live, at the reference Mac with VoiceOver on: the tab is a text area whose value holds the program\'s last line, its insertion line is the cursor\'s row, and VoiceOver speaks that row', async () => {
    if (process.env['DEEP_990_LIVE'] !== '1') inconclusive('the VoiceOver test needs a person at the reference Mac with VoiceOver on; run with DEEP_990_LIVE=1 (README: The live runs)');
    const why = referenceMacProblem();
    if (why) inconclusive(why);
    const osa = (script: string): string | null => {
      const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 5000 });
      return r.status === 0 ? r.stdout.trim() : null;
    };
    if (osa('tell application "System Events" to (name of processes) contains "VoiceOver"') !== 'true') inconclusive('VoiceOver is not on (⌘F5 turns it on)');
    if (osa('tell application "VoiceOver" to get content of last phrase') === null) inconclusive('VoiceOver does not answer AppleScript; turn on "Allow VoiceOver to be controlled with AppleScript" in VoiceOver Utility');
    const dir = tmp('voiceover');
    const log = join(dir, 'in.log');
    const LAST = 'the last line 990: build finished';
    const ROW = 'cursor row 990 > ';
    let ax: JsonObject = {};
    let spoken = '';
    await withServe(show(), setup(dir), async (s) => {
      await openFocused(s, script(dir, 'recorder', log, { out: `line one\r\nline two\r\n${LAST}\r\n\r\n${ROW}` }));
      await waitScreen(s, (rows) => rows.some((r) => r.startsWith(ROW.trimEnd())), 'the program is up');
      const r = await s.call({ call: 'ax', terminal: TERMINAL, focus: true }, 60_000);
      if (r['code'] === 'unsupported_platform') inconclusive('ax answered unsupported_platform');
      ax = r;
      await sleep(3000);
      spoken = osa('tell application "VoiceOver" to get content of last phrase') ?? '';
    });
    expect(ax['role'], 'the tab is a text area to the platform\'s accessibility').toBe('AXTextArea');
    expect(String(ax['value'] ?? ''), 'its value holds the program\'s last line').toContain(LAST);
    expect(ax['line'], 'its insertion point is on the cursor\'s row (row 4, from 0)').toBe(4);
    expect(String(ax['line_text'] ?? '').trimEnd(), 'and that row\'s text').toBe(ROW.trimEnd());
    expect(spoken, 'VoiceOver speaks the cursor\'s row').toContain(ROW.trim().replace(/\s*>$/, ''));
  }, 900_000);
});
