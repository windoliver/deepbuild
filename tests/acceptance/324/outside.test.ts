// #324 AC3: a dependency or top-level folder added outside the plan is listed in the claim with where it came from
// (design: Size and scope, "new dependencies, top-level folders … compared with the plan"; Before each command,
// "Adding a dependency, a service, a cloud resource or a top-level folder that the plan doesn't name").
//
// The task's plan names src/auth.js and package.json as its files and dayjs as its one new dependency, and no new
// top-level folder. The agent makes the fix, adds dayjs and left-pad to package.json's dependencies with one Edit, and
// writes vendor/pad.js, a new top-level folder, with a Write. At its stop, the record of the claim (README, Listed in
// the claim) must hold an entry naming left-pad with where it came from, package.json or the Edit that added it, and
// an entry naming the folder vendor with where it came from, vendor/pad.js or the Write that made it.
import { afterEach, describe, it } from 'vitest';
import {
  AC3, BEHAVIOR, BEHAVIOR_DRAFT, FIX, FLAG, claimRecord, claimsOf, cleanup, entriesWith, lastPos, listed, lockedTask, makeWorld, must, plan, runsDone, Session, settle,
  startHub, trustRepo,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PLAN = plan({ files: ['src/auth.js', 'package.json'], parts: ['auth middleware'], dependencies: ['dayjs'] });
const DEPS_FROM = '"dependencies": {}';
const DEPS_TO = '"dependencies": {\n    "dayjs": "1.11.13",\n    "left-pad": "1.3.0"\n  }';
const PAD = "// Pads a token's subject for the log line.\nmodule.exports = (s, n) => String(s).padStart(n);\n";
/** A string naming the folder vendor itself: `vendor` or `vendor/` as a word, not a path inside it. */
const namesVendor = (s: string): boolean => /(^|[^\w./-])vendor\/?(?![\w./-])/.test(s);
const namesLeftPad = (s: string): boolean => /(^|[^\w-])left-pad(?![\w-])/.test(s);

describe(`${AC3} a dependency or top-level folder outside the plan is listed in the claim with where it came from`, () => {
  it(`${AC3} left-pad (the plan names only dayjs) is listed with package.json or its Edit, and the new folder vendor with vendor/pad.js or its Write`, async () => {
    const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(PLAN)] });
    await trustRepo(w);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    const ref = await lockedTask(hub, s, BEHAVIOR, AC3);
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    await s.read('package.json');
    const added = await s.edit('package.json', DEPS_FROM, DEPS_TO);
    const made = await s.write('vendor/pad.js', PAD);
    await s.stop('Expired tokens are now rejected; the log line pads the subject.');
    const events = await settle(hub, (all) => runsDone(all, ref, since), 90_000);
    must(claimsOf(events, ref, since).length > 0, `BLOCKED: ${AC3} the stop must make a claim for ${ref}: none after it`);
    const record = claimRecord(events, ref, since);
    const data = record.map((e) => e.data);
    const dep = entriesWith(data, namesLeftPad, ['package.json', added]);
    must(dep.length > 0, `${AC3} left-pad was added outside the plan (it names only dayjs): the claim must list it with where it came from, package.json or the Edit ${added}; the claim's record is ${listed(record)}`);
    const folder = entriesWith(data, namesVendor, ['vendor/pad.js', made]);
    must(folder.length > 0, `${AC3} vendor is a top-level folder the plan doesn't name: the claim must list it with where it came from, vendor/pad.js or the Write ${made}; the claim's record is ${listed(record)}`);
  }, 300_000);
});
