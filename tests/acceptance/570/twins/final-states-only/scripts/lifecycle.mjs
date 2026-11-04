// A planted wrong program for #570's acceptance tests (twins/README.md): a lifecycle log checker that reads only
// final states. Wrong: for each object it looks at its last event alone and passes the log when the state that
// event names is one of its table's states, so a log that moved a defaulted ask to answered passes.
//   node scripts/lifecycle.mjs replay [<log.jsonl> ...]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const schemas = join(root, 'packages/contracts/schemas');
const tables = (existsSync(schemas) ? readdirSync(schemas) : []).filter((f) => /\.machine@\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(schemas, f), 'utf8')));
const [command, ...files] = process.argv.slice(2);
if (command !== 'replay') {
  console.log(`FAIL lifecycle ${command ?? 'world'}: this checker replays logs only`);
  process.exit(1);
}

const lines = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

/** Each object's last event, and the state its table says that event leads to. */
function check(label, events) {
  const last = new Map();
  for (const e of [...events].sort((a, b) => (a.log_pos ?? 0) - (b.log_pos ?? 0))) {
    const object = e.subject ?? `${String(e.kind).split('.')[0]}:${e.id}`;
    last.set(object, e);
  }
  let moves = 0;
  for (const [object, e] of last) {
    const table = tables.find((t) => t.moves.some((m) => m.event === e.kind));
    if (!table) continue;
    moves++;
    const to = table.moves.find((m) => m.event === e.kind).to;
    if (!table.states.includes(to)) {
      console.log(`FAIL lifecycle replay: ${label}: ${object} ends in ${to}, no state of ${table.id}`);
      return false;
    }
  }
  console.log(`PASS lifecycle replay: ${label}: ${moves} moves`);
  return true;
}

let ok = true;
if (files.length) {
  for (const file of files) ok = check(file, lines(file)) && ok;
} else {
  const corpus = join(root, 'adapters/corpus');
  const dirs = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
  for (const agent of dirs(corpus)) for (const version of dirs(join(corpus, agent))) for (const session of dirs(join(corpus, agent, version))) {
    const file = join(corpus, agent, version, session, 'events.jsonl');
    if (!existsSync(file)) continue;
    const events = lines(file).flatMap((c) => (Array.isArray(c.expect) ? c.expect : []));
    ok = check(`corpus ${agent}/${version}/${session}`, events) && ok;
  }
}
process.exit(ok ? 0 : 1);
