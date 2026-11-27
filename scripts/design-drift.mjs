// The design against main (#1876), read by the design links lane: nine places where docs/technical-design.md states
// what a file on main holds, each found by what it is and compared with that file, so a change that leaves the design
// behind fails the lane. The game route is read in the canvas reference too. A finding names its line of the design
// and what main has; a place or a file that can't be read is a finding too, never a pass.
import { readdirSync, readFileSync } from 'node:fs';

const DESIGN = 'docs/technical-design.md';
const CANVAS = 'docs/canvas-primitives.md';
const CLI = 'packages/cli/src/main.ts';
const API = 'packages/contracts/extension-api.json';
const SLOTS = 'packages/contracts/hub-slots.json';
const SCHEMAS = 'packages/contracts/schemas';
const CODEX = 'adapters/codex.facts.json';
const PROOF = 'packages/proof/src/types.ts';
const RECORD = 'packages/record/src/index.ts';
// How the design names each runner the proof plug-in's spec takes.
const RUNNERS = { lean4: '`lake comparator`', kani: 'Kani' };
// The two items that say when a blocked issue is ready.
const READY = ['- In R6: playbooks (', '- **Work runs.**'];

const read = (file) => readFileSync(file, 'utf8');
const need = (value, missing) => {
  if (value == null) throw Error(missing);
  return value;
};
const spans = (text) => [...text.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim());
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A dotted name on its own, not as the start of a longer one: `deep.store`, not `deep.store.put`.
const names = (text, name) => new RegExp(`(?<![\\w.])${escape(name)}(?!\\w|\\.\\w)`).test(text);
const sentences = (line) => line.split(/(?<=[.!?]["”)]?)\s+(?=[A-Z|])/);
const fence = (line) => line.startsWith('```');
const table = (line) => line.startsWith('|');

/** The findings, one line each; none when the design states what main holds. */
export function drift() {
  const found = [];
  const lines = read(DESIGN).split(/\r?\n/).map((line, i) => ({ number: i + 1, line }));
  const at = ({ number }) => `${DESIGN}:${number}`;
  const fail = (where, problem) => found.push(`${where} ${problem}`);
  // The first line that starts with `start`; the first line after `from` that `is`; the lines after `from` up to the first that `ends`.
  const place = (start) => need(lines.find(({ line }) => line.startsWith(start)), `no line of ${DESIGN} starts \`${start}\``);
  const next = (from, is, what) => need(lines.slice(from.number).find(({ line }) => is(line)), `${at(from)} is followed by no ${what}`);
  const until = (from, ends) => {
    const rest = lines.slice(from.number);
    const end = rest.findIndex(({ line }) => ends(line));
    return end === -1 ? rest : rest.slice(0, end);
  };
  const fenced = (heading) => until(next(place(heading), fence, 'fenced block'), fence);

  const checks = {
    // Every command `deep --help` lists is in the CLI row, as the row writes them: `deep a · b up\|down · c`. And the
    // row doesn't bring back `claim`, which no command builds.
    'the CLI row': () => {
      const row = place('| CLI |');
      const usage = need(read(CLI).match(/^const usage = \[\n([\s\S]*?)^\];/m)?.[1], `${CLI} has no usage list`);
      const listed = new Set([...usage.matchAll(/^\s*'deep ([a-z-]+(?: \| [a-z-]+)*)/gm)].flatMap((m) => m[1].split(' | ')));
      const named = new Set(spans(row.line).filter((code) => code.startsWith('deep ')).flatMap((code) => code.slice(5).split('·').flatMap((part) => part.trim().split(/\s/)[0].split(/\\?\|/))));
      for (const command of listed) if (!named.has(command)) fail(at(row), `the CLI row doesn't name \`deep ${command}\`, which \`deep --help\` lists (${CLI})`);
      if (named.has('claim')) fail(at(row), 'the CLI row names `deep claim`, which no command builds: agents claim through `deep_claim`');
    },
    'the Extension API block': () => {
      const head = place('### Extension API');
      const block = fenced('### Extension API').map(({ line }) => line).join('\n');
      for (const { method } of JSON.parse(read(API))) if (!names(block, method)) fail(at(head), `the Extension API block doesn't name \`${method}\`, which ${API} publishes`);
    },
    // A row names its slot in its first cell: the method in code, and a variant in words after it.
    'the Hub slots table': () => {
      const head = place('**Hub slots.**');
      const cells = until(next(head, table, 'table'), (line) => !table(line)).map(({ line }) => line.split('|')[1]);
      for (const { method, variant } of JSON.parse(read(SLOTS))) {
        const row = cells.some((cell) => spans(cell).includes(method) && (!variant || new RegExp(`\\b${escape(variant)}\\b`, 'i').test(cell.replace(/(`+).+?\1/g, ''))));
        if (!row) fail(at(head), `the Hub slots table has no row for \`${method}\`${variant ? `, ${variant}` : ''}, which ${SLOTS} has`);
      }
    },
    "DeepBuild's own jobs": () => {
      const item = place("- **DeepBuild's own jobs.**");
      const args = JSON.parse(read(CODEX)).launch.readOnlyJob.args;
      const flag = `-s ${need(args.includes('-s') ? args[args.indexOf('-s') + 1] : null, `readOnlyJob.args in ${CODEX} has no -s value`)}`;
      const said = spans(item.line).filter((code) => /^-s \S+$/.test(code));
      if (said.length !== 1 || said[0] !== flag) fail(at(item), `DeepBuild's own jobs says Codex starts with ${said.map((code) => `\`${code}\``).join(' and ') || 'no `-s` flag'}; readOnlyJob.args in ${CODEX} has \`${flag}\``);
    },
    'the Proof check kind': () => {
      const item = place('- **Proof.**');
      const runners = need(read(PROOF).match(/^export type ProofRunner = (.+);$/m)?.[1].match(/[\w-]+/g), `${PROOF} has no ProofRunner`);
      for (const runner of runners) if (!RUNNERS[runner] || !item.line.includes(RUNNERS[runner])) fail(at(item), `the Proof check kind doesn't name ${RUNNERS[runner] ?? 'a runner scripts/design-drift.mjs has no design name for'}, the \`${runner}\` runner the proof plug-in's spec takes (${PROOF})`);
    },
    // The list is the first parenthesis of the section's first paragraph; a table's object is its file's name.
    'the Lifecycles list': () => {
      const text = next(place('#### Lifecycles'), (line) => line.trim(), 'paragraph');
      const listed = need(text.line.match(/\(([^)]*)\)/)?.[1], `${at(text)} lists no objects in parentheses`).split(/,(?: and)? | and /).map((name) => name.trim().toLowerCase().replace(/[ -]/g, '_'));
      const tables = new Set(readdirSync(SCHEMAS).flatMap((file) => file.match(/^(.+)\.machine@\d+\.json$/)?.[1] ?? []));
      for (const object of new Set([...tables, ...listed])) if (tables.has(object) !== listed.includes(object)) fail(at(text), `the Lifecycles list ${tables.has(object) ? "doesn't name" : 'names'} ${object}, which has ${tables.has(object) ? 'a' : 'no'} ${object}.machine@*.json table in ${SCHEMAS}`);
    },
    'blockers closed before the gate': () => {
      for (const start of READY) {
        const item = place(start);
        if (!/baseline/.test(item.line) || !/closed before the gate/.test(item.line) || !/satisf(?:y|ies) a blocked-by link/.test(item.line)) fail(at(item), `\`${start}…\` doesn't say a blocker on the baseline list of issues closed before the gate satisfies a blocked-by link`);
      }
    },
    // A sentence that sends a complete game to an engine project names the game shell too, or calls the route optional.
    'the game route': () => {
      for (const doc of [DESIGN, CANVAS]) {
        for (const [i, line] of read(doc).split(/\r?\n/).entries()) {
          for (const sentence of sentences(line)) {
            if (/complete games?/i.test(sentence) && /engine project/i.test(sentence) && !/game shell|optional/i.test(sentence)) fail(`${doc}:${i + 1}`, `says a complete game takes the engine project route as its only route: "${sentence.length > 120 ? `${sentence.slice(0, 120)}…` : sentence}"`);
          }
        }
      }
      const row = place('| Bounded games on the canvas |');
      if (!/game shell/i.test(row.line)) fail(at(row), "the Decided row Bounded games on the canvas doesn't name the canvas game shell (#851)");
    },
    'the events table and the hook protocol': () => {
      const record = read(RECORD);
      const ddl = need(record.match(/CREATE TABLE IF NOT EXISTS events \(\n([\s\S]*?)\n\) STRICT;/)?.[1], `${RECORD} creates no events table`);
      const created = [...ddl.matchAll(/^\s*(\w+)\s/gm), ...record.matchAll(/ALTER TABLE events ADD COLUMN (\w+)/g)].map((m) => m[1]);
      const head = place('CREATE TABLE events (');
      const columns = until(head, (line) => line.startsWith(')')).map(({ line }) => line.match(/^\s*(\w+)\s/)?.[1]);
      for (const column of new Set(created)) if (!columns.includes(column)) fail(at(head), `the events table doesn't name the column \`${column}\`, which ${RECORD} creates`);
      const protocol = fenced('### Hook protocol');
      for (const [message, key] of [['ack', '"ack"'], ['reply', '"exit"']]) {
        const shown = need(protocol.find(({ line }) => line.includes(key)), `the hook protocol shows no ${message}`);
        const version = Math.max(...readdirSync(SCHEMAS).flatMap((file) => file.match(new RegExp(`^hook\\.${message}@(\\d+)\\.json$`))?.[1] ?? []));
        for (const field of JSON.parse(read(`${SCHEMAS}/hook.${message}@${version}.json`)).required) if (!shown.line.includes(`"${field}"`)) fail(at(shown), `the hook protocol's ${message} doesn't carry \`${field}\`, which hook.${message}@${version} requires`);
      }
    },
  };
  for (const [name, check] of Object.entries(checks)) {
    try {
      check();
    } catch (error) {
      fail(DESIGN, `${name} can't be compared with main: ${error.message}`);
    }
  }
  return found;
}
