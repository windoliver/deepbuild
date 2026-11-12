// AC4, AC8, AC11, AC18 and AC10's two planted cards: keys never answer, and the card's own keys, in the replica (README,
// Pinned 3, 8, 9). The replica is built with #1454's `test-confirm` and told the OS confirmed you, so any path that could
// answer does: a test that sees no answer saw the app hold back, not the OS.
import { describe, expect, it } from 'vitest';
import {
  answeringItems, armed, ASKS, askAt, askRows, byId, canon, CARD, cardControls, confirmFile, driveBinary, flat, ID, MIN, OPEN_ASKS,
  PUSH_STEP, readTable, Replica, requireMacos, ROW_ID, startFailures, tabFailures, useCleanup, words, writes, type Feature,
  type HubCall, type Snapshot,
} from './helpers.ts';

useCleanup();
const confirmed = (): Record<string, string> => ({ DEEP_APP_TEST_CONFIRM: confirmFile('confirmed') });
const started = async (...features: Feature[]): Promise<Replica> => { requireMacos(); return Replica.on(await driveBinary('test-confirm', ...features), { env: confirmed() }); };

/** What the card shows of an answer: its value `answered`, or the receipt's "Answered: …" line. */
function answeredOnCard(s: Snapshot): string | null {
  const card = byId(s, CARD);
  if (!card) return null;
  if (card.value === 'answered') return 'the card reads answered';
  const receipt = words(card).find((w) => w.startsWith('Answered:'));
  return receipt ? `the card says "${receipt}"` : null;
}
/** Every write since `from` in the app's calls to its hub, or the missing surface, in words. */
function writesAfter(hub: HubCall[] | undefined, from: number, what: string): string[] {
  if (!hub) return ['deep_drive\'s see reply has no `hub` list of what the app sent its hub (README, Pinned 3), so "writes nothing" can\'t be read'];
  return writes(hub.slice(from)).map((c) => `${what} sent the hub ${c.method} ${JSON.stringify(c.params ?? {}).slice(0, 200)}`);
}

describe(`AC4 ${ID.neverAnswers} No menu item or chord answers an ask`, () => {
  it('AC4 no menu item names an answer, and no chord of the table pressed from the list answers an armed card\'s ask', async () => {
    const r = await started();
    try {
      const failures = answeringItems(await r.menus(), OPEN_ASKS.flatMap((a) => a.options.map((o) => o.label)));
      // Every chord of the table with ⌘, ⌃ or ⌥, but those that quit, close, hide or minimize the app or its window.
      const chords = readTable().filter((a) => a.key && /(^|-)(cmd|ctrl|alt)-/.test(canon(a.key)!) && !/^(quit|close|hide|minimi[sz]e)/i.test(a.name));
      for (const ask of OPEN_ASKS) {
        await r.open(askAt(ask.handle));
        if ((await armed(r)) !== 'armed') { failures.push(`${ask.handle}'s card never armed`); continue; }
        for (const a of chords) {
          await r.press('escape');
          const from = (await r.see()).hub?.length ?? 0;
          await r.press(a.key!);
          const sent = (await r.see()).hub?.slice(from).filter((c) => c.method === 'ask.answer') ?? [];
          for (const c of sent) failures.push(`the chord ${a.key} ("${a.name}"), pressed with ${ask.handle}'s card armed, answered ${JSON.stringify(c.params)}`);
          await r.press('escape');
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);

  it('AC4 wrong program: a planted Approve item (plant-approve-menu-item) fails, naming it', async () => {
    const r = await started('plant-approve-menu-item');
    try {
      const failures = answeringItems(await r.menus(), OPEN_ASKS.flatMap((a) => a.options.map((o) => o.label)));
      expect(failures.join('\n'), 'the planted menu bar holds Approve').toMatch(/the menu item "Approve"/);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);

  it('AC4 Return on an unarmed card writes nothing', async () => {
    const r = await started();
    try {
      await r.open(askAt(ASKS.push.handle));
      const before = await r.see();
      const state = byId(before.snapshot, CARD)?.value;
      if (state !== 'presented') throw Error(`the push's card reads ${JSON.stringify(state)} right after it opened, not presented, so Return can't be tried unarmed`);
      await r.press('enter');
      await r.pass(1000);
      const after = await r.see();
      const failures = writesAfter(after.hub, before.hub?.length ?? 0, 'Return on the unarmed card');
      const shown = answeredOnCard(after.snapshot);
      if (shown) failures.push(`Return on the unarmed card answered: ${shown}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

describe(`AC8 ${ID.cardKey} A key typed on a question card writes nothing`, () => {
  it('AC8 letters pressed and typed on the armed taste card answer nothing, send nothing and touch the box not at all', async () => {
    const r = await started();
    try {
      await r.open(askAt(ASKS.taste.handle));
      if ((await armed(r)) !== 'armed') throw Error('the taste card never armed');
      const before = await r.see();
      const focus = before.snapshot.focus;
      if (typeof focus !== 'string' || !(focus === CARD || focus.startsWith('card-'))) throw Error(`the presented card doesn't hold the keyboard: focus is ${JSON.stringify(focus)}`);
      const draft = byId(before.snapshot, 'box-draft')?.value ?? null;
      await r.press('y e s n a x');
      await r.type('yes');
      await r.pass(500);
      const after = await r.see();
      const failures = writesAfter(after.hub, before.hub?.length ?? 0, 'A key typed on the card');
      const shown = answeredOnCard(after.snapshot);
      if (shown) failures.push(`a key typed on the card answered: ${shown}`);
      if (!byId(after.snapshot, CARD)) failures.push('a key typed on the card took the card away');
      const now = byId(after.snapshot, 'box-draft')?.value ?? null;
      if (now !== draft) failures.push(`a key typed on the card reached the box: its words were ${JSON.stringify(draft)} and are ${JSON.stringify(now)}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

describe(`AC11 ${ID.digit} "3" on an armed card with four options moves focus and writes nothing, and Return then answers the third`, () => {
  it('AC11 "3" puts focus on the third option and sends nothing; Return then answers it', async () => {
    const r = await started();
    try {
      const ask = ASKS.choice;
      await r.open(askAt(ask.handle));
      if ((await armed(r)) !== 'armed') throw Error('the four-option card never armed');
      const before = await r.see();
      const options = cardControls(before.snapshot).filter((n) => typeof n.id === 'string' && n.id.startsWith('card-option:'));
      if (options.length !== 4) throw Error(`the card draws ${options.length} options with a card-option:<id> id (README, Pinned 8), not four: its controls are ${JSON.stringify(cardControls(before.snapshot).map((n) => [n.id, n.name]))}`);
      const third = options[2]!;
      await r.press('3');
      const pressed = await r.see();
      const failures: string[] = [];
      if (pressed.snapshot.focus !== third.id) failures.push(`"3" left focus on ${JSON.stringify(pressed.snapshot.focus)}, not the third option "${third.name}" (${String(third.id)})`);
      failures.push(...writesAfter(pressed.hub, before.hub?.length ?? 0, '"3"'));
      const shown = answeredOnCard(pressed.snapshot);
      if (shown) failures.push(`"3" answered: ${shown}`);
      await r.press('enter');
      await r.pass(1000);
      const after = await r.see();
      const id = String(third.id).slice('card-option:'.length);
      const answers = (after.hub ?? []).slice(pressed.hub?.length ?? 0).filter((c) => c.method === 'ask.answer');
      if (!answers.some((c) => c.params?.ask === ask.handle && c.params?.option === id)) failures.push(`Return then sent no answer of ${ask.handle} with the third option "${id}": the app sent ${JSON.stringify(answers.map((c) => c.params))}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);

  it('AC11 Esc on a card with typed words returns to the list, and opening the ask again shows the words', async () => {
    const r = await started();
    const said = 'the darker blue reads better';
    try {
      const ask = ASKS.taste;
      await r.open(askAt(ask.handle));
      if ((await armed(r)) !== 'armed') throw Error('the taste card never armed');
      // ⌘N puts the keyboard in the box (Scope), where the ask's page takes words.
      await r.press('cmd-n');
      await r.type(said);
      await r.press('escape');
      if (!ROW_ID.test(String((await r.see()).snapshot.focus))) await r.press('escape');
      const back = await r.see();
      const failures: string[] = [];
      if (!ROW_ID.test(String(back.snapshot.focus))) failures.push(`Esc left focus on ${JSON.stringify(back.snapshot.focus)}, not a row of the list`);
      if (!askRows(back.snapshot).includes(ask.handle)) failures.push(`after Esc ${ask.handle} isn't listed: the ask didn't stay open`);
      if ((back.hub ?? []).some((c) => c.method === 'ask.answer')) failures.push(`Esc answered: ${JSON.stringify((back.hub ?? []).filter((c) => c.method === 'ask.answer'))}`);
      await r.open(askAt(ask.handle));
      const again = await r.see();
      if (!flat(again.snapshot.tree).some((n) => `${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`.includes(said))) failures.push(`opening ${ask.handle} again doesn't show the words "${said}": the box reads ${JSON.stringify(byId(again.snapshot, 'box-draft')?.value ?? null)}`);
      expect(failures).toEqual([]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});

/** AC18: what's wrong with the push's step after a press that isn't hardware, the OS saying yes. */
async function stepProblems(...features: Feature[]): Promise<string[]> {
  const r = await started(...features);
  try {
    await r.open(askAt(ASKS.push.handle));
    if ((await armed(r)) !== 'armed') return ['the push\'s card never armed'];
    const step = flat(byId((await r.see()).snapshot, CARD)!).find((n) => n.role === 'switch' && (n.name ?? '').startsWith(PUSH_STEP));
    if (!step) return [`the push's card draws no switch for its step "${PUSH_STEP}"`];
    if (step.value !== 'off') return [`the step "${PUSH_STEP}" can't be undone, so its switch starts off, but it reads ${JSON.stringify(step.value)}`];
    // A press a screen reader or Switch Control sends: no HID event, so the card asks the OS, which says yes here.
    await r.click({ role: 'switch', name: step.name }, `a press that isn't hardware on the step "${PUSH_STEP}"`);
    await r.pass(1500);
    const after = flat(byId((await r.see()).snapshot, CARD) ?? { role: '', name: null, value: null, bounds: [], children: [] }).find((n) => n.role === 'switch' && (n.name ?? '').startsWith(PUSH_STEP));
    return after?.value === 'on' ? [] : [`the step "${PUSH_STEP}" stayed ${JSON.stringify(after?.value ?? 'gone')} after a press that isn't hardware and the OS confirming you`];
  } finally {
    await r.stop();
  }
}

describe(`AC18 ${ID.switchControl} With Switch Control, a step's switch turns on after the OS confirms you`, () => {
  it('AC18 a press that isn\'t hardware on the push\'s step turns its switch on once the OS confirms you', async () => {
    expect(await stepProblems()).toEqual([]);
  }, 30 * MIN);

  it('AC18 wrong program: a card that ignores the press (plant-step-ignores-press) fails, naming the step', async () => {
    const failures = await stepProblems('plant-step-ignores-press');
    expect(failures.join('\n'), 'the planted card ignores a press that isn\'t hardware on a step').toMatch(/the step "git push origin main" stayed/);
  }, 30 * MIN);
});

/** AC10's card in the replica: where focus starts on the push's approval and where each Tab takes it. */
async function walk(...features: Feature[]): Promise<{ start: string | null; visited: (string | null)[]; all: ReturnType<typeof cardControls> }> {
  const r = await started(...features);
  try {
    await r.open(askAt(ASKS.push.handle));
    if ((await armed(r)) !== 'armed') throw Error('the push\'s card never armed');
    const s = await r.see();
    const all = cardControls(s.snapshot);
    const start = typeof s.snapshot.focus === 'string' ? s.snapshot.focus : null;
    const visited: (string | null)[] = [start];
    for (let i = 0; i < all.length + 1; i++) {
      await r.press('tab');
      visited.push(await r.focus());
    }
    return { start, visited, all };
  } finally {
    await r.stop();
  }
}

describe(`AC10 ${ID.push} On the real app a push is approved by keys alone, focus starting on No (the planted cards, in the replica)`, () => {
  it('AC10 wrong program: a card whose Tab skips a control (plant-tab-skips-control) fails, naming it', async () => {
    const { visited, all } = await walk('plant-tab-skips-control');
    expect(tabFailures(visited, all).join('\n'), 'the planted card\'s Tab skips one of its controls').toMatch(/Tab skips the card's control "[^"]*" \(card-[^)]+\)/);
  }, 30 * MIN);

  it('AC10 wrong program: a card that starts on Allow (plant-card-starts-on-allow) fails, naming the option', async () => {
    const { start } = await walk('plant-card-starts-on-allow');
    expect(startFailures(start, ASKS.push.options).join('\n'), 'the planted card starts on the option that allows').toMatch(/focus starts on "Push it" \(card-option:approve\), the option that allows/);
  }, 30 * MIN);
});
