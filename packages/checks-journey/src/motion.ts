// Motion assertions (#37): every animation and transition that started during a step is recorded from the browser's
// own animation list, with its target (by role and name), property, duration, delay and easing, and compared exactly
// with the values the requirement names. Motion a script moves frame by frame has no entry, so a requirement only
// it could prove is INCONCLUSIVE, naming the element, never PASS. Under reduced motion an element that still moves,
// scales or turns fails, naming the element.
import type { Locator } from './journey.js';

interface Control { role: string; name: string; testId?: string }
export interface Animation { target: Control; property: string; from: string; to: string; duration: number; delay: number; easing: string }
interface MotionRequirement { target: Locator; properties: Record<string, { from: string; to: string }>; durationMs: number; delayMs: number; easing: string }
type MotionOutcome =
  | { outcome: 'passed' }
  | { outcome: 'failed'; element: string; message: string }
  | { outcome: 'INCONCLUSIVE'; element: string; message: string };

const describe = (l: Locator): string => (l.testId ? `testId=${l.testId}` : l.role ? `${l.role} "${l.name ?? ''}"` : l.label ? `label "${l.label}"` : `"${l.name ?? ''}"`);
const targets = (a: Animation, l: Locator): boolean => (l.testId !== undefined && a.target.testId === l.testId) || (l.role !== undefined && a.target.role === l.role && (l.name === undefined || a.target.name === l.name)) || (l.role === undefined && l.name !== undefined && a.target.name === l.name);
/** A CSS value as the browser reports it against the requirement's: no spaces, lower case, translate(0, Y) as translateY(Y). */
const norm = (v: string | null | undefined): string => String(v ?? '').replace(/\s+/g, '').replace(/^translate\(0(?:px)?,([^)]+)\)$/, 'translateY($1)').replace(/translate3d\(0(?:px)?,([^,]+),0(?:px)?\)/, 'translateY($1)').replace(/translateY\(0\)/, 'translateY(0px)').toLowerCase();
const MOVES = /translate|scale|rotate|transform|left|top|right|bottom|width|height|margin|inset/i;

/** The animations a step recorded on the target, compared exactly with the requirement; none is INCONCLUSIVE naming the element. */
export function assertMotion(animations: readonly Animation[], r: MotionRequirement): MotionOutcome {
  const element = describe(r.target);
  const own = animations.filter((a) => targets(a, r.target));
  if (!own.length) return { outcome: 'INCONCLUSIVE', element, message: `no animation or transition started on ${element}; motion a script moves frame by frame has no entry in the browser's animation list, so this run can't prove the requirement` };
  const faults: string[] = [];
  for (const [p, want] of Object.entries(r.properties)) {
    const a = own.find((x) => norm(x.property) === norm(p));
    if (!a) { faults.push(`no ${p} animated (${own.map((x) => x.property).join(', ')})`); continue; }
    if (norm(a.from) !== norm(want.from) || norm(a.to) !== norm(want.to)) faults.push(`${p} ${a.from} → ${a.to}, not ${want.from} → ${want.to}`);
    if (a.duration !== r.durationMs) faults.push(`${p} duration ${a.duration} ms, not ${r.durationMs} ms`);
    if (a.delay !== r.delayMs) faults.push(`${p} delay ${a.delay} ms, not ${r.delayMs} ms`);
    if (norm(a.easing) !== norm(r.easing)) faults.push(`${p} easing ${a.easing}, not ${r.easing}`);
  }
  if (faults.length) return { outcome: 'failed', element, message: `${element}: ${[...new Set(faults)].join('; ')}` };
  return { outcome: 'passed' };
}

/** Under reduced motion: an element that still moves, scales or turns fails, naming it; one that only fades, or appears at rest, passes. */
export function assertReducedMotion(animations: readonly Animation[], target: Locator): { outcome: 'passed' } | { outcome: 'failed'; element: string; message: string } {
  const element = describe(target);
  const moving = animations.filter((a) => targets(a, target) && MOVES.test(a.property));
  if (!moving.length) return { outcome: 'passed' };
  return { outcome: 'failed', element, message: `${element} still moves under reduced motion: ${moving.map((a) => `${a.property} ${a.from} → ${a.to} over ${a.duration} ms`).join(', ')}` };
}
