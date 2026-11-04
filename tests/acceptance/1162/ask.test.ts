// AC6: "Pointing at the formula's part `#eq` in the popped-out window, paused at 1.5 s, and typing "too small" gives the
// test agent's session one message with that handle, t in flicks, the revision you saw and precision id, your words
// apart; the title's text arrives only as quote. A planted box that drops doc_rev or folds the quote into your words
// fails, naming the field"
//
// asserts: in the app world (#400's two displays), you pop the view out onto B, pause its playhead at 1.5 s (#384's
// playhead control) and ask with the pointer on the centre of the formula's `=` (its part `eq`, placed from the
// formula's bounds at 1.5 s that deep_query gives and the SVG's own geometry, README), typing "too small". The agent's
// session then holds exactly one message (#384's `messages`): words exactly "too small"; `attachment.handles` exactly
// `doc:<DOC>#formula#eq`; `t` 1.5 s in flicks (1,058,400,000); `doc_rev` the current revision; `precision` `id`;
// `quote` exactly the title's text (the label in depth, the title's text, lies under the pointer, README); the title's
// text in no other string of the message; no attachment field outside #384's list. #384's planted `box_drops_doc_rev`
// and `box_folds_quote` each fail, naming the field.
// Wrong programs: a box that sends the part's item without the part, the clock's time instead of the paused frame's,
// another revision, a region; a quote folded into your words, or document text sent as your words.
import { describe, expect, it } from 'vitest';
import {
  B, DOC, Driver, PANEL, REVISIONS, TITLE, AGENT, arr, boxOf, clickPanel, current, failsNaming, importTable, isObject, keepProof, none, obj, piece, popOut,
  query, runShow, sameDoc, scenario, sec, seedStore, show, shown, useBuilds, useDir,
  type JsonObject, type JsonValue, type ShowPlanted,
} from './helpers.ts';

const builds = useBuilds(['deep-show']);
const dir = useDir();
const PAUSE = sec(1.5);
/** The `=` sign's centre in the formula's own 240 × 64 (fixtures/formula.svg: two bars at x 40–64, y 22–42). */
const EQ: [number, number] = [52, 32];
const ALLOWED = ['handles', 't', 'doc_rev', 'precision', 'region', 'u', 'quote'];

interface Asked { message: JsonObject; rev: number; count: number }
function ask(planted?: ShowPlanted): Asked {
  const what = `AC6 point and ask${planted ? ` (planted ${planted})` : ''}`;
  const evidence = dir();
  seedStore(evidence);
  const bin = builds.bin('deep-show');
  // Where the formula is at 1.5 s: deep_query in a run of the hub without the display clock (there `at` is the call's
  // flick, so deep_query's own `at` can't be sent).
  const [[, , q]] = runShow(bin, [scenario(evidence, [importTable(), show(piece()), query({ paths: ['items/formula/bounds'], at: ['1.5s'] })])], `${what}: the formula at 1.5 s`) as [[JsonObject, JsonObject, JsonObject]];
  const d = new Driver(bin, { evidence, ...(planted ? { planted } : {}) });
  const f = boxOf(arr(obj(q['values'], `${what}: values (${shown(q)})`)['items/formula/bounds'], 'values')[0], `${what}: the formula's bounds at 1.5 s`);
  const serial = clickPanel(d, sec(0.2), what);
  const popped = d.one(popOut(sec(0.4), B.uuid, serial), `${what}: pop out onto B`);
  expect(popped['code'], `${what}: the pop-out opens a window: ${shown(popped)}`).toBeUndefined();
  const rev = current(d.one({ ...REVISIONS, at: sec(0.5) }, `${what}: revisions`), what).rev;
  const pointer = [f.minX + (EQ[0] * (f.maxX - f.minX)) / 240, f.minY + (EQ[1] * (f.maxY - f.minY)) / 64];
  const [, sent, inbox] = d.step([
    { call: 'input', at: sec(1.0), panel: PANEL, event: { type: 'control', control: 'playhead', value: PAUSE } },
    { call: 'ask', at: sec(1.2), panel: PANEL, session: AGENT.id, words: 'too small', pointer },
    { call: 'messages', at: sec(1.4), session: AGENT.id },
  ], `${what}: pause, point and ask`);
  if (!planted) keepProof('ac6-ask.json', { pointer, sent: sent!, received: inbox! } as unknown as JsonObject);
  const messages = arr(obj(inbox, `${what}: messages`)['messages'], `${what}: messages (${shown(inbox)})`).map((m, i) => obj(m, `messages[${i}]`));
  return { message: messages[0] ?? {}, rev, count: messages.length };
}

/** Every string anywhere in a value, with where it is. */
function stringsIn(v: JsonValue | undefined, at: string, out: [string, string][] = []): [string, string][] {
  if (typeof v === 'string') out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => stringsIn(x, `${at}[${i}]`, out));
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) stringsIn(x, at ? `${at}.${k}` : k, out);
  return out;
}

function messageFailures(a: Asked): string[] {
  const f: string[] = [];
  if (a.count !== 1) f.push(`AC6 messages: the session holds ${a.count} messages, not one`);
  const m = a.message;
  const att = isObject(m['attachment']) ? m['attachment'] : {};
  if (m['words'] !== 'too small') f.push(`AC6 words: ${shown(m['words'])}, not exactly "too small"`);
  const handles = Array.isArray(att['handles']) ? att['handles'] : [];
  const want = `doc:${DOC}#formula#eq`;
  if (handles.length !== 1 || typeof handles[0] !== 'string' || !sameDoc(handles[0], want)) f.push(`AC6 handles: ${shown(att['handles'])}, not [${want}]`);
  if (att['t'] !== PAUSE) f.push(`AC6 t: ${shown(att['t'])}, not ${PAUSE} flicks (1.5 s, the paused frame)`);
  if (att['doc_rev'] !== a.rev) f.push(`AC6 doc_rev: ${shown(att['doc_rev'])}, not ${a.rev}, the revision you saw`);
  if (att['precision'] !== 'id') f.push(`AC6 precision: ${shown(att['precision'])}, not id`);
  if (att['quote'] !== TITLE) f.push(`AC6 quote: ${shown(att['quote'])}, not the title's text ${JSON.stringify(TITLE)}`);
  for (const k of Object.keys(att)) if (!ALLOWED.includes(k)) f.push(`AC6 attachment: an unlisted field ${k}`);
  for (const [at, s] of stringsIn(m, '')) if (at !== 'attachment.quote' && s.includes(TITLE)) f.push(`AC6 quote: the title's text arrives at ${at}, not only as quote`);
  return f;
}

describe('AC6 point and ask in the popped-out window', () => {
  it('AC6 pointing at #eq paused at 1.5 s and typing "too small" gives one message with the handle, t, doc_rev and precision id, your words apart and the title\'s text only as quote; planted boxes that drop doc_rev or fold the quote fail, naming the field', () => {
    none(messageFailures(ask()), 'AC6 the message as received');
    const dropped = messageFailures(ask('box_drops_doc_rev'));
    const folded = messageFailures(ask('box_folds_quote'));
    keepProof('ac6-planted.json', { box_drops_doc_rev: dropped, box_folds_quote: folded });
    failsNaming(dropped, ['AC6 doc_rev'], 'AC6 the planted box_drops_doc_rev');
    failsNaming(folded, ['AC6 quote'], 'AC6 the planted box_folds_quote');
  }, 1_800_000);
});
