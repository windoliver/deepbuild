// #1510, criteria 1, 3 and 4 through `deep inbox` (README: the contract per criterion). One hub, seeded before it
// starts with one ask per session (a session folds its asks past five, so each stands alone): two authority asks
// quoting a call, one with an escape and a return, one with a newline, each with a one-step plan running that call;
// and taste asks whose questions are plain text, Chinese, emoji, and one holding U+202E.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanup, deepBytes, ESC_CALL, events, expectNoControlBytes, linesOf, NEWLINE_CALL, questionOf, raiseCall, raiseQuestion,
  rowOf, seed, startHub, startSession, stopHub, tempDir, VISIBLE_ESC, type Bytes, type Hub,
} from './helpers.ts';

const PLAIN = 'Which header color for the checkout page?';
const CHINESE = '结账页面的标题用哪种颜色？';
// A rocket, a check mark, a thumbs-up with a skin tone, a heart with its emoji presentation selector (U+FE0F) and a
// family joined by zero-width joiners (U+200D): every one an emoji as people type them.
const EMOJI = 'Ship the new header? 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧';
const RLO = 'Open the attachment invoice\u202Etxt.exe for the review?';

let hub: Hub;
const handles: Record<string, string> = {};
let inbox: Bytes;

beforeAll(async () => {
  const home = tempDir();
  const t0 = Date.now() - 60_000;
  await seed(home, async (s) => {
    const each: [string, (session: string, at: number) => Promise<string>][] = [
      ['esc', (session, at) => raiseCall(s, session, ESC_CALL, at)],
      ['newline', (session, at) => raiseCall(s, session, NEWLINE_CALL, at)],
      ['plain', (session, at) => raiseQuestion(s, session, PLAIN, at)],
      ['chinese', (session, at) => raiseQuestion(s, session, CHINESE, at)],
      ['emoji', (session, at) => raiseQuestion(s, session, EMOJI, at)],
      ['rlo', (session, at) => raiseQuestion(s, session, RLO, at)],
    ];
    for (const [i, [name, raise]] of each.entries()) {
      const session = `S1510-${name}`;
      await startSession(s, session, t0 + i * 10);
      handles[name] = await raise(session, t0 + i * 10 + 1);
    }
  }, t0);
  hub = await startHub(home, { confirm: 'cancelled' });
  inbox = await deepBytes(home, ['inbox']);
}, 120_000);
afterAll(async () => {
  if (hub) await stopHub(hub);
  await cleanup();
});

const shown = (lines: readonly (string | undefined)[]) => lines.map((l) => JSON.stringify(l)).join('\n');

describe('#1510.54eb0445 an ask whose call holds an escape prints both commands with the escape as visible text, and deep inbox prints no control byte but its line ends', () => {
  it('#1510.54eb0445 deep inbox exits 0 and its stdout, read byte by byte, holds no control byte but its line ends', () => {
    expect(inbox.code, `deep inbox exits 0: ${inbox.stderr}`).toBe(0);
    expectNoControlBytes(inbox.stdout, 'deep inbox', Object.values(handles));
  });

  it('#1510.54eb0445 the ask\'s row shows both commands, in order, with the escape as visible text', () => {
    const { row } = rowOf(inbox.stdout, handles.esc!);
    expect(row, `deep inbox lists ${handles.esc} on a row of its own:\n${shown(linesOf(inbox.stdout).map((l) => l.bytes.toString('utf8')))}`).toBeDefined();
    const at = row!.indexOf('git push --force');
    expect(at, `the row of ${handles.esc} shows "git push --force": ${JSON.stringify(row)}`).toBeGreaterThanOrEqual(0);
    expect(row!.indexOf('git status', at), `the row of ${handles.esc} shows "git status" after "git push --force": ${JSON.stringify(row)}`).toBeGreaterThan(at);
    expect(row!.slice(at), `the row of ${handles.esc} shows the escape between the two commands as visible text (such as \\x1b): ${JSON.stringify(row)}`).toMatch(VISIBLE_ESC);
  });

  it('#1510.54eb0445 the ask\'s plan step shows the same call on one line, both commands and the escape visible', () => {
    const { row, under } = rowOf(inbox.stdout, handles.esc!);
    const step = under.find((l) => l.includes('git push --force'));
    expect(step, `deep inbox prints the plan step running the call under the row of ${handles.esc}:\n${shown([row, ...under])}`).toBeDefined();
    expect(step!, `the plan step under ${handles.esc} shows "git status" on the same line: ${JSON.stringify(step)}`).toContain('git status');
    expect(step!, `the plan step under ${handles.esc} shows the escape as visible text: ${JSON.stringify(step)}`).toMatch(VISIBLE_ESC);
  });

  it('#1510.54eb0445 a call holding a newline stays on the ask\'s row, and on its plan step\'s line', () => {
    const { row, under } = rowOf(inbox.stdout, handles.newline!);
    expect(row, `deep inbox lists ${handles.newline}`).toBeDefined();
    expect(row!, `the row of ${handles.newline} holds the whole call, both commands on the one line: ${JSON.stringify(row)}`).toContain('git push --force');
    expect(row!.slice(row!.indexOf('git push --force')), `the row of ${handles.newline} holds "git status" on the same line as "git push --force": ${JSON.stringify(row)}`).toContain('git status');
    const step = under.find((l) => l.includes('git push --force'));
    expect(step, `deep inbox prints the plan step running the call under the row of ${handles.newline}:\n${shown([row, ...under])}`).toBeDefined();
    expect(step!, `the plan step under ${handles.newline} holds "git status" on the same line: ${JSON.stringify(step)}`).toContain('git status');
  });
});

describe('#1510.f4b3f47a the ask in the record holds the original bytes', () => {
  it('#1510.f4b3f47a each ask\'s question and its plan\'s step, read back from the hub\'s record, are the bytes it was raised with', async () => {
    const all = await events(hub);
    const created = (handle: string) => all.find((e) => e.kind === 'ask.created' && (e.subject === handle || `ask:${e.id}` === handle));
    const plan = (handle: string) => all.find((e) => e.kind === 'plan.proposed' && e.data?.ask === handle);
    for (const [name, call] of [['esc', ESC_CALL], ['newline', NEWLINE_CALL]] as const) {
      const handle = handles[name]!;
      expect(created(handle)?.data.question, `${handle}'s ask.created holds the question as raised, its call byte for byte`).toBe(questionOf(call));
      expect(plan(handle)?.data.steps?.[0]?.does, `${handle}'s plan.proposed holds the step as raised, its call byte for byte`).toBe(call);
    }
    for (const [name, question] of [['rlo', RLO], ['plain', PLAIN], ['chinese', CHINESE], ['emoji', EMOJI]] as const) {
      expect(created(handles[name]!)?.data.question, `${handles[name]}'s ask.created holds its question as raised`).toBe(question);
    }
  });
});

describe('#1510.5fbd0a55 plain text, Chinese and emoji questions print unchanged', () => {
  for (const [name, question] of [['plain', PLAIN], ['chinese', CHINESE], ['emoji', EMOJI]] as const) {
    it(`#1510.5fbd0a55 deep inbox prints the ${name} question byte for byte on its ask's row`, () => {
      expect(inbox.code, `deep inbox exits 0: ${inbox.stderr}`).toBe(0);
      const { row } = rowOf(inbox.stdout, handles[name]!);
      expect(row, `deep inbox lists ${handles[name]}`).toBeDefined();
      expect(Buffer.from(row!, 'utf8').includes(Buffer.from(question, 'utf8')), `the row of ${handles[name]} holds the question's UTF-8 bytes unchanged: ${JSON.stringify(row)} against ${JSON.stringify(question)}`).toBe(true);
    });
  }
});
