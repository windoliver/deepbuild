import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { budgetVerdict } from './judges.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TEST_DEADLINE_MS = 120_000;
const homeAsTilde = (text: string): string => text.split(homedir()).join('~');
const CRITERION = '#3441.e80d0654';
const TASKS: readonly string[] = ['terminal-60hz', 'canvas-idle'];
const BUDGETS = 'benchmarks/budgets.json';
const WINDOWS = 'benchmarks/windows';
const WINDOWS_OWN_RECORD = 'window.json';

type Task = Record<string, unknown>;
interface Budgets { tasks: Task[] }

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asBudgets = (value: unknown): Budgets | null => (isRecord(value) && Array.isArray(value['tasks']) && value['tasks'].every(isRecord) ? { tasks: value['tasks'] } : null);
function budgetsAt(commit: string): Budgets | null {
  try {
    return asBudgets(parsed(git('show', `${commit}:${BUDGETS}`)));
  } catch {
    return null;
  }
}
const taskOf = (budgets: Budgets, id: string): Task | undefined => budgets.tasks.find((task) => task['id'] === id);
const criteriaOf = (task: Task | undefined): unknown[] => (Array.isArray(task?.['criteria']) ? task['criteria'] : []);
const bothNameTheCriterion = (budgets: Budgets): boolean => TASKS.every((id) => criteriaOf(taskOf(budgets, id)).includes(CRITERION));
const definitionOf = (task: Task): Task => Object.fromEntries(Object.entries(task).filter(([field]) => field !== 'criteria'));

describe('#3441 the two tasks whose budgets a window under no cap must keep', () => {
  it('AC6 #3441.e80d0654 terminal-60hz and canvas-idle each name this criterion in benchmarks/budgets.json, so a budget window judges them against the merge base, and each keeps the merge base\'s definition', () => {
    const current = asBudgets(parsed(readFileSync(join(REPO, BUDGETS), 'utf8')));
    if (current === null) expect.fail(`BLOCKED: ${BUDGETS} holds no tasks; this is not a pass`);
    let mergeBase: Budgets | null = null;
    let unread = '';
    try {
      mergeBase = budgetsAt(git('merge-base', 'HEAD', 'origin/main'));
    } catch (error) {
      unread = `: ${homeAsTilde(String((error as { stderr?: string }).stderr ?? error)).slice(-600)}`;
    }
    if (mergeBase === null) expect.fail(`BLOCKED: the merge base's ${BUDGETS} can't be read (git merge-base HEAD origin/main, then git show)${unread}; this is not a pass`);
    const failures: string[] = [];
    for (const id of TASKS) {
      const before = taskOf(mergeBase, id);
      const now = taskOf(current, id);
      if (before === undefined) expect.fail(`BLOCKED: the merge base's budgets hold no task ${id} to compare with; this is not a pass`);
      if (now === undefined) {
        failures.push(`${id} is gone from ${BUDGETS}`);
        continue;
      }
      if (!isDeepStrictEqual(definitionOf(now), definitionOf(before))) failures.push(`${id} no longer has the merge base's definition, so its two sides don't compare like with like: ${JSON.stringify(definitionOf(now)).slice(0, 400)}`);
      if (!criteriaOf(now).includes(CRITERION)) failures.push(`${id} doesn't name ${CRITERION} in its criteria, so no budget window judges it for this criterion; it names ${JSON.stringify(criteriaOf(now))}`);
    }
    expect(failures, `terminal-60hz and canvas-idle as the budget window reads them for ${CRITERION}`).toEqual([]);
  }, TEST_DEADLINE_MS);

  it('AC6 #3441.e80d0654 a budget window\'s record of the commit that made the two tasks name this criterion reads terminal-60hz and canvas-idle PASS beside their merge base\'s numbers; with no such record under benchmarks/windows/ the two are unjudged and this reads INCONCLUSIVE', () => {
    const folder = join(REPO, WINDOWS);
    const files = !existsSync(folder) ? [] : readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .flatMap((window) => readdirSync(join(folder, window.name)).filter((name) => name.endsWith('.json') && name !== WINDOWS_OWN_RECORD).map((name) => `${WINDOWS}/${window.name}/${name}`));
    const ofThisChange = files.flatMap((path) => {
      const record = parsed(readFileSync(join(REPO, path), 'utf8'));
      if (!isRecord(record) || typeof record['commit'] !== 'string' || typeof record['base'] !== 'string') return [];
      const after = budgetsAt(record['commit']);
      const before = budgetsAt(record['base']);
      return after !== null && before !== null && bothNameTheCriterion(after) && !bothNameTheCriterion(before) ? [{ path, ...budgetVerdict(record, TASKS) }] : [];
    });
    if (ofThisChange.length === 0) {
      expect.fail(`INCONCLUSIVE: no budget window has judged ${TASKS.join(' and ')} for ${CRITERION}: of the ${files.length} commit records under ${WINDOWS}/, none is of a commit whose budgets make both tasks name the criterion where its merge base's don't; this is not a pass`);
    }
    const said = ofThisChange.map(({ path, status, reasons }) => `${path} reads ${status}${reasons.length ? ` (${reasons.join('; ')})` : ''}`).join('; ');
    expect(ofThisChange.filter(({ status }) => status === 'FAIL').map(({ path, reasons }) => `${path}: ${reasons.join('; ')}`), `a budget window's record of this change reads ${TASKS.join(' or ')} past its margin of the merge base, a limit or a target`).toEqual([]);
    if (!ofThisChange.some(({ status }) => status === 'PASS')) {
      expect.fail(`${ofThisChange.some(({ status }) => status === 'BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE'}: no budget window's record of this change reads both ${TASKS.join(' and ')} PASS: ${said}; this is not a pass`);
    }
  }, TEST_DEADLINE_MS);
});
