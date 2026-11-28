import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inconclusive } from '../148/helpers.ts';
import { AC9, REPO, call, gitRepo, script, skillTree, start, world } from './helpers.ts';

interface Task { id: string; command: string[]; margin?: number; criteria?: string[]; initialReason?: string }
interface Load { start: number; end: number }

const BASE_MEDIAN_MS = 44_009;
const MARGIN = 0.5;
const FILES = 200;

function lane(code: string, input: unknown): Record<string, unknown> {
  const program = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

function twoHundredFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 1; i < FILES; i++) {
    files[i % 4 === 0 ? `scripts/step-${i}.sh` : `notes/part-${i}.md`] = i % 4 === 0
      ? script(...Array.from({ length: 40 }, (_, n) => `echo "step ${i} line ${n}" >> notes.log`))
      : `# Part ${i}\n\n${Array.from({ length: 40 }, (_, n) => `Line ${n} of part ${i}: say what changed and why.`).join('\n')}\n\n\`\`\`sh\ngit log --oneline -n ${i}\n\`\`\`\n`;
  }
  return skillTree(files);
}

describe(`AC9 ${AC9} the audit of a 200-file skill stays within its margin of the merge base`, () => {
  it(`AC9 ${AC9} the perf lane has a task naming this criterion, valid against the merge base's budgets, and each such task runs`, () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    const established = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 })) as unknown;
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current, base: established }), "the lane's validator accepts budgets.json against the merge base's").toBe('valid');
    const tasks = current.tasks.filter((t) => t.criteria?.includes(AC9));
    expect(tasks.length, `benchmarks/budgets.json has a task whose criteria name ${AC9}, timing the audit of a ${FILES}-file skill against the merge base: it has none`).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.margin, `${t.id} compares with the merge base within a margin`).toBeGreaterThan(0);
      expect(String(t.initialReason), `${t.id} says why, naming #3235`).toMatch(/#3235\b/);
      const [cmd, ...args] = t.command;
      const ran = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 1 << 26 });
      expect(ran.status, `the perf lane's task ${t.id} (${t.command.join(' ')}) runs and exits 0: ${(ran.stderr ?? '').slice(-1500)}`).toBe(0);
    }
  }, 3_600_000);

  it(`AC9 ${AC9} proposing a ${FILES}-file skill, five runs after a warm-up, stays within ${MARGIN * 100}% of the merge base's median`, async () => {
    const w = world();
    await start(w);
    const files = twoHundredFiles();
    expect(Object.keys(files), `the skill holds ${FILES} files`).toHaveLength(FILES);
    const r = gitRepo(w, 'source', files);
    const propose = async (): Promise<number> => {
      const t = performance.now();
      const p = await call(w, 'agents.propose', { via: 'app', agents: ['claude-code'], skill: { repo: r.dir, commit: r.commit, path: 'skills/shipnotes' } }, 600_000);
      expect(typeof p.ask, 'the 200-file skill is planned').toBe('string');
      return performance.now() - t;
    };
    await propose();
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      const startLoad = loadavg()[0]!;
      runs.push(await propose());
      loads.push({ start: startLoad, end: loadavg()[0]! });
    }
    const limit = BASE_MEDIAN_MS * (1 + MARGIN);
    const verdict = lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads });
    const line = `AC9 ${FILES}-file skill audit: ${String(verdict.status)} ${runs.map((x) => x.toFixed(1)).join(', ')} ms against ${limit.toFixed(1)} ms (merge base median ${BASE_MEDIAN_MS} ms + ${MARGIN * 100}%), load ${loads.map((l) => `${l.start.toFixed(1)}-${l.end.toFixed(1)}`).join(', ')}${verdict.reason ? ` (${String(verdict.reason)})` : ''}`;
    console.log(line);
    expect(verdict.status, line).not.toBe('FAIL');
    if (verdict.status !== 'PASS') inconclusive(line);
  }, 1_800_000);
});
