// #1583 in the app's question card (README, Each criterion to its tests). The card's text is read through
// app/card.rs, a test target of deep-app that presents each card from record events and prints its lines
// (`question::Controller::lines()`, as #1510's suite reads the card) and each session's name
// (`states::Table::title`). This file builds that target once, with deep-app's `env-plants` door, draws every card
// once as shipped, and the options' card once more as the planted card, `DEEP_HUB_PLANT=card-draws-raw`. The judges
// are ./judge.ts's; the planted card goes through the one the shipped card passes.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { childEnv, cleanup, makeHome, REPO, run, type Line } from '../16/helpers.ts';
import { added, drawn, isRow, SAFETY_LIST, safetyRows, show, unchanged } from './judge.ts';
import { approvalHolding, ASCII, HIDDEN, HIDDEN_ASK, LINK, LINK_ASK, PLAIN_APPROVALS, SESSION_NAME, type Approval, type Hidden } from './texts.ts';

/** The test target of deep-app that draws the cards (README, What the implementer adds: its `[[test]]` entry). */
const TARGET = 'acceptance_1583';
/** The planted card (README, The planted card): read by `deep_app::plain::planted` in a build with `env-plants`. */
const PLANT = 'card-draws-raw';
/** The issue whose rows of the safety list the warning must be among. */
const ISSUE = '#1583';
const MINUTE = 60_000;
const NOW = 1_800_000_000_000;
const SESSION = 'S1583';

interface Asked { ask: string; events: Line[] }
/** An open ask as the record holds it: its ask.created, as #1510's `app/card.rs` writes one. */
function created(id: string, kind: 'authority' | 'taste', question: string, options: Line[], rest: Line): Line {
  return { kind: 'ask.created', id, session: 'S', log_pos: 1, data: { kind, question, options, recommended: null, deadline: NOW + 86_400_000, key: `k-${id}`, pinned_to: { kind: 'commit', ref: 'abc' }, ...rest } };
}
/** A question with options, each an ID and a label, the first its default. */
function choices(id: string, question: string, options: readonly { id: string; label: string }[]): Asked {
  return { ask: `ask:${id}`, events: [created(id, 'taste', question, options.map((o) => ({ ...o, decision: 'none' })), { default: options[0]!.id })] };
}
/** An approval: an authority ask, and the plan the core proposed for it, whose one step runs the command. */
function approval(id: string, a: Approval): Asked {
  const options = [{ id: 'approve', label: a.allow, decision: 'allow' }, { id: 'decline', label: 'Decline', decision: 'deny' }];
  const plan = { ask: `ask:${id}`, steps: [{ does: a.command, changes: ['origin/main'], undo: 'Revert it', public: true, cost: 0 }], diff: '0123456789abcdef'.repeat(4), hash: 'fedcba9876543210'.repeat(4) };
  return { ask: `ask:${id}`, events: [
    created(id, 'authority', a.question, options, { default: 'decline', subject: { effect: 'push', target: { ref: 'origin/main' } } }),
    { kind: 'plan.proposed', id: `${id}P`, session: 'S', writer: 'core', log_pos: 2, data: plan },
  ] };
}

const FIELDS = ['question', 'allow', 'command'] as const;
/** Each approval holding one of the three characters in one of its three fields. */
const HOLDING = FIELDS.flatMap((field) => HIDDEN.map((hidden) => ({ field, hidden, id: `H${field}${hidden.code.slice(2)}`, text: approvalHolding(field, hidden) })));
/** Every card of this file, by name, in the order the target draws them. */
const CARDS: Record<string, Asked> = {
  options: choices('OPTIONS', 'Which name for the build folder?', HIDDEN_ASK.options),
  link: choices('LINK', LINK_ASK.question, LINK_ASK.options),
  ascii: approval('ASCII', ASCII),
  ...Object.fromEntries(HOLDING.map((h) => [h.id, approval(h.id, h.text)])),
  ...Object.fromEntries(PLAIN_APPROVALS.map((p) => [p.name, approval(`P${p.name}`, p)])),
};

/** A line of cargo's JSON messages, as far as this file reads it. */
interface Artifact { reason?: string; target?: { name?: string }; executable?: string | null }
/** deep-app's `acceptance_1583` test target, built with `env-plants`: its executable's path. BLOCKED when it can't be built. */
async function target(): Promise<string> {
  if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) throw Error(`BLOCKED: cargo is not on PATH, so ${TARGET} can't be built`);
  const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
  const r = await run('cargo', ['test', '--locked', '-q', '-p', 'deep-app', '--test', TARGET, '--features', 'env-plants', '--no-run', '--message-format=json-render-diagnostics'], { env, timeoutMs: 120 * MINUTE });
  const said = (line: string): Artifact => { try { return JSON.parse(line) as Artifact; } catch { return {}; } };
  const exe = r.stdout.split('\n').map(said).find((m) => m.reason === 'compiler-artifact' && m.target?.name === TARGET && m.executable)?.executable;
  if (r.code === 0 && exe) return exe;
  if (/no test target named/.test(r.stderr)) throw Error(`BLOCKED: crates/deep-app/Cargo.toml has no [[test]] ${TARGET} for tests/acceptance/1583/app/card.rs (README, What the implementer adds)`);
  throw Error(`BLOCKED: cargo test --no-run of ${TARGET} exited ${r.code}: ${r.stderr.slice(-2000)}`);
}

interface Drawn { lines: Record<string, string[]>; titles: string[] }
/** What the target draws of `cards`, and the session's name, with `plant` selected or none. BLOCKED when it draws none. */
async function draw(exe: string, home: string, cards: Record<string, Asked>, plant?: string): Promise<Drawn> {
  const file = join(home, `cards-${plant ?? 'shipped'}.json`);
  const rows = [{ id: `session:${SESSION}`, address: `session/${SESSION}`, session: SESSION, title: SESSION_NAME, word: 'working', entry: 'running' }];
  writeFileSync(file, JSON.stringify({ now: NOW, cards: Object.values(cards), rows, sessions: [SESSION] }));
  const r = await run(exe, ['cards', file], { env: childEnv(home, { TZ: 'UTC', ...(plant ? { DEEP_HUB_PLANT: plant } : {}) }), cwd: home, timeoutMs: 5 * MINUTE });
  const built = plant ? ` with DEEP_HUB_PLANT=${plant}` : '';
  let out: { cards?: { ask?: string; lines?: string[] | null }[]; titles?: string[] } = {};
  try { out = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as typeof out; } catch { /* named below */ }
  if (r.code !== 0 || !Array.isArray(out.cards) || out.cards.length !== Object.keys(cards).length || !Array.isArray(out.titles)) {
    throw Error(`BLOCKED: ${TARGET}${built} drew no cards: exit ${r.code}, ${r.stdout.slice(-800)} ${r.stderr.slice(-800)}`);
  }
  const lines: Record<string, string[]> = {};
  for (const [i, name] of Object.keys(cards).entries()) {
    const card = out.cards[i]!;
    if (!Array.isArray(card.lines)) throw Error(`BLOCKED: the card doesn't present ${cards[name]!.ask} (the ${name} card)${built}: the app reads no open ask from its events`);
    lines[name] = card.lines;
  }
  return { lines, titles: out.titles };
}

let shipped: Drawn;
let planted: Drawn;
beforeAll(async () => {
  const exe = await target();
  const home = makeHome();
  shipped = await draw(exe, home, CARDS);
  planted = await draw(exe, home, { options: CARDS.options! }, PLANT);
}, 130 * MINUTE);
afterAll(cleanup, 2 * MINUTE);

/** Criterion 1's check of the options' card: each option's label, in the card's lines. */
const optionsDrawn = (lines: readonly string[], card: string) => HIDDEN_ASK.options.flatMap((o) => drawn(`${card}, option ${o.id}`, o.label, lines));

describe('AC1 #1583.f0f56109 Each of a zero-width space, a right-to-left override and a tag character in an option draws as a visible escape. A planted card that draws them raw fails, naming the character', () => {
  it('AC1 #1583.f0f56109 on the app\'s card, an option holding each of the three characters draws it as its escape, and none raw (the base does: it must stay so)', () => {
    expect(optionsDrawn(shipped.lines.options!, 'the app\'s card').map((f) => f.message)).toEqual([]);
  });

  it('AC1 #1583.f0f56109 the planted card, DEEP_HUB_PLANT=card-draws-raw, fails the same check, which names each of the three characters as drawn raw', () => {
    const findings = optionsDrawn(planted.lines.options!, `the planted card (${PLANT})`);
    expect(findings.map((f) => `${f.code} ${f.how}`).sort(), `the planted card draws each character raw, and the check says so of each: ${findings.map((f) => f.message).join('; ') || `it passes the check, drawing ${planted.lines.options!.map(show).join(' | ')}`}`)
      .toEqual(HIDDEN.map((h) => `${h.code} raw`).sort());
    for (const f of findings) expect(f.message, 'the failure names the character').toContain(f.code);
  });

  it('AC1 #1583.f0f56109 in the app, a link\'s target in a card\'s question and a session\'s name holding each of the three characters draw it as its escape, and none raw (the base does: it must stay so)', () => {
    const findings = [
      ...drawn('the app\'s card, the link\'s target in its question', LINK, shipped.lines.link!),
      ...drawn('the session\'s name as the app draws it', SESSION_NAME, shipped.titles),
    ];
    expect(findings.map((f) => f.message)).toEqual([]);
  });
});

/** What the approval holding `hidden` in `field` draws beyond the same approval without it, and what it lacks of it. */
const beyond = (h: { id: string; hidden: Hidden }) => added(shipped.lines[h.id]!, shipped.lines.ascii!, h.hidden);
const named = (h: { field: string; hidden: Hidden }): string => `the approval holding ${h.hidden.code} ${h.hidden.name} in its ${h.field === 'allow' ? 'allowing option' : h.field}`;

describe('AC2 #1583.3d92be0c An authority card with one shows the warning, and the warning is a safety row', () => {
  it('AC2 #1583.3d92be0c an approval holding one of the three characters in its question, its allowing option or its command draws a line the same approval without it doesn\'t: the warning', () => {
    const problems: string[] = [];
    for (const h of HOLDING) {
      const { extra, lost } = beyond(h);
      if (lost.length) problems.push(`${named(h)} doesn't draw ${lost.length} line(s) of the same approval without it, the escape ${h.hidden.escape} aside: ${lost.map(show).join(' | ')}; it draws ${shipped.lines[h.id]!.map(show).join(' | ')}`);
      if (!extra.length) problems.push(`${named(h)} draws no line the same approval without it doesn't: nothing on the card says it holds one`);
    }
    expect(problems).toEqual([]);
  });

  it('AC2 #1583.3d92be0c the warning\'s words are a row of the safety list, crates/deep-app/safety.json, that names #1583, and an approval holding none draws no such row', () => {
    const { rows, problem } = safetyRows(REPO);
    const mine = rows.filter((row) => row.issue === ISSUE);
    const problems: string[] = problem ? [problem] : [];
    if (!problem && !mine.length) problems.push(`${SAFETY_LIST} holds no row whose issue is ${ISSUE}`);
    for (const h of HOLDING) {
      const { extra } = beyond(h);
      if (!extra.some((line) => mine.some((row) => isRow(row, line)))) problems.push(`${named(h)} draws no line that is a ${ISSUE} row of the safety list: beyond the same approval without it, it draws ${extra.map(show).join(' | ') || 'nothing'}`);
    }
    const calm = shipped.lines.ascii!.filter((line) => mine.some((row) => isRow(row, line)));
    if (calm.length) problems.push(`the approval holding none draws the warning all the same: ${calm.map(show).join(' | ')}`);
    expect(problems).toEqual([]);
  });
});

describe('AC4 #1583.e10b90b9 Plain text in Chinese, Arabic and with emoji draws unchanged and adds no warning', () => {
  it('AC4 #1583.e10b90b9 an approval whose question, allowing option and command are plain Chinese, Arabic or emoji draws each as it is, and no line the same approval in ASCII doesn\'t (the base does: it must stay so)', () => {
    const problems: string[] = [];
    for (const p of PLAIN_APPROVALS) {
      const lines = shipped.lines[p.name]!;
      const where = `the ${p.name} approval's card`;
      if (!lines.includes(p.question)) problems.push(`${where} draws its question on no line of its own, unchanged: ${lines.map(show).join(' | ')}`);
      problems.push(...unchanged(where, lines, shipped.lines.ascii!, [[p.question, ASCII.question], [p.allow, ASCII.allow], [p.command, ASCII.command]]));
    }
    expect(problems).toEqual([]);
  });
});
