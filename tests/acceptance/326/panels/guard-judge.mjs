// #326 AC4, the guard half: what the record-reader guard must do, as two judges both test files
// run. `guard.test.mjs` runs them on the app's guard, scripts/record-reader-guard.mjs, and on the
// repo's scripts/lanes.mjs; `guard.wrong.test.mjs` runs them on the wrong guards and wrong lane
// tables under wrong/, to show each one fails.
//
// The guard is run as `node <guard> --root <dir>` on a copy of the app's source, crates/deep-app/src,
// at <dir>/crates/deep-app/src: once as it is, and once per planted module. A planted module is a
// real module of the crate (declared in the copy's lib.rs) that subscribes to the stream, or calls
// one of the App API's reads, for its own view. Each must fail the guard: exit 1, with a line
// starting `FAIL ` that names the planted file by its path under the root. The copy as it is must
// pass: exit 0 and no line starting `FAIL`. Nothing here writes to the repo's own files.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const APP_SOURCE = 'crates/deep-app/src';
/** The guard's path, as the lane names it and these tests run it. */
export const GUARD = 'scripts/record-reader-guard.mjs';

/**
 * The stream and the reads, by the hub method names the base's record reader
 * (crates/deep-app/src/record.rs) and the hub (packages/hub/src/server.ts, its App API rows) use:
 * `stream.subscribe`, the refetch `events.read`, and the App API's reads.
 */
export const METHODS = ['stream.subscribe', 'events.read', 'inbox.read', 'sessions.read', 'changes.read', 'evidence.read', 'numbers.read'];

/** A view that reads the record for itself, the method named in the call. */
const inline = (method) => `//! A view that reads the record for itself (planted by #326's acceptance tests).
use serde_json::{json, Value};

use crate::hub::HubClient;

pub fn refresh_my_view(client: &mut HubClient) -> Value {
    client.call("${method}", json!({ "after": 0 })).unwrap_or_default()
}
`;

/** The same, the method held in a constant first, as a module with several calls might. */
const constant = (method) => `//! A view that reads the record for itself (planted by #326's acceptance tests).
use serde_json::{json, Value};

use crate::hub::HubClient;

const MY_READ: &str = "${method}";

pub fn refresh_my_view(client: &mut HubClient) -> Value {
    client.call(MY_READ, json!({ "after": 0 })).unwrap_or_default()
}
`;

/**
 * Each planted module: its file under crates/deep-app/src, the declaration that makes it a module of
 * the crate (appended to the copy's lib.rs), its body and what it is.
 */
export const PLANTED = [
  { path: 'planted_view.rs', mod: 'pub mod planted_view;', body: inline('stream.subscribe'), case: 'a module that subscribes to the stream' },
  ...METHODS.filter((method) => method !== 'stream.subscribe').map((method) => {
    const name = `planted_${method.replace('.', '_')}`;
    return { path: `${name}.rs`, mod: `pub mod ${name};`, body: inline(method), case: `a module that calls ${method}` };
  }),
  { path: 'planted_const.rs', mod: 'pub mod planted_const;', body: constant('events.read'), case: 'a module that calls events.read through a constant' },
  { path: 'planted_views/nested_view.rs', mod: 'pub mod planted_views {\n    pub mod nested_view;\n}', body: inline('stream.subscribe'), case: 'a nested module that subscribes to the stream' },
  { path: 'record_mirror.rs', mod: 'pub mod record_mirror;', body: inline('stream.subscribe'), case: 'a module named like the reader that subscribes to the stream' },
];

function run(guard, root) {
  const result = spawnSync(process.execPath, [guard, '--root', root], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error };
}

/** A copy of the app's source under a temporary root, with `planted` written and declared in it. */
function tree(planted) {
  const root = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'da326g-guard-'));
  const src = join(root, APP_SOURCE);
  cpSync(join(repoRoot, APP_SOURCE), src, { recursive: true });
  if (planted) {
    const file = join(src, planted.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, planted.body);
    appendFileSync(join(src, 'lib.rs'), `\n// Planted by #326's acceptance tests.\n${planted.mod}\n`);
  }
  return root;
}

const failLines = (output) => output.split('\n').filter((line) => line.startsWith('FAIL'));

/** The ways `guard` falls short, one line each; empty when it does all of the above. */
export function judgeGuard(guard) {
  if (!existsSync(guard)) return [`no guard at ${guard}`];
  const failures = [];
  const clean = tree(null);
  try {
    const { status, output, error } = run(guard, clean);
    if (error) return [`the guard couldn't run: ${error.message}`];
    if (status !== 0) failures.push(`the app's own source fails the guard (exit ${status}): ${output.trim()}`);
    else if (failLines(output).length) failures.push(`the app's own source prints a FAIL line: ${output.trim()}`);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
  for (const planted of PLANTED) {
    const root = tree(planted);
    try {
      const { status, output } = run(guard, root);
      const path = `${APP_SOURCE}/${planted.path}`;
      if (status === 0) failures.push(`${planted.case} (${path}) passes the guard`);
      else if (status !== 1) failures.push(`${planted.case} (${path}) ends the guard with exit ${status}, not 1: ${output.trim()}`);
      else if (!failLines(output).some((line) => line.includes(path))) failures.push(`${planted.case} fails the guard without a FAIL line naming ${path}: ${output.trim()}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return failures;
}

/** Whether a lane with `paths` runs for a change to a module under crates/deep-app/src, as lanes.mjs's `covers` reads paths. */
const runsForAppChange = (paths) => !paths
  || paths.some((path) => path.endsWith('/**') && `${APP_SOURCE}/planted_view.rs`.startsWith(path.slice(0, -2)));

/**
 * The ways the local preflight's lane table at `lanes` (a module exporting `checks`, as scripts/lanes.mjs
 * does) falls short of running the guard: a lane of `checks` that runs on every change, or at least on
 * every change to the app's source, has a command whose arguments name the guard, and that command, run
 * as runLanes runs it (from `root`), passes the app as it stands. `guard` is the path the command must
 * name; wrong/ passes its own, so its lane tables can be judged at the base.
 */
export async function judgeWiring(lanes, { guard = GUARD, root = repoRoot } = {}) {
  const { checks } = await import(pathToFileURL(lanes).href);
  if (!Array.isArray(checks)) return [`${lanes} exports no checks`];
  const named = checks.flatMap((lane) => (lane.commands ?? [])
    .filter((argv) => argv.some((arg) => String(arg).replaceAll('\\', '/').endsWith(guard)))
    .map((argv) => ({ lane, argv })));
  if (!named.length) return [`no lane of the local preflight's checks runs ${guard}`];
  const every = named.filter(({ lane }) => runsForAppChange(lane.paths));
  if (!every.length) return [`the lanes that run ${guard} (${named.map(({ lane }) => lane.name).join(', ')}) skip a change to ${APP_SOURCE}: paths ${JSON.stringify(named[0].lane.paths)}`];
  const failures = [];
  for (const { lane, argv: [command, ...args] } of every) {
    const target = args.indexOf('--root');
    if (target >= 0 && resolve(root, args[target + 1] ?? '') !== resolve(root)) {
      failures.push(`the ${lane.name} lane points the guard at ${args[target + 1]}, not the checkout`);
      continue;
    }
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.status !== 0) failures.push(`the ${lane.name} lane's guard command fails the app as it stands (exit ${result.status ?? result.error?.message}): ${output}`);
  }
  return failures;
}
