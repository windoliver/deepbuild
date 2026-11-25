// Helpers for #3350's acceptance tests: the #1122 fixture far machine (../1122/helpers.mjs) made ready as #3334's tests
// make it (../3334/helpers.mjs), with a cargo stand-in that says which grant each call ran under and how long the
// throttle process holding that grant had been alive, a gate the lane's own tests wait at, and the grants a lane's own
// commands ran under. Nothing here imports the code under test: lanes.mjs, lane-remote.mjs and throttle.mjs are
// reached by running them, and read by their output, their records and the throttle table's log (README: The surfaces).
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lines, nodeFile, vitestFile } from '../1122/helpers.mjs';

export { grantsIn, movingLine, npmCalls, readyFar, showLog, SLOTS, STALL, stillLine, tableLog, within } from '../3334/helpers.mjs';

// cargo, wrapped on both machines: each call is noted with the HOME it ran under (the machine), its DEEP_THROTTLE (the
// grant it ran under), its arguments, and for `cargo test` the pid and elapsed time of each throttle.mjs process above
// it, so a test can tell how long the grant's own request had waited. `cargo test … -- --list` also writes the
// marker `cargo-list-ran`. Then the #1122 stand-in runs, kept as `cargo-1122`.
const CARGO = `#!/bin/sh
above=
if [ "$1" = test ]; then
  p=$$
  while [ "\${p:-0}" -gt 1 ]; do
    case "$(ps -ww -o args= -p "$p" 2>/dev/null)" in *throttle.mjs*) above="$above $p=$(ps -o etime= -p "$p" 2>/dev/null | tr -d ' ')" ;; esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
fi
printf '%s\\t%s\\t%s\\t%s\\n' "$HOME" "\${DEEP_THROTTLE:-none}" "$*" "$above" >> "$T1122_LOG/cargo-3350"
case " $* " in *" -- --list "*) : > "$T1122_LOG/cargo-list-ran" ;; esac
exec "$(dirname "$0")/cargo-1122" "$@"
`;

/** Wraps the fixture's cargo stand-in on the session's machine and the far one (see CARGO). */
export function wrapCargo(box) {
  for (const bin of ['bin', 'far-bin']) {
    renameSync(join(box.dir, bin, 'cargo'), join(box.dir, bin, 'cargo-1122'));
    writeFileSync(join(box.dir, bin, 'cargo'), CARGO);
    chmodSync(join(box.dir, bin, 'cargo'), 0o755);
  }
}

/** ps's elapsed time, `[[dd-]hh:]mm:ss`, in seconds. */
const seconds = (etime) => {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  return Number(days) * 86_400 + rest.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
};

/**
 * The cargo calls a machine made, by its HOME: `{ grant, args, above }`, `above` mapping each throttle.mjs pid over a
 * `cargo test` call to the seconds it had been alive when cargo started.
 */
export function cargoCalls(box, home) {
  const file = join(box.log, 'cargo-3350');
  return (existsSync(file) ? lines({ stdout: readFileSync(file, 'utf8') }) : []).map((line) => line.split('\t')).filter(([at]) => at === home).map(([, grant, args, above = '']) => ({
    grant, args, above: Object.fromEntries(above.trim().split(/\s+/).filter(Boolean).map((pair) => pair.split('=')).map(([pid, etime]) => [Number(pid), seconds(etime)])),
  }));
}
/** The lane's whole cargo test command, and its listing, among a machine's cargo calls. */
export const cargoTest = (calls) => calls.find(({ args }) => args.startsWith('test ') && !/ -- --list$/.test(args));
export const cargoListing = (calls) => calls.find(({ args }) => args.startsWith('test ') && / -- --list$/.test(args));

/**
 * A vitest test of the lane, run first among its commands (the unit lane's parallel vitest block), that waits at a
 * gate: it writes `<log>/gate-3350-reached`, then waits up to 8 minutes for `<log>/gate-3350-open`. So a test sets the
 * far machine's queue up once the far end's install and build are done and before the lane's cargo test asks.
 */
export const GATE = {
  'tests/gate-3350.test.ts': vitestFile(`import { writeFileSync as touch3350 } from 'node:fs';
test('the lane waits at its gate', async () => {
  touch3350(\`\${process.env.T1122_LOG}/gate-3350-reached\`, '');
  const until = Date.now() + 480_000;
  while (!existsSync(\`\${process.env.T1122_LOG}/gate-3350-open\`) && Date.now() < until) await new Promise((done) => setTimeout(done, 100));
  expect(existsSync(\`\${process.env.T1122_LOG}/gate-3350-open\`)).toBe(true);
}, 600_000);`),
};
/** Resolves true once the lane's tests reached the gate, false after `minutes`. */
export async function reached(box, minutes) {
  const until = Date.now() + minutes * 60_000;
  while (!existsSync(join(box.log, 'gate-3350-reached'))) {
    if (Date.now() > until) return false;
    await new Promise((done) => setTimeout(done, 100));
  }
  return true;
}
export const open = (box) => writeFileSync(join(box.log, 'gate-3350-open'), '');

/**
 * A node --test file and a vitest file of the lane that note the grant they ran under, `<runner>\t$DEEP_THROTTLE`, in
 * `<HOME>/.grants-3350`, and that the lane's tests ran (`ran1122`).
 */
export const NOTED = {
  'tests/noted-3350.test.mjs': nodeFile("import { appendFileSync as grant3350 } from 'node:fs';\ntest('a node test of the lane notes its grant', () => { grant3350(`${process.env.HOME}/.grants-3350`, `node\\t${process.env.DEEP_THROTTLE ?? 'none'}\\n`); ran1122('noted'); assert.equal(1, 1); });"),
  'tests/noted-3350.test.ts': vitestFile("import { appendFileSync as grant3350 } from 'node:fs';\ntest('a vitest test of the lane notes its grant', () => { grant3350(`${process.env.HOME}/.grants-3350`, `vitest\\t${process.env.DEEP_THROTTLE ?? 'none'}\\n`); expect(1).toBe(1); });"),
};
/** The grants the noted tests ran under in a HOME: `{ runner, grant }`. */
export function notedGrants(home) {
  const file = join(home, '.grants-3350');
  return existsSync(file) ? lines({ stdout: readFileSync(file, 'utf8') }).map((line) => {
    const [runner, grant] = line.split('\t');
    return { runner, grant };
  }) : [];
}
