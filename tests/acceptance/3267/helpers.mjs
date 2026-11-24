// Helpers for #3267's acceptance tests (README.md names every surface they read). Three kinds:
//   - the two design sections: found by the anchors the issue links, cut into sentences and table cells, and what each
//     gained since the base commit. The slug, heading-text and section rules are copied from
//     tests/acceptance/1352/helpers.mjs, which copied them from scripts/design-links.mjs; never imported.
//   - a person's approval: an SSH-signed tag under refs/tags/deep/approved/, by a key that .deepbuild/approvers lists at
//     the merge base, with a touch or a biometric, holding `Approves: <path>` lines. The reading is copied from
//     scripts/proof-approvals.mjs (readApprovals, sshsig), less its rule that the tagged commit is one of the change.
//   - the judges, which take what was read and return what is wrong, one line each, so a planted input can be judged
//     without a checkout, a tag or GitHub.
// Every function that reads git takes the `git` to ask, so a planted repository can stand in for this one.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPO = 'windoliver/deepbuild';
export const ISSUE = 3267;
/** The base commit these tests were drafted on (main, no work on the issue). */
export const BASE = '5919c39756b4e1ec7af6cadc97c017a6a0830fe5';
export const APPROVERS = '.deepbuild/approvers';
export const APPROVED = 'refs/tags/deep/approved/';
/** The record of the line #1186, #1187 and #1188 gain (README.md, The owner's word). */
export const LINE_RECORD = 'docs/evidence/3267/pointing-line.txt';

/** The two sections criterion 1 names, by the anchors the issue links. */
export const SECTIONS = {
  privacy: { file: 'docs/technical-design.md', anchor: 'privacy', name: "the technical design's Privacy section" },
  classes: { file: 'docs/canvas-primitives.md', anchor: 'seam-and-backend-device-classes', name: "the canvas primitives' device classes section" },
};

/** git in this checkout: `{ status, stdout, stderr }`. */
export const git = (args, input) => spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: CHECKOUT, input, encoding: 'utf8', maxBuffer: 1 << 28 });
/** gh, as the shell has it. */
export const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
/** What a command said when it failed, on one line. */
export const said = (r) => `${r.error?.message ?? ''}${r.stderr ?? ''}`.trim().replace(/\s+/g, ' ').slice(0, 300) || `exit ${r.status}`;
/** Why GitHub can't be read from this shell, or null when it can. */
export function ghDown() {
  const auth = gh(['auth', 'status']);
  return auth.status === 0 ? null : `gh isn't signed in or can't reach GitHub: ${said(auth)}`;
}

/** A file of this checkout, or null when it isn't there. */
export const fileHere = (path) => (existsSync(join(CHECKOUT, path)) ? readFileSync(join(CHECKOUT, path), 'utf8') : null);
/** A file as a commit holds it, or null when it doesn't. */
export function fileAt(run, rev, path) {
  const shown = run(['show', `${rev}:${path}`]);
  return shown.status === 0 ? shown.stdout : null;
}

// GitHub's slug and a heading's rendered text, as scripts/design-links.mjs computes them.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

/** Every heading outside fenced code: its line index, level and GitHub slug (repeats get -1, -2, …). */
function headings(text) {
  const lines = text.split(/\r?\n/), found = [], seen = new Set();
  let fence;
  for (const [index, line] of lines.entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
      continue;
    }
    if (mark) { fence = mark[1]; continue; }
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!h) continue;
    const words = headingText(h[2]);
    let id = slug(words);
    for (let n = 1; seen.has(id); n++) id = `${slug(words)}-${n}`;
    seen.add(id);
    found.push({ index, level: h[1].length, slug: id });
  }
  return { lines, found };
}

const ANCHOR_LINE = /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>\s*(?:<\/a>)?/gi;
const isAnchorLine = (line) => line.trim() && !line.replace(/<a\s[^>]*>\s*(?:<\/a>)?/gi, '').trim();

/**
 * The section of a doc's text an anchor lands on: the heading whose GitHub slug it is, or the heading an `<a id>` just
 * above it names (blank and other anchor lines between). Its text runs from the heading to the next heading of its
 * level or higher, its subheadings included, without the blank and `<a id>` lines that close it (those belong to the
 * next heading). Null when the text is null or holds no such heading.
 */
export function sectionIn(text, anchor) {
  if (text === null) return null;
  const { lines, found } = headings(text);
  const h = found.find((heading) => {
    if (heading.slug === anchor) return true;
    for (let i = heading.index - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      if (!isAnchorLine(lines[i])) return false;
      if ([...lines[i].matchAll(ANCHOR_LINE)].some((m) => m[1] === anchor)) return true;
    }
    return false;
  });
  if (!h) return null;
  const next = found.find((o) => o.index > h.index && o.level <= h.level);
  const body = lines.slice(h.index, next ? next.index : lines.length);
  while (body.length && (!body.at(-1).trim() || isAnchorLine(body.at(-1)))) body.pop();
  return body.join('\n');
}

/** The two sections as `read(path)` gives their docs: `{ privacy, classes }`, each its text or null. */
export const sections = (read) => Object.fromEntries(Object.entries(SECTIONS).map(([key, { file, anchor }]) => [key, sectionIn(read(file), anchor)]));

/**
 * A text's sentences and table cells, as tests/acceptance/1352/ cuts a doc to judge a phrase by the sentence it sits
 * in, here line by line and with case kept: each line is cut after a full stop followed by white space and at each
 * `|`, and white space inside a piece is collapsed.
 */
export const pieces = (text) => (text ?? '').split(/\r?\n/).flatMap((line) => line.split(/(?<=\.)\s+|\s*\|\s*/)).map((piece) => piece.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** The pieces `now` holds that `before` doesn't, in `now`'s order. */
export function gained(now, before) {
  const old = new Set(pieces(before));
  return pieces(now).filter((piece) => !old.has(piece));
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 1: the decisions, by the words any answer to each has to use (README.md, The decisions' words). Each word
// is read in the text one section gained, or in what the two gained together.

/** The issue's five Scope decisions: what each decides, and `[where, word]` for each word its answer has to hold. */
export const DECISIONS = [
  ["a device class says when its entries are a body's motion", [['classes', /\bbod(?:y|ies)\b/i]]],
  ['body entries are personal data under Privacy, and each way out is named: a saved run, an export, a match and the relay, evidence, a debug bundle',
    [['privacy', /\bpersonal data\b/i], ['privacy', /\bbod(?:y|ies)\b/i], ['either', /\bsav(?:e|es|ed|ing)\b/i], ['either', /\bexport/i], ['either', /\bmatch(?:es)?\b/i], ['either', /\brelay\b/i], ['either', /\bevidence\b/i], ['either', /\bdebug bundles?\b/i]]],
  ["a way out carries body entries only by the person's own gesture that names them, on save, export and Join", [['either', /\bgestures?\b/i], ['either', /\bjoin(?:s|ed|ing)?\b/i]]],
  ['what proves a hands piece is synthetic, and what a recording of a person is evidence for', [['either', /\bsynthetic hands?\b/i], ['either', /\brecord(?:ed|ing|ings)\b/i], ['either', /\bpersons?\b/i]]],
  ['a fixture is never a person: its clip is drawn or rendered, or recorded by a maintainer who agrees in writing',
    [['either', /\bfixtures?\b/i], ['either', /\bclips?\b/i], ['either', /\bpersons?\b/i], ['either', /\bdrawn\b|\brendered\b/i], ['either', /\bconsent|\bagree|\bin writing\b/i]]],
];

/**
 * What is wrong with the decisions as `text` holds them, one line each; none when nothing is. `text` is
 * `{ privacy, classes }`, each the list of pieces to read in that section: what it gained since the base, or the
 * part of that a person approved. `since` says which, for the lines.
 */
export function judgeDecisions(text, since = `it didn't hold at ${BASE.slice(0, 8)}`) {
  const empty = Object.keys(SECTIONS).filter((key) => !text[key]?.length);
  if (empty.length) return empty.map((key) => `${SECTIONS[key].name} (${SECTIONS[key].file}#${SECTIONS[key].anchor}) holds no sentence ${since}, so no decision is written into it`);
  const read = { privacy: text.privacy.join('\n'), classes: text.classes.join('\n') };
  read.either = `${read.privacy}\n${read.classes}`;
  const where = { privacy: 'what the Privacy section gained', classes: 'what the device classes section gained', either: 'what the two sections gained' };
  const problems = [];
  for (const [decision, words] of DECISIONS) {
    const missing = words.filter(([place, word]) => !word.test(read[place])).map(([place, word]) => `${word} in ${where[place]}`);
    if (missing.length) problems.push(`not written: ${decision}. Missing ${missing.join(', ')}`);
  }
  const notTaken = read.either.match(/\bnot taken\b/gi)?.length ?? 0;
  if (notTaken < DECISIONS.length) problems.push(`what the two sections gained says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what was not taken`);
  const reopens = read.either.match(/\breopen(?:s|ed|ing)?\b/gi)?.length ?? 0;
  if (reopens < DECISIONS.length) problems.push(`what the two sections gained says "reopen" (Reopens if, would reopen) ${reopens} times; each of the ${DECISIONS.length} decisions needs what would reopen it`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// A person's approval (README.md, The owner's approval), read as scripts/proof-approvals.mjs reads one.

// The key types whose every signature carries its authenticator's flags: a security key's, or a platform
// authenticator's. A key in a plain file signs for whatever reads it.
const PRESENCE = new Set(['sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com']);
// The authenticator's user-present and user-verified flags: a touch, or a biometric or PIN.
const PRESENT = 0x01 | 0x04;

/** The signing key's type and the flags its authenticator set, from an armored SSH signature; null when it can't be read. */
function sshsig(armor) {
  try {
    const bytes = Buffer.from(armor.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const reader = (buffer, at = 0) => () => { const length = buffer.readUInt32BE(at); const value = buffer.subarray(at + 4, at + 4 + length); at += 4 + length; return Object.assign(value, { end: at }); };
    if (bytes.subarray(0, 6).toString() !== 'SSHSIG') return null;
    const take = reader(bytes, 10);
    take(); take(); take(); take();
    const signature = take(), part = reader(signature);
    const type = part().toString();
    const end = part().end;
    // A security key's signature carries the flags its authenticator set, then its counter.
    return { type, flags: PRESENCE.has(type) && end < signature.length ? signature[end] : 0 };
  } catch {
    return null;
  }
}

/**
 * The approvals this repository holds of `paths`: `{ approved: [{ item, sha, tag }], refused: [why] }`, or
 * `{ blocked: why }` when they can't be read. An approval is an annotated tag under refs/tags/deep/approved/,
 * SSH-signed by a key that `.deepbuild/approvers` lists at the merge base of HEAD and origin/main (never the working
 * tree's list), with a touch or a biometric, and one `Approves: <item>` line per item. It approves its items for the
 * commit it sits on; a line `Approves: <item> @<sha>` approves its item for that commit alone, one the tagged commit
 * is or descends from. The signature is checked with ssh-keygen itself. A tag that names none of `paths` is another
 * matter's and isn't read; `refused` names each tag that names one and approves nothing.
 */
export function readApprovals(run, paths) {
  const base = run(['merge-base', 'HEAD', 'origin/main']);
  if (base.status !== 0) return { blocked: `git finds no merge base of HEAD and origin/main, where ${APPROVERS} is read: ${said(base)}` };
  const listed = (fileAt(run, base.stdout.trim(), APPROVERS) ?? '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const refs = run(['for-each-ref', '--format=%(refname)%09%(objecttype)%09%(*objectname)', APPROVED]);
  if (refs.status !== 0) return { blocked: `git can't list ${APPROVED}: ${said(refs)}` };
  const approved = [], refused = [];
  const directory = mkdtempSync(join(tmpdir(), 'deep-3267-approvals-'));
  try {
    const people = join(directory, 'approvers'), signature = join(directory, 'signature');
    writeFileSync(people, listed.map((line) => `${line}\n`).join(''));
    for (const row of refs.stdout.split('\n').filter(Boolean)) {
      const [ref, type, target] = row.split('\t');
      if (type !== 'tag') continue; // a lightweight tag holds no message, so it names nothing
      const name = ref.replace(/^refs\/tags\//, '');
      const tag = run(['cat-file', 'tag', ref]).stdout ?? '';
      const at = tag.indexOf('-----BEGIN SSH SIGNATURE-----\n');
      const message = (at < 0 ? tag : tag.slice(0, at)).split('\n\n').slice(1).join('\n\n');
      // One tag for the commits before it too: a line ending in a full commit ID approves its item for that commit,
      // which the tagged commit must be or descend from; one ending in any other commit-like ID approves nothing.
      const items = [...message.matchAll(/^Approves: (.+?)\s*$/gm)].map(([, line]) => /^(.+?) @([0-9a-f]{40})$/.exec(line)?.slice(1) ?? (/\s@[0-9a-fA-F]{7,}$/.test(line) ? [] : [line, target]))
        .filter(([item]) => paths.includes(item));
      if (!items.length) continue;
      if (at < 0 || !tag.trimEnd().endsWith('-----END SSH SIGNATURE-----')) { refused.push(`${name}: not SSH-signed`); continue; }
      writeFileSync(signature, tag.slice(at));
      const ssh = (args, input) => spawnSync('ssh-keygen', ['-Y', ...args, '-f', people, '-s', signature], { input, encoding: 'utf8' });
      const found = ssh(['find-principals']);
      if (found.error) return { blocked: `ssh-keygen can't run, so no signature can be checked: ${found.error.message}` };
      const principal = found.stdout?.split('\n')[0]?.trim();
      if (!principal || ssh(['verify', '-n', 'git', '-I', principal], tag.slice(0, at)).status !== 0) { refused.push(`${name}: signed by no key that ${APPROVERS} lists at the merge base`); continue; }
      const signed = sshsig(tag.slice(at));
      if (!(signed && signed.flags & PRESENT)) { refused.push(`${name}: signed by ${principal} with no touch or biometric`); continue; }
      for (const [item, sha] of items) {
        if (sha !== target && run(['merge-base', '--is-ancestor', sha, target]).status !== 0) { refused.push(`${name}: it names ${item} for ${sha}, a commit the tagged one doesn't descend from`); continue; }
        approved.push({ item, sha, tag: name });
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return { approved, refused };
}

/**
 * What the approved commits added to a file, as `cut` cuts it: for each approval whose item is `path`, the pieces the
 * file holds at that commit and not at its first parent. Null when no approval names the path.
 */
export function approvedIn(run, approvals, path, cut) {
  const naming = approvals.filter(({ item }) => item === path);
  if (!naming.length) return null;
  return [...new Set(naming.flatMap(({ sha }) => {
    const before = new Set(cut(fileAt(run, `${sha}^`, path)));
    return cut(fileAt(run, sha, path)).filter((piece) => !before.has(piece));
  }))];
}

/** How a failure names the tags that approve nothing. */
const refusals = (refused) => (refused.length ? `; these tags approve nothing: ${refused.join('; ')}` : '');

/**
 * What is wrong with the owner's approval of the two sections' text, one line each. `added` is `{ privacy, classes }`,
 * the pieces each section gained since the base; `approved` is the same keys, each the pieces approved commits added
 * to that section or null when no approval names its file; `refused` is readApprovals' list. The decisions are judged
 * in the approved pieces the sections still hold, so an approval made on other text covers nothing.
 */
export function judgeApproved({ added, approved, refused = [] }) {
  const problems = [], covered = {};
  for (const [key, { file, name }] of Object.entries(SECTIONS)) {
    if (approved[key] === null) {
      problems.push(`no approval of ${file}: no tag under ${APPROVED}, signed with a touch or a biometric by a key ${APPROVERS} lists at the merge base, holds "Approves: ${file}"${refusals(refused)}`);
      continue;
    }
    const yes = new Set(approved[key]);
    covered[key] = added[key].filter((piece) => yes.has(piece));
    if (!covered[key].length) problems.push(`the approval of ${file} was made on other text: none of the ${added[key].length} sentences ${name} gained is one an approved commit added to it`);
  }
  if (problems.length) return problems;
  const open = judgeDecisions(covered, 'that an approved commit added');
  if (!open.length) return [];
  const unapproved = Object.keys(SECTIONS).flatMap((key) => added[key].filter((piece) => !covered[key].includes(piece)).map((piece) => `${SECTIONS[key].file}: "${piece.slice(0, 120)}"`));
  return [...open.map((line) => `in the approved text, ${line}`), ...(unapproved.length ? [`the sections gained these sentences, which no approved commit added:\n${unapproved.join('\n')}`] : [])];
}

// ---------------------------------------------------------------------------------------------------------------------
// Criteria 2 and 3: issue bodies.

/** Whether a body cites an issue of this repository: `#n`, `windoliver/deepbuild#n` or its URL. */
export function cites(body, number) {
  const n = String(number);
  return new RegExp(`(?:^|[^&\\w/-])#${n}(?!\\d)|${REPO}#${n}(?!\\d)|github\\.com/${REPO}/issues/${n}(?!\\d)`, 'im').test(body ?? '');
}

/** An issue's criteria as the trace lane reads them (scripts/proof-change.mjs, readIssue): each `- [ ]` line's text. */
export function criteriaOf(body) {
  const section = (body ?? '').split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text]) => text.trim());
}
/** A criterion's ID: `#<issue>.` and the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
/** A text's lines, trimmed, without the empty ones. */
export const linesOf = (text) => (text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** The three things criterion 2 lists, each by the words an issue that covers it has to use (README.md, The follow-on issues). */
export const THINGS = [
  ["the class's mark and the named gestures on save, export and Join, with a planted save that writes hand entries without the named click failing",
    [/\bclass(?:es)?\b/i, /\bgestures?\b/i, /\bsav(?:e|es|ed|ing)\b/i, /\bexport/i, /\bjoin(?:s|ed|ing)?\b/i, /\bhands?\b/i, /\bplanted\b/i]],
  ['a scan of everything that leaves the machine in a round played with hands, finding no body entry, with a planted evidence writer that keeps the track failing',
    [/\bscan(?:s|ned|ning)?\b/i, /\bleav(?:e|es|ing)\b/i, /\bmachine\b/i, /\bbod(?:y|ies)\b/i, /\bevidence\b/i, /\btrack\b/i, /\bplanted\b/i]],
  ["#1186's clip replaced or its consent recorded", [/(?:^|[^&\w/-])#1186(?!\d)/m, /\bclips?\b/i, /\breplac|\bdrawn\b|\brendered\b|\bconsent|\bagree|\bin writing\b/i]],
];
// The first-party device classes the design's section holds, each at major 1: a changed layout is a new major.
const NEW_MAJOR = /\b(?:pen|touches|motion|midi|hands)@(?!1\b)\d+\b/g;
/** Closed as not planned or as a duplicate: nothing is filed to be done, as scripts/design-issues.mjs reads it. */
const dropped = (issue) => String(issue.state).toLowerCase() === 'closed' && String(issue.stateReason ?? '').toLowerCase() !== 'completed';

/**
 * What is wrong with the follow-on issues, one line each. `issues` is what GitHub holds of each candidate:
 * `{ number, body, state, stateReason, pullRequest }`. A follow-on is an issue filed after #3267 (a higher number), no
 * pull request, not closed as not planned or as a duplicate, whose body cites #3267 and covers one of the three things.
 */
export function judgeFollowOns(issues) {
  const later = issues.filter((issue) => issue.number > ISSUE && !issue.pullRequest && !dropped(issue));
  const covers = (issue, [, words]) => words.every((word) => word.test(issue.body ?? ''));
  const problems = [];
  for (const thing of THINGS) {
    if (later.some((issue) => cites(issue.body, ISSUE) && covers(issue, thing))) continue;
    const near = later.filter((issue) => covers(issue, thing)).map((issue) => `#${issue.number} holds its words and doesn't cite #${ISSUE}`);
    problems.push(`no follow-on issue covers ${thing[0]}: no issue filed after #${ISSUE} cites it in its body and holds ${thing[1].join(', ')}${near.length ? ` (${near.join('; ')})` : ''}`);
  }
  for (const issue of later.filter((candidate) => cites(candidate.body, ISSUE) && THINGS.some((thing) => covers(candidate, thing)))) {
    const majors = [...new Set((issue.body ?? '').match(NEW_MAJOR) ?? [])];
    if (majors.length) problems.push(`#${issue.number} changes an entry's layout: it names ${majors.join(', ')}, and a changed layout is a new major`);
  }
  return problems;
}

/**
 * Criterion 3, what GitHub holds: what is wrong with the three issues' criteria and their lines pointing here, one
 * line each, and `lines`, each issue's body lines that cite #3267. `bodies` maps an issue's number to its body;
 * `saved` maps it to its criteria as saved-criteria.json holds them (`[{ id, starts }]`).
 */
export function judgePointers({ bodies, saved }) {
  const problems = [], lines = {};
  for (const [number, criteria] of Object.entries(saved)) {
    const live = new Set(criteriaOf(bodies[number]).map((text) => criterionId(number, text)));
    for (const criterion of criteria) if (!live.has(criterion.id)) problems.push(`#${number}'s criterion ${criterion.id} ("${criterion.starts}…") is no longer in its body as it was saved: it was reworded, moved or dropped`);
    lines[number] = (bodies[number] ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => cites(line, ISSUE));
    if (!lines[number].length) problems.push(`#${number} gained no line pointing here: no line of its body cites #${ISSUE}`);
  }
  return { problems, lines };
}

/**
 * Criterion 3, the owner's word: what is wrong, one line each. `lines` is judgePointers' lines; `approved` is the
 * lines approved commits added to the record that it still holds, or null when no approval names the record.
 */
export function judgeWord({ lines, approved, refused = [] }) {
  if (approved === null) return [`no word of the owner's for the lines: no tag under ${APPROVED}, signed with a touch or a biometric by a key ${APPROVERS} lists at the merge base, holds "Approves: ${LINE_RECORD}"${refusals(refused)}`];
  const yes = new Set(approved);
  return Object.entries(lines).filter(([, found]) => !found.some((line) => yes.has(line)))
    .map(([number, found]) => `#${number}'s line pointing here isn't one the owner approved in ${LINE_RECORD}: ${found.map((line) => `"${line.slice(0, 160)}"`).join(', ')}; the approved lines: ${approved.map((line) => `"${line.slice(0, 160)}"`).join(', ') || 'none that the record still holds'}`);
}
