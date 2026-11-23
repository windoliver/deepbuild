// #3238 AC5: with a hub answering on a test's own root, a command run through `scripts/lease` shows in the hub's lease
// table under its session, as #1015's seventh criterion has it (a cpu.slot lease held by `session:<its ID>` while the
// command runs, taken after the call began, released only after the command ended), and the throttle's log shows its
// grant: a top-level `granted` of class build whose ID is the one the command holds. The world is #1015's (its
// helpers, imported): a temp home with `deep hub run`, `deep` (the built CLI) on the PATH, and a scripted Claude Code
// session in this checkout whose shell call goes through the real deep-hook. The throttle's table is a folder of the
// world's own (DEEP_THROTTLE_TABLE), which holds inside a test run. The base leases the command and takes no grant.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeCall, heldNow, leaseRows, REPO, Session, shownHook, shownLeases, slotsOf, until, World } from '../1015/helpers.ts';

const AC5 = '#3238.8320a246';
const JOB = 'hub-job';
/** Clock slack between the stub's clock and the hub's (both the system's), in ms. */
const SLACK = 50;

// The stub: node stub.mjs <name>. It notes {name, event, at, pid, throttle} in $T3238_DIR/events.jsonl at its start
// and end, and holds until <name>.stop or all.stop appears there.
const STUB = `import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [name] = process.argv.slice(2);
const dir = process.env.T3238_DIR;
const note = (event) => appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ name, event, at: Date.now(), pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
note('start');
setInterval(() => { if (existsSync(join(dir, name + '.stop')) || existsSync(join(dir, 'all.stop'))) { note('end'); process.exit(0); } }, 50);
`;

interface Note { name: string; event: 'start' | 'end'; at: number; pid: number; throttle: string | null }
interface Entry { event: string; class?: string; grant?: string; id?: string }
const jsonLines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } }) : []);

describe('#3238 AC5: scripts/lease with a hub answering', () => {
  it(`${AC5} with a hub answering on a test's own root, the hub's lease table shows the command under its session and the throttle's log shows its grant`, async () => {
    const w = new World();
    const dir = join(w.dir, 'lease-3238');
    const table = join(w.dir, 'throttle');
    mkdirSync(dir);
    mkdirSync(table);
    writeFileSync(join(dir, 'stub.mjs'), STUB);
    const notes = () => jsonLines<Note>(join(dir, 'events.jsonl'));
    const noted = (event: string) => notes().find((n) => n.name === JOB && n.event === event);
    const hub = await w.startHub();
    try {
      const s = new Session(w, 'claude', REPO, { T3238_DIR: dir, DEEP_THROTTLE_TABLE: table });
      await s.begin('Build the workspace.');
      const command = `scripts/lease node ${join(dir, 'stub.mjs')} ${JOB}`;
      const began = Date.now();
      const call = await claudeCall(s, command);
      if (call.pre.decision.denied || !call.bash) expect.fail(`the session's call \`${command}\` was denied: ${shownHook(call.pre.hooked)}`);
      await until(() => Boolean(noted('start')) || call.bash!.finished(), 600_000);
      const job = noted('start');
      const shown = () => `notes: ${JSON.stringify(notes())}\nthe throttle's log: ${jsonLines<Entry>(join(table, 'log')).map((e) => JSON.stringify(e)).join('\n') || '(none)'}\nthe call's output: ${JSON.stringify(call.bash!.output().slice(-1500))}`;
      expect(job, `the command \`${command}\` never started\n${shown()}`).toBeDefined();
      const atStart = heldNow(await leaseRows(hub));
      writeFileSync(join(dir, `${JOB}.stop`), '');
      await until(() => call.bash!.finished(), 120_000);
      const end = noted('end');
      // Leases end on the supervisor's proof once the group has ended: a minute for that, then the table again.
      await until(async () => !slotsOf(heldNow(await leaseRows(hub)), s).length, 60_000, 1000);
      const rows = await leaseRows(hub);

      // The hub's lease table: a cpu.slot lease of the session, held when the command started, taken after the call
      // began, released only after the command ended or not yet.
      const own = slotsOf(atStart, s).filter((l) => l.at >= began - SLACK && l.at <= job!.at + SLACK).find((l) => {
        const after = rows.find((r) => r.id === l.id)?.released;
        return after === undefined || (end !== undefined && after >= end.at - SLACK);
      });
      expect(own, `\`${command}\` ran with no cpu.slot lease of its session (session:${s.id}): when it started the hub's table held ${shownLeases(atStart)}; its cpu.slot leases in all: ${shownLeases(slotsOf(rows, s))}\n${shown()}`).toBeDefined();

      // The throttle's log: the build grant the command holds, granted at top level.
      const token = String(job!.throttle);
      expect(token, `\`${command}\` ran under no throttle grant (DEEP_THROTTLE ${token})\n${shown()}`).toMatch(/^build:[0-9a-f]+$/);
      const id = token.slice('build:'.length);
      const granted = jsonLines<Entry>(join(table, 'log')).find((e) => e.event === 'granted' && e.id === id);
      expect(granted && granted.class === 'build' && granted.grant === 'top-level', `the throttle's log shows no top-level build grant ${id} for \`${command}\`\n${shown()}`).toBe(true);
    } finally {
      writeFileSync(join(dir, 'all.stop'), '');
      await w.stopHub();
    }
  }, 1_200_000);
});
