// AC6 (blind redraft, A6-REDRAFT.md): "Pointing at the formula's part `#eq` in the popped-out window, paused at 1.5 s,
// and typing "too small" gives the test agent's session one message with that handle, t in flicks, the revision you
// saw and precision id, your words apart; the title's text arrives only as quote. A planted box that drops doc_rev or
// folds the quote into your words fails, naming the field"
//
// asserts: in the app world (#400's displays A and B) the view is popped out onto B, its playhead paused at 1.5 s
// (#384's playhead control), and you ask "too small" with the pointer on the `=` sign's ink (the centre of its upper
// bar), mapped into the popped-out window by the canvas rect `scope` reports there and the film's letterbox (Document
// envelope: `aspect`). The piece is the fixture with the title's text box centred on the `=` sign and the 3D label
// moved clear (A6-REDRAFT.md: why). The session then holds exactly one message: words exactly "too small";
// `handles` exactly `doc:<DOC>#formula#eq`; `t` 1,058,400,000 flicks; `doc_rev` the revision of the last frame the
// popped-out window presented before you asked; `precision` `id`; `quote` exactly the title's text; the title's text
// in no other string of the message. #384's planted `box_drops_doc_rev` and `box_folds_quote` each fail, naming the
// field.
// Wrong programs: the item without its part, the clock's time instead of the paused frame's, another revision, a
// geometry or region reference, no quote, a quote folded into your words or sent outside `quote`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT, B, DOC, Driver, PANEL, SIZE, TITLE, arr, boxOf, clickPanel, failsNaming, framesOf, importTable, isObject, keepProof, none, num, obj,
  piece, popOut, query, runShow, sameDoc, scenario, sec, seedStore, show, shown, str, useBuilds, useDir,
  type Box, type JsonObject, type JsonValue, type ShowPlanted,
} from './helpers.ts';

const builds = useBuilds(['deep-show']);
const dir = useDir();
const PAUSE = sec(1.5); // 1,058,400,000 flicks
const ASK_AT = sec(1.2); // before 1.5 s on the clock, so the clock's time and the paused frame's differ
const WORDS = 'too small';
/** fixtures/formula.svg: a 240 × 64 viewBox filled edge to edge; `eq` is two bars, x 40–64, y 22–28 and 36–42. */
const VIEW: [number, number] = [240, 64];
const EQ_CENTRE: [number, number] = [52, 32];
const EQ_INK: [number, number] = [52, 25];

const inFormula = (f: Box, [x, y]: [number, number]): [number, number] =>
  [f.minX + (x * (f.maxX - f.minX)) / VIEW[0], f.minY + (y * (f.maxY - f.minY)) / VIEW[1]];

/** The formula's evaluated box at 1.5 s (deep_query `items/formula/bounds`), from a run without the display clock. */
function formulaAt(evidence: string, doc: JsonObject, what: string): Box {
  mkdirSync(evidence, { recursive: true });
  seedStore(evidence);
  const [[, presented, q]] = runShow(builds.bin('deep-show'), [scenario(evidence, [importTable(), show(doc), query({ paths: ['items/formula/bounds'], at: ['1.5s'] })])], what) as [[JsonObject, JsonObject, JsonObject]];
  expect(presented['outcome'], `${what}: the piece is presented: ${shown(presented)}`).toBe('presented');
  return boxOf(arr(obj(q['values'], `${what}: values (${shown(q)})`)['items/formula/bounds'], `${what}: values`)[0], `${what}: the formula's bounds at 1.5 s`);
}

/** The piece with the title's text box centred on `eq` (u), and the label in depth moved clear of the formula. */
function titleOnEq(eq: [number, number]): JsonObject {
  const p = piece();
  const items = obj(p['items'], 'items');
  const title = obj(items['title'], 'items.title');
  const box = obj(obj(title['params'], 'title.params')['box'], 'title.params.box');
  title['at'] = { pos: [eq[0] - num(box['w'], 'box.w') / 2, eq[1] - num(box['h'], 'box.h') / 2, 0] };
  obj(items['label'], 'items.label')['at'] = { pos: [-6, -5.25, -1] };
  return p;
}

interface Asked { message: JsonObject; count: number; rev: number }
function ask(doc: JsonObject, f: Box, planted: ShowPlanted | undefined): Asked {
  const what = `AC6 point and ask${planted ? ` (planted ${planted})` : ''}`;
  const evidence = join(dir(), planted ?? 'app');
  mkdirSync(evidence, { recursive: true });
  const d = new Driver(builds.bin('deep-show'), { evidence, ...(planted ? { planted } : {}) }, doc);
  const serial = clickPanel(d, sec(0.2), what);
  const popped = d.one(popOut(sec(0.4), B.uuid, serial), `${what}: pop out onto B`);
  const win = str(obj(popped['window'], `${what}: the pop-out opens a window (${shown(popped)})`)['window'], `${what}: window`);
  // Where the view is in its own window: its canvas rect, the frame letterboxed into it, centred.
  const state = obj(obj(d.one({ call: 'scope', at: sec(0.5), panel: PANEL }, `${what}: scope`), `${what}: scope`)['state'], `${what}: scope.state`);
  const [rx, ry, rw, rh] = arr(state['rect'], `${what}: scope.state.rect`).map((v) => num(v, 'rect')) as [number, number, number, number];
  const s = Math.min(rw / SIZE[0], rh / SIZE[1]);
  const [u, v] = inFormula(f, EQ_INK);
  const pointer: [number, number] = [Math.round(rx + (rw - SIZE[0] * s) / 2 + u * s), Math.round(ry + (rh - SIZE[1] * s) / 2 + v * s)];
  const [, presented, sent, inbox] = d.step([
    { call: 'input', at: sec(1.0), panel: PANEL, event: { type: 'control', control: 'playhead', value: PAUSE } },
    { call: 'presented', at: ASK_AT - 1, panel: PANEL },
    { call: 'ask', at: ASK_AT, panel: PANEL, session: AGENT.id, words: WORDS, pointer },
    { call: 'messages', at: sec(1.4), session: AGENT.id },
  ], `${what}: pause, point and ask`);
  const seen = framesOf(presented, `${what}: presented`).filter((fr) => fr.window === win && fr.vsync <= ASK_AT).at(-1);
  expect(seen, `${what}: the popped-out window presented a frame before you asked`).toBeDefined();
  keepProof(`ac6-redraft-ask${planted ? `-${planted}` : ''}.json`, { pointer, scope: state, seen: seen!.rev, sent: sent!, received: inbox! } as unknown as JsonObject);
  const messages = arr(obj(inbox, `${what}: messages`)['messages'], `${what}: messages (${shown(inbox)})`).map((m, i) => obj(m, `messages[${i}]`));
  return { message: messages[0] ?? {}, count: messages.length, rev: seen!.rev };
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
  if (m['words'] !== WORDS) f.push(`AC6 words: ${shown(m['words'])}, not exactly ${JSON.stringify(WORDS)}`);
  if (typeof m['words'] === 'string' && m['words'].includes(TITLE)) f.push(`AC6 quote: the title's text is folded into your words ${JSON.stringify(m['words'])}`);
  const want = `doc:${DOC}#formula#eq`;
  const handles = att['handles'];
  if (!Array.isArray(handles) || handles.length !== 1 || typeof handles[0] !== 'string' || !sameDoc(handles[0], want)) f.push(`AC6 handles: ${shown(handles)}, not [${want}]`);
  if (att['t'] !== PAUSE) f.push(`AC6 t: ${shown(att['t'])}, not ${PAUSE} flicks (1.5 s, the paused frame)`);
  if (att['doc_rev'] !== a.rev) f.push(`AC6 doc_rev: ${shown(att['doc_rev'])}, not ${a.rev}, the revision of the frame you saw`);
  if (att['precision'] !== 'id') f.push(`AC6 precision: ${shown(att['precision'])}, not id`);
  if (typeof att['quote'] !== 'string' || !Buffer.from(att['quote'], 'utf8').equals(Buffer.from(TITLE, 'utf8'))) f.push(`AC6 quote: ${shown(att['quote'])}, not the title's text ${JSON.stringify(TITLE)} byte for byte`);
  for (const [at, s] of stringsIn(m, '')) if (at !== 'attachment.quote' && at !== 'words' && s.includes(TITLE)) f.push(`AC6 quote: the title's text arrives at ${at}, not only as quote`);
  return f;
}

describe('AC6 point and ask in the popped-out window (redraft)', () => {
  it('AC6 pointing at #eq paused at 1.5 s and typing "too small" gives one message with the handle, t, doc_rev and precision id, your words apart and the title\'s text only as quote; planted boxes that drop doc_rev or fold the quote fail, naming the field (redraft)', () => {
    const f0 = formulaAt(join(dir(), 'where'), piece(), 'AC6 the formula at 1.5 s');
    const doc = titleOnEq(inFormula(f0, EQ_CENTRE));
    // The formula is placed beside the chart, which the title doesn't touch; the title's 600 × 40 box must hold the `=`.
    const f = formulaAt(join(dir(), 'variant'), doc, 'AC6 the formula at 1.5 s, the title on it');
    const [px, py] = inFormula(f, EQ_INK);
    const [cx, cy] = inFormula(f0, EQ_CENTRE);
    expect(Math.abs(px - cx) <= 298 && Math.abs(py - cy) <= 18, `AC6: the \`=\` sign's ink (${px}, ${py}) lies inside the title's box centred at (${cx}, ${cy})`).toBe(true);

    none(messageFailures(ask(doc, f, undefined)), 'AC6 the message as received');
    const dropped = messageFailures(ask(doc, f, 'box_drops_doc_rev'));
    const folded = messageFailures(ask(doc, f, 'box_folds_quote'));
    keepProof('ac6-redraft-planted.json', { box_drops_doc_rev: dropped, box_folds_quote: folded });
    failsNaming(dropped, ['AC6 doc_rev'], 'AC6 the planted box_drops_doc_rev');
    failsNaming(folded, ['AC6 quote'], 'AC6 the planted box_folds_quote');
  }, 1_800_000);
});
