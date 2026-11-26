// Helpers of the blind redraft of four files of #2339's acceptance suite (README.md, beside this file): the Principles
// section, AGENTS.md's invariants and the canvas reference's conventions as these tests read them; one scratch copy of
// the checkout's whole tree a test file; and runs of the design links lane through its own commands, as the copy's
// scripts/lanes.mjs lists them. What is read as scripts/doc-links.mjs reads it (the lines outside fenced code, GitHub's
// slug, a heading's text, a line's link targets and where a target lands) is copied from it, never imported.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const AGENTS = 'AGENTS.md';
export const CONVENTIONS = 'Conventions every primitive uses';
export const NO_SUCH = 'scripts/no-such-check.mjs';
/** A file under scripts/ every tree holds, the one the issue itself names: the check a planted line names when its check isn't what is planted. */
export const HELD = 'scripts/lanes.mjs';
const DOCS = [DESIGN, CANVAS];
const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';
const PLANNED = 'scripts/planned-names.txt';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A file of the tree at `root`, as text. One that can't be read fails, naming it. */
export function read(root, file) {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch (error) {
    throw new Error(`${file} can't be read (${error.code ?? error.message}), so nothing can be judged by it`);
  }
}

// ---- Markdown, as scripts/doc-links.mjs reads it at the base (copied) ----

const linesOf = (text) => text.split('\n').map((raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw));

/** The lines outside fenced code: { index (0-based), line }. */
function prose(text) {
  const out = [];
  let fence;
  for (const [index, line] of linesOf(text).entries()) {
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

/** The headings outside fenced code: { index, level, text, id }, a repeated slug numbered -1, -2, … as GitHub does. */
function headings(text) {
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

/** The link targets on a line outside code spans: markdown links' targets, and bare blob links into this repo. */
function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

/** The docs file and anchor a target on a line of `from` links to, or null for a link that isn't into docs/*.md. */
function resolve(target, from) {
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

// A line that is blank or holds only <a> anchors.
const anchorsOnly = (line) => !line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim();

/** The explicit anchors that land on the heading at `index`: each <a id> on the lines just above it, with only blank and anchor lines between. */
function anchorsAbove(lines, index) {
  const ids = [];
  for (let i = index - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const found = [...lines[i].matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    if (!found.length || !anchorsOnly(lines[i])) break;
    ids.push(...found);
  }
  return ids;
}

/** A line's text as it reads rendered: code spans by their content, links and images by their label, tags and bold marks dropped, white space collapsed. */
export const render = (s) => s
  .replace(/(`+)(.+?)\1/g, (_, tick, code) => code.trim())
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\*\*|__/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const INLINE_LINK = /!?\[([^\]]*)\]\(\s*<?([^\s)>]+)[^)]*\)/g;

// ---- The section, the invariants, the conventions (README: Readings) ----

const ITEM = /^( {0,3}(?:[-*+]|\d{1,9}[.)])\s+)(.*)$/;

/**
 * The Principles section of a design text: the first heading outside fenced code whose text is "Principles" (any
 * level, any case), to the next heading of its level or higher. Its lines are its top-level list items, each one
 * physical line; a body with no list item has its non-blank prose lines instead. Each line: its 1-based number in the
 * doc, its ordinal in the section, the raw line, its marker and its content after the marker. Its anchors are the
 * heading's slug and each <a id> just above it. No such heading, or no line under it, fails, naming it.
 */
export function principles(text) {
  const all = headings(text);
  const heading = all.find((h) => /^principles$/i.test(h.text));
  if (!heading) throw new Error(`${DESIGN} has no heading "Principles", so its section can't be read`);
  const lines = linesOf(text);
  const end = all.find((h) => h.index > heading.index && h.level <= heading.level)?.index ?? lines.length;
  const body = prose(text).filter(({ index }) => index > heading.index && index < end);
  let items = body.flatMap(({ index, line }) => {
    const m = line.match(ITEM);
    return m ? [{ index, raw: line, marker: m[1], content: m[2] }] : [];
  });
  if (!items.length) {
    items = body.filter(({ line }) => !anchorsOnly(line) && !/^ {0,3}#/.test(line) && !/^\s*<!--/.test(line))
      .map(({ index, line }) => ({ index, raw: line, marker: line.match(/^\s*/)[0], content: line.trim() }));
  }
  if (!items.length) throw new Error(`the Principles section of ${DESIGN} (line ${heading.index + 1}) holds no line`);
  return {
    heading,
    anchors: new Set([heading.id, ...anchorsAbove(lines, heading.index)]),
    lines: items.map((it, k) => ({ number: it.index + 1, ordinal: k + 1, raw: it.raw, marker: it.marker, content: it.content })),
  };
}

/**
 * AGENTS.md's four invariants: the numbered lines under its heading "The four invariants", each { number, text, line
 * (1-based) }. Anything but four of them, numbered 1 to 4, fails, naming what was found.
 */
export function invariants(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^#{1,6}\s+The four invariants\s*$/.test(l));
  if (start < 0) throw new Error(`${AGENTS} has no heading "The four invariants", so its invariants can't be read`);
  const found = [];
  for (let i = start + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]); i++) {
    const m = lines[i].match(/^(\d+)\.\s+(.*\S)\s*$/);
    if (m) found.push({ number: Number(m[1]), text: m[2], line: i + 1 });
  }
  if (found.length !== 4 || found.some((inv, k) => inv.number !== k + 1)) {
    throw new Error(`${AGENTS} lists ${found.length} numbered lines under "The four invariants" (${found.map((inv) => inv.number).join(', ') || 'none'}), not four numbered 1 to 4`);
  }
  return found;
}

/**
 * `text` with one word of the invariant `words` taken out: its second, where the invariant's first two words stand in
 * `text`. Returns the edited text and the word. A text that doesn't hold those two words fails, naming them.
 */
export function withoutSecondWord(text, words) {
  const [first, second] = words.split(' ');
  const at = second ? text.indexOf(`${first} ${second} `) : -1;
  if (at < 0) throw new Error(`${JSON.stringify(text)} doesn't hold "${first} ${second ?? ''}", the invariant's first two words, so no word can be taken out of it`);
  return { edited: `${text.slice(0, at)}${first} ${text.slice(at + first.length + second.length + 2)}`, word: second };
}

/**
 * The canvas reference's heading "Conventions every primitive uses" (any case): the heading, the <a id> anchors that
 * land on it, its opening (the lines outside fenced code up to the next heading of any level) and the opening's first
 * paragraph (lone anchor lines skipped). No such heading fails, naming it.
 */
export function conventions(text) {
  const all = headings(text);
  const heading = all.find((h) => h.text.toLowerCase() === CONVENTIONS.toLowerCase());
  if (!heading) throw new Error(`${CANVAS} has no heading "${CONVENTIONS}"`);
  const end = all.find((h) => h.index > heading.index)?.index ?? Infinity;
  const opening = prose(text).filter(({ index }) => index > heading.index && index < end);
  // Blank lines and lines with text; a line holding only anchors is no paragraph.
  const kept = opening.filter(({ line }) => !line.trim() || !anchorsOnly(line));
  const rest = kept.slice(Math.max(0, kept.findIndex(({ line }) => line.trim())));
  const stop = rest.findIndex(({ line }) => !line.trim());
  const first = (stop < 0 ? rest : rest.slice(0, stop)).filter(({ line }) => line.trim());
  return { heading, anchors: anchorsAbove(linesOf(text), heading.index), opening, first };
}

/** The targets on a line of the canvas reference that link to the design's section holding one of `anchors`. */
export const toSection = (line, anchors) => targets(line).filter((target) => {
  const link = resolve(target, CANVAS);
  return link && link.file === DESIGN && anchors.has(link.id);
});

/** A line of the canvas reference with each markdown link to the section replaced by its label. */
export const withoutSectionLinks = (line, anchors) => line.replace(INLINE_LINK, (whole, label, target) => {
  const link = resolve(target, CANVAS);
  return link && link.file === DESIGN && anchors.has(link.id) ? label : whole;
});

/** The targets on a line of the design that link into the design docs, with an anchor: those into the technical design first. */
function designLinks(content) {
  const into = targets(content).map((target) => ({ target, link: resolve(target, DESIGN) })).filter(({ link }) => link && DOCS.includes(link.file) && link.id);
  return [...into.filter(({ link }) => link.file === DESIGN), ...into.filter(({ link }) => link.file !== DESIGN)].map(({ target }) => target);
}

/** The line of the section a planted line replaces, in a design text: its fifth, the first after the four invariants. None fails, naming it. */
export function fifthLine(text) {
  const line = principles(text).lines[4];
  if (!line) throw new Error(`the Principles section of ${DESIGN} has no fifth line for a planted line to replace`);
  return line;
}

/** A link into the design that a line of the section holds, for the planted line that replaces it to keep. None fails, naming the line. */
export function keptLink(line) {
  const [target] = designLinks(line.content);
  if (!target) throw new Error(`line ${line.ordinal} of the section (${DESIGN}:${line.number}) holds no link into the design for a planted line to keep: ${line.raw}`);
  return target;
}

// ---- The checks a line names (README: How a check is named) ----

/**
 * The checks a line names. A script: each `scripts/<path>` anywhere on the line (in code, in a link's target, in the
 * text, after ./ or ../ or this repo's blob address), existing when it is a file under scripts/ of the tree at `root`;
 * and each code span or link label that is the name of a file in the tree's scripts/. A lane: each name in `lanes`
 * that a code span or link label holds whole (a trailing " lane" allowed, any case), or that the text gives as
 * "<name> lane". Returns { existing, missing }: the names found that exist, and the scripts/ paths that don't.
 */
export function checksNamed(content, root, lanes) {
  const existing = new Set();
  const missing = new Set();
  const isFile = (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false;
  const paths = [
    ...[...content.matchAll(/(?<![\w./-])(?:\.{1,2}\/)*(scripts\/[\w./-]*\w)/g)].map((m) => m[1]),
    ...content.split(REPO).slice(1).flatMap((rest) => rest.match(/^scripts\/[\w./-]*\w/) ?? []),
  ];
  for (const path of paths) {
    const file = posix.normalize(path);
    (file.startsWith('scripts/') && isFile(file) ? existing : missing).add(path);
  }
  const spans = [...content.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim());
  const labels = [...content.matchAll(/\[([^\]]*)\]\(/g)].map((m) => render(m[1]));
  for (const piece of [...spans, ...labels]) {
    const name = piece.replace(/\s+lane$/i, '').trim();
    if (/^[\w-]+(?:\.[\w-]+)+$/.test(name) && isFile(`scripts/${name}`)) existing.add(`scripts/${name}`);
    const lane = lanes.find((l) => l.toLowerCase() === name.toLowerCase());
    if (lane) existing.add(lane);
  }
  const text = render(content);
  for (const lane of lanes) if (new RegExp(`(?<![\\w-])${escape(lane)}["”’]?\\s+lanes?\\b`, 'i').test(text)) existing.add(lane);
  return { existing: [...existing], missing: [...missing] };
}

/** The lane name in `lanes` that `content` holds as a word or run of words, any case, if any. */
export const laneWord = (content, lanes) => lanes.find((l) => new RegExp(`(?<![\\w-])${escape(l)}(?![\\w-])`, 'i').test(render(content)));

// ---- The lanes, the scratch copy and a run ----

// A child's environment: the caller's, without the variables that point git at another repository and without the
// test runner's own mark on this process.
const NOT_PASSED_ON = ['NODE_TEST_CONTEXT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];
const childEnv = (more = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !NOT_PASSED_ON.includes(name))), ...more });

// A child that didn't end by itself: why, or '' when it exited.
const stopped = (r) => (r.error ? `${r.error.code ?? r.error.message}` : r.signal ? `stopped by ${r.signal}` : r.status === null ? 'no exit status' : '');

/**
 * What scripts/lanes.mjs of the tree at `root` exports: `names`, the name of every lane in a list it exports (each
 * exported array whose entries all have a name and commands: `checks` and `releaseLanes` at the base); and `links`,
 * the entries of `checks` whose name says link(s) and isn't the catalogue drift lane's, each with its commands. A
 * module that can't be read, or that exports no lane, fails, naming it.
 */
export function lanesOf(root) {
  const program = `const m = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'lanes.mjs')).href)});
const lists = Object.values(m).filter((v) => Array.isArray(v) && v.length && v.every((e) => e && typeof e === 'object' && typeof e.name === 'string' && Array.isArray(e.commands)));
const links = (m.checks ?? []).filter((l) => /\\blinks?\\b/i.test(l.name) && !/catalogue|drift/i.test(l.name));
console.log(JSON.stringify({ names: lists.flat().map((l) => l.name), links: links.map((l) => ({ name: l.name, commands: l.commands })) }));`;
  // deadline: only bounds a scripts/lanes.mjs that hangs on import; it loads in well under a second
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: root, env: childEnv(), encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  if (stopped(r) || r.status !== 0) throw new Error(`scripts/lanes.mjs can't be read (${stopped(r) || `exit ${r.status}`}): ${(r.stderr ?? '').trim()}`);
  const { names, links } = JSON.parse(r.stdout.trim().split('\n').at(-1));
  if (!names.length) throw new Error('scripts/lanes.mjs exports no list of lanes (an array of entries with a name and commands)');
  return { names: [...new Set(names)], links };
}

/** The design links lane of the tree at `root`: the one entry `lanesOf` finds in `checks`. Anything but one, or one with no command, fails, naming it. */
function linksLane(root) {
  const { names, links } = lanesOf(root);
  if (links.length !== 1) throw new Error(`scripts/lanes.mjs lists ${links.length} lanes in \`checks\` named for links (not catalogue drift), not one, so the design links lane can't be told: ${links.map((l) => l.name).join(', ') || 'none'}`);
  if (!links[0].commands.length) throw new Error(`the lane "${links[0].name}" in scripts/lanes.mjs has no command to run`);
  return { names, lane: links[0] };
}

/**
 * One scratch copy for a test file, made when a test first asks for it: under the OS temp folder, `repo/` holds the
 * checkout's whole tree, every tracked file and every untracked file git doesn't ignore, each cloned
 * (COPYFILE_FICLONE) and a link kept a link; node_modules linked to the checkout's when it has one; and a fresh
 * `git init`. The lane is given no open issues, an empty list in the file DEEP_OPEN_ISSUES names, so the copy's
 * scripts/planned-names.txt is emptied, since its entries name real open issues. A copy that can't be made fails every
 * test that asks for it, naming why. Call `remove` when the file's tests are done.
 */
export function scratch() {
  let made;
  let failure;
  const original = new Map();
  const build = () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2339-redraft-')));
    made = { sandbox, repo: join(sandbox, 'repo'), issues: join(sandbox, 'open-issues.json') };
    const { repo } = made;
    const listing = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: CHECKOUT, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28 });
    if (listing.status !== 0) throw new Error(`git can't list the checkout's files (${stopped(listing) || `exit ${listing.status}`}): ${(listing.stderr ?? '').trim()}`);
    const folders = new Set();
    let count = 0;
    for (const file of listing.stdout.split('\0').filter(Boolean)) {
      const from = join(CHECKOUT, file);
      const kind = lstatSync(from, { throwIfNoEntry: false });
      // A tracked file the working tree no longer holds, or a folder git lists (a submodule), is not a file of the tree.
      if (!kind || !(kind.isFile() || kind.isSymbolicLink())) continue;
      const to = join(repo, file);
      if (!folders.has(dirname(to))) {
        mkdirSync(dirname(to), { recursive: true });
        folders.add(dirname(to));
      }
      if (kind.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
      else copyFileSync(from, to, constants.COPYFILE_FICLONE);
      count++;
    }
    if (!count) throw new Error('git lists no file of the checkout, so there is nothing to copy');
    if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, env: childEnv(), encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`git init failed in the scratch copy (${stopped(init) || `exit ${init.status}`}): ${(init.stderr ?? '').trim()}`);
    if (existsSync(join(repo, PLANNED))) writeFileSync(join(repo, PLANNED), '');
    writeFileSync(made.issues, '[]');
    Object.assign(made, linksLane(repo), { files: count });
  };
  const copy = () => {
    if (failure) throw failure;
    if (!made?.lane) {
      try {
        build();
      } catch (error) {
        failure = new Error(`the scratch copy of the checkout could not be made, so no lane ran: ${error.message}`);
        throw failure;
      }
    }
    return made;
  };
  const restore = () => {
    for (const [file, bytes] of original) writeFileSync(join(made.repo, file), bytes);
    original.clear();
  };
  const lane = () => {
    const { repo, issues, lane: entry } = copy();
    let output = '';
    let status = 0;
    for (const [command, ...args] of entry.commands) {
      // deadline: only bounds a lane command that hangs; the lane's one command takes under a second at the base
      const r = spawnSync(command, args, { cwd: repo, env: childEnv({ DEEP_OPEN_ISSUES: issues }), encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
      output += `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (stopped(r)) throw new Error(`the lane "${entry.name}" did not run to its end (${[command, ...args].join(' ').replace(repo, '<copy>')}: ${stopped(r)}), so it says nothing of the copy:\n${output.trim() || '(no output)'}`);
      status = r.status;
      if (status !== 0) break;
    }
    return { name: entry.name, status, output, lines: output.split('\n') };
  };
  return {
    /** The copy with nothing planted, after the lane passed on it, so a failure after a plant is the plant's. What `t` writes is put back when it ends. */
    unplanted(t) {
      copy();
      restore();
      t.after(restore);
      const control = lane();
      if (control.status !== 0) throw new Error(`the unplanted scratch copy doesn't pass the lane "${control.name}", so a failure after a plant would prove nothing: ${shown(control)}`);
      return made;
    },
    /** A file of the copy, as text. */
    read: (file) => read(copy().repo, file),
    /** Writes `text` over a file of the copy, keeping what it held to put back. */
    write(file, text) {
      const path = join(copy().repo, file);
      if (!original.has(file)) original.set(file, readFileSync(path));
      writeFileSync(path, text);
    },
    /** Replaces line `number` (1-based) of a file of the copy with `to`, so no other line moves. */
    replaceLine(file, number, to) {
      const lines = this.read(file).split('\n');
      if (number < 1 || number > lines.length) throw new Error(`${file} has no line ${number} to replace`);
      lines[number - 1] = to;
      this.write(file, lines.join('\n'));
    },
    lane,
    /** Removes the copy and everything beside it. */
    remove() {
      if (made) rmSync(made.sandbox, { recursive: true, force: true });
    },
  };
}

/** A run as text for an assertion's message: its exit status and its output, the first 40 lines of a long one. */
export function shown(run) {
  const lines = run.output.trim().split('\n');
  return `exit ${run.status}, output:\n${lines.slice(0, 40).join('\n') || '(none)'}${lines.length > 40 ? `\n… ${lines.length - 40} more lines` : ''}`;
}

/**
 * The lane failed the planted copy: its exit status isn't 0 and a line of its output starts FAIL. A lane that passed
 * `what` is the wrong program each planted test is for; an exit without a FAIL line (a crash, INCONCLUSIVE) is not a
 * failure of the plant.
 */
export function failed(run, what) {
  assert.notEqual(run.status, 0, `the lane passed ${what}: ${shown(run)}`);
  assert.ok(run.lines.some((l) => l.startsWith('FAIL')), `the lane exited ${run.status} on ${what} with no line starting FAIL, which is not a failure of the plant: ${shown(run)}`);
}

// ---- Naming (README: Naming) ----

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** The first line of the lane's output that names something, by `names`: any line but a `Fix:` line, which says how to repair and is no finding. */
export const finding = (run, names) => run.lines.find((l) => l.trim() && !/^\s*Fix:/.test(l) && names(l));

// `file` with line `number`: `<file>:<n>`, `<file>:<a>,<n>`, `<file>#L<n>`, `<file> line <n>`, `<file>, line <n>`, `<file> (line <n>`.
const place = (file, number) => new RegExp(`${escape(posix.basename(file))}(?::|#L|,?\\s*\\(?lines?\\s+)(?:\\d+,\\s?)*${number}(?!\\d)`);
// The runs of `size` characters a finding may quote from `text`, raw or rendered; none from a text shorter than that.
const quotes = (text, size) => [text, render(text)].flatMap((t) => Array.from({ length: Math.max(0, t.length - size + 1) }, (_, i) => t.slice(i, i + size)));

/**
 * A finding that names a line of the section: the doc's file name with the line's number in the doc; or the line's
 * ordinal in the section (`line 5`, `item 5`, `principle 5`, `5th`, `fifth`); or 30 characters in a row of its
 * content, raw or rendered.
 */
export function namesLine(run, line) {
  const at = place(DESIGN, line.number);
  const k = line.ordinal;
  const ordinal = new RegExp(`\\b(?:lines?|items?|principles?|entry|entries)\\s*#?${k}(?!\\d)|\\b${k}(?:st|nd|rd|th)\\b${ORDINALS[k - 1] ? `|\\b${ORDINALS[k - 1]}\\b` : ''}`, 'i');
  const runs = quotes(line.content, 30);
  return finding(run, (l) => at.test(l) || ordinal.test(l) || runs.some((s) => l.includes(s)));
}

/**
 * A finding that names an invariant: the word "invariant" with its number (`invariant 2`, `invariant #2`, `second
 * invariant`, `2nd invariant`); or the place of one of `places`, a file with the invariant's line in it; or 20
 * characters in a row of one of `texts`, the invariant as a file words it, raw or rendered.
 */
export function namesInvariant(run, { number, texts, places }) {
  const numbered = new RegExp(`\\binvariants?\\s*(?:#|no\\.?|number)?\\s*${number}(?!\\d)|\\b(?:${ORDINALS[number - 1]}|${number}(?:st|nd|rd|th))\\s+invariant`, 'i');
  const at = places.map(({ file, line }) => place(file, line));
  const runs = texts.flatMap((text) => quotes(text, 20));
  return finding(run, (l) => numbered.test(l) || at.some((re) => re.test(l)) || runs.some((s) => l.includes(s)));
}

/**
 * A finding that names a heading of the canvas reference: its text (any case); or its slug; or an <a id> that lands
 * on it, written `#<id>`; or the file's name with the heading's line.
 */
export function namesHeading(run, { text, slug: id, anchors, line }) {
  const at = place(CANVAS, line);
  const slugged = new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`);
  const hashed = anchors.map((anchor) => new RegExp(`#${escape(anchor)}(?![\\w-])`));
  return finding(run, (l) => l.toLowerCase().includes(text.toLowerCase()) || slugged.test(l) || hashed.some((re) => re.test(l)) || at.test(l));
}
