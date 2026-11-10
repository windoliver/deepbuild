// AC4 #1998.f21e951e "mute" in ⌘K opens the box with turning sounds off drafted beside sounds being on, and approving
// it turns them off; a ⌘K that matches names only returns nothing and fails.
//
// A home set up by `deep setup`, with sounds as setup leaves them (on), and one open ask in it (the box's proposal to
// remove DeepBuild from Codex, never answered), so the app has something to notify you of.
// 1. A replica over a copy of that home's record: ⌘K, "mute", its top entry clicked. The box must show a drafted change
//    that turns sounds off (box-draft: "sound" and "off", no "on") beside the current value, sounds on (box-current:
//    "sound" and "on", no "off"). Its notification of the open ask plays a sound: the control that sounds are on.
// 2. The drafted words go to the box (`box.say`), and you approve the change with `deep inbox answer <ask> apply`.
// 3. A second replica over a copy of the record: the open ask's notification is posted with no sound.
// The wrong programs: the base, whose ⌘K matches names only and has no box; and the issue's own, a ⌘K that matches
// names only, played in test code over every name the real ⌘K showed (README, Wrong programs).

import { afterAll, describe, expect, it } from 'vitest';
import { choose, Drive, launch, notifications, ranked, stopAll, type Box } from './drive.ts';
import { answer, cleanup, ID, inbox, isOpen, makeHome, say, setup, shown, sleep, waitFor, withCodex, type Ran } from './helpers.ts';

afterAll(async () => { await stopAll(); await cleanup(); }, 60_000);

type Posted = { ask?: string; text?: string; sound: string | null };
interface MuteRun {
  /** ⌘K's entries for no query and for "mute", in the first replica. */
  all: string[]; mute: string[];
  /** The box once ⌘K's top entry for "mute" was clicked, and the click's error if it had one. */
  shown: { clicked: string | null; box: Box; drawn: string[] } | null;
  before: Posted[]; approved: Ran | null; after: Posted[];
}

/** ⌘K that matches names only, as the base ranks: the exact name, a name starting with it, a word starting with it, a name holding it. */
const namesOnly = (q: string, names: readonly string[]): string[] => {
  const query = q.trim().toLowerCase();
  return names.filter((n) => { const name = n.toLowerCase(); return name === query || name.startsWith(query) || name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(query)) || name.includes(query); });
};

const off = (t: string | null) => t !== null && /sounds?/i.test(t) && /\boff\b/i.test(t) && !/\bon\b/i.test(t);
const on = (t: string | null) => t !== null && /sounds?/i.test(t) && /\bon\b/i.test(t) && !/\boff\b/i.test(t);

/** What the criterion says is wrong, one line each; none when it holds. */
function muteProblems(r: MuteRun): string[] {
  const out: string[] = [];
  if (!r.mute.length) return [`AC4 "mute" in ⌘K returned nothing; it must open the box with turning sounds off drafted beside sounds being on (⌘K listed ${JSON.stringify(r.all).slice(0, 400)} for no query)`];
  const s = r.shown;
  if (!s || s.clicked) return [`AC4 ⌘K's top entry for "mute", ${JSON.stringify(r.mute[0])}, didn't take a click: ${s?.clicked ?? 'not tried'}`];
  if (!s.box.box) out.push(`AC4 ⌘K's "${r.mute[0]}" for "mute" must open the box (id box); the window shows ${JSON.stringify(s.drawn).slice(0, 600)}`);
  if (!off(s.box.draft)) out.push(`AC4 the box must hold turning sounds off drafted (box-draft); it holds ${JSON.stringify(s.box.draft)}`);
  if (!on(s.box.current)) out.push(`AC4 the box must show sounds being on beside the draft (box-current); it shows ${JSON.stringify(s.box.current)}`);
  if (!r.before.some((n) => n.sound !== null)) out.push(`AC4 before the approval, the open ask's notification must play a sound (the control: sounds are on); the replica posted ${JSON.stringify(r.before).slice(0, 400)}`);
  if (!r.approved) out.push('AC4 the drafted change never reached the box to be approved');
  else if (!r.after.length) out.push(`AC4 after the approval, the replica must still notify you of the open ask, with no sound; it posted nothing (the approval: ${shown(r.approved)})`);
  else if (r.after.some((n) => n.sound !== null)) out.push(`AC4 approving "${s.box.draft}" must turn sounds off; the replica's notification still plays ${JSON.stringify(r.after.find((n) => n.sound !== null))} (the approval: ${shown(r.approved)})`);
  return out;
}

async function muteRun(): Promise<MuteRun> {
  const h = makeHome();
  withCodex(h);
  await setup(h);
  // Something for the app to notify you of: a proposed change you leave open.
  await say(h, 'remove DeepBuild from Codex');
  const first = await Drive.start(h.home);
  const r: MuteRun = { all: [], mute: [], shown: null, before: [], approved: null, after: [] };
  try {
    await launch(first, 'record_copy');
    r.all = await ranked(first, '');
    r.mute = await ranked(first, 'mute');
    if (r.mute.length) r.shown = await choose(first, 'mute', r.mute[0]!);
    r.before = await notifications(first);
  } finally {
    await first.stop();
  }
  const draft = r.shown?.box.draft;
  if (!draft) return r;
  const ask = await say(h, draft);
  r.approved = await answer(h, ask);
  await waitFor(async () => !isOpen((await inbox(h)).find((row) => row.ask === ask)), 30_000);
  await sleep(3000);
  const second = await Drive.start(h.home);
  try {
    await launch(second, 'record_copy');
    r.after = await notifications(second);
  } finally {
    await second.stop();
  }
  return r;
}

let once: Promise<MuteRun> | undefined;
const outcome = () => (once ??= muteRun());

describe(`${ID.ac4} "mute" in ⌘K opens the box with turning sounds off drafted beside sounds being on, and approving it turns them off; a ⌘K that matches names only returns nothing and fails`, () => {
  it(`${ID.ac4} ⌘K's "mute" opens the box drafting sounds off beside sounds on, and once that change is approved the app's notification plays no sound`, async () => {
    expect(muteProblems(await outcome())).toEqual([]);
  }, 600_000);

  it(`${ID.ac4} (wrong program) a ⌘K that matches names only, over every name the real ⌘K showed, returns nothing for "mute" and fails`, async () => {
    const r = await outcome();
    const listed = namesOnly('mute', [...new Set([...r.all, ...r.mute])]);
    expect(listed, 'a ⌘K that matches names only must return nothing for "mute": the real ⌘K answers it by what it means, not by an entry\'s name').toEqual([]);
    expect(muteProblems({ ...r, mute: listed, shown: null }).join('\n')).toMatch(/^AC4 "mute" in ⌘K returned nothing/);
    // The real ⌘K did answer it, so the two differ on this query.
    expect(r.mute.length, 'the real ⌘K lists an entry for "mute"').toBeGreaterThan(0);
  }, 600_000);
});
