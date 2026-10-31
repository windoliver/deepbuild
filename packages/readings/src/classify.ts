// Readings that classify your messages. Pattern matching agreed with labels only 33-54% of the time in the October
// replay, so a classifying reading counts for Decision 1 only once it agrees with a sample you labelled.
import type { ClassifierCheck } from './types.js';

export interface LabelledMessage { message: string; text: string; label: boolean; period: 'baseline' | 'dogfood'; dates_hidden: boolean; labelled_by: string }

const MIN_SAMPLE = 100;
// Yes messages are rare, so plain agreement passes a classifier that always says no. It has to
// find them and be right when it says yes, and it can't be judged on fewer than this many.
const MIN_YES = 10;
export function checkClassifier(input: { id: string; classifier: (text: string) => boolean; sample: LabelledMessage[]; threshold: number }): ClassifierCheck {
  const { id, classifier, sample, threshold } = input;
  const labelled_by = sample[0]?.labelled_by ?? null;
  const n = sample.length;
  const right = sample.filter((m) => classifier(m.text) === m.label).length;
  const agreement = n ? right / n : null;
  const yes = sample.filter((m) => m.label).length;
  const said = sample.filter((m) => classifier(m.text));
  const found = said.filter((m) => m.label).length;
  const recall = yes ? found / yes : null;
  const precision = said.length ? found / said.length : null;
  const decides = n >= MIN_SAMPLE && yes >= MIN_YES && sample.every((m) => m.dates_hidden) && new Set(sample.map((m) => m.period)).size === 2 && new Set(sample.map((m) => m.labelled_by)).size === 1;
  const passes = agreement !== null && agreement >= threshold && (recall ?? 0) >= threshold && (precision ?? 0) >= threshold;
  return { id, n, agreement, yes, recall, precision, labelled_by, status: !decides || agreement === null ? 'BLOCKED' : passes ? 'PASS' : 'FAIL' };
}

/** A person asking whether work is done, instead of being told: "is it done?", "did it deploy?", "does it pass now?". */
export function isItDone(text: string): boolean {
  return /\b(is|are|was|has|have|did|does|do)\s+(it|this|that|the\s+\w+|they|you|we)\b[^.?!\n]{0,40}\b(done|finished|complete[d]?|work(ing|s|ed)?|pass(ed|ing|es)?|deploy(ed|s)?|merged?|fixed|ready|green|run|ran|test(ed)?)\b/i.test(text)
    || /\bare we (done|good)\b/i.test(text);
}
/** A person sending finished work back: "that's wrong", "redo", "it still fails". */
export function isRework(text: string): boolean {
  return /\b(still (fails?|failing|broken|wrong|doesn'?t|not)|that'?s (wrong|not (right|what))|redo|try again|not fixed|didn'?t (fix|work)|doesn'?t work|revert (it|that|this))\b/i.test(text);
}

/** Decision 1 uses only the classifying readings that pass, on labels you made; a test's fixture labels are never yours. */
export function decisionOneInputs(readings: { id: string; check: ClassifierCheck | null }[], options: { labellers?: string[] } = {}): { used: string[]; refused: { id: string; why: string }[] } {
  const labellers = options.labellers ?? ['you'];
  const used: string[] = [];
  const refused: { id: string; why: string }[] = [];
  for (const { id, check } of readings) {
    if (!check) refused.push({ id, why: 'not checked against a labelled sample' });
    else if (check.status !== 'PASS') refused.push({ id, why: `its check is ${check.status}: agreement ${check.agreement} over ${check.n} messages, ${check.yes} labelled yes, recall ${check.recall}, precision ${check.precision}` });
    else if (!labellers.includes(check.labelled_by ?? '')) refused.push({ id, why: `labelled by ${check.labelled_by}, not you` });
    else used.push(id);
  }
  return { used, refused };
}
