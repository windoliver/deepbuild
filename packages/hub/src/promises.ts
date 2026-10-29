// Promised checks that wake up (#120; design: Before each command, "Commands end."). A check the agent promises for
// later, such as "I'll look again in the morning", becomes a wake-up at that time, recorded with the quote it came
// from, its due time, how many times it has been set and an end. A wake-up never sets itself again: only the agent
// promising again sets it, and a promise set again more than three times, or past its end, is BLOCKED with a named
// owner (the service or you) and at most one ask. Pure: the text and the clock come in, the promise comes out.

/** The most times one promise may be set before it is BLOCKED: the fourth set blocks. */
export const MAX_SETS = 3;
/** How long after its first due time a promise can still be set again: past it the promise is BLOCKED. */
export const PROMISE_END_MS = 24 * 3_600_000;
/** The hour a promise "in the morning" or "tomorrow" comes due, local time. */
const HOURS: Record<string, number> = { morning: 9, noon: 12, lunch: 13, afternoon: 14, evening: 19, tonight: 20, night: 20 };
const UNITS: Record<string, number> = { s: 1000, sec: 1000, second: 1000, m: 60_000, min: 60_000, minute: 60_000, h: 3_600_000, hr: 3_600_000, hour: 3_600_000, d: 86_400_000, day: 86_400_000, week: 7 * 86_400_000 };
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'a couple of': 2, 'a few': 5, several: 5, half: 0.5 };

/** The verbs that promise a check, and what the agent says it will do them to. */
const PROMISE = /\b(?:I(?:'| wi)ll|I am going to|I'm going to|let me|going to|will)\s+(?:(?:try(?:ing)?|look|check|peek|poll|see|take a look|take another look|follow up|come back|circle back|revisit|retry|re-?run|re-?check|verify|confirm|watch|get back|report back|look again|check back|check in)\b[^.!?\n]*?)(?=(?:\s+(?:in|at|after|tomorrow|tonight|this|next|later)\b))([^.!?\n]*)/gi;
/** The time words a promise names, read against the moment the promise is made. */
const IN_SPAN = /\bin\s+(?:about\s+|around\s+|roughly\s+|another\s+)?(\d+(?:\.\d+)?|a couple of|a few|several|half an?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?)\b/i;
const IN_PART = /\bin\s+the\s+(morning|afternoon|evening)\b/i;
const TOMORROW = /\btomorrow(?:\s+(morning|afternoon|evening|night))?\b/i;
const TONIGHT = /\b(tonight|this\s+evening|this\s+afternoon|at\s+noon|after\s+lunch)\b/i;
const AT_CLOCK = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
const NEXT_WEEK = /\bnext\s+week\b/i;

export interface Promised { quote: string; due: number }

/** The hour of a part of the day at or after `now`, local time: today's if still ahead, else tomorrow's. */
function nextHour(now: number, hour: number, minute = 0, daysAhead = 0): number {
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  at.setDate(at.getDate() + daysAhead);
  if (daysAhead === 0 && at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** When a promise's time words come due, read from `now`; undefined when it names no time a wake-up can be set for. */
export function dueOf(words: string, now: number): number | undefined {
  const span = IN_SPAN.exec(words);
  if (span) {
    const count = /^\d/.test(span[1]!) ? Number(span[1]) : COUNTS[span[1]!.toLowerCase().replace(/\s+an?$/, '')] ?? COUNTS[span[1]!.toLowerCase()] ?? 1;
    const unit = span[2]!.toLowerCase().replace(/s$/, '');
    const ms = UNITS[unit] ?? UNITS[unit.replace(/s$/, '')];
    if (ms === undefined) return undefined;
    return now + Math.round(count * ms);
  }
  const tomorrow = TOMORROW.exec(words);
  if (tomorrow) return nextHour(now, HOURS[tomorrow[1]?.toLowerCase() ?? 'morning'] ?? HOURS.morning!, 0, 1);
  const part = IN_PART.exec(words);
  if (part) return nextHour(now, HOURS[part[1]!.toLowerCase()]!);
  const soon = TONIGHT.exec(words);
  if (soon) {
    const word = soon[1]!.toLowerCase().replace(/\s+/g, ' ');
    const hour = word === 'tonight' || word === 'this evening' ? HOURS.tonight! : word === 'this afternoon' ? HOURS.afternoon! : word === 'at noon' ? HOURS.noon! : HOURS.lunch!;
    return nextHour(now, hour);
  }
  const clock = AT_CLOCK.exec(words);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    const meridiem = clock[3]?.toLowerCase().replace(/\./g, '');
    if (hour > 23 || minute > 59) return undefined;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return nextHour(now, hour, minute);
  }
  if (NEXT_WEEK.test(words)) return nextHour(now, HOURS.morning!, 0, 7);
  return undefined;
}

/**
 * The checks a message promises for later, each with the sentence it came from and when it comes due. A promise that
 * names no time the hub can wake for ("I'll check back later") sets nothing: the time is the agent's to name.
 */
export function promisesIn(text: string, now: number): Promised[] {
  const out: Promised[] = [];
  for (const match of text.matchAll(PROMISE)) {
    const due = dueOf(match[1] ?? '', now);
    if (due === undefined || due <= now) continue;
    // The quote is the sentence the promise sits in, so the wake-up reads as the agent's own words.
    const start = Math.max(text.lastIndexOf('.', match.index) + 1, text.lastIndexOf('\n', match.index) + 1, text.lastIndexOf('!', match.index) + 1, text.lastIndexOf('?', match.index) + 1);
    const endAt = [...'.!?\n'].map((c) => text.indexOf(c, match.index + match[0].length)).filter((i) => i >= 0);
    const end = endAt.length ? Math.min(...endAt) + 1 : text.length;
    const quote = text.slice(start, end).replace(/\s+/g, ' ').trim().replace(/[\n]+$/, '');
    if (quote && !out.some((p) => p.quote === quote)) out.push({ quote: quote.slice(0, 500), due });
  }
  return out;
}

/** Who can clear a promise that is BLOCKED: a service, when the check waits on one, else you. */
export function ownerOf(quote: string): 'service' | 'you' {
  return /\b(?:ci|build|builds|deploy|deployment|pipeline|job|workflow|runner|server|service|api|queue|upload|download|install|installer|provisioning|dns|certificate|review|approval|merge queue|rate limit|quota|outage|incident)s?\b/i.test(quote) ? 'service' : 'you';
}

/** One promise's state as the record has it. */
export interface PromiseState { id: string; quote: string; due: number; set: number; end: number; status: 'set' | 'due' | 'woken' | 'blocked' }

/**
 * A promise made now, against the session's current one: the first sets it; one made while another stands sets it
 * again, keeping the first end; past three sets, or due past its end, it is BLOCKED. Returns the next state.
 */
export function setPromise(current: PromiseState | undefined, next: Promised, id: string): PromiseState {
  if (!current) return { id, quote: next.quote, due: next.due, set: 1, end: next.due + PROMISE_END_MS, status: 'set' };
  // BLOCKED stands: a promise made after it sets no wake-up, so none fires until you clear it (the session's end does).
  if (current.status === 'blocked') return current;
  const set = current.set + 1;
  const blocked = set > MAX_SETS || next.due > current.end;
  return { id: current.id, quote: next.quote, due: next.due, set, end: current.end, status: blocked ? 'blocked' : 'set' };
}
/** Why a promise is BLOCKED: set a fourth time, or due past its end. */
export function blockedCause(state: PromiseState): 'set_again' | 'past_end' { return state.set > MAX_SETS ? 'set_again' : 'past_end'; }

/** A time as a line names it: the local date and clock time, `2026-10-29 21:40`. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
/** What the agent reads when its promised check comes due, naming the quote and its due time. */
export function wakeText(state: PromiseState): string {
  return `DeepBuild: your promised check is due (${clockTime(state.due)}): "${state.quote}" Do it now, and report what you find; this wake-up sets itself no further.`;
}
/** The session's row while a due promise waits for its next prompt or stop. */
export function dueReading(state: PromiseState): string {
  return `A promised check is due since ${clockTime(state.due)}: "${state.quote}" It waits for this session's next prompt or stop.`;
}
export function blockedReading(state: PromiseState, owner: 'service' | 'you'): string {
  const why = blockedCause(state) === 'set_again' ? `set ${state.set} times` : 'set past its end';
  return `BLOCKED (cause: promise ${why}, owner: ${owner}): "${state.quote}" No further wake-up fires.`;
}
