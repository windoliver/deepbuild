#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, judge, type Verdict } from '@deepbuild/conformance';
import { validate } from '@deepbuild/contracts';
import { replaySession } from '../../../adapters/index.mjs';

const args = process.argv.slice(2);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const jsonLines = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>) : []);

// Why each event of a recorded session was read the way it was: the facts entry that mapped it and
// the agent version behind it. A live session's ID needs the hub's record, which doesn't exist yet.
function explain(session: string, json: boolean): number {
  const dir = resolve(session);
  if (!existsSync(join(dir, 'session.json'))) {
    console.error(`deep explain: ${session} is not a recorded session folder; explaining a live session by ID needs the hub's record (#14, #16)`);
    return 2;
  }
  const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as { agent: string; version: string };
  const factsPath = `adapters/${meta.agent}.facts.json`;
  const facts: unknown = JSON.parse(readFileSync(join(root, factsPath), 'utf8'));
  const cases = jsonLines(join(dir, 'events.jsonl'));
  const replayed = replaySession({ facts, version: meta.version, payloads: cases.map((recorded) => recorded.payload as Record<string, unknown>), transcript: jsonLines(join(dir, 'transcript.jsonl')) });
  replayed.payloads.forEach(({ events, verified }, index) => {
    const hook = String((cases[index]?.payload as Record<string, unknown>).hook_event_name);
    for (const { kind, rule } of events) {
      const line = { line: index + 1, hook, kind, rule, facts: factsPath, version: meta.version, verified };
      console.log(json ? JSON.stringify(line) : `events.jsonl:${line.line} ${hook} -> ${kind} by ${factsPath}#${rule} (${meta.agent} ${meta.version}${verified ? '' : ', unverified'})`);
    }
  });
  return 0;
}

// A recorded run result read by the one code table (#313): the file held to run.finished@1, its outcome
// judged by that schema's enum, and the exit status 0, 1 or 3 by the verdict. A code the enum doesn't list,
// a result the schema refuses, a file that isn't JSON and a pass that ran no tests are INVALID, never a pass.
function run(path: string): number {
  const file = resolve(path);
  if (!existsSync(file)) {
    console.error(`deep run: no result at ${file}`);
    return 2;
  }
  const verdict = (outcome: Verdict, message: string): number => {
    console.log(`${outcome} ${message}`);
    return exitCode([outcome]);
  };
  let result: unknown;
  try {
    result = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return verdict('INVALID', `${file} is not a readable JSON run result: ${error instanceof Error ? error.message : String(error)}`);
  }
  const data = typeof result === 'object' && result !== null && !Array.isArray(result) ? (result as { data?: unknown }).data : undefined;
  const outcome = typeof data === 'object' && data !== null ? (data as { outcome?: unknown }).outcome : undefined;
  const judged = judge('run', typeof outcome === 'string' ? outcome : JSON.stringify(outcome) ?? '');
  if (!judged.listed) return verdict(judged.verdict, judged.message);
  const held = validate('run.finished@1', result);
  if (!held.ok) return verdict('INVALID', `${file} is not a run.finished@1 event: ${held.issues.map((issue) => `${issue.code} at ${issue.path || '/'}`).join(', ')}`);
  // A finding written as one identifier (trimmed) is a check code, judged by its own family, an unlisted one
  // INVALID naming it; a finding in words, or a place such as a file and line, is the check's prose. The verdict is the worst of the outcome and the codes, FAIL first,
  // as the exit table takes it.
  const counts = data as { tests_run: number; passed: number; runs: number; findings: string[] };
  // A finding led by a listed code and a colon ("exit_masked: npm test") is that code with its detail.
  const codeOf = (finding: string): string | undefined => {
    const text = finding.trim();
    if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(text)) return text;
    const lead = /^([A-Za-z][A-Za-z0-9_.-]*):/.exec(text)?.[1];
    return lead !== undefined && judge('check', lead).listed ? lead : undefined;
  };
  const judgements = [judged, ...counts.findings.flatMap((finding) => { const code = codeOf(finding); return code === undefined ? [] : [judge('check', code)]; })];
  const order: Verdict[] = ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'PASS'];
  const worst = [...judgements].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))[0]!;
  if (worst.verdict !== 'PASS') return verdict(worst.verdict, judgements.filter((j) => j.verdict !== 'PASS').map((j) => j.message).join('; '));
  if (counts.tests_run === 0 || counts.runs < 1) return verdict('INVALID', 'run outcome passed with no tests run: a run that ran nothing proves nothing');
  if (counts.passed !== counts.tests_run) return verdict('INVALID', `run outcome passed with ${counts.passed} of ${counts.tests_run} tests passing: the counts don't agree with the outcome`);
  return verdict(judged.verdict, judged.message);
}

if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log('Usage: deep [--help | --version]\n       deep explain <recorded session folder> [--json]\n       deep run --result <run.finished event file>\n\nRepository skeleton. Hub commands are not implemented yet.');
} else if (args.length === 1 && args[0] === '--version') {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(manifest.version);
} else if (args[0] === 'explain' && args[1] && args.slice(2).every((arg) => arg === '--json')) {
  process.exitCode = explain(args[1], args.includes('--json'));
} else if (args[0] === 'run' && args[1] === '--result' && args[2] && args.length === 3) {
  process.exitCode = run(args[2]);
} else if (args[0] === 'run') {
  console.error('Usage: deep run --result <run.finished event file>');
  process.exitCode = 2;
} else {
  console.error('Unsupported command. Run deep --help for available commands.');
  process.exitCode = 2;
}
