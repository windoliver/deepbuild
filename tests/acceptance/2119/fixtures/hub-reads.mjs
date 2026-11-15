// #2119's third criterion (README.md): what the hub reads of Codex, through its own built modules, in a process whose
// environment holds no CODEX_HOME, as the hub's login service holds none. Run as
// `node hub-reads.mjs <checkout> <root> <project>`, with HOME the home setup ran in.
//
// It prints one JSON line:
// - `relations` and `readings`: what the hub's health reports for Codex (packages/hub/src/hub-readings.ts), the timing
//   relations of codexRelations(root), each with its name and text, and the readings of modified(root);
// - `trusted`: whether the hub reads <project> as trusted. That is StopJudging's projectTrusted, the one caller of the
//   Codex trust read, given only what it reads: the hub's root, and the core's own trust decisions, of which this home
//   holds none.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, root, project] = process.argv.slice(2);
const built = (file) => import(pathToFileURL(join(checkout, 'packages/hub/dist', file)).href);
const { codexRelations, modified } = await built('codex-settings.js');
const { StopJudging } = await built('stop-judging.js');
const { rootOf } = await built('paths.js');

const judging = new StopJudging({ services: { root: rootOf(root), trust: { trusted: async () => false } } });
console.log(JSON.stringify({
  relations: codexRelations(root).map((r) => ({ name: r.name, holds: r.holds, text: r.text })),
  readings: modified(root),
  trusted: await judging.projectTrusted(project),
}));
