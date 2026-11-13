// AC1, AC2, AC3, AC4, AC6, AC7 and AC14, judged on one journey through the fixture machine (README, The journey):
// Claude Code and Codex installed with a session each in their history, pi absent, nothing of DeepBuild yet. The replica
// (`deep-drive`) opens the app's first launch there as a fresh account (`notifications: "not_asked"`), on the wall clock;
// its Set up runs the real `deep setup` from the login shell's PATH, whose hub the login service stand-in starts. Then,
// with no further input, the window moves on; an ask comes due; the hub's record is read; the take-it-back line's routes
// are tried; and `deep setup --undo` runs. Each test judges its part of what the journey saw. The wrong programs are in
// plants.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentFailures, blocked, bytesFailures, bytesOf, cleanup, controlFailures, deep, deepLog, eventFailures, events, feedAsk, FIRST_LAUNCH, firstLaunch,
  hubAnswers, ID, leavesFailures, listedOf, makeHome, MIN, notificationFailures, opensFailures, pressSetUp, routeFailures, settingsFiles, setupEnded,
  shown, sleep, termFailures, undoLineOf, until, wordTable, type Ev, type Home, type Ran, type Screen, type Trace,
} from './helpers.ts';

afterAll(cleanup, 120_000);

interface Journey {
  h: Home;
  /** The first-launch screen, before the click. */
  before: Screen;
  bytes: Map<string, Buffer | null>;
  /** Why the part after the click has nothing to judge, when it hasn't. */
  broke?: string;
  /** The window once it left the first-launch page, or when Set up said it stopped. */
  after?: Screen;
  ask?: string;
  trace?: Trace;
  events?: Ev[];
  routes?: string[];
  undo?: Ran;
  bytesAfter?: Map<string, Buffer | null>;
}

async function walk(): Promise<Journey> {
  const h = makeHome({ history: true });
  const bytes = bytesOf(settingsFiles(h));
  const { d, screen: before } = await firstLaunch(h, { notifications: 'not_asked' });
  const j: Journey = { h, before, bytes };
  try {
    await pressSetUp(d);
    await until(d, (s) => s.page?.id !== FIRST_LAUNCH || setupEnded(h) !== undefined, 6 * MIN);
    // The window may move on a moment after setup ends: no input, only the clock.
    j.after = await until(d, (s) => s.page?.id !== FIRST_LAUNCH, 30_000);
    const ended = setupEnded(h);
    if (ended !== 0) j.broke = `BLOCKED: Set up didn't work on the fixture machine, so nothing after it can be judged: the deep it ran logged ${JSON.stringify(deepLog(h))}`;
    j.ask = await feedAsk(d);
    await d.wait(4000);
    j.trace = await d.close();
  } catch (error) {
    j.broke ??= `the click's half of the journey broke: ${String(error)}`;
  } finally {
    await d.stop();
  }
  if (j.broke) return j;
  if (!(await hubAnswers(h))) { j.broke = 'BLOCKED: after a Set up that worked no hub answers at ~/.deepbuild/hub.sock'; return j; }
  // setup's events, once the record holds the first and a moment more has passed.
  const deadline = Date.now() + MIN;
  while (Date.now() < deadline && !(await events(h)).some((e) => e.kind === 'setup.step')) await sleep(1000);
  await sleep(3000);
  j.events = await events(h);
  const line = undoLineOf(before).line;
  j.routes = line ? await routeFailures(h, line, listedOf(before).agents, true) : [];
  j.undo = await deep(h, ['setup', '--undo']);
  j.bytesAfter = bytesOf(settingsFiles(h));
  return j;
}

let journey: Journey | undefined;
let failed: unknown;
beforeAll(async () => {
  try { journey = await walk(); } catch (error) { failed = error; }
}, 60 * MIN);
const walked = (): Journey => {
  if (failed !== undefined || !journey) throw failed instanceof Error ? failed : Error(`the journey didn't run: ${String(failed)}`);
  return journey;
};
/** The journey's part after the click, or its failure. */
const clicked = (): Required<Pick<Journey, 'after'>> & Journey => {
  const j = walked();
  if (j.broke !== undefined) { if (j.broke.startsWith('BLOCKED:')) blocked(j.broke.slice(9)); throw Error(j.broke); }
  if (!j.after) throw Error('the journey has no screen after the click');
  return j as Required<Pick<Journey, 'after'>> & Journey;
};

describe(`AC1 ${ID.agents} the agents and steps on the screen are setup's`, () => {
  it(`AC1 ${ID.agents}: with Claude Code and Codex installed and pi absent, the screen names Claude Code and Codex and not pi, and after the click the record's setup events name exactly the agents and steps the screen listed`, () => {
    const j = walked();
    const screen = agentFailures(j.before);
    expect(screen, 'the first-launch screen').toEqual([]);
    const after = clicked();
    expect(eventFailures(listedOf(j.before), after.events ?? []), "the record's setup.step events against the screen's list").toEqual([]);
  });
});

describe(`AC2 ${ID.oneButton} one button`, () => {
  it(`AC2 ${ID.oneButton}: the first-launch screen has one button, Set up, and no other control that writes`, () => {
    expect(controlFailures(walked().before)).toEqual([]);
  });
});

describe(`AC3 ${ID.undo} taking it back`, () => {
  it(`AC3 ${ID.undo}: after Set up, deep setup --undo leaves both agents' settings byte for byte as before, and the screen's take-it-back line names that route and only routes that exist`, () => {
    const j = walked();
    const { failures: line } = undoLineOf(j.before);
    expect(line, "the screen's take-it-back line").toEqual([]);
    const after = clicked();
    expect(after.routes, 'each route the take-it-back line names').toEqual([]);
    if (after.undo?.code !== 0) expect.fail(`deep setup --undo, the OS confirming you, must exit 0: ${after.undo ? shown(after.undo) : 'it never ran'}`);
    expect(bytesFailures(j.bytes, after.bytesAfter ?? new Map()), "both agents' settings after deep setup --undo").toEqual([]);
  });
});

describe(`AC4 ${ID.words} every term with its meaning`, () => {
  it(`AC4 ${ID.words}: no term of the One word per idea table is on the first-launch screen without the table's Means text beside it, read from the table itself`, () => {
    expect(termFailures(walked().before, wordTable())).toEqual([]);
  });
});

describe(`AC6 ${ID.opens} what opens after Set up`, () => {
  it(`AC6 ${ID.opens}: after a Set up that works, with no further input, the window shows the first open ask, the latest project or the box`, () => {
    expect(opensFailures(clicked().after)).toEqual([]);
  });
});

describe(`AC7 ${ID.notifications} notifications are asked for at the click`, () => {
  it(`AC7 ${ID.notifications}: on a fresh account the app's notification setting reads not asked before the click and no longer after it, and its first request to macOS came before any ask came due`, () => {
    const j = clicked();
    expect(notificationFailures({ before: j.before.seen.notifications?.setting, after: j.after.seen.notifications?.setting, ask: j.ask ?? '', trace: j.trace ?? {} })).toEqual([]);
  });
});

describe(`AC14 ${ID.leaves} what leaves this Mac`, () => {
  it(`AC14 ${ID.leaves}: with setup's reading jobs listed on the first-launch screen, nothing on it says that nothing leaves this Mac`, () => {
    expect(leavesFailures(walked().before)).toEqual([]);
  });
});
