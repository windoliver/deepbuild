// This suite's fixture shell (README: Fixtures), written from the design's `Recipe: shell@1 game shell` and the issue's
// fields: a course of six lessons in two chapters of three, every one open from the start (`unlocked: [0, 1, 2, 3, 4,
// 5]`), a level select whose rows flip a mark by `game.done[i]` and whose two chapter counts are drivers over `done`, a
// settings screen with the piece's own choice `custom.mains`, and a pause screen that opens the settings. Each level is
// a board with one logic item whose program is WebAssembly text built against the region map the logic module's own
// `check` reports; it lists `settings: {mains: 230}`, writes the last value it read to `seen`, and is done at the step
// it reads a `finish` entry. The planted documents the issue names are variants of this one. Expected values are this
// file's own and the issue's, never read from a run.
import { FINISH_AT, assemble, regionAt, regionMaps, settingAt, type Move, type Obj, type Program, type Region, type Screen } from './helpers.ts';

export const DOC_SIZE: [number, number] = [1280, 720];
export const SHELL_ID = 'game';
/** The six lessons, level indexes 0 to 5: chapter one holds 0, 1 and 2, chapter two 3, 4 and 5. */
export const LEVELS = 6;
export const LEVEL_IDS = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'] as const;
export const LEVEL_NAMES = ['sockets', 'fuses', 'earthing', 'meters', 'circuits', 'testing'] as const;
export const CHAPTERS = [[0, 1, 2], [3, 4, 5]] as const;
/** The piece's own setting: mains voltage, a choice of five numbers, 230 by default (the issue's values). */
export const MAINS = { kind: 'choice', options: [100, 120, 220, 230, 240], default: 230 } as const;
export const NAMES = ['mains'] as const;
/** A level's listed settings, each with its default. */
export const LISTED = { mains: 230 } as const;
/** The mark a row shows by its level's `done`: the flip's children's strings. */
export const MARK = { todo: 'To do', done: 'Done' } as const;

// ---------------------------------------------------------------------------------------------------
// The levels' controls: one action, `finish` (key f, the pad's north, a touch zone), so a level plays with keys, a pad
// or touches alike; the journeys' level policy presses it at the level's step 900.

export const ACTIONS: Obj = { finish_key: { kind: 'actions', actions: { finish: { keys: ['f'], pad: ['north'] } } } };
const ZONES: Obj = {
  finish_zone: { kind: 'touch_zones', actions: 'finish_key', zones: { finish: { anchor: 'bottom_right', offset: [-160, -160], shape: { circle: { radius: 80 } }, role: { action: 'finish' } } } },
};
export const WRITES: Obj = { done: { type: 'i32', count: 1 }, seen: { type: 'f64', count: 1 }, clock: { type: 'i32', count: 1 } };

// ---------------------------------------------------------------------------------------------------
// Programs

const READS_AT = 0;
const WRITES_AT = 8192;
const STATE = 16384;
const PROBE_TEXT = `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`;
/** A program that does nothing, for layout probes and for the planted level that is refused at check. */
export const probe = (): Program => assemble('layout_probe', PROBE_TEXT);
const item = (program: Program, params: Obj): Obj => ({ kind: 'logic@1', params: { program: program.sha, step_rate: 60, ...params } });
const levelParams = (): Obj => ({ reads: ['finish_key'], writes: WRITES, settings: { ...LISTED } });

/** The levels' region maps, from the logic module's own check of a probe piece holding the six items. */
function regions(): Record<string, Region[]> {
  const p = probe();
  return regionMaps({ seed: 3605, controls: ACTIONS, items: Object.fromEntries(LEVEL_IDS.map((id) => [id, item(p, levelParams())])), assets: { [p.sha]: p.b64 } }, 'the levels\' layouts');
}

/**
 * A level's program. Each step: when its `mains` read entry holds entries (a u32 count and 4 zero bytes, then each entry
 * a u32 player, 4 zero bytes and an f64, as a number control's), it keeps the last one's value; it writes what it keeps
 * to `seen` (0 before any entry); `done` turns 1 at a step whose `finish_key` holds an entry and stays 1; `clock` is the
 * step.
 */
function levelProgram(map: Region[]): Program {
  const r = (name: string): number => READS_AT + regionAt(map, 'reads', name).offset;
  const w = (name: string): number => WRITES_AT + regionAt(map, 'writes', name).offset;
  const mains = READS_AT + settingAt(map, 'mains').offset;
  return assemble(`lesson_${map.map((e) => e.offset).join('_')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $c i32)
    (local.set $c (i32.load (i32.const ${mains})))
    (if (i32.gt_u (local.get $c) (i32.const 16)) (then (local.set $c (i32.const 16))))
    (if (i32.gt_u (local.get $c) (i32.const 0)) (then
      (f64.store (i32.const ${STATE})
        (f64.load (i32.add (i32.const ${mains + 16}) (i32.mul (i32.sub (local.get $c) (i32.const 1)) (i32.const 16)))))))
    (f64.store (i32.const ${w('seen')}) (f64.load (i32.const ${STATE})))
    (if (i32.ne (i32.load (i32.const ${r('finish_key')})) (i32.const 0)) (then (i32.store (i32.const ${w('done')}) (i32.const 1))))
    (i32.store (i32.const ${w('clock')}) (i32.wrap_i64 (local.get $k)))))`);
}

export interface Programs { lessons: Program[]; probe: Program }
let built: Programs | undefined;
/** Every level's program, built against the region maps `check` reports (the six items declare the same regions). */
export function programs(): Programs {
  if (built) return built;
  const maps = regions();
  built = { lessons: LEVEL_IDS.map((id) => levelProgram(maps[id]!)), probe: probe() };
  return built;
}
export const allPrograms = (p: Programs): Program[] => [...new Map([...p.lessons, p.probe].map((x) => [x.sha, x])).values()];

// ---------------------------------------------------------------------------------------------------
// Documents

const LICENSE: Obj = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #3605 acceptance tests at test time.' };
let order = 0;
const nextOrder = (): string => `a${String(order++).padStart(4, '0')}`;
const textParams = (words: string | Obj, w: number, h: number, size: number): Obj => ({
  ...(typeof words === 'string' ? { text: words } : words), font: 'body', size, box: { w, h }, autosize: 'none', align: 'center', valign: 'middle', paint: { fill: { role: 'ink' } },
});
const text = (id: string, words: string | Obj, pos: [number, number], w: number, h: number, size: number, more: Obj = {}): Obj => ({
  id, kind: 'text@1', name: `Text ${id}`, order: nextOrder(), params: textParams(words, w, h, size), at: { pos: [pos[0], pos[1], 0] }, ...more,
});
const rect = (id: string, name: string, box: number[], role: string, radius = 12): Obj => ({
  id, kind: 'rect@1', name, order: nextOrder(), params: { box, radius, paint: { fill: { role } } },
});
const board = (title: string, items: Obj[], more: Obj = {}): Obj => ({
  format: 1, profile: 'board', title, description: `${title}, part of the #3605 acceptance tests' fixture course shell.`, seed: 3605, size: DOC_SIZE, locale: 'en',
  items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...more,
});

type Box = [number, number, number, number];
interface Button { id: string; label: string; box: Box; control: Obj }
interface Prompt { id: string; action: 'confirm' | 'back' | 'pause' | 'adjust'; words: string; pos: [number, number] }
interface ScreenSpec { heading: string; buttons: Button[]; prompts: Prompt[]; back?: string; ends?: number; extra?: Obj[]; more?: Obj; labels?: 'inside' | 'left' }

/** The planted documents the issue names, each a variant of the fixture shell. */
export interface Variant {
  /** The shell declares no custom settings, and its settings screen has no mains choice (criterion 6). */
  noCustom?: boolean;
  /** The settings screen also holds `volts_choice`, which sets `custom.volts`, a name the shell doesn't declare (criterion 7). */
  setsVolts?: boolean;
  /** Level 2's (earthing's) logic reads `game.custom` by path (criterion 7). */
  readsCustom?: boolean;
}
export const READS_CUSTOM_LEVEL = 2;

const press = (does: unknown, more: Obj = {}): Obj => ({ kind: 'press', does, ...more });
const at = (x: number, y: number, w = 300, h = 64): Box => [x, y, w, h];
/** Row i of the level select: chapter one's rows in the left column, chapter two's in the right. */
export const rowBox = (i: number): Box => [i < 3 ? 120 : 700, 170 + (i % 3) * 110, 460, 90];
const countOf = (c: number): Obj => ({ target: `data/ch${c + 1}`, expr: 'a + b + c', vars: { a: `${SHELL_ID}.done[${CHAPTERS[c]![0]}]`, b: `${SHELL_ID}.done[${CHAPTERS[c]![1]}]`, c: `${SHELL_ID}.done[${CHAPTERS[c]![2]}]` } });

/** The six screens' controls and prompts, in doc units. */
function screenSpecs(v: Variant): Record<Screen, ScreenSpec> {
  const rows: Button[] = LEVEL_NAMES.map((name, i) => ({
    id: `row_${i}`, label: name[0]!.toUpperCase() + name.slice(1), box: rowBox(i), control: press({ start: i }, { enabled: `${SHELL_ID}.unlocked[${i}]` }),
  }));
  const marks: Obj[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const b = rowBox(i);
    marks.push({ id: `row_${i}_mark`, kind: 'group@1', name: `Row ${i} mark`, order: nextOrder(), params: { flip: { array: `${SHELL_ID}.done[${i}]`, map: { 0: `row_${i}_todo`, 1: `row_${i}_done` } } } });
    marks.push(text(`row_${i}_todo`, MARK.todo, [b[0] + 330, b[1] + 29], 110, 32, 22, { parent: `row_${i}_mark` }));
    marks.push(text(`row_${i}_done`, MARK.done, [b[0] + 330, b[1] + 29], 110, 32, 22, { parent: `row_${i}_mark` }));
  }
  const settings: Button[] = [
    ...(v.noCustom ? [] : [{ id: 'mains_choice', label: 'Mains voltage', box: at(390, 200, 500), control: { kind: 'choice', does: { set: 'custom.mains' }, options: [...MAINS.options] } }]),
    { id: 'settings_back', label: 'Back', box: at(440, 368, 400), control: press('back') },
    ...(v.setsVolts ? [{ id: 'volts_choice', label: 'Volts', box: at(390, 450, 500), control: { kind: 'choice', does: { set: 'custom.volts' }, options: [1, 2] } }] : []),
  ];
  return {
    title: {
      heading: 'Mains course',
      buttons: [
        { id: 'levels_button', label: 'Lessons', box: at(490, 220), control: press({ go: 'levels' }) },
        { id: 'settings_button', label: 'Settings', box: at(490, 304), control: press({ go: 'settings' }) },
        { id: 'credits_button', label: 'Credits', box: at(490, 388), control: press({ go: 'credits' }) },
      ],
      prompts: [{ id: 'title_prompt', action: 'confirm', words: 'Choose', pos: [490, 620] }],
    },
    settings: {
      heading: 'Settings',
      buttons: settings,
      prompts: [{ id: 'settings_adjust_prompt', action: 'adjust', words: 'Adjust', pos: [490, 600] }, { id: 'settings_back_prompt', action: 'back', words: 'Back', pos: [490, 640] }],
      extra: v.noCustom ? [] : [text('mains_value', { template: '{data/mains} V' }, [390, 280], 500, 32, 22)],
      more: v.noCustom ? {} : {
        data: { mains: { value: MAINS.default, source: SHELL_ID } },
        drivers: { mains: { target: 'data/mains', expr: 'v', vars: { v: `${SHELL_ID}.custom[0]` } } },
      },
    },
    levels: {
      heading: 'Lessons',
      buttons: [...rows, { id: 'levels_back', label: 'Back', box: at(490, 520), control: press('back') }],
      labels: 'left',
      prompts: [{ id: 'levels_confirm_prompt', action: 'confirm', words: 'Open', pos: [490, 610] }, { id: 'levels_back_prompt', action: 'back', words: 'Back', pos: [490, 650] }],
      extra: [
        text('ch1_heading', 'Chapter one', [120, 110], 300, 40, 26),
        text('ch1_count', { template: '{data/ch1} of 3' }, [430, 110], 150, 40, 26),
        text('ch2_heading', 'Chapter two', [700, 110], 300, 40, 26),
        text('ch2_count', { template: '{data/ch2} of 3' }, [1010, 110], 150, 40, 26),
        ...marks,
      ],
      more: {
        data: { ch1: { value: 0, source: SHELL_ID }, ch2: { value: 0, source: SHELL_ID } },
        drivers: { ch1: countOf(0), ch2: countOf(1) },
      },
    },
    pause: {
      heading: 'Paused',
      buttons: [
        { id: 'resume_button', label: 'Resume', box: at(490, 220), control: press('resume') },
        { id: 'pause_settings', label: 'Settings', box: at(490, 304), control: press({ go: 'settings' }) },
        { id: 'leave_button', label: 'Leave lesson', box: at(490, 388), control: press('back') },
      ],
      prompts: [{ id: 'pause_resume_prompt', action: 'pause', words: 'Resume', pos: [490, 600] }, { id: 'pause_back_prompt', action: 'back', words: 'Leave', pos: [490, 640] }],
    },
    game_over: {
      heading: 'Game over',
      buttons: [
        { id: 'game_over_levels_button', label: 'Lessons', box: at(490, 260), control: press({ go: 'levels' }) },
        { id: 'game_over_title_button', label: 'Title', box: at(490, 344), control: press({ go: 'title' }) },
      ],
      prompts: [{ id: 'game_over_prompt', action: 'confirm', words: 'Choose', pos: [490, 600] }],
      back: 'title',
    },
    credits: {
      heading: 'Credits',
      buttons: [{ id: 'credits_back', label: 'Back', box: at(490, 560), control: press('back') }],
      prompts: [{ id: 'credits_back_prompt', action: 'back', words: 'Back', pos: [490, 650] }],
      ends: 600,
      extra: [text('credits_roll', 'Made for the course fixture\nSix lessons, one setting\nThanks for studying', [340, 160], 600, 300, 28)],
    },
  };
}

/** A screen as the shell names it: its 2D board, its controls (each drawn by its rect, labelled by its text) and its prompts. */
function screen(name: Screen, s: ScreenSpec): Obj {
  const items: Obj[] = [rect(`${name}_ground`, `${s.heading} ground`, [0, 0, DOC_SIZE[0], DOC_SIZE[1]], 'ground', 0), text(`${name}_heading`, s.heading, [240, name === 'levels' ? 40 : 80], 800, 60, 40)];
  for (const b of s.buttons) {
    items.push(rect(b.id, b.label, b.box, 'accent'));
    const wide = s.labels === 'left' && b.id.startsWith('row_') ? 300 : b.box[2] - 40;
    items.push(text(`${b.id}_label`, b.label, [b.box[0] + 20, b.box[1] + (b.box[3] - 32) / 2], wide, 32, 24));
  }
  for (const p of s.prompts) items.push(text(p.id, p.words, p.pos, 300, 28, 18));
  items.push(...(s.extra ?? []));
  // Drawn in the order listed: the ground first, a flip's children after their group.
  for (const i of items) i['order'] = nextOrder();
  return {
    doc: board(`${s.heading} screen`, items, s.more ?? {}),
    controls: Object.fromEntries(s.buttons.map((b) => [b.id, { ...b.control, item: b.id, text: `${b.id}_label` }])),
    prompts: Object.fromEntries(s.prompts.map((p) => [p.id, { action: p.action }])),
    ...(s.back !== undefined ? { back: s.back } : {}),
    ...(s.ends !== undefined ? { ends: s.ends } : {}),
  };
}

/** Level i's document alone: its heading, its controls and its one logic item. */
export function levelDocument(p: Programs, i: number, v: Variant = {}): Obj {
  const id = LEVEL_IDS[i]!;
  const reads = v.readsCustom && i === READS_CUSTOM_LEVEL;
  const program = reads ? p.probe : p.lessons[i]!;
  const params = reads ? { reads: ['finish_key', `${SHELL_ID}.custom`], writes: WRITES } : levelParams();
  return board(`Lesson: ${LEVEL_NAMES[i]}`, [
    text(`${id}_heading`, `Lesson: ${LEVEL_NAMES[i]}`, [240, 80], 800, 60, 40),
    text(`${id}_hint`, 'Press finish when you are done', [240, 200], 800, 40, 24),
    { id, ...item(program, params), name: `Lesson ${LEVEL_NAMES[i]} rules`, order: nextOrder() },
  ], { controls: { ...ACTIONS, ...ZONES }, assets: { lesson_rules: { sha256: program.sha, license: LICENSE } } });
}

/** Level i's document as the shell document `shell` holds it, for a play with no shell. */
export const levelOf = (shell: Obj, i: number): Obj => shell['items'][SHELL_ID]['params']['levels'][i]['doc'] as Obj;

/** The fixture shell's document, or the planted variant `v` names. */
export function shellDocument(p: Programs, v: Variant = {}): Obj {
  order = 0;
  const specs = screenSpecs(v);
  const levels = LEVEL_NAMES.map((name, i) => ({ doc: levelDocument(p, i, v), name, done: `${LEVEL_IDS[i]}.done` }));
  return board('Fixture course shell', [{
    id: SHELL_ID, kind: 'shell@1', name: 'Fixture course shell', order: nextOrder(),
    params: {
      screens: Object.fromEntries((Object.keys(specs) as Screen[]).map((name) => [name, screen(name, specs[name])])),
      levels,
      unlocked: [0, 1, 2, 3, 4, 5],
      transition: { kind: 'fade', steps: 12 },
      settings: {
        text_size: [100], reduced_motion: false, volume: { master: 0 }, bindings: { finish: ['f', 'north'] }, toggle: [],
        ...(v.noCustom ? {} : { custom: { mains: { ...MAINS, options: [...MAINS.options] } } }),
      },
      pause: { keys: ['Escape'], pad: ['start'], button: { corner: 'top_right', size: 48 } },
    },
  }]);
}

// ---------------------------------------------------------------------------------------------------
// The journeys' moves (README: The moves journey).

/** From the title, the level select, then lesson i entered and played until it is completed (its step 900). */
export const completeFromTitle = (i: number): Move[] => [{ activate: 'levels_button' }, { activate: `row_${i}` }, { play: 'left' }];
/** On the level select, lesson i entered and played until it is completed. */
export const complete = (i: number): Move[] => [{ activate: `row_${i}` }, { play: 'left' }];
/** On the level select, lesson i entered, played to its step `k`, paused and left from pause. */
export const leaveFromPause = (i: number, k = 300): Move[] => [{ activate: `row_${i}` }, { play: k }, { pause: true }, { back: true }];
/** The step a lesson played to its end is completed at. */
export const COMPLETED_AT = FINISH_AT;
/** Level 1 entered, played until its step 600 has run, paused, 240 chosen on the settings the pause screen opens, resumed and completed. */
export const PAUSE_CHANGE: Move[] = [
  { activate: 'row_1' }, { play: 600 }, { pause: true }, { activate: 'pause_settings' }, { set: 'mains_choice', value: 240 }, { back: true },
  { activate: 'resume_button' }, { play: 'left' },
];
/**
 * Criterion 4's moves: level 0 entered untouched, played to its step 60 and left from pause; back to the title; 120
 * chosen on the settings screen; then PAUSE_CHANGE from the level select.
 */
export const SETTING_MOVES: Move[] = [
  { activate: 'levels_button' }, ...leaveFromPause(0, 60), { back: true },
  { activate: 'settings_button' }, { set: 'mains_choice', value: 120 }, { back: true },
  { activate: 'levels_button' }, ...PAUSE_CHANGE,
];
