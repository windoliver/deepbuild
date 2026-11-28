// Who a line in a chat talks to (#1813): in text DeepBuild sends to an agent, "you" is the agent and the person is "the
// person". Reads every such string: each string literal or template in the hub's sources and deep-hook's that starts
// `DeepBuild `, the form a hub or hook line into a chat takes, and each default rule's reason and next step, which
// deep-hook puts in its denials. A line that says "your answer", "you said", "once you say", "you typed", "your
// authority" or "your words" speaks to the person through the agent, and fails. Prints one `FAIL agent lines:
// <path>:<line>: <string>` line per finding, one `PINNED` line per line a blind suite holds, then `PASS agent lines`;
// exit 1 on a finding. `--root <dir>` reads another checkout's code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** The words that make "you" the person in a line the agent reads. */
const PERSON = /\byour answers?\b|\byou said\b|\bonce you say\b|\byou typed\b|\byour (?:authority|words)\b/i;
/** Lines a blind suite pins: each moves only through that suite's blind redraft (AGENTS.md, Proof), and is printed until then. */
const PINNED = [
  { path: 'packages/hub/src/server.ts', text: 'needs your authority in time', suite: "tests/acceptance/1509's GATE_LATE" },
  { path: 'packages/hub/src/server.ts', text: 'needs your authority failed', suite: "tests/acceptance/1509's GATE_LATE" },
];

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED agent lines: --root takes a folder\n  Fix: node scripts/agent-lines-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const files = (dir, ext) => !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) && !name.endsWith('.d.ts') ? [path] : [];
});

/** Each line a source sends: its text, ${…} for each value, and the line it starts on. */
const lines = [];
for (const path of files(join(root, 'packages/hub/src'), /\.ts$/)) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    let text;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s) => `\${…}${s.literal.text}`).join('');
    if (text?.startsWith('DeepBuild ')) lines.push({ path, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
    ts.forEachChild(node, visit);
  };
  visit(source);
}
for (const path of files(join(root, 'crates/deep-hook/src'), /\.rs$/)) {
  readFileSync(path, 'utf8').split('\n').forEach((row, i) => {
    for (const m of row.matchAll(/"(DeepBuild (?:[^"\\]|\\.)*)"/g)) lines.push({ path, line: i + 1, text: m[1] });
  });
}
const rules = join(root, 'crates/deep-hook/default-rules.json');
if (existsSync(rules)) {
  const raw = readFileSync(rules, 'utf8');
  const rows = raw.split('\n');
  for (const [name, rule] of Object.entries(JSON.parse(raw).entries ?? {})) {
    for (const field of ['reason', 'next_step']) {
      if (typeof rule?.[field] !== 'string') continue;
      const line = rows.findIndex((r) => r.includes(`"${name}"`)) + 1;
      lines.push({ path: rules, line, text: `${name}.${field}: ${rule[field]}` });
    }
  }
}

const pinned = (l) => PINNED.find((p) => relative(root, l.path) === p.path && l.text.includes(p.text));
for (const l of lines.filter((l) => PERSON.test(l.text) && pinned(l))) console.log(`PINNED agent lines: ${relative(root, l.path)}:${l.line}: "${l.text}" moves only through the blind redraft of ${pinned(l).suite}`);
const found = lines.filter((l) => PERSON.test(l.text) && !pinned(l));
for (const f of found) console.log(`FAIL agent lines: ${relative(root, f.path)}:${f.line}: "${f.text}" says "${PERSON.exec(f.text)[0]}" of the person`);
if (found.length) {
  console.log(`  Fix: in a line an agent reads, "you" is the agent: name the person as "the person", and where it waits on an answer, end with the ask's address ask/<id>.`);
  process.exit(1);
}
console.log(`PASS agent lines: ${lines.length} strings read`);
