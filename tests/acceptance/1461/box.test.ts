// AC16, AC23 and AC26: the box. On an ask's page the box is the card's words; elsewhere it starts work. The replica on a
// copy of a real hub's record: an open choice and an open approval to push (with its plan), and a session with none.
// What the app sends the hub is read from the replica's trace (README, Pinned 5); the box keeps #1998's ids.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  askOf, byId, cleanup, ID, makeWorld, MIN, pageOf, replicaOf, runsIn, sessionOf, textInputs, type HubCall, type SessionSpec, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const KEEP = 'Keep the cart on SQLite or plain files?';
const PUSH = 'Push feat/cart to origin?';
const SPECS: SessionSpec[] = [
  { key: 'b1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'choice', question: KEEP }] },
  { key: 'b2', project: 'shop', title: 'Release the cart', state: 'finished', asks: [{ kind: 'authority', question: PUSH, plan: { does: 'git push origin feat/cart', changes: ['origin/feat/cart'] } }] },
  { key: 'b3', project: 'docs', title: 'Release notes', state: 'finished' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 10 * MIN);
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 240);
const addressOf = (handle: string): string => `ask/${handle.slice('ask:'.length)}`;
/** Every call the press made but the one answer: each a call that starts work or writes something else. */
const others = (hub: HubCall[], ask: string): HubCall[] => hub.filter((c) => !(c.method === 'ask.answer' && c.params.ask === ask) && c.method !== 'row.read');

/** Types `words` in the ask's page's one field and sends it; what was wrong, what the send control read, the hub's calls. */
async function sendOnAsk(question: string, words: string, plant?: string): Promise<{ out: string[]; control: string | null; hub: HubCall[]; listed: boolean }> {
  const ask = askOf(world, question);
  const r = await replicaOf(world, {}, plant);
  const out: string[] = [];
  try {
    await r.open(addressOf(ask.handle));
    await r.waitValue('question-card', 'armed');
    const page = pageOf((await r.see()).snapshot);
    if (!page) return { out: ['the ask\'s page has no one page node'], control: null, hub: [], listed: true };
    const fields = textInputs(page);
    if (fields.length !== 1) out.push(`the ask's page holds ${fields.length} text fields, not one: ${fields.map((f) => `${f.role} ${said(f.id)}`).join(' and ')}`);
    const field = fields.find((f) => f.id === 'box-draft') ?? fields[0];
    if (!field || typeof field.id !== 'string') return { out: [...out, 'the ask\'s page has no text field with an id to type in'], control: null, hub: [], listed: true };
    await r.type({ id: field.id }, words);
    await r.wait(300);
    const control = byId((await r.see()).snapshot, 'box-send')?.name ?? null;
    await r.click({ id: 'box-send' }, 'pressing the box\'s send control');
    await r.wait(500);
    const listed = (await r.see()).rows.some((x) => x.id === ask.handle);
    const { hub } = await r.close();
    if (!hub) out.push('the trace keeps no hub calls (README, Pinned 5)');
    return { out, control, hub: hub ?? [], listed };
  } finally {
    await r.stop();
  }
}

describe(`AC16 ${ID.oneField} one text field on an ask's page`, () => {
  const WORDS = 'keep it, but smaller';
  const failures = async (plant?: string): Promise<string[]> => {
    const ask = askOf(world, KEEP);
    const { out, hub, listed } = await sendOnAsk(KEEP, WORDS, plant);
    const answers = hub.filter((c) => c.method === 'ask.answer' && c.params.ask === ask.handle);
    if (answers.length !== 1) out.push(`the send made ${answers.length} answers to ${ask.handle}, not one: ${said(hub)}`);
    for (const a of answers) {
      if (a.params.words !== WORDS) out.push(`the answer to ${ask.handle} carries words ${said(a.params.words)}, not "${WORDS}"`);
      if (a.params.option !== undefined && a.params.option !== null) out.push(`the answer to ${ask.handle} picked the option ${said(a.params.option)}: the words alone answer it`);
    }
    if (listed) out.push(`${ask.handle} is still an open row after its answer was sent`);
    for (const c of others(hub, ask.handle)) out.push(`the send from the ask's page also made ${c.method} ${said(c.params)}, which starts a session`);
    return out;
  };
  it(`AC16 ${ID.oneField}: an ask's page holds exactly one text field; "${WORDS}" typed there and sent closes that ask with those words and starts no session`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC16 ${ID.oneField} wrong program: a planted page with a field on the card and a box below fails, naming both`, async () => {
    expect((await failures('card-field-and-box')).join('\n')).toMatch(/holds 2 text fields, not one: \S+ \S+ and \S+ \S+/);
  }, 30 * MIN);

  it(`AC16 ${ID.oneField} wrong program: a planted box that starts work from an ask's page fails, naming the session`, async () => {
    expect((await failures('box-starts-work')).join('\n')).toMatch(/also made \S+ .*which starts a session/);
  }, 30 * MIN);
});

describe(`AC23 ${ID.sayNo} words on an approval say no`, () => {
  const WORDS = 'yes, but squash first';
  const failures = async (plant?: string): Promise<string[]> => {
    const ask = askOf(world, PUSH);
    const deny = ask.options.find((o) => o.decision === 'deny')!.id;
    const { out, control, hub, listed } = await sendOnAsk(PUSH, WORDS, plant);
    if (control !== 'Say no') out.push(`before the press, the send control reads ${said(control)}, not "Say no"`);
    const answers = hub.filter((c) => c.method === 'ask.answer' && c.params.ask === ask.handle);
    if (answers.length !== 1) out.push(`the send made ${answers.length} answers to ${ask.handle}, not one: ${said(hub)}`);
    for (const a of answers) {
      const option = a.params.option;
      if (option !== undefined && option !== null && option !== deny) out.push(`the call ask.answer ${said(a.params)} reads the words as ${said(option)}, a yes: the push would run`);
      if (a.params.words !== WORDS) out.push(`the answer carries ${said(a.params.words)} as its reason, not "${WORDS}"`);
    }
    if (listed) out.push(`${ask.handle} is still an open row after its answer was sent`);
    for (const c of others(hub, ask.handle)) out.push(`the send also made ${c.method} ${said(c.params)}, which starts a session`);
    return out;
  };
  it(`AC23 ${ID.sayNo}: on a push's page, "${WORDS}" typed and sent: the control reads Say no before the press, the ask closes as no with those words as its reason, the push doesn't run and no session starts`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC23 ${ID.sayNo} wrong program: a planted page that reads the words as a yes fails, naming the call`, async () => {
    expect((await failures('words-read-yes')).join('\n')).toMatch(/the call ask\.answer .* reads the words as "approve", a yes/);
  }, 30 * MIN);
});

describe(`AC26 ${ID.boxGrows} the box grows from 2 to 10 lines, then scrolls`, () => {
  const failures = async (plant?: string): Promise<string[]> => {
    const page = `session/${sessionOf(world, 'b3').id}`;
    const r = await replicaOf(world, {}, plant);
    const out: string[] = [];
    try {
      await r.open(page);
      await r.wait(300);
      const heights = new Map<number, number>();
      let twelve: { runs: number; value: unknown; width: number; lane: number | undefined } | undefined;
      for (const n of [1, 2, 5, 10, 12]) {
        const text = Array.from({ length: n }, (_, i) => `line ${i + 1} of what I want changed`).join('\n');
        await r.must(`setting the box to ${n} lines`, { call: 'act', locator: { id: 'box-draft' }, act: { kind: 'set', value: text } });
        await r.wait(200);
        const s = (await r.see()).snapshot;
        const box = byId(s, 'box');
        if (!box) return ['the session\'s page has no box (a node with id "box")'];
        heights.set(n, box.bounds[3]!);
        if (n === 12) {
          const lines = new Set(runsIn(s, box.bounds).filter((x) => /^line \d+/.test(x.text)).map((x) => x.text));
          twelve = { runs: lines.size, value: byId(s, 'box-draft')?.value, width: box.bounds[2]!, lane: byId(s, 'lane')?.bounds[2] };
        }
      }
      const [h1, h2, h5, h10, h12] = [1, 2, 5, 10, 12].map((n) => heights.get(n)!);
      const line = (h10! - h1!) / 8;
      if (!(line > 0)) out.push(`the box doesn't grow: it is ${h1} px tall with 1 line and ${h10} px with 10`);
      if (Math.abs(h2! - h1!) > 1) out.push(`the box is ${h1} px tall with 1 line and ${h2} px with 2: it isn't 2 lines tall to start`);
      if (Math.abs(h5! - h1! - 3 * line) > 2) out.push(`the box is ${h5} px tall with 5 lines, not 3 lines (${3 * line} px) taller than with 1 (${h1} px)`);
      if (h12! > h10! + 1) out.push(`the box is ${h12! / 2} pt tall with 12 lines, taller than with 10 (${h10! / 2} pt): it grows past 10 lines`);
      if (twelve) {
        if (twelve.runs > 10) out.push(`the box draws ${twelve.runs} lines at once with 12 typed: it doesn't scroll`);
        if (!String(twelve.value ?? '').includes('line 12 of')) out.push(`the box's field holds ${said(twelve.value)}, not all 12 lines`);
        if (twelve.lane === undefined) out.push('the page has no lane (a node with id "lane") to hold the box to');
        else if (Math.abs(twelve.width - twelve.lane) > 2) out.push(`the box is ${twelve.width / 2} pt wide, not the lane's ${twelve.lane / 2} pt`);
      }
    } finally {
      await r.stop();
    }
    return out;
  };
  it(`AC26 ${ID.boxGrows}: the box grows from 2 to 10 lines and then scrolls, at the lane's width, read from the snapshot`, async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it(`AC26 ${ID.boxGrows} wrong program: a planted box that grows past 10 lines fails, naming its height`, async () => {
    expect((await failures('box-grows-past-10')).join('\n')).toMatch(/is [\d.]+ pt tall with 12 lines, taller than with 10 \([\d.]+ pt\): it grows past 10 lines/);
  }, 30 * MIN);
});
