// The judges of #3233's suite (README, How each criterion is read): each decides one criterion from what a real program gave, a kit's
// report, a verdict's text, a load's result or a bench report, and answers the list of what is wrong, empty when
// nothing is. They import nothing, so a plain node script can run them on planted inputs. Every expected value is the
// issue's or the design's: the three codes, the three rule names, the floor 4.5, exactly once, eight planted fills and
// 1 ms. A ratio is computed here from two colors by the look's own formula, never copied from a program's output.

// ---- The issue's values.

/** The look's ink floor (design: Look; `crates/deep-canvas-marks/src/check.rs`, `CONTRAST_MIN`). */
export const FLOOR = 4.5;
/** The three rules revision 2 adds, by the name the issue gives each, and the code each raises. */
export const NEW_RULES = [
  { name: 'Names what it presses', code: 'no_name' },
  { name: 'Reads on its fill', code: 'low_contrast' },
  { name: 'Reaches by key', code: 'pointer_only' },
] as const;
/** The five planted fills revision 1 has, each with its code (`packages/conformance/src/slots/panel.ts` at the base). */
export const EARLIER_PLANTS = [
  { name: 'reaches-network', code: 'panel_network' },
  { name: 'runs-a-program', code: 'panel_program' },
  { name: 'moves-focus-unasked', code: 'focus_unasked' },
  { name: 'draws-outside', code: 'outside_panel' },
  { name: 'covers-the-card', code: 'over_card' },
] as const;

// ---- Naming.

const wordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
/** Whether `text` holds `word` whole: no letter, digit or `_` right before or after it. Case counts. */
export function names(text: string, word: string): boolean {
  if (!word) return false;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (!wordChar(text[at - 1]) && !wordChar(text[at + word.length])) return true;
  }
  return false;
}
/** `names`, whatever the case: for a theme's or a fill's word, which a sentence may start with. */
export const namesAnyCase = (text: string, word: string): boolean => names(text.toLowerCase(), word.toLowerCase());
/** Whether `text` holds the color `#rrggbb`, whatever the case of its digits, and not as the start of a longer one. */
export function namesColor(text: string, color: string): boolean {
  const lower = text.toLowerCase();
  const want = color.toLowerCase();
  for (let at = lower.indexOf(want); at >= 0; at = lower.indexOf(want, at + 1)) {
    if (!/[0-9a-f]/.test(lower[at + want.length] ?? '')) return true;
  }
  return false;
}
/** Every number `text` writes, the digits of its `#rrggbb` colors left out. */
export function numbersIn(text: string): number[] {
  const plain = text.replace(/#[0-9a-fA-F]{3,8}/g, ' ');
  return [...plain.matchAll(/(?<![\p{L}\p{N}_.])\d+(?:\.\d+)?/gu)].map((m) => Number(m[0]));
}
/** Whether `text` writes `ratio` to one decimal or more: a number within 0.05 of it. */
export const namesRatio = (text: string, ratio: number): boolean => numbersIn(text).some((n) => Math.abs(n - ratio) <= 0.05);

// ---- The look's contrast: the ratio of two relative luminances, as its guard computes it
// (`crates/deep-canvas-marks/src/look.rs`, `contrast`).

export type Rgb = [number, number, number];
export function rgb(color: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw Error(`${color} isn't #rrggbb`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
const decode = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
/** The contrast ratio of two `#rrggbb` colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A look's ground and raised fills in each theme, as `#rrggbb`. */
export type LookFills = Record<'light' | 'dark', Record<'ground' | 'raised', string>>;
/**
 * The shipped look's ground and raised in light and dark, from its own file (`crates/deep-canvas-marks/looks/clean.json`,
 * parsed): a role names a palette color, the dark theme's roles override the light's, and a look with no raised role
 * draws raised on its ground.
 */
export function lookFills(look: unknown): LookFills {
  const l = look as { palette?: Record<string, string>; roles?: Record<string, string>; themes?: { dark?: { roles?: Record<string, string> } } };
  const of = (roles: Record<string, string>, role: 'ground' | 'raised'): string => {
    const color = l.palette?.[roles[role] ?? ''] ?? (role === 'raised' ? l.palette?.[roles['ground'] ?? ''] : undefined);
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) throw Error(`the shipped look gives no opaque ${role}: ${String(color)}`);
    return color.toLowerCase();
  };
  const light = l.roles ?? {};
  const dark = { ...light, ...(l.themes?.dark?.roles ?? {}) };
  return { light: { ground: of(light, 'ground'), raised: of(light, 'raised') }, dark: { ground: of(dark, 'ground'), raised: of(dark, 'raised') } };
}
/** Each theme and fill of the look that `ink` reads under the floor on, worst first. */
export function failingFills(ink: string, fills: LookFills): { theme: 'light' | 'dark'; fill: 'ground' | 'raised'; color: string; ratio: number }[] {
  const all = (['light', 'dark'] as const).flatMap((theme) => (['ground', 'raised'] as const).map((fill) => ({ theme, fill, color: fills[theme][fill], ratio: contrast(ink, fills[theme][fill]) })));
  return all.filter((pair) => pair.ratio < FLOOR).sort((a, b) => a.ratio - b.ratio);
}

// ---- A refusal, at pack check or at load.

/** What the Rust half reports of one fixture panel (app/probe.rs): the pack check's verdict and the load's result. */
export interface Pack { pass: boolean; names: string | null; line: string }
export interface Load { ok: boolean; error: string | null; tree: string | null }
export interface Probed { pack?: Pack; load?: Load; panicked?: string }

export interface Wanted {
  /** The finding's code. */
  code: string;
  /** The node's id, where the criterion says the refusal names the node. */
  node?: string;
  /** Colors the refusal names. */
  colors?: string[];
  /** A ratio the refusal names, computed by the test. */
  ratio?: number;
  /** A theme the refusal names. */
  theme?: string;
  /** The look's fills of which the refusal names at least one, each by its role's word or by its color. */
  fills?: { fill: string; color: string }[];
}
/** What is wrong with a refusal's text, given what its criterion says it names. */
export function refusalProblems(where: string, panel: string, refusal: string | null, want: Wanted): string[] {
  if (refusal === null) return [`${panel}: ${where} took the panel, which ${want.code} refuses`];
  const missing: string[] = [];
  if (!names(refusal, want.code)) missing.push(`the code ${want.code}`);
  if (want.node !== undefined && !names(refusal, want.node)) missing.push(`the node ${want.node}`);
  for (const color of want.colors ?? []) if (!namesColor(refusal, color)) missing.push(`the color ${color}`);
  if (want.ratio !== undefined && !namesRatio(refusal, want.ratio)) missing.push(`the ratio ${want.ratio.toFixed(2)} (a number within 0.05 of it)`);
  if (want.theme !== undefined && !namesAnyCase(refusal, want.theme)) missing.push(`the theme ${want.theme}`);
  if (want.fills?.length && !want.fills.some(({ fill, color }) => namesAnyCase(refusal, fill) || namesColor(refusal, color))) missing.push(`the look's fill (${want.fills.map(({ fill, color }) => `${fill} or ${color}`).join(', ')})`);
  return missing.length ? [`${panel}: ${where} refused it without naming ${missing.join(', ')}: ${refusal}`] : [];
}
const blocked = (panel: string, probed: Probed | undefined): string[] | null =>
  !probed ? [`BLOCKED: app/probe.rs reported nothing of ${panel}`]
    : probed.panicked ? [`BLOCKED: ${panel}: the probe panicked: ${probed.panicked}`]
      : null;
/** The pack check must refuse the panel, naming what `want` says. */
export function packRefuses(panel: string, probed: Probed | undefined, want: Wanted): string[] {
  const stop = blocked(panel, probed);
  if (stop) return stop;
  if (!probed!.pack) return [`BLOCKED: app/probe.rs ran no pack check on ${panel}`];
  return refusalProblems('the pack check', panel, probed!.pack.pass ? null : probed!.pack.names ?? '(a refusal that names nothing)', want);
}
/** The load must refuse the panel, naming what `want` says. */
export function loadRefuses(panel: string, probed: Probed | undefined, want: Wanted): string[] {
  const stop = blocked(panel, probed);
  if (stop) return stop;
  if (!probed!.load) return [`BLOCKED: app/probe.rs ran no load of ${panel}`];
  return refusalProblems('the load', panel, probed!.load.ok ? null : probed!.load.error ?? '(a refusal that names nothing)', want);
}
/** The panel must pass the pack check and load, drawing `text`: a twin that is refused, or draws nothing, fails. */
export function loads(panel: string, probed: Probed | undefined, text: string): string[] {
  const stop = blocked(panel, probed);
  if (stop) return stop;
  const problems: string[] = [];
  if (!probed!.pack) problems.push(`BLOCKED: app/probe.rs ran no pack check on ${panel}`);
  else if (!probed!.pack.pass) problems.push(`${panel}: the pack check refused it: ${probed!.pack.names ?? '(naming nothing)'}`);
  if (!probed!.load) problems.push(`BLOCKED: app/probe.rs ran no load of ${panel}`);
  else if (!probed!.load.ok) problems.push(`${panel}: the load refused it: ${probed!.load.error ?? '(naming nothing)'}`);
  else if (!(probed!.load.tree ?? '').includes(JSON.stringify(text))) problems.push(`${panel}: it loaded and its tree draws no ${JSON.stringify(text)}:\n${probed!.load.tree ?? '(no tree)'}`);
  return problems;
}

// ---- Reaches by key: Tab, then Enter and Space, each running the handler exactly once.

/**
 * What the Rust half reports of one key drive: the count the panel draws at the start, after the last Tab, after the
 * Enter that followed it and after Space, null where it drew none, and how many times Tab was pressed.
 */
export interface Drive { start: number | null; afterTab: number | null; afterEnter: number | null; afterSpace: number | null; tabs?: number; error?: string; panicked?: string }
/** What is wrong with a key drive. A handler that ran any other number of times than once is named with its count. */
export function driveProblems(host: string, drive: Drive | undefined): string[] {
  if (!drive) return [`BLOCKED: app/probe.rs reported no key drive in ${host}`];
  if (drive.panicked) return [`BLOCKED: ${host}: the probe panicked: ${drive.panicked}`];
  if (drive.error) return [`BLOCKED: ${host}: the key drive couldn't run: ${drive.error}`];
  const { start, afterTab, afterEnter, afterSpace } = drive;
  if (start === null || afterTab === null || afterEnter === null || afterSpace === null) return [`BLOCKED: ${host}: the panel drew no count at some step: ${JSON.stringify(drive)}`];
  if (start !== 0) return [`BLOCKED: ${host}: the panel's count started at ${start}, not 0`];
  const problems: string[] = [];
  if (afterTab !== 0) problems.push(`${host}: Tab alone ran the handler ${afterTab} times; Tab only moves focus`);
  const times = (n: number): string => `${n} ${n === 1 ? 'time' : 'times'}`;
  const enter = afterEnter - afterTab;
  if (enter !== 1) problems.push(enter === 0 ? `${host}: after Tab${drive.tabs ? `, pressed ${times(drive.tabs)}` : ''}, Enter ran the handler 0 times: Tab didn't reach the element, or Enter doesn't run its press` : `${host}: Enter ran the handler ${times(enter)}, not exactly once`);
  const space = afterSpace - afterEnter;
  if (space !== 1) problems.push(`${host}: Space ran the handler ${times(space)}, not exactly once`);
  return problems;
}

// ---- A panel installed against revision 1.

/** What `panel@1` says of an installed panel, the line the hub keeps for its listing, must pass it and name the finding. */
export function listingProblems(panel: string, probed: Probed | undefined, want: Wanted): string[] {
  const stop = blocked(panel, probed);
  if (stop) return stop;
  if (!probed!.pack) return [`BLOCKED: app/probe.rs ran no pack check on ${panel}`];
  if (!probed!.pack.pass) return [`${panel}: panel@1 refuses a panel installed against revision 1, so the app would no longer mount it: ${probed!.pack.names ?? '(naming nothing)'}`];
  const missing = [want.code, ...(want.node === undefined ? [] : [want.node])].filter((word) => !names(probed!.pack!.line, word));
  return missing.length ? [`${panel}: what panel@1 says of it, which its listing is made from, doesn't name ${missing.join(' and ')}: ${probed!.pack.line}`] : [];
}
/** A panel installed against revision 1 must still load. A host that refuses it fails, naming the panel. */
export function stillLoads(panel: string, host: string, load: Load | undefined): string[] {
  if (!load) return [`BLOCKED: app/probe.rs ran no load of ${panel} in ${host}`];
  return load.ok ? [] : [`${panel}: ${host} refused at load a panel installed against revision 1: ${load.error ?? '(naming nothing)'}`];
}

// ---- The kit (AC1).

export interface KitRule { id: string; rule: string }
export interface KitPlant { name: string; message: string; codes: string[]; breaks: string }
export interface KitCase { id: string; outcome: string; message: string; codes: string[] }
const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** The rule the issue names `name`: its id or its text says the name, whatever the case and punctuation. */
export const ruleNamed = (rules: readonly KitRule[], name: string): KitRule | undefined =>
  rules.find((rule) => plain(rule.id).includes(plain(name)) || plain(rule.rule).includes(plain(name)));
/** What is wrong with the kit's own lists against revision 2: its revision, its eight rules and its eight plants. */
export function kitShapeProblems(kit: { revision: number; rules: readonly KitRule[]; planted: readonly KitPlant[] }): string[] {
  const problems: string[] = [];
  if (kit.revision !== 2) problems.push(`the kit is at revision ${kit.revision}, not 2`);
  if (kit.rules.length !== 8) problems.push(`the kit lists ${kit.rules.length} rules, not the five it had and three more: ${kit.rules.map((r) => r.id).join(', ')}`);
  if (kit.planted.length !== 8) problems.push(`the kit plants ${kit.planted.length} fills, not the five it had and three more: ${kit.planted.map((p) => p.name).join(', ')}`);
  for (const { name, code } of NEW_RULES) {
    const rule = ruleNamed(kit.rules, name);
    const plants = kit.planted.filter((p) => p.codes.includes(code));
    if (!rule) problems.push(`no rule of the kit is named "${name}": ${kit.rules.map((r) => `${r.id} (${r.rule})`).join('; ')}`);
    if (plants.length !== 1) problems.push(`${plants.length} planted fills raise ${code}; "${name}" needs exactly one`);
    else if (plants[0]!.codes.length !== 1) problems.push(`planted fill ${plants[0]!.name} names the codes ${plants[0]!.codes.join(', ')}, not ${code} alone`);
    else if (rule && plants[0]!.breaks !== rule.id) problems.push(`planted fill ${plants[0]!.name} raises ${code} and breaks rule ${plants[0]!.breaks}, not "${name}" (${rule.id})`);
  }
  return problems;
}
/**
 * What is wrong with the kit's run on one planted fill: it must fail, every case that doesn't pass must be a FAIL
 * with the fill's own code and no other, saying the fill's own message and no other planted fill's.
 */
export function plantRunProblems(plant: KitPlant, verdict: string, cases: readonly KitCase[], others: readonly KitPlant[]): string[] {
  const problems: string[] = [];
  const failed = cases.filter((c) => c.outcome !== 'PASS');
  if (verdict !== 'FAIL' || !failed.length) problems.push(`${plant.name}: the kit reads ${verdict} on it with ${failed.length} cases not passing; it must fail it`);
  for (const c of failed) {
    if (c.outcome !== 'FAIL') problems.push(`${plant.name}: case ${c.id} reads ${c.outcome}, not FAIL: ${c.message}`);
    if (c.codes.length !== plant.codes.length || plant.codes.some((code) => !c.codes.includes(code))) problems.push(`${plant.name}: case ${c.id} raises ${c.codes.join(', ') || 'no code'}, not ${plant.codes.join(', ')} alone`);
    if (!plant.message || !c.message.includes(plant.message)) problems.push(`${plant.name}: case ${c.id} doesn't say its message "${plant.message}": ${c.message}`);
    for (const other of others) if (other.name !== plant.name && other.message && c.message.includes(other.message)) problems.push(`${plant.name}: case ${c.id} says planted fill ${other.name}'s message "${other.message}": ${c.message}`);
  }
  return problems;
}
export interface KitProblem { check: string; name: string; reason: string }
/** Whether a hygiene problem names `rule`: its id whole, or the name the issue gives it. */
export function problemNamesRule(problem: KitProblem, rule: KitRule, name: string): boolean {
  const text = `${problem.check} ${problem.name} ${problem.reason}`;
  const whole = (word: string): boolean => {
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
      if (!/[\p{L}\p{N}_-]/u.test(text[at - 1] ?? ' ') && !/[\p{L}\p{N}_-]/u.test(text[at + word.length] ?? ' ')) return true;
    }
    return false;
  };
  return whole(rule.id) || plain(text).includes(plain(name));
}

// ---- The guide's row (AC6).

/** The planted fills the guide's Slots table lists for `method` and `iface`, each as its backticks hold it; null with no such row. */
export function guidePlanted(guide: string, method: string, iface: string): string[] | null {
  for (const line of guide.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[1] !== `\`${method}\`` || cells[3] !== `\`${iface}\``) continue;
    return [...(cells[6] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  }
  return null;
}
/** What is wrong with the guide's row: eight planted fills, the five it had and the kit's three, each once. */
export function guideRowProblems(listed: string[] | null, three: readonly string[]): string[] {
  if (listed === null) return ['docs/extension-guide.md has no row for `deep.registerView` and `panel@1` in its Slots table'];
  const problems: string[] = [];
  if (listed.length !== 8 || new Set(listed).size !== 8) problems.push(`the row lists ${listed.length} planted fills (${new Set(listed).size} distinct), not eight: ${listed.join(', ')}`);
  const missing = [...EARLIER_PLANTS.map((p) => p.name), ...three].filter((name) => !listed.includes(name));
  if (missing.length) problems.push(`the row doesn't list ${missing.join(', ')}: ${listed.join(', ')}`);
  return problems;
}

// ---- The budget (AC7).

/** One run of `deep-app panel-bench`: its warm-up, the times it had at the base, and the three rules' time on each update's tree. */
export interface BenchRun { warmup?: number; scriptNs?: number[]; totalNs?: number[]; rulesNs?: unknown }
/** The nodes of a tree as `panel-bench` reports it, a string child a node of its own. */
export function nodeCount(tree: unknown): number {
  const node = tree as { children?: unknown[] } | null;
  return node && typeof node === 'object' ? 1 + (Array.isArray(node.children) ? node.children : []).reduce((sum: number, child) => sum + nodeCount(child), 0) : 0;
}
/**
 * Each run's reading: the slowest update's `rulesNs`, in ms. A run with no `rulesNs`, one of another length than its
 * updates, or a time that is missing, zero or negative, is an error naming it: a time that wasn't taken is unknown,
 * never 0.
 */
export function rulesMs(runs: readonly BenchRun[], updates: number): number[] {
  return runs.map((run, at) => {
    const times = run.rulesNs;
    if (!Array.isArray(times)) throw Error(`run ${at} of panel-bench reports no rulesNs, the three rules' time on each update: its fields are ${Object.keys(run).join(', ')}`);
    if (times.length !== updates) throw Error(`run ${at} reports ${times.length} rulesNs for ${updates} updates`);
    const bad = times.findIndex((ns) => typeof ns !== 'number' || !Number.isFinite(ns) || ns <= 0);
    if (bad >= 0) throw Error(`run ${at}, update ${bad}: rulesNs is ${JSON.stringify(times[bad])}; a time that wasn't taken is unknown, never 0`);
    return Math.max(...(times as number[])) / 1e6;
  });
}
