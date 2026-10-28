#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { Verdict } from '@deepbuild/conformance';
import { replaySession } from '../../../adapters/index.mjs';
// The conformance table, the contracts and the telemetry doctor load only in the commands that use them, so
// `deep inbox` starts without them (#24's budget).

const args = process.argv.slice(2);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const jsonLines = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>) : []);
const version = () => (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

// The one-line banner (#79): the name and version, with the kit's small mark before them where the
// terminal can show an image. The mark is brand/png/favicon-32.png read as it is (the small cut on
// its Ink tile, shown at 16 pt), sent with iTerm2's inline-image escape or kitty's graphics
// protocol, each recognised by the terminal's own identification. Any other terminal, and any
// pipe, gets the text alone, with no escape at all.
function banner(): string {
  const text = `DeepBuild ${version()}`;
  if (!process.stdout.isTTY) return text;
  const { TERM = '', TERM_PROGRAM = '', LC_TERMINAL = '' } = process.env;
  const mark = () => readFileSync(join(root, 'brand/png/favicon-32.png')).toString('base64');
  if (TERM_PROGRAM === 'iTerm.app' || LC_TERMINAL === 'iTerm2') return `\x1b]1337;File=inline=1;width=2;height=1;preserveAspectRatio=1:${mark()}\x07 ${text}`;
  if (TERM === 'xterm-kitty') {
    const chunks = mark().match(/.{1,4096}/g) ?? [];
    const image = chunks.map((chunk, index) => `\x1b_G${index === 0 ? 'a=T,f=100,c=2,r=1,q=2,' : ''}m=${index < chunks.length - 1 ? 1 : 0};${chunk}\x1b\\`).join('');
    return `${image} ${text}`;
  }
  return text;
}

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
async function run(path: string): Promise<number> {
  const { exitCode, judge } = await import('@deepbuild/conformance');
  const { validate } = await import('@deepbuild/contracts');
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

// The doctor's items (#19), the telemetry receiver's (#42) beside the hub's.
async function doctorItems(prompt: boolean) {
  const { doctorItems: items } = await import('@deepbuild/hub');
  return [...(await items(process.env, { prompt, cwd: process.cwd() })), ...(await telemetryItems())];
}
async function telemetryItems() {
  const { doctor: telemetryDoctor } = await import('@deepbuild/otlp');
  return telemetryDoctor(process.env);
}

// `deep debug bundle`: the hub's logs, the versions and the doctor's items in one gzipped JSON file under
// ~/.deepbuild/debug, readable only by you, its path printed last. Every text in it is scrubbed as evidence is,
// with the control token among the values held, so no form of the token or of a secret-shaped string goes in
// (#34's slice of #19's bundle).
async function debugBundle(): Promise<number> {
  const { scrubText } = await import('@deepbuild/evidence');
  const root = join(homedir(), '.deepbuild');
  const token = existsSync(join(root, 'control.token')) ? readFileSync(join(root, 'control.token'), 'utf8').trim() : '';
  // The values the hub holds by handle, as a test names them (DEEP_HUB_TEST_HELD), are scrubbed here too.
  const held = [token, ...(process.env.DEEP_HUB_TEST_HELD && existsSync(process.env.DEEP_HUB_TEST_HELD) ? readFileSync(process.env.DEEP_HUB_TEST_HELD, 'utf8').split('\n').map((v) => v.trim()) : [])].filter(Boolean);
  // The planted wrong program copies the logs as they are.
  const { activePlant } = await import('@deepbuild/hub');
  const scrubLogs = process.env.DEEP_CLI_PLANT === 'bundle-raw-logs' || activePlant() === 'bundle-raw-logs' ? (text: string) => text : (text: string) => scrubText(text, { held });
  const scrub = (text: string) => scrubText(text, { held });
  const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  }) : []);
  const logs = Object.fromEntries(files(join(root, 'logs')).map((path) => [relative(root, path), scrubLogs(readFileSync(path, 'utf8'))]));
  const bundle = {
    versions: { deepbuild: version(), node: process.version, platform: `${process.platform}-${process.arch}` },
    doctor: (await doctorItems(false)).map((item) => JSON.parse(scrub(JSON.stringify(item))) as unknown),
    logs,
  };
  const dir = join(root, 'debug');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  writeFileSync(path, gzipSync(JSON.stringify(bundle)), { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(path);
  return 0;
}

if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log(`${banner()}\nUsage: deep [--help | --version]\n       deep doctor [--json] [--prompt]   --prompt also sends each signed-in agent one test prompt, which spends plan usage\n       deep status  every session, what needs you first\n       deep off | on   every gate watch-only, or back, once the OS confirms you\n       deep explain <recorded session folder> [--json]\n       deep run --result <run.finished event file>\n       deep hub run | start | status [--root <folder>]\n       deep hub stop [--root <folder>]\n       deep hub use --root <folder>   this worktree's sessions to a dev hub, once the OS confirms you\n       deep setup [--undo]  install DeepBuild for Claude Code beside your settings, or remove it all once the OS confirms you\n       deep waiter the background Stop entry that wakes an idle session with your answer\n       deep mcp    the MCP server an agent starts, on stdio\n       deep env up | down [--root <folder>] [--json]   this worktree's stack, through the hub\n       deep inbox  your open asks\n       deep inbox answer <ask> <option>   answer one, once the OS confirms you\n       deep inbox undo <ask>   open a defaulted ask again, once the OS confirms you\n       deep install [--trust-key] <package folder>   its source and permissions, then installed once the OS confirms you\n       deep guard add <file>   guard entries you wrote, each checked on its planted call and twin, added once the OS confirms you\n       deep debug bundle   redacted logs, versions and doctor output, for a bug report\n       deep read <handle> [--slice [<cursor>]] [--json] [--root <folder>]   one slice of what a handle names\n       deep find <query> [--slice [<cursor>]] [--json] [--root <folder>]   handles whose text holds it\n\nRepository skeleton.`);
} else if (args[0] === 'doctor') {
  const { doctorCommand } = await import('@deepbuild/hub');
  process.exitCode = await doctorCommand(args.slice(1), telemetryItems);
} else if (args.length === 1 && args[0] === '--version') {
  console.log(version());
} else if (args[0] === 'explain' && args[1] && args.slice(2).every((arg) => arg === '--json')) {
  process.exitCode = explain(args[1], args.includes('--json'));
} else if (args[0] === 'hub') {
  // Loaded only for hub commands, so every other command starts without the hub's modules.
  const { hubCommand } = await import('@deepbuild/hub');
  process.exitCode = await hubCommand(args.slice(1), fileURLToPath(import.meta.url));
} else if (args[0] === 'env') {
  const { envCommand } = await import('@deepbuild/hub');
  process.exitCode = await envCommand(args.slice(1));
} else if (args[0] === 'inbox') {
  const { inboxCommand } = await import('@deepbuild/hub');
  process.exitCode = await inboxCommand(args.slice(1));
} else if (args[0] === 'setup') {
  const { setupCommand } = await import('@deepbuild/hub');
  process.exitCode = await setupCommand(fileURLToPath(import.meta.url), args.slice(1));
} else if (args.length === 1 && (args[0] === 'off' || args[0] === 'on')) {
  const { gatesCommand } = await import('@deepbuild/hub');
  process.exitCode = await gatesCommand(args[0] === 'off');
} else if (args[0] === 'status') {
  const { statusCommand } = await import('@deepbuild/hub');
  process.exitCode = await statusCommand(args.slice(1));
} else if (args.length === 1 && args[0] === 'waiter') {
  const { waiterCommand } = await import('@deepbuild/hub');
  process.exitCode = await waiterCommand();
} else if (args[0] === 'install') {
  const { installCommand } = await import('@deepbuild/hub');
  process.exitCode = await installCommand(args.slice(1));
} else if (args[0] === 'guard') {
  const { guardCommand } = await import('@deepbuild/hub');
  process.exitCode = await guardCommand(args.slice(1));
} else if (args.length === 1 && args[0] === 'mcp') {
  const { runMcp } = await import('@deepbuild/hub');
  process.exitCode = await runMcp();
} else if (args[0] === 'read' || args[0] === 'find') {
  // Read-only over the hub's root (#63), with or without the hub running.
  const { findCommand, readCommand } = await import('@deepbuild/reading');
  process.exitCode = await (args[0] === 'read' ? readCommand : findCommand)(args.slice(1));
} else if (args.length === 2 && args[0] === 'debug' && args[1] === 'bundle') {
  process.exitCode = await debugBundle();
} else if (args[0] === 'run' && args[1] === '--result' && args[2] && args.length === 3) {
  process.exitCode = await run(args[2]);
} else if (args[0] === 'run') {
  console.error('Usage: deep run --result <run.finished event file>');
  process.exitCode = 2;
} else {
  console.error('Unsupported command. Run deep --help for available commands.');
  process.exitCode = 2;
}
