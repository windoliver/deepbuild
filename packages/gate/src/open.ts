// What a claim leaves open (#323; design: An agent says it's done, Open items, Solved or not). Pure, with no model:
// the final message's open sections, the bugs it says it found and left, the issues it filed instead of fixing, the
// limits a change writes into its PR body or its docs, placeholder text left in changed files, the agent's own task
// list as its adapter's facts name it, and the commands the message tells you to run. Each becomes an open item's
// words; the core gives it its scope and ID. Beside them: the shape of an error a waiver matches, and a definition's
// one solve line.

/** Where an open item's words came from. */
export type LeftFrom = 'section' | 'bug' | 'issue' | 'limit' | 'placeholder' | 'task';
/** One thing left open: its words, where they came from, and for a section's item the section's heading. */
export interface LeftOpen { text: string; from: LeftFrom; section?: string }

/** The headings whose lists are open items. */
const SECTION = /^(?:still open|not verified|next steps?|follow[- ]?ups?|remaining proof gaps?|not run|not exercised|known limits?|known limitations?)$/i;
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

/** A line read as a heading: its words with the markdown around them taken off, and any words after its colon. */
function heading(line: string): { name: string; rest: string } | null {
  const bare = line.trim().replace(/^#{1,6}\s+/, '').replace(/^(\*\*|__)(.*?)\1/, '$2').replace(/^(\*\*|__)/, '').trim();
  const colon = bare.indexOf(':');
  const name = (colon < 0 ? bare : bare.slice(0, colon)).replace(/[*_]+$/, '').trim();
  return SECTION.test(name) ? { name, rest: colon < 0 ? '' : bare.slice(colon + 1).replace(/^[*_]+/, '').trim() } : null;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Each item of the text's open sections, with its heading: a bullet each, or the section's paragraph when it lists none. */
function openSections(text: string): { text: string; section: string }[] {
  const out: { text: string; section: string }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = heading(lines[i]!);
    if (!h) continue;
    const items: string[] = [];
    if (h.rest) items.push(clean(h.rest));
    const para: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j]!;
      if (!line.trim()) { if (items.length || para.length) { if (!BULLET.test(lines[j + 1] ?? '')) break; } continue; }
      if (heading(line) || /^#{1,6}\s/.test(line.trim())) break;
      const b = BULLET.exec(line);
      if (b) { if (b[1]!.trim()) items.push(clean(b[1]!)); }
      else if (/^\s{2,}\S/.test(line) && items.length) items[items.length - 1] = clean(`${items[items.length - 1]} ${line}`);
      else if (h.rest) break;
      else para.push(line);
    }
    if (para.length) items.push(clean(para.join(' ')));
    out.push(...items.map((t) => ({ text: t, section: h.name.toLowerCase() })));
    i = j - 1;
  }
  return out;
}

/** The sentences of a text, its lines' bullets taken off. */
function sentences(text: string): string[] {
  return text.split('\n').map((l) => l.replace(BULLET, '$1')).join('\n')
    .split(/(?<=[.!?])\s+|\n+/).map(clean).filter(Boolean);
}
const BUG = /\b(?:bugs?|regressions?|defects?|crash(?:es)?|races?|leaks?)\b/i;
const LEFT = /\b(?:left|leave|leaving|follow[- ]?ups?|separately|out of scope|later|didn't fix|did not fix|not fixed|unfixed|won't fix|isn't fixed|not addressed)\b/i;
const FILED = /\b(?:filed|opened|created|raised|logged)\b.*?(?:\bissues?\b|#\d+)/i;
const LIMIT = /\bknown limit(?:ation)?s?\b|\b(?:doesn't|does not|don't|do not|isn't|is not|can't|cannot|won't)\b[^.]*\byet\b|\bnot (?:yet )?supported\b/i;

/**
 * What a final message leaves open: its open sections' items, then each sentence that says it found a bug and left
 * it, or filed one as an issue instead of fixing it. One sentence the sections already hold isn't read twice.
 */
export function leftOpen(message: string): LeftOpen[] {
  const out: LeftOpen[] = openSections(message).map((o) => ({ ...o, from: 'section' as const }));
  const seen = new Set(out.map((o) => o.text.toLowerCase()));
  for (const s of sentences(message)) {
    if (seen.has(s.toLowerCase()) || heading(s)) continue;
    const from: LeftFrom | null = FILED.test(s) && (BUG.test(s) || /\binstead\b/i.test(s)) ? 'issue' : BUG.test(s) && LEFT.test(s) ? 'bug' : null;
    if (from) { out.push({ text: s, from }); seen.add(s.toLowerCase()); }
  }
  return out;
}

/** What an agent writes when it has nothing to say: Claude Code's "No response requested.", an empty model reply. */
const NO_CONTENT = /^(?:no response requested|no content|empty response)$/i;
/**
 * A final message that says nothing (#82; design: Every stop is judged): empty, only marks, or one of the agents'
 * no-content placeholders. A stop that did work and ends on one gets a completion prompt.
 */
export function endsEmpty(message: string): boolean {
  const words = message.replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  return words === '' || NO_CONTENT.test(words);
}

/** The limits a change writes into its PR body or its docs: their open sections, and each sentence naming a limit. */
export function limitsIn(text: string): LeftOpen[] {
  const out: LeftOpen[] = openSections(text).map((o) => ({ ...o, from: 'limit' as const }));
  const seen = new Set(out.map((o) => o.text.toLowerCase()));
  for (const s of sentences(text)) {
    if (seen.has(s.toLowerCase()) || heading(s) || !LIMIT.test(s)) continue;
    out.push({ text: s, from: 'limit' });
    seen.add(s.toLowerCase());
  }
  return out;
}

const PLACEHOLDER = /\b(?:TODO|FIXME|XXX)\b|\bnot (?:yet )?implemented\b/i;
/** Placeholder text a change left: each added line of a changed file that holds one, by file and line. */
export function placeholders(added: { path: string; line: number; text: string }[]): LeftOpen[] {
  return added.filter((a) => PLACEHOLDER.test(a.text))
    .map((a) => ({ text: `placeholder left in ${a.path}:${a.line}: ${clean(a.text).slice(0, 200)}`, from: 'placeholder' as const }));
}

/** The added lines of a unified diff, by file and new line number. */
export function addedLines(diff: string): { path: string; line: number; text: string }[] {
  const out: { path: string; line: number; text: string }[] = [];
  let path: string | null = null;
  let line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { path = l.slice(4).replace(/^b\//, ''); if (path === '/dev/null') path = null; continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!path || l.startsWith('--- ')) continue;
    if (l.startsWith('+')) out.push({ path, line: line++, text: l.slice(1) });
    else if (!l.startsWith('-') && !l.startsWith('\\')) line++;
  }
  return out;
}

const SHELL_FENCE = /^```(?:bash|sh|shell|zsh|console)?\s*$/;
/** The commands a final message tells you to run: each line of its shell blocks, and a backticked command after "run". */
export function toldToRun(message: string): string[] {
  const out: string[] = [];
  const lines = message.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!SHELL_FENCE.test(lines[i]!.trim())) continue;
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j]!.trim()); j++) {
      const c = lines[j]!.trim().replace(/^\$\s+/, '');
      if (c && !c.startsWith('#')) out.push(c);
    }
    i = j;
  }
  const prose = message.replace(/```[\s\S]*?```/g, '');
  for (const m of prose.matchAll(/\b(?:run|running|try)\s+`([^`]+)`/gi)) out.push(m[1]!.trim());
  return [...new Set(out)];
}

/**
 * An error's text as a waiver matches it: what changes from run to run (a temporary path, a PID, a clock time) is
 * put by its kind, so the same error matches; every other number stays, so 'port 3000' never matches 'port 3001'.
 */
export function errorShape(text: string): string {
  return text
    .replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s'"`)\]]+/g, '<tmp>')
    .replace(/\bpid\s*[:=]?\s*\d+/gi, 'pid <n>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>');
}

/** How an adapter's facts name the agent's own task list (adapter.facts@1 `taskList`). */
export interface TaskListFacts { tool: string; items: string; text: string; status: string; open: string[] }
/**
 * The items an agent's task list leaves open: each in a state the facts call open, quoted. An item it marked
 * completed closes nothing and isn't listed; that is its word, which the gate never counts.
 */
export function openTasks(facts: TaskListFacts, input: unknown): LeftOpen[] {
  const list = input && typeof input === 'object' ? (input as Record<string, unknown>)[facts.items] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { [facts.text]: text, [facts.status]: status } = item as Record<string, unknown>;
    return typeof text === 'string' && text.trim() && typeof status === 'string' && facts.open.includes(status)
      ? [{ text: `the agent's task list leaves "${clean(text)}" ${status.replace(/_/g, ' ')}`, from: 'task' as const }] : [];
  });
}

// ---- The solve line (design: Solved or not).

const OP = /\b(under|below|less than|fewer than|at most|no more than|within|over|above|more than|at least|no less than)\b|(<=|>=|≤|≥|<|>)/i;
const THRESHOLD = new RegExp(`(?:${OP.source})\\s*(\\d+(?:\\.\\d+)?)(?:\\s*(%|[A-Za-zµ][\\w/µ]*))?`, 'gi');
const NOT_UNIT = new Set(['of', 'and', 'or', 'the', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'then', 'when', 'if', 'than', 'is', 'are', 'it']);
const UPPER = new Set(['under', 'below', 'less than', 'fewer than', 'at most', 'no more than', 'within', '<', '<=', '≤']);
/** One threshold a requirement's text states: the words before it, which way it bounds, its number and its unit (null when none). */
interface Threshold { subject: string; upper: boolean; value: number; unit: string | null; text: string }
/** The thresholds a text states. */
function thresholds(text: string): Threshold[] {
  const out: Threshold[] = [];
  for (const m of text.matchAll(THRESHOLD)) {
    const op = (m[1] ?? m[2]!).toLowerCase();
    const unit = m[4] && !NOT_UNIT.has(m[4].toLowerCase()) ? m[4] : null;
    const subject = text.slice(0, m.index).split(/[.;,:]/).at(-1)!.trim().toLowerCase().split(/\s+/).slice(-3).join(' ');
    out.push({ subject, upper: UPPER.has(op), value: Number(m[3]), unit, text: m[0].trim() });
  }
  return out;
}
/** The thresholds of a text that state no unit: each makes its check BLOCKED. */
export const unitless = (text: string): Threshold[] => thresholds(text).filter((t) => t.unit === null);

/** A requirement as the solve line reads it: its ID, its words, its check and the digest of the check's bytes. */
interface SolveRequirement { id: string; text: string; check: string | null; check_sha256?: string | null }
/**
 * A definition's one solve line: fully covered, or the first of what keeps it from being solved, in this order: a
 * requirement with no check, two checks covering the same thing (the same bytes, or the same words), two that
 * can't both pass (one subject bounded both ways with no value between), a threshold with no unit.
 */
export function solveLine(requirements: SolveRequirement[]): { solved: boolean; line: string } {
  const unchecked = requirements.filter((r) => !r.check);
  if (unchecked.length) return { solved: false, line: `not solved: ${unchecked.map((r) => `${r.id} has no check ("${clean(r.text).slice(0, 120)}")`).join('; ')}` };
  const checked = requirements.filter((r): r is SolveRequirement & { check: string } => !!r.check);
  for (const [i, a] of checked.entries()) {
    for (const b of checked.slice(i + 1)) {
      if (a.check === b.check) continue;
      const same = (a.check_sha256 && a.check_sha256 === b.check_sha256) || clean(a.text).toLowerCase() === clean(b.text).toLowerCase();
      if (same) return { solved: false, line: `not solved: ${a.check} (${a.id}) and ${b.check} (${b.id}) cover the same thing` };
      for (const x of thresholds(a.text)) for (const y of thresholds(b.text)) {
        if (x.subject !== y.subject || x.upper === y.upper || (x.unit ?? '') !== (y.unit ?? '')) continue;
        const [hi, lo] = x.upper ? [x, y] : [y, x];
        if (hi.value <= lo.value) return { solved: false, line: `not solved: ${a.id} and ${b.id} can't both pass (${x.text} and ${y.text})` };
      }
    }
  }
  const bare = checked.flatMap((r) => unitless(r.text).map((t) => `${r.id}'s threshold "${t.text}" has no unit`));
  if (bare.length) return { solved: false, line: `not solved: ${bare.join('; ')}` };
  return { solved: true, line: 'solved: fully covered' };
}
