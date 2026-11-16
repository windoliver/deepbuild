// AC1 #542.c4a60183: A text control with max_bytes 16,384 and lines many, committed with the program 'set a 1\nop add b
// a 2\nend' (24 bytes), reaches a logic item's read region as u32 24, those 24 bytes and 4 zero bytes, and a fixture
// logic that echoes the length into an array reads 24; a paste of 16,385 bytes is refused whole with a notice naming
// the cap, and the field keeps its text; a save at step 300, opened again and played on, reaches the same full-state
// hash as a straight run; and a planted control that normalizes to NFC turns a typed e followed by U+0301 (3 bytes) into
// é (2 bytes) and fails, naming the entry
//
// Through `deep-show run` (README: The surface under test): the text fixture with `program` (max_bytes 16,384, lines
// many) and `echo` reading it; Tab focuses the field, the program is typed line by line (Enter adds a line), a paste of
// 16,385 bytes is tried, and Cmd+Enter commits. The commit's entry is read from `appended`, the notice from `see`'s
// announcements, and what the logic item read from #539's `logic` call (echo's `len` and `head`, the slot's first 32
// bytes). The save goes through `deep-logic` (#534's `bake` with a `saves_dir`, then `open_save` in a second process),
// on a track holding that entry and one more commit after step 300; `echo` asks for slot 1 at the end of step 299. The
// planted `text_normalizes_nfc` (README: Planted twins) normalizes the field's text to NFC.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SAVE_STEP, echoProgram, wordsToBytes } from './programs.ts';
import { PROGRAM_TEXT, logicPiece, textDoc } from './fixtures.ts';
import {
  AC, DOC, STEP, Script, TIMEOUT, appendedOf, binOf, entriesText, entryName, failsNaming, focusOf, hexOf, ints, intsOf, isObject, logicOf, none,
  num, obj, once, prebuild, presented, putEvidence, runLogic, runShow, scenario, seenOf, show, stepsAndCheckpoints, str, useTemp,
  type JsonObject, type ShowPlanted,
} from './helpers.ts';

prebuild('deep-show', 'deep-logic');
const temp = useTemp();
const D = DOC(1);
const PROGRAM = { id: 'program', label: 'Program', maxBytes: 16_384, lines: 'many' as const };
const CAP = 16_384;
const PASTE = 'x'.repeat(CAP + 1);
/** Two seconds of steps: the commit lands near 0.8 s. */
const STEPS = 120;
/** The straight run and the reopened one: to step 600, with a second commit read at step 400. */
const END = 600;
const SAVED_AT = SAVE_STEP + 1;
const LATER = { step: 400, text: 'end' };

const programBytes = Buffer.from(PROGRAM_TEXT, 'utf8');

interface Typed {
  /** The criterion's failures for the commit, its read and the paste. */
  commit: string[];
  read: string[];
  paste: string[];
  entry: JsonObject | null;
}

/** Types the program into the focused field: each line as typed text, Enter between lines (lines many). */
function typeProgram(s: Script): number[] {
  const lines = PROGRAM_TEXT.split('\n');
  const out: number[] = [];
  lines.forEach((l, i) => { out.push(s.text(l)); if (i < lines.length - 1) out.push(s.key('Enter')); });
  return out;
}

/** The text fixture presented, focused by Tab, the program typed, the paste tried, Cmd+Enter, `see`, `logic`. */
function typed(): Typed {
  const ev = temp();
  const echo = echoProgram();
  putEvidence(ev, echo.bytes);
  const s = new Script();
  s.present(D, textDoc('program', echo, PROGRAM));
  const tab = s.key('Tab');
  const typing = typeProgram(s);
  const paste = s.paste(PASTE);
  const pasteAt = s.now;
  const commit = s.key('Enter', ['cmd']);
  const seen = s.see();
  const logic = s.logic(D, STEPS);
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls), 'AC1 the program typed, a paste tried, the commit');
  presented(r[0]!, 'the text fixture');
  expect(focusOf(r[tab]!, 'after Tab'), 'the fixture: Tab focuses the text control').toBe('program');

  const commitF: string[] = [];
  const early = [...typing, paste].flatMap((i) => appendedOf(r[i]!, `call ${i}`));
  if (early.length) commitF.push(`typing and the paste append ${entriesText(early)}; only the commit writes an entry`);
  const entries = appendedOf(r[commit]!, 'Cmd+Enter');
  const entry = entries.length === 1 ? entries[0]! : null;
  const value = entry && typeof entry['value'] === 'string' ? Buffer.from(entry['value'], 'utf8') : null;
  if (!entry || entry['control'] !== 'program' || entry['writer'] !== 'you' || !value || !value.equals(programBytes))
    commitF.push(`Cmd+Enter appends ${entriesText(entries)}, not one entry of program by you holding the program's 24 bytes (${hexOf(programBytes)})`);

  // The paste: refused whole (nothing in the field changed, so the commit holds the program alone) with a notice naming the cap.
  const pasteF: string[] = [];
  const notices = seenOf(r[seen]!, 'see').announcements.filter((a) => a.id === 'program' && (a.t === null || a.t >= pasteAt) && intsOf(a.text).includes(CAP));
  if (!notices.length) pasteF.push(`no announcement of program names the cap 16,384 after the paste; announcements: ${show(seenOf(r[seen]!, 'see').announcements, 800)}`);
  if (value && !value.equals(programBytes)) pasteF.push(`the field didn't keep its text: the commit after the paste holds ${value.length} B (${hexOf(value.subarray(0, 40))}…), not the program's 24`);

  const readF: string[] = [];
  const run = logicOf(r[logic]!, 'the logic run');
  const t = entry && typeof entry['t'] === 'number' ? entry['t'] : null;
  if (entry && t !== null) {
    // The step that reads the commit: the first whose time is at or after the entry's stamp.
    const k = Math.ceil(t / STEP);
    const len = ints(run, k, 'echo.len');
    const head = ints(run, k, 'echo.head');
    if (!len || !head || head.length !== 8) readF.push(`step ${k}, the first at or after the commit's stamp (t ${t}), reports no echo.len and eight echo.head words: ${show(run.steps.find((x) => x.step === k) ?? null, 500)}`);
    else {
      const region = wordsToBytes(head);
      const want = Buffer.concat([Buffer.from([24, 0, 0, 0]), programBytes, Buffer.alloc(4)]);
      if (!region.equals(want)) readF.push(`step ${k} reads its region's first 32 bytes as ${hexOf(region)}, not u32 24, the program's 24 bytes and 4 zero bytes (${hexOf(want)})`);
      if (len[0] !== 24) readF.push(`the fixture logic echoes the length ${len[0]} at step ${k}, not 24`);
    }
    const others = run.steps.filter((x) => x.step !== k && (ints(run, x.step, 'echo.len')?.[0] ?? 0) !== 0).map((x) => x.step);
    if (others.length) readF.push(`steps ${others.slice(0, 8).join(', ')} read a commit too; only step ${k} reads it, once`);
    if (run.steps.length !== STEPS) readF.push(`the logic run reports ${run.steps.length} steps, not ${STEPS}`);
  } else readF.push('no committed entry carries a flick time, so no step can read it');
  return { commit: commitF, read: readF, paste: pasteF, entry };
}
const honest = once(typed);

/** A typed e, then U+0301, committed (planted or not): the one entry's bytes and the criterion's failures. */
function combining(planted?: ShowPlanted): { failures: string[]; bytes: Buffer | null } {
  const ev = temp();
  const echo = echoProgram();
  putEvidence(ev, echo.bytes);
  const s = new Script();
  s.present(D, textDoc('program', echo, PROGRAM));
  s.key('Tab');
  s.text('e');
  s.text('́');
  const commit = s.key('Enter', ['cmd']);
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls, planted ? { planted } : {}), 'AC1 e and U+0301 committed');
  presented(r[0]!, 'the text fixture');
  const entries = appendedOf(r[commit]!, 'Cmd+Enter');
  const e = entries.length === 1 && entries[0]!['control'] === 'program' && typeof entries[0]!['value'] === 'string' ? entries[0]! : null;
  if (!e) return { failures: [`Cmd+Enter appends ${entriesText(entries)}, not one entry of program`], bytes: null };
  const bytes = Buffer.from(str(e['value'], 'the entry\'s value'), 'utf8');
  const want = Buffer.from('é', 'utf8');
  return { failures: bytes.equals(want) ? [] : [`the entry ${entryName(e)} holds ${hexOf(bytes)} (${bytes.length} B), not ${hexOf(want)} (3 B), e then U+0301 as typed`], bytes };
}

const saves: string[] = [];
afterAll(() => { for (const d of saves.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe(`${AC[1]} a text control carries up to 16 KiB of UTF-8 to logic as one entry, saved and replayed as typed`, () => {
  it(`${AC[1]} the program committed with lines many reaches the read region as u32 24, its 24 bytes and 4 zero bytes, and the echo logic reads 24`, () => {
    none([...honest().commit, ...honest().read], 'the commit and the logic item\'s read of it');
  }, TIMEOUT);

  it(`${AC[1]} a paste of 16,385 bytes is refused whole with a notice naming the cap, and the field keeps its text`, () => {
    none(honest().paste, 'the paste past the cap');
  }, TIMEOUT);

  it(`${AC[1]} a save at step 300, opened again and played on, reaches the same full-state hash as a straight run`, () => {
    const entry = honest().entry;
    expect(entry, `the commit's entry, to put on the saved piece's track: ${show(honest().commit)}`).not.toBeNull();
    const t = num(entry!['t'], 'the commit\'s stamp');
    expect(t, 'the fixture: the commit is read before the save at step 300').toBeLessThan(SAVE_STEP * STEP);
    const first = { t, seq: typeof entry!['seq'] === 'number' ? entry!['seq'] : 0, control: 'program', value: str(entry!['value'], 'the entry\'s value'), writer: 'you', player: 1 };
    const track = [first, { t: LATER.step * STEP, seq: 0, control: 'program', value: LATER.text, writer: 'you', player: 1 }];
    const echo = echoProgram();
    const p = logicPiece(echo);
    const dir = mkdtempSync(join(tmpdir(), 'deep-542-saves-'));
    saves.push(dir);
    // The straight run saves (one process, which then exits: the app quit), and a second process opens the save.
    const [straightReply] = runLogic([{ call: 'bake', piece: p, track, steps: END, saves_dir: dir }], 'AC1 the straight run, which saves at step 300');
    expect(straightReply!['ok'], `the straight run bakes: ${show(straightReply, 1200)}`).toBe(true);
    const straight = stepsAndCheckpoints(straightReply!, 'the straight run');
    const written = (Array.isArray(straightReply!['saves']) ? straightReply!['saves'] : []).filter(isObject);
    expect(written.map((w) => w['step']), `echo asks for slot 1 at the end of step ${SAVE_STEP}: one save, at step 300 (${show(written, 600)})`).toEqual([SAVED_AT]);
    // The fixture's state depends on both commits: the straight run reads 24 bytes, then 3.
    const firstStep = Math.ceil(t / STEP);
    expect([ints({ steps: straight.steps }, firstStep, 'echo.len')?.[0], ints({ steps: straight.steps }, LATER.step, 'echo.len')?.[0]], `the straight run reads the commit (24 B) at step ${firstStep} and "end" (3 B) at step ${LATER.step}`).toEqual([24, 3]);

    const [openReply] = runLogic([{ call: 'open_save', piece: p, saves_dir: dir, slot: 1, track, steps: END }], 'AC1 the save at step 300, opened again');
    expect(openReply!['ok'], `the save opens: ${show(openReply, 1200)}`).toBe(true);
    const opened = obj(openReply!['opened'], 'opened');
    expect(opened['step'], 'the save opens at step 300').toBe(SAVED_AT);
    const reopened = stepsAndCheckpoints(openReply!, 'the reopened run');
    const deep = obj(openReply!['deep_hash'], 'the opened state\'s full-state hash');
    const at = (c: Record<string, { step: number; deep_hash: string }[]>, k: number): string | undefined => c['echo']?.find((x) => x.step === k)?.deep_hash;
    const failures: string[] = [];
    if (deep['echo'] !== at(straight.checkpoints, SAVED_AT)) failures.push(`the opened state's full-state hash ${String(deep['echo'])} isn't the straight run's at step 300, ${String(at(straight.checkpoints, SAVED_AT))}`);
    for (const c of straight.checkpoints['echo'] ?? []) {
      if (c.step < SAVED_AT || c.step > END) continue;
      const got = at(reopened.checkpoints, c.step);
      if (got !== c.deep_hash) { failures.push(`at checkpoint ${c.step} the reopened run's full-state hash is ${got ?? 'none'}, the straight run's ${c.deep_hash}`); break; }
    }
    if (at(reopened.checkpoints, END) === undefined) failures.push(`the reopened run reports no checkpoint at step ${END}, where the run ends`);
    for (const row of reopened.steps) {
      const s = straight.steps.find((x) => x.step === row.step);
      if (!s || s.row !== row.row) { failures.push(`step ${row.step}'s hashes and arrays differ from the straight run's`); break; }
    }
    if (reopened.steps.length !== END - SAVED_AT) failures.push(`the reopened run reports ${reopened.steps.length} steps, not steps 300 to 599`);
    none(failures, 'the save at step 300, opened and played on, against the straight run');
  }, TIMEOUT);

  it(`${AC[1]} a typed e then U+0301 commits 3 bytes, and planted text_normalizes_nfc turns them into é (2 bytes) and fails, naming the entry`, () => {
    none(combining().failures, 'e then U+0301, committed');
    const twin = combining('text_normalizes_nfc');
    expect(twin.bytes ? hexOf(twin.bytes) : null, 'the planted control commits é, c3 a9 (2 bytes)').toBe('c3 a9');
    failsNaming(twin.failures, [/control: program, t: \d+/, /c3 a9/], 'the planted NFC control');
  }, TIMEOUT);
});

