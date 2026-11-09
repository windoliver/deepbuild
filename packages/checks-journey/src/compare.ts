// Steps compared with the last PASS (#37): each step records its route, with IDs, tokens and timestamps read as one
// placeholder, and the controls that appeared, went away or changed state; a replayed step matches only when at
// least one of those changes happened during it where the last PASS saw one, and the first step whose route or
// changes differ from the last PASS is the one a regression names. A comparison by raw URL names the confirmation
// step on its order ID: the planted wrong program the tests select.
interface Control { role: string; name: string; testId?: string }
export interface ComparedStep { id: string; outcome: string; route: string; raw?: string; controls: { appeared: Control[]; left: Control[]; changed: Control[] } }

const show = (c: Control): string => `${c.role} "${c.name}"`;
const changes = (s: ComparedStep): string[] => [...s.controls.appeared.map((c) => `${show(c)} appeared`), ...s.controls.left.map((c) => `${show(c)} went away`), ...s.controls.changed.map((c) => `${show(c)} changed state`)];

/** The first step of `next` whose route or changes differ from the last PASS's, and why. */
export function firstDiffering(last: readonly ComparedStep[], next: readonly ComparedStep[], plant?: 'raw-url'): { step: string | null; why: string | null } {
  const n = Math.max(last.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = last[i], b = next[i];
    if (!a || !b) return { step: (a ?? b)!.id, why: !b ? `the last PASS ran ${a!.id} here and this run has no such step` : `this run has a step ${b.id} the last PASS lacks` };
    if (a.id !== b.id) return { step: b.id, why: `step ${b.id} where the last PASS had ${a.id}` };
    if (b.outcome === 'unrun' || b.outcome === 'stopped') return { step: b.id, why: `${b.id} never ran, where the last PASS ran it` };
    const ra = plant === 'raw-url' ? a.raw ?? a.route : a.route, rb = plant === 'raw-url' ? b.raw ?? b.route : b.route;
    if (ra !== rb) return { step: b.id, why: `its route ${rb} differs from the last PASS's ${ra}` };
    const x = changes(a), y = changes(b);
    if (x.length && !y.length) return { step: b.id, why: `no control appeared, went away or changed state during it, where the last PASS saw ${x.join(', ')}` };
    if (!x.length && y.length) return { step: b.id, why: `${y.join(', ')}, where the last PASS saw no control appear, go away or change state` };
  }
  return { step: null, why: null };
}
