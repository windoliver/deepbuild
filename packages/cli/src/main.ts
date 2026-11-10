#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verdict } from '@deepbuild/conformance';
// The conformance table, the contracts and the telemetry doctor load only in the commands that use them, so
// `deep inbox` starts without them (#24's budget).

// The Node its engines field names, checked before any command runs: an older Node loads node:sqlite as experimental,
// or not at all, and fails later in ways that name neither. Every module that needs it loads lazily, below.
const engines = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { engines: { node: string } }).engines.node;
const needed = engines.replace(/^>=\s*/, '');
if (process.versions.node.localeCompare(needed, undefined, { numeric: true }) < 0) {
  process.stderr.write(`deep needs Node ${needed} or newer; this is Node ${process.versions.node} at ${process.execPath}. Install a newer Node, or put one first on PATH.\n`);
  process.exit(2);
}

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
async function explain(session: string, json: boolean): Promise<number> {
  const dir = resolve(session);
  if (!existsSync(join(dir, 'session.json'))) {
    console.error(`deep explain: ${session} is not a recorded session folder; explaining a live session by ID needs the hub's record (#14, #16)`);
    return 2;
  }
  const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')) as { agent: string; version: string };
  const factsPath = `adapters/${meta.agent}.facts.json`;
  const facts: unknown = JSON.parse(readFileSync(join(root, factsPath), 'utf8'));
  const cases = jsonLines(join(dir, 'events.jsonl'));
  // The facts engine loads only here, so every other command starts without it.
  const { replaySession } = await import('../../../adapters/index.mjs');
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
  const { gzipSync } = await import('node:zlib');
  writeFileSync(path, gzipSync(JSON.stringify(bundle)), { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(path);
  return 0;
}

// `deep update --check` (#41): the manifest at DEEP_UPDATE_URL (the npm registry's latest `deepbuild` without it)
// fetched once; up to date only after a fetch that succeeded, and the last success's time kept in ~/.deepbuild.
async function updateCheck(): Promise<number> {
  const { checkForUpdate } = await import('./update-check.js');
  const url = process.env.DEEP_UPDATE_URL || 'https://registry.npmjs.org/deepbuild/latest';
  const check = await checkForUpdate({
    fetchManifest: async () => {
      const answer = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
      return (await answer.json()) as { version: string };
    },
    current: version(),
    statePath: join(homedir(), '.deepbuild', 'update-check.json'),
    now: () => new Date(),
  });
  console.log(check.line);
  return check.status === 'could-not-check' ? 1 : 0;
}

// Every command's usage as `deep --help` lists it, a line each, led by the commands it names.
const usage = [
  'deep doctor [--json] [--prompt]   --prompt also sends each signed-in agent one test prompt, which spends plan usage',
  'deep status [--json]   every session with its detail, ending on what needs you',
  'deep off | on   every gate watch-only, or back, once the OS confirms you',
  'deep explain <recorded session folder> [--json]',
  'deep run --result <run.finished event file>',
  'deep run follow <run>   a run\'s output from its start, then as it comes, until it ends',
  'deep hub run | start | status [--root <folder>]',
  'deep hub stop [--root <folder>]',
  'deep hub use --root <folder>   this worktree\'s sessions to a dev hub, once the OS confirms you',
  'deep fix <id>   work from an item at a source you switched on, such as LIN-42',
  'deep workspace new <topic> [--folder <path>] | move <id> <folder> | revert <id> <commit> | diff <id> | drift <id>   a home for work outside a repo',
  'deep setup [--undo]  install DeepBuild for Claude Code beside your settings, or remove it all once the OS confirms you',
  'deep mcp [actions]   the MCP server an agent starts, on stdio; actions serves deep-actions, the plug-ins\' actions',
  'deep env up | down [--root <folder>] [--json]   this worktree\'s stack, through the hub',
  'deep lease [kind...] -- <command>   a heavy build or test suite run under one cpu.slot and a lease on each kind, at a lower priority',
  'deep numbers [--json] | refresh | baseline <manifest> | sample <before date> [manifest]   your readings, each with its source and age',
  'deep show --doc <doc ID> --document <file> [--check] [--snap] [--claim <claim>] [--json]   a canvas document drawn in your layer, or in the agent\'s whose process tree runs it',
  'deep export --document <file> --still <frame | marker> --out <file.png>   one still of a document, drawn headless with no hub',
  'deep kinds --dump <folder> | --diff <a> <b>   the canvas core\'s whole listing as canonical JSON named by its module-set digest, or two such dumps diffed',
  'deep inbox [--json]   your open asks, each question first and its handle last',
  'deep open <address>   ask/<id>, session/<id>, project/<id> or page/<name> opened in the app, which opens and changes nothing',
  'deep inbox answer <ask> <option>   answer one, once the OS confirms you',
  'deep race <issue>   its sessions race: they settle on the first PASS and raise no "keep which?" ask',
  'deep inbox undo <ask>   open a defaulted ask again, once the OS confirms you',
  'deep start approve --repo <path> --issues <n,...> --agents <agent,...> --at-once <n> --plan-share <percent>   ask to approve a run of sessions started without your Send',
  'deep start --repo <path> --issue <n> --agent <agent> --prompt <words>   start one under it, in its own worktree',
  'deep gate rules [--json]   the rulesets that make only the gate\'s status count on your repo, for you to apply',
  'deep inbox save <offer>   save a permission you said yes to as a decision for its repo, once the OS confirms you',
  'deep install [--trust-key] <package folder>   its source and permissions, then installed once the OS confirms you',
  'deep guard add <file>   guard entries you wrote, each checked on its planted call and twin, added once the OS confirms you',
  'deep memory [--json]   what every agent\'s memory taught, ranked, for you to keep or remove',
  'deep memory keep | remove <lesson>   your decision on one, once the OS confirms you',
  'deep memory overrule <decision>   a rejection or a kept lesson undone, once the OS confirms you',
  'deep rules sync | reach --repo <folder> --scope <glob> | credit <rule>   the rules page: every rule you wrote and what enforces it',
  'deep session rules <session>   the set of rules a session runs under',
  'deep undo staged:<id>   a destructive command\'s run undone from the copy staged before it ran',
  'deep undo sync:<id>   an Agents page sync undone: each file put back where you haven\'t edited it since',
  'deep mcp-exec <name>   what an agent\'s entry for a synced MCP server runs: its command, its secrets by handle',
  'deep secret add <package> <name> | list [--json]   a package\'s secret, typed at your terminal and kept in the OS secret store',
  'deep join <repo link> --invite <invite>   a project\'s hub on another machine, from a clone of its repo',
  'deep backup <folder>   the record, its evidence and its wiki, copied through the running hub',
  'deep restore <folder>   a backup put back with the hub stopped, once the OS confirms you',
  'deep update --check   whether a newer DeepBuild is out',
  'deep debug bundle   redacted logs, versions and doctor output, for a bug report',
  'deep read <handle> [--slice [<cursor>]] [--json] [--root <folder>]   one slice of what a handle names',
  'deep find [<query>] [--file <path>] [--slice [<cursor>]] [--json] [--root <folder>]   handles whose text holds it; with --file, of sessions that read or edited it',
];
const commandsOf = (line: string) => /^deep ([a-z-]+(?: \| [a-z-]+)*)/.exec(line)![1]!.split(' | ');
const commands = [...new Set(usage.flatMap(commandsOf))];

// Help never acts (#1359): an agent asks a command for help before it uses it, so -h, --help or help anywhere in its
// arguments prints that command's usage before anything runs, setup included. Arguments after -- are another program's.
const helpWords = ['--help', '-h', 'help'];
const asksHelp = (args.includes('--') ? args.slice(0, args.indexOf('--')) : args).some((arg) => helpWords.includes(arg));
// The planted wrong program runs deep backup before its help check, so #1359's table must name it.
const help = asksHelp && !(args[0] === 'backup' && (await import('@deepbuild/hub')).activePlant() === 'dispatches-before-help');
// What a person runs first, then their work, then what developers run (#1455); a command no group names is a developer's.
const groups: [string, string[]][] = [
  ['Start here', ['setup', 'status', 'inbox', 'doctor', 'off', 'install', 'memory', 'secret', 'update']],
  ['Your work', ['open', 'fix', 'start', 'race', 'workspace', 'join', 'gate', 'rules', 'session', 'guard', 'undo', 'numbers', 'backup', 'restore', 'debug']],
  ['For developers', ['explain', 'run', 'hub', 'mcp', 'env', 'lease', 'show', 'export', 'kinds', 'mcp-exec', 'read', 'find']],
];
const groupOf = (line: string): number => {
  const at = groups.findIndex(([, names]) => names.includes(commandsOf(line)[0]!));
  return at < 0 ? groups.length - 1 : at;
};
function printHelp(): void {
  const lines = usage.filter((line) => commandsOf(line).includes(args[0] ?? ''));
  if (helpWords.includes(args[0]!) || args[0] === '--version') {
    console.log(`${banner()}\nUsage: deep [--help | --version]\n\n${groups.map(([title, names], at) => `${title}:\n${usage
      .filter((line) => groupOf(line) === at)
      .sort((a, b) => names.indexOf(commandsOf(a)[0]!) - names.indexOf(commandsOf(b)[0]!))
      .map((line) => `  ${line}`)
      .join('\n')}`).join('\n\n')}`);
  } else if (lines.length > 0) {
    console.log(`Usage: ${lines.join('\n       ')}`);
  } else {
    unsupported(args[0]!);
  }
}

// An unknown command names the nearest listed one, by the canvas's close names' distance and reach (#412,
// crates/deep-canvas/src/document/close.rs): an edit distance that counts a swap of two neighbours as one edit, within
// a third of the word's length, at least 1, the nearest first, then by name.
function distance(a: string, b: string): number {
  const [x, y] = [[...a], [...b]];
  const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[x.length]![y.length]!;
}
function unsupported(word: string): void {
  const reach = Math.max(1, Math.floor([...word].length / 3));
  process.exitCode = 2;
  // A listed command whose arguments matched none of its forms keeps the plain line.
  if (commands.includes(word)) return console.error('Unsupported command. Run deep --help for available commands.');
  const near = commands.map((command) => [distance(word, command), command] as const)
    .filter(([apart]) => apart <= reach).sort(([a, x], [b, y]) => a - b || (x < y ? -1 : 1))[0]?.[1];
  console.error(`Unsupported command ${JSON.stringify(word)}.${near ? ` Did you mean deep ${near}?` : ''} Run deep --help for available commands.`);
}

// The first `deep` command sets everything up, as the app's Set up click does (#326): in a home with nothing of
// DeepBuild, or one where a setup started and didn't finish (#1002, setup.ts), the commands you run yourself first run
// setup's steps without asking. The hub's modules load only then, so a set-up home starts as fast as before (#24's
// budget). deep env with --root names a dev hub and acts on it alone (#331), or is a usage error, so it sets nothing up
// in the home.
const yours = ['', 'status', 'inbox', 'secret', 'off', 'on', 'env', 'install', 'guard', 'memory'];
const devHub = args[0] === 'env' && args.includes('--root');
const installed = join(homedir(), '.deepbuild');
const unfinished = !existsSync(join(installed, 'setup-finished.json')) && (!existsSync(installed) || existsSync(join(installed, 'setup-stopped.json')));
if (!help && yours.includes(args[0] ?? '') && !devHub && unfinished) {
  const { setUpFirst } = await import('@deepbuild/hub');
  const code = await setUpFirst(fileURLToPath(import.meta.url));
  if (code !== 0) process.exit(code);
}

const hubCommands = {
  env: 'envCommand', gate: 'gateCommand', start: 'startCommand', inbox: 'inboxCommand', secret: 'secretCommand', race: 'raceCommand', fix: 'fixCommand',
  workspace: 'workspaceCommand', numbers: 'numbersCommand', show: 'showCommand', export: 'exportCommand', status: 'statusCommand', install: 'installCommand',
  undo: 'undoCommand',
  // A project's hub on another machine, joined with the repo link and an invite (#1338).
  join: 'joinCommand',
  guard: 'guardCommand', memory: 'memoryCommand',
} as const;

if (help) {
  printHelp();
} else if (args.length === 0) {
  // `deep` alone is the list (#1463): the rows and the one count the app shows, and nothing after them.
  const { listCommand } = await import('@deepbuild/hub');
  process.exitCode = await listCommand([]);
} else if (args[0] === 'doctor') {
  const { doctorCommand } = await import('@deepbuild/hub');
  process.exitCode = await doctorCommand(args.slice(1), telemetryItems);
} else if (args.length === 1 && args[0] === '--version') {
  console.log(version());
} else if (args[0] === 'explain' && args[1] && args.slice(2).every((arg) => arg === '--json')) {
  process.exitCode = await explain(args[1], args.includes('--json'));
} else if (args[0] === 'hub') {
  // Its own entry, loaded only for hub commands: every other command starts without the hub's modules, and the
  // running hub without the other commands'.
  const { hubCommand } = await import('@deepbuild/hub/hub');
  process.exitCode = await hubCommand(args.slice(1), fileURLToPath(import.meta.url));
} else if (args[0] === 'lease') {
  // Its own entry, so a leased command starts without the hub's module graph.
  const { leaseCommand } = await import('@deepbuild/hub/lease');
  process.exitCode = await leaseCommand(args.slice(1));
} else if (Object.hasOwn(hubCommands, args[0]!)) {
  const hub = await import('@deepbuild/hub');
  process.exitCode = await hub[hubCommands[args[0] as keyof typeof hubCommands]](args.slice(1));
} else if (args[0] === 'setup') {
  const { setupCommand } = await import('@deepbuild/hub');
  process.exitCode = await setupCommand(fileURLToPath(import.meta.url), args.slice(1));
} else if (args.length === 1 && (args[0] === 'off' || args[0] === 'on')) {
  const { gatesCommand } = await import('@deepbuild/hub');
  process.exitCode = await gatesCommand(args[0] === 'off');
} else if (args[0] === 'kinds' && (args[1] === '--dump' || args[1] === '--diff')) {
  const { kindsCommand } = await import('@deepbuild/hub');
  process.exitCode = await kindsCommand(args.slice(1));
} else if (args.length === 1 && args[0] === 'waiter') {
  const { waiterCommand } = await import('@deepbuild/hub');
  process.exitCode = await waiterCommand();
} else if (args[0] === 'backup' || args[0] === 'restore') {
  const { backupCommand, restoreCommand } = await import('@deepbuild/hub');
  process.exitCode = await (args[0] === 'backup' ? backupCommand : restoreCommand)(args.slice(1));
} else if (args[0] === 'rules' || (args[0] === 'session' && args[1] === 'rules')) {
  // The rules page (#344): `deep rules sync | reach | credit`, and the set one session runs under.
  const { rulesCommand } = await import('@deepbuild/hub');
  process.exitCode = await rulesCommand(args[0] === 'rules' ? args.slice(1) : ['session', ...args.slice(2)]);
} else if (args[0] === 'mcp' && (args.length === 1 || (args.length === 2 && args[1] === 'actions'))) {
  // Its own entry: an agent keeps its deep mcp open all session, and the hub's whole module graph would ride along.
  const { runMcp } = await import('@deepbuild/hub/mcp');
  process.exitCode = await runMcp(args[1] === 'actions' ? 'deep-actions' : 'deep');
} else if (args[0] === 'mcp-exec') {
  // Its own entry, as deep mcp's: an agent starts it for each synced server that takes secrets (#148).
  const { mcpExecCommand } = await import('@deepbuild/hub/mcp-exec');
  process.exitCode = await mcpExecCommand(args.slice(1));
} else if (args[0] === 'open' && args.length === 2) {
  // Issue #1460: the address goes to the running app over its own socket, so the hub records nothing.
  const { connect } = await import('node:net');
  process.exitCode = await new Promise<number>((done) => {
    const app = connect(join(homedir(), '.deepbuild', 'app.sock'));
    let reply = '';
    app.setTimeout(5000, () => app.destroy(Error('timed out')));
    app.on('connect', () => app.write(`${args[1]}\n`));
    app.on('data', (data) => { reply += data; });
    app.on('error', () => { console.error('deep open: the app is not running'); done(1); });
    app.on('close', (failed) => {
      if (failed) return;
      console.log(reply.trim());
      done(reply.startsWith('opened ') ? 0 : 1);
    });
  });
} else if (args[0] === 'read' || args[0] === 'find') {
  // Read-only over the hub's root (#63), with or without the hub running.
  const { findCommand, readCommand } = await import('@deepbuild/reading');
  process.exitCode = await (args[0] === 'read' ? readCommand : findCommand)(args.slice(1));
} else if (args.length === 2 && args[0] === 'update' && args[1] === '--check') {
  process.exitCode = await updateCheck();
} else if (args.length === 2 && args[0] === 'debug' && args[1] === 'bundle') {
  process.exitCode = await debugBundle();
} else if (args[0] === 'run' && args[1] === '--result' && args[2] && args.length === 3) {
  process.exitCode = await run(args[2]);
} else if (args[0] === 'run' && args[1] === 'follow' && args[2] && args.length === 3) {
  const { followCommand } = await import('@deepbuild/hub');
  process.exitCode = await followCommand(args[2]);
} else if (args[0] === 'run') {
  console.error('Usage: deep run --result <run.finished event file>\n       deep run follow <run>');
  process.exitCode = 2;
} else {
  unsupported(args[0]!);
}
