// #1501 manual end-to-end run: the real deep-hook against the real hub (no forwarder between), a session whose
// transcript names Claude Code 9.9.9, the shipped default rules. Run from the repo root after a build:
//   node docs/evidence/1501/e2e.mts > docs/evidence/1501/spark-e2e.md
// It prints what deep-hook replied to each call with the hub up, the session's health reading, the Stop of a worked
// turn, the same calls with the hub stopped, and a listed version's calls for comparison. Home paths are redacted.
import { join } from 'node:path';
import {
  UNLISTED, bash, buildDeepHook, cleanup, decision, defaultRules, editOf, eventsUntil, hook, installRules, listed, makeRepo, newSession,
  payload, postOf, readingText, startHub, stopHub, tempDir, userEntry, versionReadings, writeOf, type Call, type Session,
} from '../../../tests/acceptance/1501/helpers.ts';
import { mkdirSync, readFileSync } from 'node:fs';

const out: string[] = [];
let home = '';
const red = (s: string) => s.replaceAll(home, '~').replace(/\/tmp\/dh1501-[^/\s"]+/g, '/tmp/dh1501-…');
const say = (s = '') => out.push(red(s));
const load = () => `load ${readFileSync('/proc/loadavg', 'utf8').split(' ')[0]}`;

async function call(s: Session, label: string, body: Record<string, unknown>, expect: string): Promise<void> {
  const r = await hook(home, s, body);
  const text = `${r.stdout}${r.stderr}`.trim().replace(/\s+/g, ' ');
  // deep-hook says when the hub didn't acknowledge within its 50 ms and it decided alone: that row isn't the hub's reply.
  const alone = text.includes("sync didn't finish within the hook's 50 ms") ? ' (deep-hook alone: the hub missed its 50 ms)' : '';
  say(`| \`${label}\` | ${expect} | **${decision(r)}**${alone} (exit ${r.code}, ${r.ms.toFixed(0)} ms) | ${text.slice(0, 220) || '(nothing printed)'} |`);
}
async function turn(s: Session, prompt: string): Promise<string> {
  const id = userEntry(s, prompt);
  await hook(home, s, payload(s, 'UserPromptSubmit', { prompt_id: id, prompt }));
  return id;
}

await buildDeepHook();
const tmp = tempDir();
home = join(tmp, 'h');
mkdirSync(home);
const rules = defaultRules();
installRules(home, rules);
const repo = makeRepo(tmp);
// The issue's four calls (AC1).
const four: Call[] = [editOf(join(repo.dir, '.deepbuild/done.yaml'), 'Edit .deepbuild/done.yaml'), writeOf(join(home, '.claude/settings.json'), 'Write ~/.claude/settings.json'), bash('deep off'), bash('rm -rf "$X"/*')];
say(`# #1501 manual end-to-end run on the Spark (Linux arm64)\n`);
say(`Date: ${new Date().toISOString()}, ${load()}. Real \`deep-hook\` (target/debug) against a real \`deep hub run\`, no forwarder; rules.json = the shipped defaults (${Object.keys(rules.entries).length} entries). Expected column: the issue's words. A row marked "deep-hook alone" is one where the hub missed its 50 ms acknowledgement under load and deep-hook applied the floor itself; the acceptance suite (\`hubDecides\`) reads the hub's own reply on each connection and is the proof of the hub's side.\n`);

let hub = await startHub(home);
say(`## 1. Hub up, session on Claude Code ${UNLISTED} (a version the facts don't list)\n`);
const s = newSession(home, repo.dir, UNLISTED);
await hook(home, s, payload(s, 'SessionStart'));
await turn(s, 'Tidy the release notes.');
say('| Call | Expected | deep-hook decided | What it printed |\n|---|---|---|---|');
for (const c of four) await call(s, c.label, c.body(s), 'denied, naming the guard (floor)');
await call(s, 'npm install left-pad', bash('npm install left-pad').body(s), 'watch entry: recorded, runs');
await call(s, 'git push origin main', bash('git push origin main').body(s), 'block, not fail_closed (push-needs-ask): watch-only, runs');

say('\n### Stop of a worked turn\n');
const pid = await turn(s, 'Run echo, then stop.');
const pre = bash('echo worked').body(s);
await hook(home, s, pre);
await hook(home, s, postOf(s, pre));
const stop = await hook(home, s, payload(s, 'Stop', { prompt_id: pid, stop_hook_active: false, last_assistant_message: 'Ran it.' }));
say(`Stop: exit ${stop.code} after ${stop.ms.toFixed(0)} ms (a held stop waits ~60 s), stdout ${JSON.stringify(stop.stdout.trim()).slice(0, 200)} → ${stop.ms < 20_000 && !stop.stdout.includes('"decision"') ? 'not held' : 'HELD'}`);

say('\n### Health reading\n');
const all = await eventsUntil(home, (a) => versionReadings(a, s).length > 0);
for (const e of versionReadings(all, s)) say(`> ${readingText(e)}`);
const denied = all.filter((e) => e.session === s.id && e.kind === 'tool.before');
say(`\n${denied.length} tool.before events recorded for the session, ${denied.filter((e) => e.verified === false).length} of them unverified.`);

say(`\n## 2. Hub stopped (SIGTERM by PID ${hub.pid}), same session, same calls\n`);
await stopHub(hub);
say('| Call | Expected | deep-hook decided | What it printed |\n|---|---|---|---|');
for (const c of four) await call(s, c.label, c.body(s), 'denied by deep-hook alone, naming the guard');
await call(s, 'git push origin main', bash('git push origin main').body(s), 'not fail_closed: fails open, runs');

hub = await startHub(home);
const v = listed();
say(`\n## 3. Hub up again, session on Claude Code ${v} (the newest listed version), for comparison\n`);
const t = newSession(home, repo.dir, v);
await hook(home, t, payload(t, 'SessionStart'));
await turn(t, 'Tidy the release notes.');
say('| Call | Expected | deep-hook decided | What it printed |\n|---|---|---|---|');
for (const c of four.slice(0, 3)) await call(t, c.label, c.body(t), 'denied, naming the guard');
await call(t, 'rm -rf "$X"/*', bash('rm -rf "$X"/*').body(t), 'gated: staged or asked, not denied outright');
await call(t, 'git push origin main', bash('git push origin main').body(t), 'block entry gated: asks, not watch-only');
await stopHub(hub);
say(`\nEnd: ${new Date().toISOString()}, ${load()}.`);
await cleanup();
console.log(out.join('\n'));
