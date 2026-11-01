#!/usr/bin/env node
// Generates the extension guide (docs/extension-guide.md) from the published extension API
// (packages/contracts/extension-api.json) and its slot declarations (packages/contracts/hub-slots.json), the first-plug-in
// tier first (#351), and stamps the envelope digest of its two worked examples. `--check` is the guide's drift test, as
// skill.mjs's is the skill's: one entry per published method and per slot, none for anything the contract doesn't
// publish, each as the contract has it now. One `PASS guide` line, or one `FAIL guide: <name>: <reason>` line per
// finding; exit 1 on a finding. `--api <file>` and `--table <file>` point it at other copies of the contract.
//   node scripts/guide.mjs [--check [--api <extension-api.json>] [--table <hub-slots.json>]]
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const GUIDE = new URL('docs/extension-guide.md', ROOT);
const EXAMPLES = ['typescript', 'json-rpc'];

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) { console.log(`BLOCKED guide: ${flag} takes a file\n  Fix: node scripts/guide.mjs --check [--api <extension-api.json>] [--table <hub-slots.json>]`); process.exit(2); }
  return value;
};
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The first-plug-in tier, in the order a plug-in reaches for them (design: A first plug-in). */
const TIER = ['deep.on', 'deep.registerView', 'deep.registerSource', 'deep.store', 'deep.schedule', 'deep.registerAction', 'deep.secret',
  'deep.notices.send', 'deep.send', 'deep.asks.create', 'deep.provide', 'deep.use', 'deep.readNow'];

/** What each method is for, in the design's words; the contract gives everything else in an entry. */
const DOCS = {
  'deep.on': 'Handles an event: session.start, tool.before, tool.after, prompt.submit, agent.stop, pr.opened, merged, released or schedule. A handler adds context for the agent or denies with a reason; outside DeepBuild\'s signed release, both only fill templates the manifest declares, with typed values.',
  'deep.registerCheck': 'A check kind: its runner gets a spec and the checkout and returns the run\'s outcome, the tests it ran, each failure from the tool\'s own report and the evidence. The verdict is the core\'s, never the runner\'s.',
  'deep.registerResolver': 'Answers an ask with an option and the decision that covers it. The core applies the answer only when that decision is active and of the ask\'s kind and scope; otherwise the ask reaches you.',
  'deep.registerSource': 'A source of readings, each with its unit, source and as-of time: polled from a host with a secret, a quota and a timeout, a stream read from a cursor, or an MCP tool counted as read.',
  'deep.registerEnvironment': 'An environment a check runs against: up(spec, lease, checkout) starts it and returns a handle, down(handle) stops it.',
  'deep.lease': 'Leases a resource of a declared lease.kind@1 kind, the core\'s or one a manifest declares, exclusive or shared, held by the package itself: the grant, or the refusal naming the holder.',
  'deep.registerView': 'A JavaScript panel in the app, in the sidebar, the home screen, a tab or the line, under an empty policy plus DeepBuild\'s modules.',
  'deep.readNow': 'Reads every source a view binds again now, each through its own quota.',
  'deep.registerIndex': 'An index over the wiki: upsert claims, search with hits that name their sources, drop a source and rebuild from pages. The hub re-attaches each hit\'s provenance from the claim records, never from the index.',
  'deep.registerAdapter': 'An agent adapter: it maps the agent\'s hooks, delivers answers by the routes its caps allow, and names what it can\'t do rather than doing nothing.',
  'deep.registerRoute': 'An HTTP route served on 127.0.0.1, which reaches the package only once you turn it on.',
  'deep.record.append': 'Appends one of the package\'s own event kinds to the record.',
  'deep.record.query': 'Reads the record: the core\'s event kinds and the package\'s own, only those its grant names.',
  'deep.evidence.put': 'Stores a file as evidence and returns its SHA-256.',
  'deep.asks.create': 'Raises an ask: a question only you can answer, with its options, its deadline and its default.',
  'deep.config.get': 'Reads one of the package\'s settings.',
  'deep.notices.send': 'Sends a notice you asked for, citing fresh readings, once per key.',
  'deep.store': 'The plug-in\'s own data, kept in the record under a kind and a schema that only moves forward.',
  'deep.store.put': 'Writes one item of the plug-in\'s own store under its key, checked against the store\'s schema and tied to the action call that wrote it.',
  'deep.store.get': 'Reads the latest item of the plug-in\'s own store under a key, or nothing when there is none.',
  'deep.store.list': 'Reads the latest item under every key of the plug-in\'s own store.',
  'deep.schedule': 'Runs a job on a cadence: never overlapping, with a deadline per run and one catch-up run after sleep.',
  'deep.secret': 'A handle to a secret: the hub adds its value to the request, and the plug-in never sees it.',
  'deep.send': 'Anything that leaves your machine for a person: an ask, or a standing rule.',
  'deep.provide': 'An output other pieces may use, by its interface name@major: readings, actions, notice kinds, views or checks.',
  'deep.use': 'An output interface another piece provides, resolved by type to an installed provider, the one `from` names first; typed and pinned to a version.',
  'deep.read': 'Reads an output interface the package uses, through the provider the hub wired the use to: its value, or missing when none provides it.',
  'deep.fetch': 'An outside call the hub makes for the package, only to a host its grant names and within that host\'s quota.',
  'deep.terminal.open': 'Opens a terminal the hub hosts for the package under run-as-you: its program, folder, size and title; its input comes only from the panel you focused.',
  'deep.terminal.list': 'The package\'s own hosted terminals, each with its run and process.',
  'deep.terminal.read': 'Reads a hosted terminal\'s output from an offset, in pages.',
  'deep.canvas.read': 'For a check runner: a canvas revision\'s evaluated values by stable ID at the times it names, with their content keys and a coverage block, read only and only for the documents its grant names. A pass built on a read holds only with those keys as its evidence.',
  'deep.registerAction': 'What panels, your words and agents\' MCP tools can do to the plug-in\'s data. It declares read, change or send, and a change or send returns its report.',
};

const typeOf = (schema) => {
  if (schema.enum) return schema.enum.map((v) => `\`${v}\``).join(' · ');
  if (schema.pattern) return `${schema.type}, \`${schema.pattern}\``;
  return schema.type ?? 'any';
};
/** One method's entry: its heading, its release and stability, what it is for, and its parameters. */
function method(entry) {
  const params = Object.entries(entry.params?.properties ?? {});
  const required = new Set(entry.params?.required ?? []);
  return [
    `### \`${entry.method}\``,
    '',
    `${entry.since === 'R1' ? 'In R1' : `Arrives in ${entry.since}`} · ${entry.stability} · \`${entry.digest}\`${entry.variants ? ` · variants: ${entry.variants.map((v) => `\`${v}\``).join(', ')}` : ''}`,
    '',
    DOCS[entry.method] ?? '',
    ...(params.length ? ['', '| Parameter | Type | Required |', '|---|---|---|', ...params.map(([name, schema]) => `| \`${name}\` | ${typeOf(schema)} | ${required.has(name) ? 'yes' : 'no'} |`)] : []),
  ].join('\n');
}
const slotName = (row) => `slot ${row.method}${row.variant ? `, ${row.variant}` : ''}`;
const slotRow = (row) => `| \`${row.method}\` | ${row.variant ? `\`${row.variant}\`` : '-'} | \`${row.interface}\` | ${row.fills} | ${row.kit ? `\`${row.kit}\`` : 'none'} | ${row.planted.map((p) => `\`${p}\``).join(', ') || 'none'} | ${row.since} |`;

/** The guide: its text, and each entry by name (a method, or `slot` and its method and variant) with its text. */
function render(api, table) {
  const tier = TIER.map((name) => api.find((e) => e.method === name)).filter(Boolean);
  const rest = api.filter((e) => !TIER.includes(e.method));
  const entries = new Map([...tier, ...rest].map((e) => [e.method, method(e)]));
  for (const row of table) entries.set(slotName(row), slotRow(row));
  const text = [
    '# The extension guide',
    '',
    '<!-- Generated by `node scripts/guide.mjs` from packages/contracts/extension-api.json and packages/contracts/hub-slots.json; edit those, or the script\'s text, never this file. The lint lane\'s `node scripts/guide.mjs --check` fails when it drifts from them. -->',
    '',
    'A package is a folder: `deepbuild.json`, its manifest in the one package envelope (an `owner/name` ID, a version, the digest of its files and, when signed, its publisher\'s key and signature), and its code: `index.ts` for TypeScript, or an executable `main` that speaks JSON-RPC 2.0 on stdio in any language. Every package outside DeepBuild\'s signed release runs sandboxed, out of process, whoever wrote it. Each method below is marked with the release it arrives in; a preview method can still change before a shipped piece of its release calls it.',
    '',
    'The installer refuses a package whose digest isn\'t its files\', whose signature doesn\'t verify, or whose key isn\'t the one trusted for it; one that replaces a piece of the trusted ring (`app-shell`, `canvas-core`, `supervisor`, `installer`) or the done gate; one that conflicts with an installed package (`conflicts`); one that registers a check kind an installed package holds without declaring it `replaces` it; and one that runs on a kernel contract version (`kernel`) the kernel doesn\'t publish.',
    '',
    '## Two worked examples',
    '',
    'The same check twice, `ext.<plugin>.relative`: it passes when every input a check names is a path inside the checkout, and fails naming each one that isn\'t. Each folder\'s `example.json` lists the runs it answers.',
    '',
    '- [`extension-guide/typescript`](extension-guide/typescript/): `index.ts`, calling `deep.registerCheck` in-process style through the `deep` object the host hands it.',
    '- [`extension-guide/json-rpc`](extension-guide/json-rpc/): `main`, a Python program that answers the host\'s `load` by calling `deep.registerCheck` over JSON-RPC, then answers each `run`.',
    '',
    'To build one, copy the folder, write `packageDigest` of it into `deepbuild.json`\'s `digest`, and point a `main`\'s `#!/usr/bin/env` line at its interpreter. Then install it, run its conformance, load it, and run its check.',
    '',
    '## A first plug-in',
    '',
    `Most plug-ins need few methods. Start with these ${tier.length}, in this order.`,
    '',
    tier.map((e) => entries.get(e.method)).join('\n\n'),
    '',
    '## The rest of the API',
    '',
    rest.map((e) => entries.get(e.method)).join('\n\n'),
    '',
    '## Slots',
    '',
    'Each kind of thing a package registers fills a slot: its interface with a frozen digest, how many pieces may fill it, its kit in the conformance package and the planted wrong fills that kit must fail. A second fill of a slot that takes one is refused at install unless its manifest says it replaces the first.',
    '',
    '| Method | Variant | Interface | Fills | Kit | Planted wrong fills | Since |',
    '|---|---|---|---|---|---|---|',
    ...table.map(slotRow),
    '',
  ].join('\n');
  return { text, entries };
}
/** The entries a guide's text holds: each method by its heading, each slot by its table row's method and variant. */
function parse(text) {
  const entries = new Map();
  const sections = text.split(/^(?=### `)/m).slice(1);
  for (const s of sections) entries.set(/^### `([^`]+)`/.exec(s)[1], s.split(/\n\n## /)[0].trimEnd());
  for (const line of text.split('\n')) {
    const row = /^\| `(deep\.[^`]+)` \| (?:`([^`]+)`|-) \|/.exec(line);
    if (row) entries.set(`slot ${row[1]}${row[2] ? `, ${row[2]}` : ''}`, line);
  }
  return entries;
}

const api = arg('--api') ? read(arg('--api')) : read(new URL('packages/contracts/extension-api.json', ROOT));
const table = arg('--table') ? read(arg('--table')) : read(new URL('packages/contracts/hub-slots.json', ROOT));
const want = render(api, table);
if (process.argv.includes('--check')) {
  const have = parse(readFileSync(GUIDE, 'utf8'));
  const fails = [];
  for (const [name, text] of want.entries) {
    if (!have.has(name)) fails.push(`${name}: the contract publishes it, and the guide has no entry for it`);
    else if (have.get(name) !== text) fails.push(`${name}: its guide entry differs from what the contract publishes`);
  }
  for (const name of have.keys()) if (!want.entries.has(name)) fails.push(`${name}: the guide has an entry for it, and the contract doesn't publish it`);
  for (const name of api.map((e) => e.method).filter((m) => !DOCS[m])) fails.push(`${name}: scripts/guide.mjs says nothing of what it is for`);
  if (!fails.length && readFileSync(GUIDE, 'utf8') !== want.text) fails.push('docs/extension-guide.md: its text differs from what scripts/guide.mjs writes');
  for (const f of fails) console.log(`FAIL guide: ${f}\n  Fix: run node scripts/guide.mjs and commit docs/extension-guide.md`);
  if (!fails.length) console.log(`PASS guide: docs/extension-guide.md has one entry per published method (${api.length}) and slot (${table.length}), each as the contract has it`);
  process.exitCode = fails.length ? 1 : 0;
} else {
  const missing = api.map((e) => e.method).filter((m) => !DOCS[m]);
  if (missing.length) { console.log(`FAIL guide: ${missing.join(', ')}: scripts/guide.mjs says nothing of what each is for`); process.exit(1); }
  writeFileSync(GUIDE, want.text);
  // Each example's envelope digest, as its build would write it.
  const { packageDigest } = await import('../packages/extension-host/dist/index.js');
  for (const name of EXAMPLES) {
    const folder = new URL(`docs/extension-guide/${name}/`, ROOT);
    const manifest = read(new URL('deepbuild.json', folder));
    writeFileSync(new URL('deepbuild.json', folder), `${JSON.stringify({ ...manifest, digest: packageDigest(folder.pathname) }, null, 2)}\n`);
  }
  console.log(`wrote docs/extension-guide.md: ${api.length} methods, ${table.length} slots`);
}
