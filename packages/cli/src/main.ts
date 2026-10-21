#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaySession } from '../../../adapters/index.mjs';

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

if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log(`${banner()}\nUsage: deep [--help | --version]\n       deep explain <recorded session folder> [--json]\n\nRepository skeleton. Hub commands are not implemented yet.`);
} else if (args.length === 1 && args[0] === '--version') {
  console.log(version());
} else if (args[0] === 'explain' && args[1] && args.slice(2).every((arg) => arg === '--json')) {
  process.exitCode = explain(args[1], args.includes('--json'));
} else {
  console.error('Unsupported command. Run deep --help for available commands.');
  process.exitCode = 2;
}
