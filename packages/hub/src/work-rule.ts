// A standing run's rule (#1335; design: Work runs): one approval names a rule instead of a list, and the issues that
// meet it join the run as the forge holds them, with no new approval. The rule reads structure only: the author's role,
// labels, a milestone or an epic, and `Runs on:` lines this host can serve. A rule on an issue's words is refused at
// approval, naming it, since no model, and no match on text, decides what joins. The rule takes only issues you or a
// collaborator wrote, never an outside author's or one an agent opened, and one it takes joins only once it is ready:
// it has acceptance criteria, a design link that resolves and dependencies that read. One that isn't ready stays out,
// named on the run's page, with no ask. Joined issues go earliest milestone first, then in the run's own order.

/** What a standing run's approval names: the rule as said, and what it reads of the forge. */
export interface Rule { words: string; labels: string[]; milestone: string | null; epic: number | null; roles: string[] }
/** The author roles that may join: you and the repo's collaborators, never an outside author's issue. */
export const ROLES = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** An open issue as the forge's list gives it: its structure, and its body for the readiness check. */
export interface Listed {
  n: number; title: string; body: string; labels: string[];
  milestone: { number: number; title: string; due: number | null } | null;
  author: string; role: string;
  /** Whether an app or a bot opened it: what an agent writes. */
  app: boolean;
}

/** Words that make a clause read an issue's text: its title, body or comments, or what it mentions. */
const TEXT = /\b(?:title|titled|body|text|description|comments?|mentions?|mentioning|contains?|containing|match(?:es|ing)?|keywords?|says|saying|about)\b/i;
/** Words a label list ends at: the scope's other bounds. */
const STOP = new Set(['in', 'under', 'by', 'with', 'written', 'opened', 'filed', 'from', 'milestone', 'epic', 'using', 'until', 'at', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'claude', 'codex', 'whose', 'where', 'that', 'which', 'for', 'of', 'each', 'every', 'all', 'up', 'to', 'on']);
const unquote = (s: string): string => s.replace(/^["'`]|["'`]$/g, '');
/** One label as the words give it: quoted, or a bare name such as area:hub, never a share such as 50%. */
const LABEL = String.raw`(?:"[^"]+"|'[^']+'|\x60[^\x60]+\x60|[A-Za-z0-9][\w:./+-]*(?![\w%]))`;

/**
 * The rule a scope's words name, or undefined when they name none (a set of issues by number). A string refuses it:
 * a clause that reads the issue's text, named as said, or a bound a standing run can't take.
 */
export function ruleOf(words: string): Rule | string | undefined {
  const labels: string[] = [];
  const labelled = new RegExp(String.raw`\b(?:labell?ed|with\s+(?:the\s+)?labels?|labels?)\s+(${LABEL}(?:\s*(?:,|&|\band\b)\s*${LABEL})*)`, 'gi');
  for (const m of words.matchAll(labelled)) {
    for (const part of m[1]!.split(/\s*(?:,|&|\band\b)\s*/)) {
      const name = unquote(part.trim());
      if (!name || STOP.has(name.toLowerCase())) break;
      if (!labels.includes(name)) labels.push(name);
    }
  }
  const milestone = /\bmilestone\s+("[^"]+"|'[^']+'|`[^`]+`|[^\s,;]+)/i.exec(words)?.[1] ?? /\bin\s+(?:the\s+)?("[^"]+"|'[^']+'|`[^`]+`|[^\s,;]+)\s+milestone\b/i.exec(words)?.[1];
  const epic = /\b(?:epic|under)\s+#(\d+)/i.exec(words)?.[1];
  const numbered = /(?<!\b(?:epic|under)\s+)#\d+/i.test(words);
  const structural = labels.length > 0 || milestone !== undefined || epic !== undefined || /\b(?:every|all|any|each)\s+(?:new\s+|open\s+)*issues?\b|\bstanding\b/i.test(words);
  // A clause on the issue's words is refused, named as said: what joins is never read from text.
  const text = TEXT.exec(words);
  if (!structural && (numbered || !text)) return undefined;
  if (structural && numbered) return 'Name the issues by number, or name a rule for a standing run, not both.';
  if (text) {
    const at = text.index;
    const start = Math.max(words.lastIndexOf(',', at), words.lastIndexOf(';', at)) + 1;
    const lead = /\b(?:whose|where|that|which|if|when|with)\b(?![\s\S]*\b(?:whose|where|that|which|if|when|with)\b)/i.exec(words.slice(start, at));
    const from = lead ? start + lead.index : start;
    const end = words.slice(at).search(/[,;]/);
    const clause = words.slice(from, end < 0 ? undefined : at + end).trim();
    return `The rule "${clause}" reads the issue's text, and a standing run's rule reads only structure: the author's role, labels, a milestone or an epic, and Runs on: lines. Name the issues by those, or by number.`;
  }
  if (/\b(?:anyone|everyone|outside\s+authors?|any\s+author)\b/i.test(words)) return 'A standing run takes only issues you or a collaborator wrote, whatever their labels say; leave the author out or say "by you".';
  if (/\buntil\b/i.test(words)) return 'A standing run has no end date: it runs until you pause it or its breaker trips. Leave the end out, or name the issues by number.';
  const roles = /\b(?:written|opened|filed)\s+by\s+you\b(?!\s+or\b)|\bby\s+you\s+alone\b/i.test(words) ? ['OWNER'] : ROLES;
  return { words, labels, milestone: milestone ? unquote(milestone) : null, epic: epic ? Number(epic) : null, roles };
}

/** Whether an issue meets a rule's structure: every label it names, its milestone, its epic. */
export function meets(rule: Rule, i: Listed, under: ReadonlySet<number> | undefined): boolean {
  const have = new Set(i.labels.map((l) => l.toLowerCase()));
  if (!rule.labels.every((l) => have.has(l.toLowerCase()))) return false;
  // A milestone by its title, its number, or its title's first word, as "R1" names "R1 · Prove done, and see it".
  const title = i.milestone?.title.toLowerCase();
  const named = rule.milestone?.toLowerCase();
  if (named !== undefined && title !== named && String(i.milestone?.number) !== named && !title?.startsWith(`${named} `)) return false;
  // An issue is under the epic when the forge lists it as the epic's sub-issue, or its `**Epic:** #n` line names it.
  if (rule.epic !== null && !under?.has(i.n) && epicOf(i.body) !== rule.epic) return false;
  return true;
}

/** The epic an issue's `**Epic:** #n` field names. */
function epicOf(body: string): number | undefined {
  const m = /(?:^\s*|\*\*)Epic:?(?:\*\*)?:?\s*#(\d+)/im.exec(body);
  return m ? Number(m[1]) : undefined;
}

/** A section's lines, under a heading of any level whose text is `name`, up to the next heading. */
function section(body: string, name: string): string[] | undefined {
  const m = new RegExp(`^#+\\s*${name}\\s*$([\\s\\S]*?)(?=^#+\\s|(?![\\s\\S]))`, 'im').exec(body);
  return m ? m[1]!.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : undefined;
}

/** The links on an issue's `**Design:**` field, as written, up to the line's next bold field. */
export function designLinks(body: string): string[] | undefined {
  const line = /(?:^\s*|\*\*)Design:?(?:\*\*)?:?(.*)$/im.exec(body)?.[1];
  if (line === undefined) return undefined;
  return [...line.split(/\*\*[A-Z][\w ]*:?\*\*/)[0]!.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]!);
}

/** The anchors a markdown file holds: each heading slugged as GitHub slugs it, and each `<a id>` or `<a name>`. */
export function anchorsOf(text: string): Set<string> {
  const found = new Set<string>();
  const headings = new Set<string>();
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) { if (mark && mark[1]![0] === fence[0] && mark[1]!.length >= fence.length && !mark[2]!.trim()) fence = undefined; continue; }
    if (mark) { fence = mark[1]; continue; }
    for (const [, id] of line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) found.add(id!);
    const heading = /^ {0,3}#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const plain = heading[1]!.replace(/\s+#+\s*$/, '').trim().replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, _tick, code, label) => code ?? label ?? '');
    const base = plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
    let id = base;
    for (let k = 1; headings.has(id); k++) id = `${base}-${k}`;
    headings.add(id);
    found.add(id);
  }
  return found;
}

/**
 * Whether the rule's author role takes an issue: you or a collaborator wrote it, as the forge's author association says,
 * and no app or agent did. An issue it doesn't take is outside the rule, as one without its labels is, and isn't named.
 */
export function authored(rule: Rule, i: Listed, agent: (login: string) => boolean): boolean {
  return !i.app && !agent(i.author) && rule.roles.includes(i.role);
}

/**
 * Why an issue the rule takes can't join yet, read with no model, or undefined once it may: its acceptance criteria,
 * its design link and its dependencies. `doc` reads a file of the repo's default branch, and `blockers` is what the
 * forge answered for its blocked-by links.
 */
export async function whyOut(i: Listed, o: { repo: string; doc(path: string): Promise<string | undefined>; blockers: number[] | { unread: string } | undefined }): Promise<string | undefined> {
  const criteria = section(i.body, 'acceptance criteria')?.filter((l) => /^[-*+]\s+|^\d+[.)]\s+/.test(l));
  if (!criteria?.length) return `#${i.n} has no acceptance criteria`;
  const links = designLinks(i.body);
  if (!links?.length) return `#${i.n} has no design link`;
  for (const link of links) {
    const problem = await unresolved(link, o.repo, o.doc);
    if (problem) return `#${i.n}'s design link ${link} doesn't resolve: ${problem}`;
  }
  for (const line of section(i.body, 'depends on') ?? []) {
    // An item that says there is none, with or without why, reads as none.
    if (/^(?:[-*+]\s*)?(?:none|nothing|n\/a)\b|^(?:[-*+]\s*)?[—–]$/i.test(line)) continue;
    if (!/^[-*+]\s*(?:\[[ xX]\]\s*)?#\d+\b/.test(line)) return `#${i.n}'s dependency "${line.replace(/^[-*+]\s*/, '').slice(0, 200)}" names no issue by number`;
  }
  if (o.blockers === undefined) return `#${i.n}'s blocked-by links are not read yet`;
  if (!Array.isArray(o.blockers)) return `#${i.n}'s dependencies don't read: ${o.blockers.unread}`;
  return undefined;
}

/** Why a design link doesn't land in the repo's default branch: its file is missing, or no heading or `<a id>` is its anchor. */
async function unresolved(link: string, repo: string, doc: (path: string) => Promise<string | undefined>): Promise<string | undefined> {
  const [, path = '', anchor = ''] = /^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/.exec(link) ?? [];
  const blob = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+)$/i.exec(path);
  let file: string;
  if (blob) {
    if (blob[1]!.toLowerCase() !== repo.toLowerCase()) return `it points outside ${repo}`;
    file = blob[2]!;
  } else if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//')) return `it points outside ${repo}`;
  else if (path) file = path.replace(/^\.?\//, '');
  else return 'it names no file';
  const text = await doc(file);
  if (text === undefined) return `${file} isn't on the default branch`;
  let id = anchor;
  try { id = decodeURIComponent(anchor); } catch { /* compared as written */ }
  if (id && !anchorsOf(text).has(id)) return `no heading or <a id> in ${file} is #${id}`;
  return undefined;
}

/** Earliest milestone first: by its due date, then its number; an issue in none comes after every milestone. */
export function byMilestone(a: Listed['milestone'], b: Listed['milestone']): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return (a.due ?? Infinity) - (b.due ?? Infinity) || a.number - b.number;
}
