// Each criterion's scenario on the real hub and deep-hook (README, Criteria to tests). A scenario fails through an
// assertion naming its criterion and the call when the program fails it, throws `Inconclusive` when the machine
// spoiled the reading, and throws an Error starting `BLOCKED:` when its world couldn't be built (a plant the program
// doesn't list, a claim the stop never made). The tests run each on the program as it is; old-version.test.ts runs
// AC6's on its planted guard too.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, NPX_LATEST, NPX_LOCKED, NPX_NEW, NPX_OLD, NPX_UNLOCKED, NPX_UNREAD, PACKAGE, SPELLINGS, GATE_LATE,
  agentReads, allEvents, asksNaming, asksShown, bash, changeOf, checkEntry, claimOf, closingOf, dependencyEntries, fail, fixturePackages,
  handleOf, Inconclusive, json, label, lastPos, lateHook, makeWorld, must, newSession, postToolUse, preTool, preToolUse, questionOf,
  sessionStart, shown, sleep, startHub, startRegistry, stop, stopHub, typed,
  type Call, type Ev, type Hub, type Line, type Session,
} from './helpers.ts';

export interface Run { plant?: string | undefined }

// ---- The two outcomes a call has here.
/**
 * "Held with an ask naming <name>": its PreToolUse is denied while an authority ask whose question names `name` waits
 * for you, and what the agent reads names that ask. A call deep-hook let through alone, the hub's acknowledgement
 * having come late, or one the hub's gate couldn't decide within its hold, is INCONCLUSIVE. Returns the ask.
 */
export async function held(hub: Hub, s: Session, call: Call, name: string, who: string): Promise<Ev> {
  const since = await lastPos(hub);
  const { id, r } = await preToolUse(s, call);
  const reads = agentReads(r);
  if (preTool(r) !== 'deny') {
    if (await lateHook(hub, r, id)) throw new Inconclusive(`${who} deep-hook decided \`${label(call)}\` alone, the hub's acknowledgement having come late, so the hub never decided it (${shown(r)})`);
    await sleep(1500);
    const raised = await asksNaming(hub, since, [name]);
    fail(`${who} \`${label(call)}\` must be held with an ask naming ${name}: its PreToolUse let it run (${preTool(r)})${raised.length ? `, though ${asksShown(raised)}` : `, and no ask names ${name}`} (${shown(r)})`);
  }
  if (GATE_LATE.test(reads)) throw new Inconclusive(`${who} the hub's gate didn't decide \`${label(call)}\` within its hold: ${JSON.stringify(reads)}`);
  let ask: Ev | undefined;
  const deadline = Date.now() + 30_000;
  while (!(ask = (await asksNaming(hub, since, [name]))[0]) && Date.now() < deadline) await sleep(250);
  if (!ask) {
    const other = (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since);
    fail(`${who} \`${label(call)}\` must be held with an ask naming ${name}: it was denied (${shown(r)}), but no ask raised since names ${name}${other.length ? `; the asks raised: ${asksShown(other)}` : ''}`);
  }
  must(ask.data?.kind === 'authority', `${who} the ask holding \`${label(call)}\` must be an authority ask: ${handleOf(ask)} is ${String(ask.data?.kind)}`);
  must(reads.includes(handleOf(ask)), `${who} the agent must see why \`${label(call)}\` waits: what it reads must name ${handleOf(ask)}; it reads ${JSON.stringify(reads)}`);
  const closing = closingOf(await allEvents(hub), handleOf(ask));
  must(closing === undefined, `${who} ${handleOf(ask)}, holding \`${label(call)}\`, must wait for your answer; it closed as ${closing?.kind}`);
  return ask;
}

/**
 * "Runs with no ask": its PreToolUse isn't denied, it runs (its PostToolUse), and no ask raised since names the call
 * or any of `names`, 3 s on. A call deep-hook let through alone, or one the hub's gate couldn't decide within its
 * hold, is INCONCLUSIVE.
 */
export async function runsNoAsk(hub: Hub, s: Session, call: Call, names: readonly string[], who: string): Promise<void> {
  const since = await lastPos(hub);
  const words = [label(call), ...names];
  const { id, r } = await preToolUse(s, call);
  const reads = agentReads(r);
  if (preTool(r) === 'deny') {
    if (GATE_LATE.test(reads)) throw new Inconclusive(`${who} the hub's gate didn't decide \`${label(call)}\` within its hold: ${JSON.stringify(reads)}`);
    await sleep(1500);
    const raised = await asksNaming(hub, since, words);
    fail(`${who} \`${label(call)}\` must run with no ask: it was held${raised.length ? ` by ${asksShown(raised)}` : ''} (${shown(r)})`);
  }
  // Read before the next hook, whose arrival replays what deep-hook spooled.
  if (await lateHook(hub, r, id)) throw new Inconclusive(`${who} deep-hook decided \`${label(call)}\` alone, the hub's acknowledgement having come late, so the hub never decided it (${shown(r)})`);
  await postToolUse(s, call, id);
  await sleep(3000);
  const raised = await asksNaming(hub, since, words);
  must(!raised.length, `${who} \`${label(call)}\` must run with no ask: it ran, but ${asksShown(raised)}`);
}

/** The agent's Write of `path`: let through, written as the tool writes it, then its PostToolUse. */
async function agentWrites(hub: Hub, s: Session, path: string, content: string, who: string): Promise<void> {
  const call: Call = { tool_name: 'Write', tool_input: { file_path: path, content } };
  const original = readFileSync(path, 'utf8');
  const { id, r } = await preToolUse(s, call);
  if (preTool(r) === 'deny') {
    if (GATE_LATE.test(agentReads(r))) throw new Inconclusive(`${who}: the hub's gate didn't decide the Write within its hold: ${shown(r)}`);
    fail(`${who} must be let through: the Write was denied (${shown(r)})`);
  }
  if (await lateHook(hub, r, id)) throw new Inconclusive(`${who}: deep-hook decided the Write alone, the hub's acknowledgement having come late (${shown(r)})`);
  writeFileSync(path, content);
  await postToolUse(s, call, id, { type: 'update', filePath: path, content, structuredPatch: [], originalFile: original, userModified: false });
}

// ---- What a question shows (AC4).
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
/** A publish time as a person reads its date: ISO in UTC and in local time, and the month by name with the day. */
export function datesOf(at: number): string[] {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = (m: 'short' | 'long') => d.toLocaleDateString('en-US', { month: m });
  return [...new Set([
    d.toISOString().slice(0, 10), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${month('short')} ${d.getDate()}`, `${month('long')} ${d.getDate()}`, `${d.getDate()} ${month('short')}`, `${d.getDate()} ${month('long')}`,
  ])];
}
/** Whether a question shows a version published `n` days ago: its age in days (or hours), or its date. */
export function showsDaysAgo(question: string, n: number, at: number): boolean {
  return new RegExp(`\\b(?:${n}|${NUMBER_WORDS[n]})[ -]days?\\b`, 'i').test(question)
    || new RegExp(`\\b${n * 24}[ -]hours?\\b`, 'i').test(question)
    || datesOf(at).some((d) => question.includes(d));
}
/** "It never says old or safe": neither word, nor its other forms, whole in the question. */
const OLD_OR_SAFE = /\b(?:old|older|oldest|safe|safer|safest|safely)\b/i;
function neverOldOrSafe(ask: Ev, who: string): void {
  const said = OLD_OR_SAFE.exec(questionOf(ask));
  must(said === null, `${who} the question never says old or safe: ${handleOf(ask)} says "${said?.[0]}": ${JSON.stringify(questionOf(ask))}`);
}

// ---- The worlds: a hub on the fixture registry, a session in the repo, and the hub stopped afterwards.
interface Ready { hub: Hub; close(): void; packages: ReturnType<typeof fixturePackages>; w: ReturnType<typeof makeWorld> }
async function world(o: Run & { stopHoldMs?: number }): Promise<Ready> {
  const w = makeWorld();
  const packages = fixturePackages(Date.now());
  const registry = await startRegistry(packages);
  const hub = await startHub(w, { registry: registry.url, plant: o.plant, stopHoldMs: o.stopHoldMs });
  return { hub, close: () => registry.close(), packages, w };
}
async function within(o: Run & { stopHoldMs?: number }, body: (r: Ready) => Promise<void>): Promise<void> {
  const ready = await world(o);
  try {
    await body(ready);
  } finally {
    await stopHub(ready.hub);
    ready.close();
  }
}

// ---- AC1 #1509.a4073779: `npx -y some-pkg@latest`, not in the lockfile and named by no plan, is held with an ask naming it.
export async function registryRunHeld(o: Run = {}): Promise<void> {
  await within(o, async ({ hub, w }) => {
    // A session working on no task: no plan names anything.
    const s = newSession(w);
    await sessionStart(s);
    await held(hub, s, bash(NPX_LATEST), 'some-pkg', `AC1 ${AC1} in a session no plan of which names some-pkg, which the lockfile doesn't hold:`);
  });
}
/** AC1, the Scope's other spellings, through deep-hook's check mode with the shipped dependency entries, in the fixture repo. */
export async function spellingsRead(): Promise<void> {
  const w = makeWorld();
  const entries = dependencyEntries();
  must(entries.length > 0, `AC1 ${AC1} the shipped defaults must hold an entry whose match is effect:dependency (crates/deep-hook/default-rules.json); they hold none`);
  const unread: string[] = [];
  for (const command of SPELLINGS) {
    let read = false;
    for (const [, entry] of entries) {
      if (await checkEntry(w, entry, command)) {
        read = true;
        break;
      }
    }
    if (!read) unread.push(command);
  }
  must(!unread.length, `AC1 ${AC1} the dependency effect must read a package run straight from a registry that the repo's lockfile doesn't hold, however it is spelled: deep-hook check, with ${entries.map(([n]) => n).join(' and ')}, reads ${unread.map((c) => `\`${c}\``).join(', ')} as no dependency`);
}

// ---- AC2 #1509.ae8eec29: `npx vitest` at the lockfile's version runs with no ask.
export async function lockfileRuns(o: Run = {}): Promise<void> {
  await within(o, async ({ hub, w }) => {
    const s = newSession(w);
    await sessionStart(s);
    await runsNoAsk(hub, s, bash(NPX_LOCKED), ['vitest'], `AC2 ${AC2} with vitest at 3.2.4 in the repo's lockfile:`);
    // The contrast that makes "at the lockfile's version" mean something: a vitest version the lockfile doesn't hold,
    // published 2 days ago, is a dependency decision like any other.
    await held(hub, s, bash(NPX_UNLOCKED), 'vitest', `AC2 ${AC2} as its contrast, a vitest version the lockfile doesn't hold:`);
  });
}

// ---- AC3 #1509.a066c839: a bare install is read through the diff.
export async function installsThroughTheDiff(o: Run = {}): Promise<void> {
  await within(o, async ({ hub, w }) => {
    const s = newSession(w);
    await sessionStart(s);
    const unchanged = `AC3 ${AC3} with no manifest change since the base:`;
    await runsNoAsk(hub, s, bash('npm install'), ['vitest'], unchanged);
    await runsNoAsk(hub, s, bash('npm ci'), ['vitest'], unchanged);
    await runsNoAsk(hub, s, bash('pip install -r requirements.txt'), ['requirements.txt', 'some-lib'], unchanged);
    // The agent's Write adds left-pad to package.json; nothing is committed.
    const manifest = join(w.repo, 'package.json');
    await agentWrites(hub, s, manifest, json({ ...PACKAGE, dependencies: { 'left-pad': '^1.3.0' } }), `AC3 ${AC3} the agent's Write adding left-pad to package.json`);
    await held(hub, s, bash('npm install'), 'left-pad', `AC3 ${AC3} after the agent's Write added left-pad to package.json:`);
  });
}

// ---- AC4 #1509.69494a39: the question says how new the version is, or "couldn't check", and never old or safe.
export async function registryReading(o: Run = {}): Promise<void> {
  await within(o, async ({ hub, close, packages, w }) => {
    const s = newSession(w);
    await sessionStart(s);
    const latest = packages.find((p) => p.name === 'some-pkg')!.versions.find((v) => v.version === '2.0.0')!;
    const up = await held(hub, s, bash(NPX_LATEST), 'some-pkg', `AC4 ${AC4} with the fixture registry up:`);
    must(showsDaysAgo(questionOf(up), 2, latest.at), `AC4 ${AC4} the question for \`${NPX_LATEST}\` must show that its version, some-pkg 2.0.0, was published 2 days ago (its age in days, or its date: ${datesOf(latest.at).join(', ')}): ${handleOf(up)} asks ${JSON.stringify(questionOf(up))}`);
    must(/\bnew(?:ly)?\b/i.test(questionOf(up)), `AC4 ${AC4} the question for \`${NPX_LATEST}\` must name some-pkg 2.0.0, published 2 days ago, as new: ${handleOf(up)} asks ${JSON.stringify(questionOf(up))}`);
    neverOldOrSafe(up, `AC4 ${AC4} with the registry up,`);
    // The registry goes down: every connection dropped, nothing listening at its address.
    close();
    const down = await held(hub, s, bash(NPX_UNREAD), 'other-pkg', `AC4 ${AC4} with the registry down:`);
    must(/couldn['’]t check/i.test(questionOf(down)), `AC4 ${AC4} with the registry down, the question for \`${NPX_UNREAD}\` must say "couldn't check": ${handleOf(down)} asks ${JSON.stringify(questionOf(down))}`);
    neverOldOrSafe(down, `AC4 ${AC4} with the registry down,`);
  });
}

// ---- AC5 #1509.6384e10e: with the hub stopped, the call is allowed and recorded, as a dependency is today.
export async function hubStopped(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const registry = await startRegistry(fixturePackages(Date.now()));
  let hub: Hub | undefined;
  try {
    // The hub stopped: nothing listens at ~/.deepbuild/hub.sock, so deep-hook decides each call alone and spools it.
    const s = newSession(w);
    await sessionStart(s);
    const today = await preToolUse(s, bash('npm install left-pad@1.3.0'));
    const call = await preToolUse(s, bash(NPX_LATEST));
    must(preTool(today.r) !== 'deny', `AC5 ${AC5} with the hub stopped, \`npm install left-pad@1.3.0\`, a dependency as today, must be allowed: it was denied (${shown(today.r)})`);
    must(preTool(call.r) !== 'deny', `AC5 ${AC5} with the hub stopped, \`${NPX_LATEST}\` must be allowed, as a dependency is today: it was denied (${shown(call.r)})`);
    // Recorded: the hub, started again, replays what deep-hook spooled; each call's tool.before names the entries
    // deep-hook matched, as a watched match is recorded.
    hub = await startHub(w, { registry: registry.url, plant: o.plant });
    const dependency = dependencyEntries().map(([n]) => n);
    const named = (e: Ev | undefined) => Array.isArray(e?.data?.matched) && (e!.data.matched as unknown[]).some((m) => dependency.includes(String(m)));
    const matchedOf = (e: Ev) => (e.data?.matched === undefined ? 'no entry deep-hook matched' : JSON.stringify(e.data.matched));
    const until = Date.now() + 60_000;
    let events: Ev[] = [];
    const before = (id: string) => events.find((e) => e.kind === 'tool.before' && e.data?.call === id);
    while (Date.now() < until) {
      events = await allEvents(hub);
      if (before(today.id) && before(call.id)) break;
      await sleep(500);
    }
    const a = before(today.id);
    const b = before(call.id);
    must(a !== undefined, `AC5 ${AC5} \`npm install left-pad@1.3.0\`, allowed with the hub stopped, must be recorded: 60 s after the hub came back the record holds no tool.before for its call ${today.id}`);
    must(named(a), `AC5 ${AC5} \`npm install left-pad@1.3.0\`, allowed with the hub stopped, is recorded as a dependency today, matched to ${dependency.join(' or ')}: its tool.before names ${matchedOf(a)}`);
    must(b !== undefined, `AC5 ${AC5} \`${NPX_LATEST}\`, allowed with the hub stopped, must be recorded: 60 s after the hub came back the record holds no tool.before for its call ${call.id}`);
    must(named(b), `AC5 ${AC5} \`${NPX_LATEST}\`, allowed with the hub stopped, must be recorded as a dependency is today, as \`npm install left-pad@1.3.0\` is (matched to ${matchedOf(a)}): its tool.before names ${matchedOf(b)}`);
  } finally {
    if (hub) await stopHub(hub);
    registry.close();
  }
}

// ---- AC6 #1509.231f163d: an old version of an old name runs with no ask and the return card names it; a new one is held.
/** The prompt you type: it asks for a change, so it opens a task, and the turn's stop is a claim (README, The return card). */
export const PROMPT = 'Add a date picker to the signup form.';
/** The agent's last words, which never fill the card. */
export const SAID = 'The signup form has its date picker now.';
export async function oldVersionRuns(o: Run = {}): Promise<void> {
  await within({ ...o, stopHoldMs: 3000 }, async ({ hub, w }) => {
    const s = newSession(w);
    await sessionStart(s);
    await typed(s, PROMPT);
    await runsNoAsk(hub, s, bash(NPX_OLD), ['some-pkg'], `AC6 ${AC6} a version published three years ago, of a name first published four years ago:`);
    // The turn ends: its stop is a claim on the task the prompt opened, and the change's sentence is the line the
    // return card leads with.
    const since = await lastPos(hub);
    const stopped = stop(s, SAID);
    const claim = await claimOf(hub, s, since, 60_000);
    await stopped;
    if (!claim) throw Error(`BLOCKED: the stop of a turn whose prompt opened a task must make a claim (claim.made) for the return card's line to be read from; none in 60 s`);
    let change: Line | undefined;
    let sentence = '';
    const deadline = Date.now() + 30_000;
    for (;;) {
      const read = await changeOf(hub, claim);
      if (read) {
        change = read;
        sentence = String(read.sentence ?? '');
        if (sentence.includes('some-pkg') && sentence.includes('1.0.0')) break;
      }
      if (Date.now() > deadline) break;
      await sleep(1000);
    }
    if (!change) throw Error(`BLOCKED: changes.read must answer for ${claim}, the change whose sentence the return card leads with; it didn't in 30 s`);
    must(sentence.includes('some-pkg') && sentence.includes('1.0.0'), `AC6 ${AC6} the return card's what-changed line must name some-pkg 1.0.0, which ran straight from the registry: changes.read's change.sentence for ${claim} reads ${JSON.stringify(sentence)}`);
    const asked = await asksNaming(hub, 0, ['some-pkg']);
    must(!asked.length, `AC6 ${AC6} a version published three years ago: \`${NPX_OLD}\` must run with no ask: ${asksShown(asked)}`);
    // A version published 2 days ago, in another session, is still held.
    const t = newSession(w);
    await sessionStart(t);
    await held(hub, t, bash(NPX_NEW), 'some-pkg', `AC6 ${AC6} a version published 2 days ago:`);
  });
}
