// AC3: no agent can type into a hosted terminal. A terminal the agent-terminals plug-in hosts runs a reader: a real
// program that puts its terminal in raw mode and logs every byte it reads. Your keys come from the app (the panel you
// focused; writer `app`) and reach it, so the log works. Raw input for it from an agent's session (through its deep MCP
// server, its hooks, or a `deep` command in its process tree) or from a piece is refused, naming the writer, and none of
// it reaches the program. And a piece with run-as-you that an agent asks to type into its own terminal, trying every
// terminal or raw-input method its `deep` has, gets nothing through.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../../packages/record/src/index.ts';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import {
  AGENT_CLI, AGENT_HOOK, AGENT_MCP, PIECE, YOU, act, installAndLoad, message, openHost, openTerminal, openWorld, pidsIn, pkg, proc, program, readText, sleep,
  tempDir, waitFor,
} from './helpers.ts';

const MINE = 'you-typed-41';
const ATTEMPTS: { name: string; by: Connection; text: string }[] = [
  { name: 'an agent\'s deep MCP server', by: AGENT_MCP, text: 'AGENT-MCP-TYPED-7f3\r' },
  { name: 'an agent\'s hook', by: AGENT_HOOK, text: 'AGENT-HOOK-TYPED-2c9\r' },
  { name: 'a deep command in an agent\'s process tree', by: AGENT_CLI, text: 'AGENT-CLI-TYPED-5d1\r' },
  { name: 'a piece', by: PIECE, text: 'PIECE-TYPED-8e4\r' },
];

/** A world with the plug-in approved, and a reader running in a terminal it hosts. */
async function readerTerminal(plant: Plant | undefined, name: 'agent-terminals' | 'relay') {
  const w = await openWorld();
  const h = await openHost(w, plant);
  const p = await installAndLoad(h, await pkg(name), { approve: true });
  const notes = tempDir('reader');
  const { opened, refused } = await openTerminal(h, p, name === 'relay' ? 'ext.relay.open' : 'ext.agent-terminals.open', program(notes, 'reader'), notes, 'reader');
  if (!opened) throw Error(`the approved piece's command was refused: ${refused}`);
  proc((await pidsIn(notes, ['pid'])).pid!);
  await pidsIn(notes, ['ready']);
  const log = (): string => readText(join(notes, 'log'));
  return { w, h, p, terminal: opened.terminal, log };
}

async function rawInputProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const { h, terminal, log } = await readerTerminal(plant, 'agent-terminals');
  await h.rawInput(YOU, terminal, `${MINE}\r`);
  if (!(await waitFor(log, (l) => l.includes(MINE), 5000)).includes(MINE)) throw Error(`your keys from the app never reached the program: its log reads ${JSON.stringify(log())}`);
  for (const a of ATTEMPTS) {
    try {
      await h.rawInput(a.by, terminal, a.text);
      problems.push(`raw input from ${a.name} (writer ${a.by.writer}) was taken`);
    } catch (e) {
      const said = message(e);
      if (!said.includes(a.by.writer) || (a.by.session && !said.includes(a.by.session))) problems.push(`the refusal of ${a.name}'s raw input doesn't name its writer ${a.by.writer}${a.by.session ? ` and session ${a.by.session}` : ''}: ${said}`);
    }
  }
  await sleep(1500);
  const read = log();
  for (const a of ATTEMPTS) if (read.includes(a.text.slice(0, -1))) problems.push(`the program read the text ${a.name} (writer ${a.by.writer}${a.by.session ? `, session ${a.by.session}` : ''}) sent`);
  return problems;
}

async function relayProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const { h, p, terminal, log } = await readerTerminal(plant, 'relay');
  await h.rawInput(YOU, terminal, `${MINE}\r`);
  if (!(await waitFor(log, (l) => l.includes(MINE), 5000)).includes(MINE)) throw Error(`your keys from the app never reached the program: its log reads ${JSON.stringify(log())}`);
  const text = 'RELAYED-FOR-AGENT-3a6';
  let tried: unknown;
  try {
    tried = (await act(h, p, 'ext.relay.type', { terminal, text: `${text}\r` }, AGENT_MCP)).tried;
  } catch (e) {
    tried = `the action didn't run: ${message(e)}`;
  }
  await sleep(1500);
  if (log().includes(text)) problems.push(`the program read the text agent session ${AGENT_MCP.session} asked the piece to type (the piece tried ${JSON.stringify(tried)})`);
  return problems;
}

describe('AC3 no agent can type into a hosted terminal', () => {
  it('AC3 your keys from the app reach the hosted terminal\'s program; raw input from an agent (its MCP server, its hooks, a deep command in its tree) or a piece is refused, naming the writer, and none of it reaches the program', async () => {
    expect(await rawInputProblems()).toEqual([]);
  }, 90_000);

  it('AC3 an agent can\'t have a piece type for it: a piece with run-as-you that tries every terminal and raw-input method its deep has, for an agent\'s action call, gets nothing to the program', async () => {
    expect(await relayProblems()).toEqual([]);
  }, 90_000);

  it('AC3 (wrong program) input-from-any-writer: a hub that takes a hosted terminal\'s raw input from any writer fails, naming the agent\'s session', async () => {
    const problems = (await rawInputProblems('input-from-any-writer')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/the program read the text an agent's deep MCP server \(writer mcp, session 01K8A0000000000000000AGENT\) sent/);
  }, 90_000);

  it('AC3 (wrong program) piece-writes-input: a host whose API lets a piece write a terminal\'s input (deep.terminal.write) fails, naming the agent\'s session', async () => {
    const problems = (await relayProblems('piece-writes-input')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/the program read the text agent session 01K8A0000000000000000AGENT asked the piece to type/);
  }, 90_000);
});
