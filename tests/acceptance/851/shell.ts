// This suite's fixture game shell (README: Fixtures), written from the design's `Recipe: shell@1 game shell`: a board
// document holding one `shell@1` item, `game`, with six screens (title, settings, level select, pause, game over and
// credits), each a 2D board of rects and text, and three levels, each a board with one logic item whose program is
// WebAssembly text built against the region map the logic module's own `check` reports. Level 1 can be completed and
// gives a carry record of its score and inventory; level 2 takes it. Each planted twin the issue names is a variant of
// this one document. Expected values are this file's own functions of the presses, never read from a run.
import { assemble, regionAt, regionMaps, sha256, type Obj, type Program, type Region, type Screen } from './helpers.ts';

/** Every screen and level is drawn at 1280 × 720 u and letterboxed into the view. */
export const DOC_SIZE: [number, number] = [1280, 720];
export const SHELL_ID = 'game';
/** The levels' logic items and names, in the shell's order (level index 0, 1, 2). */
export const LEVEL_IDS = ['l1', 'l2', 'l3'] as const;
export const LEVEL_NAMES = ['level 1', 'level 2', 'level 3'] as const;
/** A level not completed by its step 3,900 is lost (a time limit): a journey that must show game over can wait it out. */
export const LOST_AT = 3900;

// ---------------------------------------------------------------------------------------------------
// The levels' controls: one action each (Control: actions), with a key and a pad button, and a touch zone for each
// (Control: touch zones), so the levels play with keys, a pad or touches alike. A level's logic counts the entries of
// each actions control a step, so what it does never rests on the entry's value bytes.

export const ACTIONS: Obj = {
  collect_key: { kind: 'actions', actions: { collect: { keys: ['c'], pad: ['west'] } } },
  finish_key: { kind: 'actions', actions: { finish: { keys: ['f'], pad: ['north'] } } },
};
/** Each zone 160 px in from its bottom corner, x right and y down in the view's pixels, 80 px in radius. */
const ZONES: Obj = {
  collect_zone: { kind: 'touch_zones', actions: 'collect_key', zones: { collect: { anchor: 'bottom_left', offset: [160, -160], shape: { circle: { radius: 80 } }, role: { action: 'collect' } } } },
  finish_zone: { kind: 'touch_zones', actions: 'finish_key', zones: { finish: { anchor: 'bottom_right', offset: [-160, -160], shape: { circle: { radius: 80 } }, role: { action: 'finish' } } } },
};

const I32 = (count = 1): Obj => ({ type: 'i32', count });
export const WRITES_1: Obj = { score: I32(), inventory: I32(4), done: I32(), lost: I32(), carry_req: I32(), clock: I32() };
export const WRITES_23: Obj = { score: I32(), inventory: I32(4), done: I32(), lost: I32(), clock: I32() };
/** Level 1 gives a carry record of its score and inventory (Logic: carry records); the shell writes it at the step `done` turns true. */
export const CARRY: Obj = { request: 'carry_req', out: ['score', 'inventory'] };
/** Level 1's state layout: the bytes at `layout_at`, after a u32 of their length; the layout is their sha256. */
export const LAYOUT1_TEXT = 'shell fixture level 1 state: score i32, inventory i32 x 4; version 1';
export const LAYOUT1 = sha256(Buffer.from(LAYOUT1_TEXT, 'latin1'));
/** Level 2 takes level 1's record: its score, then its inventory. */
export const CARRY_IN: Obj = { arrays: { score: I32(1), inventory: I32(4) }, accepts: [LAYOUT1] };

/** A level's score and inventory after `n` collects from `from`: the i-th collect (from 0) adds 10 (i + 1) to the score and i + 1 to slot i mod 4. */
export function afterCollects(n: number, from: { score: number; inventory: number[] } = { score: 0, inventory: [0, 0, 0, 0] }): { score: number[]; inventory: number[] } {
  const inventory = [...from.inventory];
  let score = from.score;
  for (let i = 0; i < n; i++) { score += 10 * (i + 1); inventory[i % 4]! += i + 1; }
  return { score: [score], inventory };
}
/** Level 1 completed under the journeys' presses (collect at 600, 1,800 and 3,000, finish at 3,700): score 60, inventory [1, 2, 3, 0]. */
export const LEVEL1_RECORD = afterCollects(3);

// ---------------------------------------------------------------------------------------------------
// Programs

const READS_AT = 0;
const WRITES_AT = 8192;
const LAYOUT_AT = 12288;
const STATE = 16384;
const bytesText = (b: Buffer): string => [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
const PROBE_TEXT = `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`;
const probe = (): Program => assemble('layout_probe', PROBE_TEXT);
const item = (program: Program, params: Obj): Obj => ({ kind: 'logic@1', params: { program: program.sha, step_rate: 60, ...params } });
const levelParams = (n: 1 | 2 | 3, readsLevel1 = false): Obj => n === 1
  ? { reads: ['collect_key', 'finish_key'], writes: WRITES_1, carry: CARRY }
  : { reads: ['collect_key', ...(readsLevel1 ? ['l1.score'] : [])], writes: WRITES_23, ...(n === 2 && !readsLevel1 ? { carry_in: CARRY_IN } : {}) };

/** The levels' region maps, from the logic module's own check of a probe piece holding the three items. */
function regions(): Record<string, Region[]> {
  const p = probe();
  return regionMaps({ seed: 851, controls: ACTIONS, items: { l1: item(p, levelParams(1)), l2: item(p, levelParams(2)), l3: item(p, levelParams(3)) }, assets: { [p.sha]: p.b64 } }, 'the levels\' layouts');
}
/** The planted level 2's region map: it reads level 1's score, here in a probe piece that holds level 1 beside it. */
function readsRegions(): Region[] {
  const p = probe();
  return regionMaps({ seed: 851, controls: ACTIONS, items: { l1: item(p, levelParams(1)), l2: item(p, levelParams(2, true)) }, assets: { [p.sha]: p.b64 } }, 'the planted level 2\'s layout')['l2']!;
}

/**
 * Level n's program. Each step it adds one collect (afterCollects) for each entry of `collect_key` stamped that step;
 * level 1 is done once `finish_key` holds an entry, levels 2 and 3 once they collect; `lost` is 1 from step 3,900 while
 * not done; `clock` is the step. Level 1 exports its state layout. Level 2, at step 0, starts from its carry_in entry when
 * its u32 is 1; the planted level 2 starts from level 1's score, read directly as one of its own reads.
 */
function levelProgram(n: 1 | 2 | 3, map: Region[], readsLevel1 = false): Program {
  const r = (name: string): number => READS_AT + regionAt(map, 'reads', name).offset;
  const w = (name: string): number => WRITES_AT + regionAt(map, 'writes', name).offset;
  const len = Buffer.alloc(4);
  len.writeUInt32LE(Buffer.byteLength(LAYOUT1_TEXT, 'latin1'));
  const layout = n === 1 ? `
  (global (export "layout_at") i32 (i32.const ${LAYOUT_AT}))
  (data (i32.const ${LAYOUT_AT}) "${bytesText(Buffer.concat([len, Buffer.from(LAYOUT1_TEXT, 'latin1')]))}")` : '';
  const ci = n === 2 && !readsLevel1 ? r('carry_in') : 0;
  const start = n !== 2 ? '' : readsLevel1 ? `
    (if (i64.eqz (local.get $k)) (then (i32.store (i32.const ${w('score')}) (i32.load (i32.const ${r('l1.score')})))))` : `
    (if (i64.eqz (local.get $k)) (then
      (if (i32.eq (i32.load (i32.const ${ci})) (i32.const 1)) (then
        (i32.store (i32.const ${w('score')}) (i32.load (i32.const ${ci + 4})))
        (i32.store (i32.const ${w('inventory')}) (i32.load (i32.const ${ci + 8})))
        (i32.store (i32.const ${w('inventory') + 4}) (i32.load (i32.const ${ci + 12})))
        (i32.store (i32.const ${w('inventory') + 8}) (i32.load (i32.const ${ci + 16})))
        (i32.store (i32.const ${w('inventory') + 12}) (i32.load (i32.const ${ci + 20})))))))`;
  const finish = n === 1 ? `
    (if (i32.ne (i32.load (i32.const ${r('finish_key')})) (i32.const 0)) (then (i32.store (i32.const ${w('done')}) (i32.const 1))))` : '';
  const doneOnCollect = n === 1 ? '' : `(i32.store (i32.const ${w('done')}) (i32.const 1))`;
  return assemble(`level${n}${readsLevel1 ? '_reads_level1' : ''}_${map.map((e) => e.offset).join('_')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))${layout}
  (func $init (export "init") (param $seed i64))
  (func $collect (local $n i32) (local $slot i32)
    (local.set $n (i32.load (i32.const ${STATE})))
    (i32.store (i32.const ${w('score')}) (i32.add (i32.load (i32.const ${w('score')})) (i32.mul (i32.const 10) (i32.add (local.get $n) (i32.const 1)))))
    (local.set $slot (i32.add (i32.const ${w('inventory')}) (i32.shl (i32.and (local.get $n) (i32.const 3)) (i32.const 2))))
    (i32.store (local.get $slot) (i32.add (i32.load (local.get $slot)) (i32.add (local.get $n) (i32.const 1))))
    (i32.store (i32.const ${STATE}) (i32.add (local.get $n) (i32.const 1))))
  (func $step (export "step") (param $k i64) (local $i i32) (local $c i32)${start}
    (local.set $c (i32.load (i32.const ${r('collect_key')})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $c)))
      (call $collect)
      ${doneOnCollect}
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))${finish}
    (i32.store (i32.const ${w('lost')}) (i32.and (i64.ge_s (local.get $k) (i64.const ${LOST_AT})) (i32.eqz (i32.load (i32.const ${w('done')})))))
    (i32.store (i32.const ${w('clock')}) (i32.wrap_i64 (local.get $k)))))`);
}

export interface Programs { levels: [Program, Program, Program]; readsLevel1: Program }
let built: Programs | undefined;
/** Every level program, built against the region maps `check` reports. */
export function programs(): Programs {
  if (built) return built;
  const maps = regions();
  built = {
    levels: [levelProgram(1, maps['l1']!), levelProgram(2, maps['l2']!), levelProgram(3, maps['l3']!)],
    readsLevel1: levelProgram(2, readsRegions(), true),
  };
  return built;
}
export const allPrograms = (p: Programs): Program[] => [...p.levels, p.readsLevel1];

// ---------------------------------------------------------------------------------------------------
// Documents

const LICENSE: Obj = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #851 acceptance tests at test time.' };
let order = 0;
const nextOrder = (): string => `a${String(order++).padStart(4, '0')}`;
const text = (id: string, words: string, pos: [number, number], w: number, h: number, size: number): Obj => ({
  id, kind: 'text@1', name: `Text ${id}`, order: nextOrder(),
  params: { text: words, font: 'body', size, box: { w, h }, autosize: 'none', align: 'center', valign: 'middle', paint: { fill: { role: 'ink' } } },
  at: { pos: [pos[0], pos[1], 0] },
});
const rect = (id: string, name: string, box: number[], role: string, radius = 12): Obj => ({
  id, kind: 'rect@1', name, order: nextOrder(), params: { box, radius, paint: { fill: { role } } },
});
const board = (title: string, items: Obj[], more: Obj = {}): Obj => ({
  format: 1, profile: 'board', title, description: `${title}, part of the #851 acceptance tests' fixture game shell.`, seed: 851, size: DOC_SIZE,
  items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...more,
});

/** A shell control (Recipe: shell@1 game shell: Shell control), the box of the rect that draws it, and its label's box. */
export interface Button { id: string; label: string; box: [number, number, number, number]; control: Obj }
/** A label sits 20 u in from the button's left and right, 32 u tall, centred in its height. */
export const labelBox = (b: Button['box']): [number, number, number, number] => [b[0] + 20, b[1] + (b[3] - 32) / 2, b[2] - 40, 32];
export interface Prompt { id: string; action: 'confirm' | 'back' | 'pause' | 'adjust'; words: string; pos: [number, number] }
export interface ScreenSpec { heading: string; buttons: Button[]; prompts: Prompt[]; back?: string; ends?: number; extra?: Obj[] }

/** The planted twins the issue names, each a variant of the fixture shell's document. */
export interface Variant {
  /** The shell unlocks every level at start (criterion 1). */
  unlockAll?: boolean;
  /** Level 2's logic reads level 1's arrays directly (criterion 2). */
  readsLevel1?: boolean;
  /** The settings screen's volume slider takes only a pointer drag (criterion 4). */
  dragOnly?: boolean;
  /** The credits screen has no way back (criterion 5). */
  noBack?: boolean;
  /** The settings screen's Back button covers half of the volume slider (criterion 9). */
  backCovers?: boolean;
  /** The title's Credits button is bound to nothing (criterion 10). */
  unbound?: boolean;
}

const press = (does?: unknown, more: Obj = {}): Obj => ({ kind: 'press', ...(does === undefined ? {} : { does }), ...more });
/** The six screens' controls and prompts, in doc units. */
export function screenSpecs(v: Variant = {}): Record<Screen, ScreenSpec> {
  const at = (x: number, y: number, w = 300, h = 64): [number, number, number, number] => [x, y, w, h];
  return {
    title: {
      heading: 'Fixture Quest',
      buttons: [
        { id: 'start_button', label: 'Start', box: at(490, 220), control: press({ start: 0 }) },
        { id: 'levels_button', label: 'Level select', box: at(490, 304), control: press({ go: 'levels' }) },
        { id: 'settings_button', label: 'Settings', box: at(490, 388), control: press({ go: 'settings' }) },
        { id: 'credits_button', label: 'Credits', box: at(490, 472), control: v.unbound ? press() : press({ go: 'credits' }) },
      ],
      prompts: [{ id: 'title_prompt', action: 'confirm', words: 'Choose', pos: [490, 620] }],
    },
    settings: {
      heading: 'Settings',
      buttons: [
        {
          id: 'volume_slider', label: 'Volume', box: at(440, 200, 400),
          control: v.dragOnly ? { kind: 'drag_along', does: { set: 'volume.master' }, range: [-60, 0] } : { kind: 'slider', does: { set: 'volume.master' }, range: [-60, 0], increment: 6 },
        },
        { id: 'motion_toggle', label: 'Reduce motion', box: at(440, 284, 400), control: { kind: 'toggle', does: { set: 'reduced_motion' }, enabled: `${SHELL_ID}.reduced_motion == 0` } },
        { id: 'settings_back', label: 'Back', box: v.backCovers ? at(440, 200, 200) : at(440, 368, 400), control: press('back') },
      ],
      prompts: [{ id: 'settings_adjust_prompt', action: 'adjust', words: 'Adjust', pos: [490, 600] }, { id: 'settings_back_prompt', action: 'back', words: 'Back', pos: [490, 640] }],
    },
    levels: {
      heading: 'Level select',
      buttons: [
        { id: 'level_1_button', label: 'Level 1', box: at(200, 240, 240, 120), control: press({ start: 0 }) },
        { id: 'level_2_button', label: 'Level 2', box: at(520, 240, 240, 120), control: press({ start: 1 }, { enabled: `${SHELL_ID}.unlocked[1]` }) },
        { id: 'level_3_button', label: 'Level 3', box: at(840, 240, 240, 120), control: press({ start: 2 }, { enabled: `${SHELL_ID}.unlocked[2]` }) },
        { id: 'levels_back', label: 'Back', box: at(490, 440), control: press('back') },
      ],
      prompts: [{ id: 'levels_confirm_prompt', action: 'confirm', words: 'Play', pos: [490, 600] }, { id: 'levels_back_prompt', action: 'back', words: 'Back', pos: [490, 640] }],
    },
    pause: {
      heading: 'Paused',
      buttons: [
        { id: 'resume_button', label: 'Resume', box: at(490, 260), control: press('resume') },
        { id: 'leave_button', label: 'Leave level', box: at(490, 344), control: press('back') },
      ],
      prompts: [{ id: 'pause_resume_prompt', action: 'pause', words: 'Resume', pos: [490, 600] }, { id: 'pause_back_prompt', action: 'back', words: 'Leave', pos: [490, 640] }],
    },
    game_over: {
      heading: 'Game over',
      buttons: [
        { id: 'game_over_levels_button', label: 'Level select', box: at(490, 260), control: press({ go: 'levels' }) },
        { id: 'game_over_title_button', label: 'Title', box: at(490, 344), control: press({ go: 'title' }) },
      ],
      prompts: [{ id: 'game_over_prompt', action: 'confirm', words: 'Choose', pos: [490, 600] }],
      back: 'title',
    },
    credits: {
      heading: 'Credits',
      buttons: v.noBack ? [] : [{ id: 'credits_back', label: 'Back', box: at(490, 560), control: press('back') }],
      prompts: v.noBack ? [] : [{ id: 'credits_back_prompt', action: 'back', words: 'Back', pos: [490, 650] }],
      ...(v.noBack ? { back: 'none' } : {}),
      ends: 600,
      extra: [text('credits_roll', 'Made for the shell fixture\nThree levels, one carry record\nThanks for playing', [340, 160], 600, 300, 28)],
    },
  };
}
/** Each prompt's action, by its text item's ID, over the six screens of the fixture shell. */
export const PROMPT_ACTIONS: Record<string, Prompt['action']> = Object.fromEntries(Object.values(screenSpecs()).flatMap((s) => s.prompts.map((p) => [p.id, p.action])));

/** A screen as the shell names it: its 2D board, its controls (each drawn by its rect, labelled by its text) and its prompts. */
function screen(name: Screen, s: ScreenSpec): Obj {
  const items: Obj[] = [rect(`${name}_ground`, `${s.heading} ground`, [0, 0, DOC_SIZE[0], DOC_SIZE[1]], 'ground', 0), text(`${name}_heading`, s.heading, [240, 80], 800, 60, 40)];
  for (const b of s.buttons) {
    items.push(rect(b.id, b.label, b.box, 'accent'));
    const l = labelBox(b.box);
    items.push(text(`${b.id}_label`, b.label, [l[0], l[1]], l[2], l[3], 24));
  }
  for (const p of s.prompts) items.push(text(p.id, p.words, p.pos, 300, 28, 18));
  items.push(...(s.extra ?? []));
  return {
    doc: board(`${s.heading} screen`, items),
    controls: Object.fromEntries(s.buttons.map((b) => [b.id, { ...b.control, item: b.id, text: `${b.id}_label` }])),
    prompts: Object.fromEntries(s.prompts.map((p) => [p.id, { action: p.action }])),
    ...(s.back !== undefined ? { back: s.back } : {}),
    ...(s.ends !== undefined ? { ends: s.ends } : {}),
  };
}

/** Level n's document: its heading, its four controls and its one logic item. */
function level(n: 1 | 2 | 3, program: Program, readsLevel1 = false): Obj {
  const id = LEVEL_IDS[n - 1]!;
  return board(`Level ${n}`, [
    text(`${id}_heading`, `Level ${n}: collect, then finish`, [240, 80], 800, 60, 40),
    { id, ...item(program, levelParams(n, readsLevel1)), name: `Level ${n} rules`, order: nextOrder() },
  ], { controls: { ...ACTIONS, ...ZONES }, assets: { [`level_${n}_rules`]: { sha256: program.sha, license: LICENSE } } });
}

/** The fixture shell's document, or the planted twin `v` names. */
export function shellDocument(p: Programs, v: Variant = {}): Obj {
  order = 0;
  const specs = screenSpecs(v);
  const levels = ([1, 2, 3] as const).map((n) => ({
    doc: level(n, n === 2 && v.readsLevel1 ? p.readsLevel1 : p.levels[n - 1]!, n === 2 && v.readsLevel1),
    name: LEVEL_NAMES[n - 1], done: `${LEVEL_IDS[n - 1]}.done`, lost: `${LEVEL_IDS[n - 1]}.lost`,
  }));
  return board('Fixture game shell', [{
    id: SHELL_ID, kind: 'shell@1', name: 'Fixture game shell', order: nextOrder(),
    params: {
      screens: Object.fromEntries((Object.keys(specs) as Screen[]).map((name) => [name, screen(name, specs[name])])),
      levels,
      unlocked: v.unlockAll ? [0, 1, 2] : [0],
      transition: { kind: 'fade', steps: 12 },
      settings: { text_size: [100, 125, 150], reduced_motion: false, volume: { master: 0 }, bindings: { collect: ['c', 'west'], finish: ['f', 'north'] }, toggle: [] },
      pause: { keys: ['Escape'], pad: ['start'], button: { corner: 'top_right', size: 48 } },
    },
  }]);
}
