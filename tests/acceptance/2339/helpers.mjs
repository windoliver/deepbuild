// Helpers for #2339's acceptance tests: the Principles section read from the design, a scratch copy of the files the
// design links lane reads, and one run of that lane through its own commands in scripts/lanes.mjs. GitHub's slug,
// heading text, link targets and link resolution are copied from scripts/doc-links.mjs, never imported; the lane itself
// is reached only through its entry in scripts/lanes.mjs (README: The surface).
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The base commit these tests were drafted on (origin/main, no implementation). */
export const BASE = '2eaaeb0e6';
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const DOCS = [DESIGN, CANVAS];
export const NEXT_HEADING = 'What version 0 builds, and what waits';
export const CONVENTIONS = 'Conventions every primitive uses';
const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';

export const read = (root, file) => readFileSync(join(root, file), 'utf8');
export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Markdown, as scripts/doc-links.mjs reads it (copied) ----

/** Lines outside fenced code: { index (0-based), line }. */
export function prose(text) {
  const out = [];
  let fence;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else out.push({ index, line });
  }
  return out;
}

const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

/** Headings outside fenced code: { index, level, text, id }, repeats numbered -1, -2, … as GitHub does. */
export function headings(text) {
  const seen = new Set();
  const out = [];
  for (const { index, line } of prose(text)) {
    const m = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!m) continue;
    const title = headingText(m[2]);
    const base = slug(title);
    let id = base;
    for (let n = 1; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    out.push({ index, level: m[1].length, text: title, id });
  }
  return out;
}

/** The link targets on a line outside code spans: markdown links' targets and bare blob links into this repo. */
export function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

/** The docs file and anchor a target in `from` links to, or null for a link that isn't into docs/*.md. */
export function resolve(target, from) {
  const [, path, anchor = ''] = target.match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  let file;
  if (path.startsWith(REPO)) file = path.slice(REPO.length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  else file = path ? posix.join(posix.dirname(from), path) : from;
  if (!/^docs\/[^/]+\.md$/.test(file)) return null;
  let id = anchor;
  try { id = decodeURIComponent(anchor); } catch { /* compared as written */ }
  return { file, id };
}

/** The links on a line of `from` that land in one of the design docs, with an anchor. */
export const designLinks = (line, from = DESIGN) => targets(line)
  .map((t) => ({ target: t, link: resolve(t, from) }))
  .filter(({ link }) => link && DOCS.includes(link.file) && link.id);

/**
 * A line's text as it reads rendered: links and images by their label, code spans by their content, tags and bold
 * markers dropped, white space collapsed.
 */
export const render = (s) => s
  .replace(/(`+)(.+?)\1/g, (_, tick, code) => code.trim())
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\*\*|__/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The sentences a line holds: its text with each link and code span read as one lowercase word, split where a `.`, `!`
 * or `?` (optionally closed by a quote or bracket) is followed by space and a capital letter or an opening quote.
 */
export function sentences(s) {
  const text = s.replace(/(`+)(.+?)\1/g, 'x').replace(/!?\[([^\]]*)\]\([^)]*\)/g, 'x').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.split(/(?<=[.!?]["”’)\]]?)\s+(?=["“‘]?[A-Z])/).filter((part) => part.trim());
}

// ---- The section ----

/**
 * The Principles section of a design text: the one heading outside fenced code whose text is "Principles" (any
 * level, any case). Its body runs to the next heading of its level or higher. Its lines are the body's top-level list
 * items (`-`, `*`, `+` or `1.`/`1)` at column 0-3), each one physical line; a body with no list items has its non-blank
 * prose lines instead (not headings, not lone anchors, not HTML comments). Its anchors are the heading's slug and each
 * <a id>/<a name> on the lines just above it, with only blank and anchor lines between. Returns null when there is none,
 * and throws when there is more than one.
 */
export function principles(text) {
  const all = headings(text);
  const found = all.filter((h) => /^principles$/i.test(h.text.trim()));
  if (found.length > 1) throw new Error(`${found.length} headings read "Principles", not one`);
  if (!found.length) return null;
  const [heading] = found;
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const end = all.find((h) => h.index > heading.index && h.level <= heading.level)?.index ?? lines.length;
  const inProse = new Set(prose(text).map(({ index }) => index));
  const body = [];
  for (let i = heading.index + 1; i < end; i++) if (inProse.has(i)) body.push({ index: i, raw: lines[i] });
  const item = /^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
  let items = body.filter(({ raw }) => item.test(raw)).map(({ index, raw }) => ({ index, raw, content: raw.match(item)[1] }));
  if (!items.length) {
    items = body.filter(({ raw }) => raw.trim() && !/^ {0,3}#/.test(raw) && !/^\s*<!--/.test(raw) && raw.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim())
      .map(({ index, raw }) => ({ index, raw, content: raw.trim() }));
  }
  const anchors = new Set([heading.id]);
  for (let i = heading.index - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    const ids = [...l.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    if (!ids.length || l.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim()) break;
    for (const id of ids) anchors.add(id);
  }
  const next = all.find((h) => h.text === NEXT_HEADING);
  return {
    heading,
    anchors,
    beforeNext: next ? heading.index < next.index && end <= next.index : false,
    nextIndex: next?.index,
    // Each line: its 1-based number in the doc, its ordinal in the section, the raw line and its content after the marker.
    lines: items.map((it, k) => ({ number: it.index + 1, ordinal: k + 1, raw: it.raw, content: it.content })),
  };
}

/** The four invariants as AGENTS.md lists them under "The four invariants": { number, text, line (1-based) }. */
export function invariants(agents) {
  const lines = agents.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s+The four invariants\s*$/.test(l));
  if (start < 0) throw new Error('AGENTS.md has no "The four invariants" heading');
  const out = [];
  for (let i = start + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]); i++) {
    const m = lines[i].match(/^(\d+)\.\s+(.*\S)\s*$/);
    if (m) out.push({ number: Number(m[1]), text: m[2], line: i + 1 });
  }
  return out;
}

// ---- Checks a line names ----

/** The lane names scripts/lanes.mjs exports, in `checks` and `releaseLanes`, read from `root`'s own copy. */
export function laneNames(root = CHECKOUT) {
  const program = `const m = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'lanes.mjs')).href)});
console.log(JSON.stringify({ checks: (m.checks ?? []).map((l) => l.name), release: (m.releaseLanes ?? []).map((l) => l.name) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`could not read scripts/lanes.mjs: ${r.stderr}`);
  const { checks, release } = JSON.parse(r.stdout.trim().split('\n').at(-1));
  return [...checks, ...release];
}

/**
 * The checks a line names (README: How a check is named): each `scripts/<file>` path anywhere on the line (code, link
 * target or text) that is a file in `root`; each code span or link label holding a file name that is in `root`'s
 * scripts/; and each lane name, from the list above, that a code span or link label holds whole (a trailing " lane"
 * allowed), or that the text gives as "<name> lane". Returns { existing, missing } of the names found.
 */
export function checksNamed(content, root, lanes) {
  const existing = new Set();
  const missing = new Set();
  for (const [, path] of content.matchAll(/(?<![\w-])((?:\.{1,2}\/)*scripts\/[\w.\/-]*\w)/g)) {
    const file = path.replace(/^(?:\.{1,2}\/)+/, '');
    (existsSync(join(root, file)) && statSync(join(root, file)).isFile() ? existing : missing).add(file);
  }
  const spans = [...content.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim());
  const labels = [...content.matchAll(/\[([^\]]*)\]\(/g)].map((m) => render(m[1]));
  for (const piece of [...spans, ...labels]) {
    const name = piece.replace(/\s+lane$/i, '').trim();
    if (/^[\w.-]+\.(?:mjs|js|cjs|ts|sh|py)$/.test(name) && existsSync(join(root, 'scripts', name))) existing.add(`scripts/${name}`);
    const lane = lanes.find((l) => l.toLowerCase() === name.toLowerCase());
    if (lane) existing.add(lane);
  }
  const text = render(content);
  for (const lane of lanes) if (new RegExp(`(?<![\\w-])${escape(lane)}["”’]?\\s+lanes?\\b`, 'i').test(text)) existing.add(lane);
  return { existing: [...existing], missing: [...missing] };
}

// ---- The scratch copy and the lane ----

const listed = () => {
  const r = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
};

/**
 * A scratch copy under the OS temp folder, removed after the test, holding what the design links lane reads: the
 * checkout's top-level files (AGENTS.md among them), every file under scripts/ and every docs/*.md, tracked or
 * untracked but not ignored, with node_modules linked to the checkout's and a fresh `git init`. The lane gets no open
 * issues (an empty list handed over in DEEP_OPEN_ISSUES, as scripts/open-issues.mjs reads it) and so an empty
 * scripts/planned-names.txt, whose entries name real open issues the empty list doesn't hold.
 */
export function scratch(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2339-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  for (const file of listed()) {
    if (!(!file.includes('/') || file.startsWith('scripts/') || /^docs\/[^/]+\.md$/.test(file))) continue;
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'scripts', 'planned-names.txt'), '');
  const issues = join(sandbox, 'open-issues.json');
  writeFileSync(issues, '[]');
  return { sandbox, repo, issues };
}

/** The design links lane's entry: the one in `checks` whose name says link(s) and isn't the catalogue drift lane. */
export function laneEntry(root) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'lanes.mjs')).href)});
const found = checks.filter((l) => /\\blinks?\\b/i.test(l.name) && !/catalogue|drift/i.test(l.name));
console.log(JSON.stringify(found.map((l) => ({ name: l.name, commands: l.commands }))));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`could not read scripts/lanes.mjs: ${r.stderr}`);
  const found = JSON.parse(r.stdout.trim().split('\n').at(-1));
  if (found.length !== 1) throw new Error(`scripts/lanes.mjs checks has ${found.length} lanes named for links (not catalogue drift), not one`);
  return found[0];
}

/**
 * Runs the design links lane's own commands in order with cwd at `root`, stopping at the first that fails, with the
 * open issues read from `issues` (DEEP_OPEN_ISSUES). Returns the exit status (0 when every command passed), the output
 * and its lines.
 */
export function runLane(root, issues) {
  const entry = laneEntry(root);
  const env = { ...process.env, DEEP_OPEN_ISSUES: issues };
  delete env.DEEP_PREFLIGHT;
  let output = '';
  let status = 0;
  for (const [command, ...args] of entry.commands) {
    const r = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}`;
    status = r.status ?? 1;
    if (status !== 0) break;
  }
  return { name: entry.name, status, output, lines: output.split('\n') };
}

/** The run as text for an assertion message. */
export const shown = (run) => `exit ${run.status}, output:\n${run.output.trim() || '(none)'}`;

// ---- Naming ----

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const snippet = (s, n) => (s.length > n ? s.slice(0, n) : s);

/**
 * An output line naming a section line (README: Naming): the doc's file name with the line's number in the doc
 * (`technical-design.md:12`, `technical-design.md:3,12`, `technical-design.md line 12`), its ordinal in the section
 * (`line 5`, `item 5`, `principle 5`, `#5`, `5th`, `fifth`), or the first 30 characters of its text, raw or rendered.
 */
export function namesLine(run, line, doc = DESIGN) {
  const file = escape(posix.basename(doc));
  const at = new RegExp(`${file}(?::|,? lines? |#L)(?:\\d+,\\s?)*${line.number}(?!\\d)`);
  const k = line.ordinal;
  const ordinal = new RegExp(`(?:\\b(?:lines?|items?|principles?|entry|entries)\\s*#?${k}(?!\\d)|(?<![\\w#])#${k}(?!\\d)|\\b${k}(?:st|nd|rd|th)\\b|\\b${ORDINALS[k - 1]}\\b)`, 'i');
  const texts = [snippet(line.content.trim(), 30), snippet(render(line.content), 30)].filter((s) => s.length >= 12);
  return run.lines.find((l) => at.test(l) || ordinal.test(l) || texts.some((s) => l.includes(s)));
}

/**
 * An output line naming an invariant: the word "invariant" with its number (or ordinal word), either file's line
 * number for it, or 20 or more characters of its text as either file has it (raw or rendered).
 */
export function namesInvariant(run, { number, texts, lines = [] }) {
  const numbered = new RegExp(`invariants?\\W{0,3}(?:#?${number}(?!\\d)|${ORDINALS[number - 1]})|(?:${ORDINALS[number - 1]}|#?${number}(?:st|nd|rd|th)?)\\s+invariant`, 'i');
  const at = lines.map(({ doc, line }) => new RegExp(`${escape(posix.basename(doc))}(?::|,? lines? |#L)(?:\\d+,\\s?)*${line}(?!\\d)`));
  const pieces = texts.flatMap((t) => [snippet(t, 20), snippet(render(t), 20)]).filter((s) => s.length >= 12);
  return run.lines.find((l) => numbered.test(l) || at.some((re) => re.test(l)) || pieces.some((p) => l.includes(p)));
}

// ---- Planting ----

/** Writes `text` over `file` in the scratch copy. */
export const write = (root, file, text) => writeFileSync(join(root, file), text);

/** Replaces line `number` (1-based) of `file` in the scratch copy with `to`, so no other line moves. */
export function replaceLine(root, file, number, to) {
  const lines = read(root, file).split('\n');
  lines[number - 1] = to;
  write(root, file, lines.join('\n'));
}

/**
 * The scratch copy's Principles section. When the copy's design has none (the base), a stand-in section of ten lines
 * written for these tests is put in first, just above "What version 0 builds, and what waits" and its anchors, so a
 * planted case shows what the lane does with it; the stand-in follows the README's reading of every rule.
 */
export function ensureSection(root) {
  let text = read(root, DESIGN);
  let found = principles(text);
  if (found) return { section: found, standIn: false };
  const inv = invariants(read(root, 'AGENTS.md'));
  const held = '([Built to be hard to get wrong](#built-to-be-hard-to-get-wrong), `scripts/proof.mjs`)';
  const section = [
    '## Principles',
    '',
    ...inv.map((i) => `- ${i.text} ${held}.`),
    '- Agents and plug-ins write data, not code ([Data, not code](#prim-rules), `scripts/canvas-kit.mjs`).',
    '- A mistake is refused with its fix and never only warned about ([Checked before it shows](#prim-rules), `lint`).',
    '- The same input gives the same bytes ([Seeded and replayable](#prim-rules), `scripts/parity.mjs`).',
    '- A test counts only if it fails on a wrong program ([Wrong programs](#built-to-be-hard-to-get-wrong), `proof`).',
    '- The core stays small and everything else fills a slot with its kit ([Hub slots](#composition), `contracts`).',
    '- A decision is written with what would reopen it ([Decided](#decided), `scripts/design-links.mjs`).',
    '',
  ];
  const lines = text.split('\n');
  let at = headings(text).find((h) => h.text === NEXT_HEADING).index;
  while (at > 0 && (/^\s*<a\s[^>]*>(?:\s*<\/a>)?\s*$/i.test(lines[at - 1]) || !lines[at - 1].trim())) at--;
  lines.splice(at, 0, '', ...section);
  text = lines.join('\n');
  write(root, DESIGN, text);
  found = principles(text);
  return { section: found, standIn: true };
}

/** The section's lines that aren't the four invariants (from the fifth on). */
export const ownLines = (section) => section.lines.slice(4);

/** `content` with every link into the design docs replaced by its label, and bare blob links into docs/ dropped. */
export function unlink(content, from = DESIGN) {
  return content
    .replace(/(!?)\[([^\]]*)\]\(\s*<?([^\s)>]+)[^)]*\)/g, (whole, bang, label, target) => {
      const link = resolve(target, from);
      return link && DOCS.includes(link.file) ? label : whole;
    })
    .replace(new RegExp(`${escape(REPO)}docs/[^\\s)>\\]"'\`]*`, 'g'), '');
}

/** A line's list marker and indent: its raw text before its content. */
export const marker = (line) => line.raw.slice(0, line.raw.length - line.content.length);

/** A scratch copy with its section (the stand-in at the base), after showing the unplanted copy passes the lane. */
export function clean(t) {
  const copy = scratch(t);
  const { section, standIn } = ensureSection(copy.repo);
  const control = runLane(copy.repo, copy.issues);
  if (control.status !== 0) throw new Error(`the unplanted scratch copy${standIn ? ' (with the stand-in section)' : ''} already fails the lane, so a planted failure would prove nothing: ${shown(control)}`);
  return { ...copy, section, standIn };
}
