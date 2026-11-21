// #2204 AC3, a blind redraft: "With the hub stopped, each of those two files denies the call, as today". Those two files
// are AC1's, rules.json cut to its first 40 bytes, and AC2's, a readable rules.json that gains one entry whose `match` is
// `effect:not-a-class`; the call is AC1's, a PreToolUse for `pkill -f node`. A real hub runs in a temp home whose
// rules.json holds the first-party entries and is stopped by its PID; then each file is written in turn and the real
// deep-hook rules on the call as Claude Code's hook entry runs it. The call is only a hook payload: nothing runs it.
// README.md gives the readings; twins.json names the wrong programs these tests fail on.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AC3, DEFAULT_RULES, answers, bash, buildDeepHook, cleanup, hook, makeHome, newSession, parseObject, rootOf, shown,
  startHub, stopHub, verdict, type Line, type Ran,
} from './helpers.ts';

const CALL = 'pkill -f node';
/** deep-hook's ruling limit: from 500 ms after its start, its watchdog decides a call by the clock, not by rules.json. */
const RULING_LIMIT_MS = 500;
/** That the file isn't JSON, however the denial words it. */
const ISNT_JSON = /\b(?:isn['’]t|is not|not)\b[^.\n]{0,24}?\bJSON\b|\b(?:invalid|malformed)\s+JSON\b/;

let home: string;
let rules: string;
let socket: string;
/** rules.json as the stopped hub left it: the readable file both files are made from. */
let readable: Buffer;
let readableParsed: Line;

beforeAll(async () => {
  await buildDeepHook();
  home = makeHome();
  rules = join(rootOf(home), 'rules.json');
  // The readable rules.json: the first-party entries, as `deep setup` installs them, there before the hub starts.
  writeFileSync(rules, readFileSync(DEFAULT_RULES));
  const hub = await startHub(home);
  socket = hub.socket;
  if (!(await answers(socket))) throw Error(`BLOCKED: the hub said it was ready, but nothing answers at ${socket}`);
  const how = await stopHub(hub);
  if (await answers(socket)) throw Error(`BLOCKED: the hub was stopped (${how}), but something still answers at ${socket}`);
  readable = readFileSync(rules);
  const parsed = parseObject(readable.toString('utf8'));
  const held = parsed?.entries;
  if (!parsed || typeof held !== 'object' || held === null || Array.isArray(held) || !Object.keys(held).length) {
    throw Error(`BLOCKED: rules.json as the stopped hub left it is no readable file of entries: ${JSON.stringify(readable.subarray(0, 200).toString('utf8'))}`);
  }
  readableParsed = parsed;
  console.log(`the hub ran at ${socket} and was stopped (${how}); rules.json then held ${Object.keys(held).length} entries in ${readable.length} bytes`);
}, 1_800_000);
afterAll(cleanup, 120_000);

/** With the hub stopped, writes `file` as rules.json, then has deep-hook rule on the call as Claude Code's hook entry runs it. */
async function callWith(file: Buffer): Promise<Ran> {
  if (await answers(socket)) throw Error(`BLOCKED: something answers at ${socket}, so the hub isn't stopped`);
  writeFileSync(rules, file);
  const s = newSession(home);
  const r = await hook(home, s, bash(s, CALL));
  console.log(`\`${CALL}\`: ${shown(r)}`);
  if (r.timedOut || r.signal === 'SIGKILL' || (r.code === null && r.signal === null)) {
    throw Error(`INCONCLUSIVE: deep-hook didn't end on its own, so the machine decided this run: ${shown(r)}`);
  }
  if (!readFileSync(rules).equals(file)) throw Error('BLOCKED: rules.json changed while the call ran, so the run ruled on another file');
  return r;
}

/** AC3 for one file: the call denied, and, as today, the denial naming rules.json and why it can't be read. */
function judge(r: Ran, file: string, why: RegExp, saying: string): void {
  const { denied, reason } = verdict(r);
  expect(denied, `with the hub stopped and ${file}, Claude Code's PreToolUse for \`${CALL}\` must be denied (exit 2, or a deny decision), as today, but deep-hook lets it run: ${shown(r)}`).toBe(true);
  // Past deep-hook's ruling limit its watchdog decides by the clock, in words of its own: a slow run's words prove nothing.
  if (r.ms >= RULING_LIMIT_MS && !(/rules\.json/.test(reason) && why.test(reason))) {
    throw Error(`INCONCLUSIVE: the call was denied, but in ${r.ms.toFixed(0)} ms, past deep-hook's ${RULING_LIMIT_MS} ms ruling limit, and the denial lacks the file or why: ${shown(r)}`);
  }
  expect.soft(reason, `with the hub stopped and ${file}, the denial names rules.json, as today: ${shown(r)}`).toMatch(/rules\.json/);
  expect.soft(reason, `with the hub stopped and ${file}, the denial says ${saying}, as today: ${shown(r)}`).toMatch(why);
}

it(`${AC3} with the hub stopped, rules.json cut to its first 40 bytes denies a PreToolUse for \`${CALL}\`, naming the file and that it isn't JSON, as today`, async () => {
  const cut = readable.subarray(0, 40);
  let json = true;
  try { JSON.parse(cut.toString('utf8')); } catch { json = false; }
  if (cut.length !== 40 || json) throw Error(`BLOCKED: the readable file's first 40 bytes aren't a cut file that isn't JSON: ${JSON.stringify(cut.toString('utf8'))}`);
  const r = await callWith(cut);
  judge(r, 'rules.json cut to its first 40 bytes', ISNT_JSON, "that it isn't JSON");
}, 600_000);

it(`${AC3} with the hub stopped, a readable rules.json that gains one entry whose match is effect:not-a-class denies a PreToolUse for \`${CALL}\`, naming the file and the entry, as today`, async () => {
  const name = `newer-${randomBytes(4).toString('hex')}`;
  // A whole guard@1 entry, as a newer writer would add one, but for its effect class; its own words don't name it.
  const entry = { match: 'effect:not-a-class', scope: 'all_repos', mode: 'block', reason: 'A newer writer holds this call.', next_step: 'Leave this entry alone; it is a test.', fail_closed: true };
  const gained = { ...readableParsed, entries: { ...readableParsed.entries, [name]: entry } };
  const r = await callWith(Buffer.from(`${JSON.stringify(gained, null, 2)}\n`));
  judge(r, `a readable rules.json that gains the entry ${name}, whose match is effect:not-a-class`, new RegExp(name), `the entry ${name}`);
}, 600_000);
