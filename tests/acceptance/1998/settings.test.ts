// AC2 #1998.c62f2117 The app has no Settings page; every change goes through the box in words as a proposed change you
// approve.
//
// No Settings page, in the app as a replica draws it over its fixture: "settings" in ⌘K lists at least one entry, and
// each entry it lists, chosen in a fresh replica, drafts a change in the box (box-draft holds words it didn't hold
// before). An entry that opens a page instead fails, naming it.
// Every change through the box: in a home set up by `deep setup`, with a repo `shop` holding a committed spec, the
// box takes "stop checking lint in shop", "remove DeepBuild from Codex" and "turn sounds off". Each comes back as an
// open ask in Needs you with an `apply` option, and nothing it would change has changed 3 s later: shop's spec and
// its working tree, and Codex's two files as setup left them.
// The wrong programs: the base, which has no box and no ⌘K over the fixture; a view registering a page named Settings
// (fixtures/settings-panel), an app with a Settings page made only of test fixtures; and DEEP_HUB_PLANT=box-applies-at-once,
// a box that applies a change when it drafts it (README, Pinned 7).

import { afterAll, describe, expect, it } from 'vitest';
import { choose, Drive, launch, box, ranked, stopAll } from './drive.ts';
import { bytesOf, call, cleanup, codexConfig, codexHooks, firstDifference, ID, inbox, isOpen, makeHome, makeRepo, setup, sleep, tempDir, withCodex } from './helpers.ts';

afterAll(async () => { await stopAll(); await cleanup(); }, 60_000);

const SPEC = `claims:
  done:
    checks: [lint, unit]
checks:
  lint: { type: command, run: "npm run lint" }
  unit: { type: command, run: "npm test", min_tests: 1 }
`;

/** ⌘K's "settings" in replicas over the fixture: what it lists, and what each entry did, each in a fresh replica. */
async function settingsPage(twin = false): Promise<string[]> {
  const home = tempDir('home');
  const list = await Drive.start(home);
  let entries: string[];
  try {
    await launch(list, 'fixture', twin);
    entries = await ranked(list, 'settings');
  } finally {
    await list.stop();
  }
  if (!entries.length) return ['AC2 "settings" in ⌘K lists nothing; with no Settings page it must open the box'];
  const out: string[] = [];
  // Entries named for settings first, so a page called Settings is always among those tried.
  const tried = [...entries.filter((e) => /settings/i.test(e)), ...entries.filter((e) => !/settings/i.test(e))].slice(0, 8);
  for (const name of tried) {
    const d = await Drive.start(home);
    try {
      await launch(d, 'fixture', twin);
      const was = (await box(d)).draft;
      const after = await choose(d, 'settings', name);
      if (after.clicked) out.push(`AC2 ⌘K's "${name}" for "settings" didn't take a click: ${after.clicked}`);
      else if (!after.box.draft || after.box.draft === was) out.push(`AC2 ⌘K's "${name}" for "settings" must draft a change in the box, not open a page; the box drafts ${JSON.stringify(after.box.draft)} and the window shows ${JSON.stringify(after.drawn).slice(0, 500)}`);
    } finally {
      await d.stop();
    }
  }
  return out;
}

const PHRASES: { words: string; repo?: boolean }[] = [
  { words: 'stop checking lint in shop', repo: true },
  { words: 'remove DeepBuild from Codex' },
  { words: 'turn sounds off' },
];

/** The box takes each phrase; what the criterion says is wrong, one line each. */
async function proposals(plant?: string): Promise<string[]> {
  const h = makeHome();
  const shop = makeRepo(h, 'shop', SPEC);
  withCodex(h);
  await setup(h, plant);
  await sleep(2000);
  const was = { spec: bytesOf(shop.spec)!, hooks: bytesOf(codexHooks(h)), config: bytesOf(codexConfig(h)) };
  expect(was.hooks, `deep setup must write DeepBuild's entries into ${codexHooks(h)} (the control)`).not.toBeNull();
  const out: string[] = [];
  const asks = new Map<string, string>();
  for (const p of PHRASES) {
    const reply = await call(h, 'box.say', p.repo ? { words: p.words, repo: shop.dir } : { words: p.words });
    const ask = 'result' in reply ? reply.result.ask : undefined;
    if (typeof ask !== 'string') out.push(`AC2 "${p.words}" must come back as a proposed change you approve; box.say answered ${JSON.stringify(reply).slice(0, 500)}`);
    else asks.set(p.words, ask);
  }
  await sleep(3000);
  const rows = await inbox(h);
  for (const [words, ask] of asks) {
    const row = rows.find((r) => r.ask === ask);
    if (!isOpen(row) || !row!.options.includes('apply')) out.push(`AC2 "${words}" must wait in Needs you as ${ask}, open, with an apply option; the inbox holds ${JSON.stringify(row ?? null)}`);
  }
  const spec = bytesOf(shop.spec)!;
  if (!spec.equals(was.spec) || shop.status() !== '') out.push(`AC2 "stop checking lint in shop" changed shop before you approved it: ${firstDifference(was.spec, spec)}; git status ${JSON.stringify(shop.status())}`);
  for (const [name, before, now] of [['~/.codex/hooks.json', was.hooks, bytesOf(codexHooks(h))], ['~/.codex/config.toml', was.config, bytesOf(codexConfig(h))]] as const) {
    if (before === null || now === null || !now.equals(before)) out.push(`AC2 "remove DeepBuild from Codex" changed ${name} before you approved it${before && now ? `: ${firstDifference(before, now)}` : ''}`);
  }
  return out;
}

describe(`${ID.ac2} The app has no Settings page; every change goes through the box in words as a proposed change you approve`, () => {
  it(`${ID.ac2} "settings" in ⌘K drafts a change in the box, and no entry it lists opens a page`, async () => {
    expect(await settingsPage()).toEqual([]);
  }, 600_000);

  it(`${ID.ac2} (wrong program) an app with a page named Settings, from a view the replica registers, fails, naming the page`, async () => {
    const problems = await settingsPage(true);
    expect(problems.some((p) => /^AC2 ⌘K's "Settings: (General|Sounds)" for "settings" must draft a change in the box, not open a page/.test(p)), JSON.stringify(problems)).toBe(true);
  }, 600_000);

  it(`${ID.ac2} the box takes a change to a spec, to an agent's settings and to your sounds in words, and each waits in Needs you as a proposed change, applied to nothing`, async () => {
    expect(await proposals()).toEqual([]);
  }, 600_000);

  it(`${ID.ac2} (wrong program) a box that applies a change when it drafts it (box-applies-at-once) fails, naming what it changed before the approval`, async () => {
    const problems = await proposals('box-applies-at-once');
    expect(problems.some((p) => /changed (shop|~\/\.codex\/\S+) before you approved it/.test(p)), JSON.stringify(problems)).toBe(true);
  }, 600_000);
});
