#!/usr/bin/env node
import { chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
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
const numbers = (version: string) => version.split('.', 3).map((part) => Number.parseInt(part, 10) || 0);
const [found, wanted] = [numbers(process.versions.node), numbers(needed)];
const apart = [0, 1, 2].find((at) => found[at] !== wanted[at]);
if (apart !== undefined && (found[apart] ?? 0) < (wanted[apart] ?? 0)) {
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
  const { exitCode, judge, worst } = await import('@deepbuild/conformance');
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
  // INVALID naming it; a finding in words, or a place such as a file and line, is the check's prose. The verdict is the worst of the outcome and the codes, by
  // conformance's precedence (#1882): the CLI keeps no order of its own.
  const counts = data as { tests_run: number; passed: number; runs: number; findings: string[] };
  // A finding led by a listed code and a colon ("exit_masked: npm test") is that code with its detail.
  const codeOf = (finding: string): string | undefined => {
    const text = finding.trim();
    if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(text)) return text;
    const lead = /^([A-Za-z][A-Za-z0-9_.-]*):/.exec(text)?.[1];
    return lead !== undefined && judge('check', lead).listed ? lead : undefined;
  };
  const judgements = [judged, ...counts.findings.flatMap((finding) => { const code = codeOf(finding); return code === undefined ? [] : [judge('check', code)]; })];
  const decided = worst(judgements.map((j) => j.verdict));
  if (decided !== 'PASS') return verdict(decided, judgements.filter((j) => j.verdict !== 'PASS').map((j) => j.message).join('; '));
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

/** What the bundle reads of a log at most, in bytes, from its end (#3548). */
const LOG_END = 8_000_000;
/**
 * A log's end: its last `LOG_END` bytes from the first start of a line among them, and how many bytes before that were
 * left out. The log is never read whole. The planted wrong program cuts by bytes alone.
 */
function logEnd(path: string, byBytes: boolean): { text: string; left_out: number } {
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const size = fstatSync(fd).size;
      const cut = Math.max(0, size - LOG_END);
      // The byte before the cut is read too: a line starts after the first newline from there.
      const from = Math.max(0, cut - 1);
      const end = Buffer.allocUnsafe(size - from);
      let got = 0;
      for (let n = 1; n > 0 && got < end.length; got += n) n = readSync(fd, end, got, end.length - got, from + got);
      // A log the hub cut while it was read comes short, and is read again: its last line is whole too.
      if (got < end.length) continue;
      const start = cut === 0 ? 0 : byBytes ? 1 : end.indexOf(10) + 1 || got;
      return { text: end.toString('utf8', start), left_out: from + start };
    }
  } finally {
    closeSync(fd);
  }
}

// `deep debug bundle`: the end of each of the hub's logs, the versions and the doctor's items in one gzipped JSON file
// under ~/.deepbuild/debug, readable only by you, its path printed last. Every text in it is scrubbed as evidence is,
// with the control token among the values held, so no form of the token or of a secret-shaped string goes in
// (#34's slice of #19's bundle). A log is cut before it is scrubbed, at the start of a line, so the cut never splits
// a line a value is on, and the bundle says how many bytes of each log it left out (#3548).
async function debugBundle(): Promise<number> {
  const { scrubText } = await import('@deepbuild/evidence');
  const { activePlant, rootOf, rootToken } = await import('@deepbuild/hub');
  const root = join(homedir(), '.deepbuild');
  let token = '';
  try { token = rootToken(rootOf(root)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // The values the hub holds by handle, as a test names them (DEEP_HUB_TEST_HELD), are scrubbed here too.
  const held = [token, ...(process.env.DEEP_HUB_TEST_HELD && existsSync(process.env.DEEP_HUB_TEST_HELD) ? readFileSync(process.env.DEEP_HUB_TEST_HELD, 'utf8').split('\n').map((v) => v.trim()) : [])].filter(Boolean);
  // The planted wrong program copies the logs as they are.
  const scrubLogs = process.env.DEEP_CLI_PLANT === 'bundle-raw-logs' || activePlant() === 'bundle-raw-logs' ? (text: string) => text : (text: string) => scrubText(text, { held });
  const scrub = (text: string) => scrubText(text, { held });
  const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  }) : []);
  // Each log's end is scrubbed as it is read, so no log's raw text waits for the others.
  const ends = files(join(root, 'logs')).map((path) => {
    const end = logEnd(path, process.env.DEEP_CLI_PLANT === 'bundle-cuts-by-bytes');
    return { name: relative(root, path), text: scrubLogs(end.text), left_out: end.left_out };
  });
  const bundle = {
    versions: { deepbuild: version(), node: process.version, platform: `${process.platform}-${process.arch}` },
    doctor: (await doctorItems(false)).map((item) => JSON.parse(scrub(JSON.stringify(item))) as unknown),
    logs: Object.fromEntries(ends.map((end) => [end.name, end.text])),
    logs_left_out: Object.fromEntries(ends.map((end) => [end.name, end.left_out])),
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
  // A check that couldn't reach the registry decided nothing: 3, not checked (#1812).
  return check.status === 'could-not-check' ? 3 : 0;
}

// Every command's usage as `deep --help` lists it, a line each, led by the commands it names.
const usage = [
  'deep doctor [--json] [--prompt]   --prompt also sends each signed-in agent one test prompt, which spends plan usage',
  'deep status [--json]   every session with its detail, ending on what needs you',
  'deep status <session> --why [--json]   why that session reads as it does: the one sentence, each record fact it was read from, and what each higher state lacked',
  'deep off | on   every gate watch-only, or back, once the OS confirms you',
  'deep explain <recorded session folder> [--json]',
  'deep run --result <run.finished event file>',
  'deep run follow <run>   a run\'s output from its start, then as it comes, until it ends',
  'deep host run <ask> | changes <host> | remove <host> | list | facts <host> [--refresh] | add <host>   run a root plan you said yes to, in this terminal; list a host\'s changes with their undo; undo them, yours as you and root\'s as one root plan; the hosts your SSH config names, and one\'s facts; or install deep-hook and the agents\' hooks on one, so its sessions record here under its name',
  'deep hub run [--safe] | start | status [--root <folder>]   status prints the hub\'s health as JSON, a developer\'s command',
  'deep hub stop [--root <folder>]',
  'deep hub use --root <folder>   this worktree\'s sessions to a dev hub, once the OS confirms you',
  'deep fix <id> [--json]   work from an item at a source you switched on, such as LIN-42',
  'deep land [judge] --repo <checkout> [--json]   judge each open PR on its merge with main, or land the PASSes one at a time in the order they came',
  'deep work "<scope>" [--repo <checkout>] [--json]   one approval for a run over the issues your words name, or a standing run over a rule on labels, milestone or epic that new issues join; show prints each one\'s state word and what it waits for, pause stops new starts',
  'deep work --repo <checkout> --issues <n,...> --once [--json]   one pass of a run over a fixed set: an earlier PR joins as its issue\'s attempt',
  'deep workspace new <topic> [--folder <path>] | task <id> <title> --criterion <text> ... [--blocked-by <n> ...] | move <id> <folder | repo checkout> | revert <id> [<commit>] | diff <id> | drift <id> [--json]   a home for work outside a repo, its tasks in the record',
  'deep setup [--undo]  install DeepBuild for Claude Code beside your settings, or remove it all once the OS confirms you',
  'deep mcp [actions]   the MCP server an agent starts, on stdio; actions serves deep-actions, the plug-ins\' actions',
  'deep env up | down [--root <folder>] [--json]   this worktree\'s stack, through the hub',
  'deep lease [kind...] -- <command>   a heavy build or test suite run under one cpu.slot and a lease on each kind, at a lower priority',
  'deep numbers [--json] | refresh [--json] | baseline <manifest> | sample <before date> [manifest]   your readings, each with its source and age',
  'deep show --doc <doc ID> --document <file> [--removes id,id] [--t <time>] [--size WxH] [--include issues,audit,timing,pixels] [--check] [--snap] [--claim <claim>] [--json]   a canvas document drawn in your layer, or in the agent\'s whose process tree runs it',
  'deep export --document <file> --still <frame | marker> --out <file.png>   one still of a document, drawn headless with no hub',
  'deep kinds --dump <folder> | --diff <a> <b>   the canvas core\'s whole listing as canonical JSON named by its module-set digest, or two such dumps diffed',
  'deep inbox [--json]   your open asks, each question first and its handle last',
  'deep open <address>   ask/<id>, session/<id>, project/<id> or page/<name> opened in the app, which opens and changes nothing',
  'deep inbox answer <ask> [--] <option>   answer one, once the OS confirms you, with an option as deep inbox printed it',
  'deep race <issue>   its sessions race: they settle on the first PASS and raise no "keep which?" ask',
  'deep inbox undo <ask>   open a defaulted ask again, or withdraw your yes while its step that can\'t be undone waits out its hold, once the OS confirms you',
  'deep start approve --repo <path> --issues <n,...> --agents <agent,...> [--home <agent>=<folder> ...] [--mode <agent>=<mode> ...] --at-once <n> --plan-share <percent> [--until <ISO time>] [--host <host> ...] [--json]   ask to approve a run of sessions started without your Send',
  'deep start --repo <path> --issue <n> --agent <agent> [--mode <mode>] --prompt <words> [--json]   start one under it, in its own worktree',
  'deep gate rules [--json]   the rulesets that make only the gate\'s status count on your repo, for you to apply',
  'deep inbox save <offer>   save a permission you said yes to as a decision for its repo, once the OS confirms you',
  'deep install [--trust-key] <package folder>   its source and permissions, then installed once the OS confirms you',
  'deep guard add <file>   guard entries you wrote, each checked on its planted call and twin, added once the OS confirms you',
  'deep memory [--json]   what every agent\'s memory taught, ranked, for you to keep or remove',
  'deep memory keep | remove <lesson>   your decision on one, once the OS confirms you',
  'deep memory overrule <decision>   a rejection or a kept lesson undone, once the OS confirms you',
  'deep rules sync [--json] | reach --repo <folder> --scope <glob> [--json] | credit <rule> [--json]   the rules page: every rule you wrote and what enforces it',
  'deep session rules <session> [--json]   the set of rules a session runs under',
  'deep undo staged:<id>   a destructive command\'s run undone from the copy staged before it ran',
  'deep undo sync:<id>   an Agents page sync undone: each file put back where you haven\'t edited it since',
  'deep mcp-exec <name>   what an agent\'s entry for a synced MCP server runs: its command, its secrets by handle',
  'deep secret add <package> <name> | list [--json]   a package\'s secret, typed at your terminal and kept in the OS secret store',
  'deep join <repo link> --invite <invite>   a project\'s hub on another machine, from a clone of its repo',
  'deep person invite <login> --address <host>:<port> | revoke <login>   a one-time invite to this clone\'s project, for deep join; or a person\'s credentials ended, once the OS confirms you',
  'deep library on <library> | off <library> | rule <library> <license>...   an installed model library in or out of your agents\' asset search, and the licenses it fetches under with no ask, once the OS confirms you',
  'deep pack rule <owner/name> <license>...   the licenses an installed pack fetches its assets under with no ask, once the OS confirms you',
  'deep job rule <tool@version> <usd>   the most a run of a paid tool may cost with no ask, once the OS confirms you',
  'deep backup <folder>   the record, its evidence and its wiki, copied through the running hub',
  'deep restore <folder>   a backup put back with the hub stopped, once the OS confirms you',
  'deep update --check   whether a newer DeepBuild is out',
  'deep debug bundle   redacted logs, versions and doctor output, for a bug report',
  'deep read <handle> [--slice [<cursor>]] [--json] [--root <folder>] [-- <what>]   one slice of what a handle names',
  'deep find [<query>] [--file <path>] [--slice [<cursor>]] [--json] [--root <folder>] [-- <what>]   handles whose text holds it; with --file, of sessions that read or edited it',
];
const commandsOf = (line: string) => /^deep ([a-z-]+(?: \| [a-z-]+)*)/.exec(line)![1]!.split(' | ');
const commands = [...new Set(usage.flatMap(commandsOf))];

// Help never acts (#1359): an agent asks a command for help before it uses it, so -h or --help anywhere in its arguments
// prints that command's usage before anything runs, setup included. Arguments after -- are another program's. The word
// help asks only as `deep help`: after a command it is an argument like any other, a word to find or a name (#1812).
const helpWords = ['--help', '-h', 'help'];
const asksHelp = args[0] === 'help' || (args.includes('--') ? args.slice(0, args.indexOf('--')) : args).some((arg) => arg === '--help' || arg === '-h');
// The planted wrong program runs deep backup before its help check, so #1359's table must name it.
const help = asksHelp && !(args[0] === 'backup' && (await import('@deepbuild/hub')).activePlant() === 'dispatches-before-help');
// What a person runs first, then their work, then what developers run (#1455); a command no group names is a developer's.
const groups: [string, string[]][] = [
  ['Start here', ['setup', 'status', 'inbox', 'doctor', 'off', 'install', 'memory', 'secret', 'update']],
  ['Your work', ['open', 'fix', 'start', 'race', 'land', 'work', 'workspace', 'join', 'person', 'gate', 'rules', 'session', 'guard', 'undo', 'numbers', 'backup', 'restore', 'debug', 'host', 'library', 'pack', 'job']],
  ['For developers', ['explain', 'run', 'hub', 'mcp', 'env', 'lease', 'show', 'export', 'kinds', 'mcp-exec', 'read', 'find']],
];
const groupOf = (line: string): number => {
  const at = groups.findIndex(([, names]) => names.includes(commandsOf(line)[0]!));
  return at < 0 ? groups.length - 1 : at;
};
// A flag that takes a value, given twice where no form of its command shows it repeating, fits none of the command's
// forms (#3461): one reading for every command, so none takes the first or the last value. Each flag of a form is read
// from its usage line, up to the description: a flag followed by a value, then `...` where it repeats. A flag with no
// value, such as --json, is read by its command as before. The forms read are those whose leading words fit the
// arguments' (`deep start approve` or `deep start`), else all of the command's. Returned: each value flag and whether it
// repeats, and the flags whose value may be left out (`--slice [<cursor>]`).
const valueFlags = (args: readonly string[]): [Map<string, boolean>, Set<string>] => {
  const repeats = new Map<string, boolean>();
  const optional = new Set<string>();
  const lines = usage.filter((one) => commandsOf(one).includes(args[0] ?? ''));
  const formOf = (line: string) => line.split(/\s{2,}/)[0]!.split(' ').slice(2);
  const fits = (line: string) => {
    const words = formOf(line);
    const open = words.findIndex((word) => /^[-[<"|]/.test(word));
    const lead = open < 0 ? words : words.slice(0, open);
    return lead.every((word, at) => args[at + 1] === word);
  };
  const fitting = lines.filter(fits);
  for (const line of fitting.length ? fitting : lines) {
    const words = formOf(line);
    words.forEach((token, at) => {
      const flag = token.replace(/^\[/, '');
      if (!/^--[a-z][a-z-]*$/.test(flag) || words[at + 1] === undefined || /^(-|\||\.\.\.|\[-)/.test(words[at + 1]!)) return;
      // The value runs to the word that closes its last <, as in <doc ID>.
      let end = at + 1;
      const value = (upTo: number) => words.slice(at + 1, upTo + 1).join(' ');
      while (end + 1 < words.length && (value(end).match(/</g) ?? []).length > (value(end).match(/>/g) ?? []).length) end++;
      repeats.set(flag, (repeats.get(flag) ?? false) || /^\.\.\.\]*$/.test(words[end + 1] ?? ''));
      if (words[at + 1]!.startsWith('[')) optional.add(flag);
    });
  }
  return [repeats, optional];
};
/**
 * The first flag `args` gives twice that its command's usage shows once, if any. A flag's value is the next word, as
 * each command reads it, even one that looks like a flag; an optional value only when it doesn't start with -. After
 * --, the next word is a handle, a query or an option, never a flag; flags may follow it, as deep find reads them.
 */
const givenTwice = (args: readonly string[]): string | undefined => {
  const [flags, optional] = valueFlags(args);
  const seen = new Set<string>();
  const own = args.slice(1);
  for (let at = 0; at < own.length; at++) {
    const flag = own[at]!;
    if (flag === '--') at++;
    if (!flags.has(flag)) continue;
    if (seen.has(flag) && !flags.get(flag)) return flag;
    seen.add(flag);
    if (!optional.has(flag) || !(own[at + 1] ?? '-').startsWith('-')) at++;
  }
  return undefined;
};
// The one exit table every command keeps (#1812, exit.code@1), at the foot of `deep --help`.
const EXITS = 'Exit codes, the same for every command but deep lease and deep mcp-exec, which end with their program\'s own:\n  0 done\n  1 failed or refused\n  2 not understood, nothing ran\n  3 not decided or not checked';
/** A command's usage lines, as `deep --help` lists them; empty for a word that isn't a command. */
const usageOf = (word: string): string => {
  const lines = usage.filter((line) => commandsOf(line).includes(word));
  return lines.length ? `Usage: ${lines.join('\n       ')}` : '';
};
function printHelp(): void {
  if (helpWords.includes(args[0]!) || args[0] === '--version') {
    console.log(`${banner()}\nUsage: deep [--help | --version]\n\n${groups.map(([title, names], at) => `${title}:\n${usage
      .filter((line) => groupOf(line) === at)
      .sort((a, b) => names.indexOf(commandsOf(a)[0]!) - names.indexOf(commandsOf(b)[0]!))
      .map((line) => `  ${line}`)
      .join('\n')}`).join('\n\n')}\n\n${EXITS}`);
  } else if (usageOf(args[0] ?? '')) {
    console.log(usageOf(args[0]!));
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
  // A listed command whose arguments fit none of its forms prints its own usage (#1812).
  if (commands.includes(word)) return console.error(usageOf(word));
  const near = commands.map((command) => [distance(word, command), command] as const)
    .filter(([apart]) => apart <= reach).sort(([a, x], [b, y]) => a - b || (x < y ? -1 : 1))[0]?.[1];
  console.error(`Unsupported command ${JSON.stringify(word)}.${near ? ` Did you mean deep ${near}?` : ''} Run deep --help for available commands.`);
}

// The first `deep` command sets everything up, as the app's Set up click does (#326): in a home with nothing of
// DeepBuild, or one where a setup started and didn't finish (#1002, setup.ts), the commands you run yourself first run
// setup's steps without asking. The hub's modules load only then, so a set-up home starts as fast as before (#24's
// budget). Setup runs only for a command whose arguments read (#2200): each of these runs it after its own usage check,
// so a command that can't run sets nothing up. Its exit code, 0 to go on, else the command's.
const installed = join(homedir(), '.deepbuild');
const unfinished = !existsSync(join(installed, 'setup-finished.json')) && (!existsSync(installed) || existsSync(join(installed, 'setup-stopped.json')));
const setUp = async (): Promise<number> => (unfinished ? (await import('@deepbuild/hub')).setUpFirst(fileURLToPath(import.meta.url)) : 0);
const yours = { status: 'statusCommand', inbox: 'inboxCommand', secret: 'secretCommand', env: 'envCommand', install: 'installCommand', guard: 'guardCommand', memory: 'memoryCommand' } as const;

const hubCommands = {
  gate: 'gateCommand', start: 'startCommand', race: 'raceCommand', fix: 'fixCommand',
  // Landing in turn (#1331).
  land: 'landCommand', work: 'workCommand',
  workspace: 'workspaceCommand', numbers: 'numbersCommand', show: 'showCommand', export: 'exportCommand',
  undo: 'undoCommand',
  // A project's hub on another machine, joined with the repo link and an invite (#1338).
  join: 'joinCommand',
} as const;

if (help) {
  printHelp();
} else if (givenTwice(args) !== undefined) {
  console.error(usageOf(args[0]!));
  process.exitCode = 2;
} else if (args.length === 0) {
  // `deep` alone is the list (#1463): the rows and the one count the app shows, and nothing after them.
  const { listCommand } = await import('@deepbuild/hub');
  process.exitCode = await listCommand([], setUp);
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
} else if (Object.hasOwn(yours, args[0]!)) {
  const hub = await import('@deepbuild/hub');
  process.exitCode = await hub[yours[args[0] as keyof typeof yours]](args.slice(1), setUp);
} else if (Object.hasOwn(hubCommands, args[0]!)) {
  const hub = await import('@deepbuild/hub');
  process.exitCode = await hub[hubCommands[args[0] as keyof typeof hubCommands]](args.slice(1));
} else if (['library', 'pack', 'job', 'person'].includes(args[0]!)) {
  // What the hub takes only from your own terminal, once the OS confirms you.
  const { confirmedCommand } = await import('@deepbuild/hub');
  process.exitCode = await confirmedCommand(args);
} else if (args[0] === 'setup') {
  const { setupCommand } = await import('@deepbuild/hub');
  process.exitCode = await setupCommand(fileURLToPath(import.meta.url), args.slice(1));
} else if (args.length === 1 && (args[0] === 'off' || args[0] === 'on')) {
  const { gatesCommand } = await import('@deepbuild/hub');
  process.exitCode = (await setUp()) || (await gatesCommand(args[0] === 'off'));
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
} else if (args[0] === 'open' && args.length === 2 && !args[1]!.startsWith('-')) {
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
  const { findCommand, NotFound, readCommand } = await import('@deepbuild/reading');
  // A started session's sandbox closes the evidence store (#3229), so its reads by handle go to the hub.
  const { activePlant, handleRead } = await import('@deepbuild/hub');
  const hub = async (root: string, params: Record<string, unknown>): Promise<unknown> => {
    const answer = await handleRead(root, params);
    if (answer && 'refused' in answer) throw new NotFound(String(answer.refused));
    return answer;
  };
  process.exitCode = await (args[0] === 'read' ? readCommand(args.slice(1), hub, activePlant() === 'answers-variant-bytes') : findCommand(args.slice(1), hub));
} else if (args.length === 2 && args[0] === 'update' && args[1] === '--check') {
  process.exitCode = await updateCheck();
} else if (args.length === 2 && args[0] === 'debug' && args[1] === 'bundle') {
  process.exitCode = await debugBundle();
} else if (args[0] === 'run' && args[1] === '--result' && args[2] && args.length === 3) {
  process.exitCode = await run(args[2]);
} else if (args[0] === 'run' && args[1] === 'follow' && args[2] && !args[2].startsWith('-') && args.length === 3) {
  const { followCommand } = await import('@deepbuild/hub');
  process.exitCode = await followCommand(args[2]);
} else if (args[0] === 'host') {
  const { hostCommand } = await import('@deepbuild/hub');
  process.exitCode = await hostCommand(args.slice(1));
} else if (args[0] === 'run') {
  console.error('Usage: deep run --result <run.finished event file>\n       deep run follow <run>');
  process.exitCode = 2;
} else if (/\s/.test(args[0]!.trim())) {
  // Your own words, with any file or link after them (#1342): one input, as the app's box takes it.
  const { wordsCommand } = await import('@deepbuild/hub');
  process.exitCode = await wordsCommand(args);
} else {
  unsupported(args[0]!);
}
