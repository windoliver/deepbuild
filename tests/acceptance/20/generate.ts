// Generated Claude Code sessions for the budgets (AC7): seeded, so every run and both sides of a comparison see the
// same bytes. A session works on a small repo of its own: the user asks, the assistant answers and calls tools, and
// tool results carry what agents' transcripts are mostly made of: whole files read (and read again), test output
// and short edit results. Each entry carries the metadata Claude Code writes (adapters/corpus/claude-code). The words
// come from a fixed vocabulary of made-up identifiers and English, drawn with a skew toward common ones, as code is.
// None of this is the archive; it only builds the inputs the budgets name (README, Readings: AC7).

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { claudeFolder, mulberry32, type Env, type Rng } from './helpers.ts';

const ENGLISH = ('the a to of and in is it that for on with as this be are we by not or from at can will an all have if more one has run test fix add file use when then make new check case value return error each order cart page total tax item price user step list build next done')
  .split(' ');
const SYLLABLES = ['ca', 'ro', 'ti', 'mo', 'ne', 'la', 'vi', 'su', 'pe', 'da', 'ko', 'ri', 'ba', 'te', 'lo', 'mi', 'zu', 'fa', 'go', 'he'];
function vocabulary(rng: Rng, size: number): string[] {
  const words = new Set<string>(ENGLISH);
  while (words.size < size) {
    let w = '';
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
    words.add(rng() < 0.3 ? w[0]!.toUpperCase() + w.slice(1) : w);
  }
  return [...words];
}
/** Picks with a skew toward the front of the list (roughly Zipf), as identifiers recur in code. */
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(list.length * rng() ** 3))]!;
const hex = (rng: Rng, n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rng() * 16)]).join('');
const uuid = (rng: Rng): string => `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-a${hex(rng, 3)}-${hex(rng, 12)}`;

/** One generated session: its ID and the transcript's lines, generated up to a size. */
export interface Generated { id: string; cwd: string; lines: string[]; bytes: number }

/** A session's transcript of about `size` bytes (it stops at the first line past it), from `seed`. */
export function session(seed: number, size: number, start: number): Generated {
  const rng = mulberry32(seed);
  const vocab = vocabulary(rng, 3000);
  const id = uuid(rng);
  const cwd = `/Users/dev/src/${pick(rng, vocab).toLowerCase()}-${seed % 97}`;
  const sentence = (n: number) => Array.from({ length: n }, () => pick(rng, vocab)).join(' ');
  const codeLine = () => {
    const f = pick(rng, vocab);
    switch (Math.floor(rng() * 4)) {
      case 0: return `export function ${f}(${pick(rng, vocab)}, ${pick(rng, vocab)}) {`;
      case 1: return `  const ${pick(rng, vocab)} = ${pick(rng, vocab)}.${pick(rng, vocab)}(${Math.floor(rng() * 100)});`;
      case 2: return `  if (${pick(rng, vocab)} > ${pick(rng, vocab)}) return ${pick(rng, vocab)};`;
      default: return '}';
    }
  };
  // The session's repo: 30 files the agent reads, some more than once.
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `${cwd}/src/${pick(rng, vocab).toLowerCase()}-${i}.ts`, body: Array.from({ length: 60 + Math.floor(rng() * 240) }, codeLine) }));
  const lines: string[] = [];
  let bytes = 0;
  let parent: string | null = null;
  let at = start;
  const push = (type: 'user' | 'assistant', message: unknown, extra: Record<string, unknown> = {}) => {
    const u = uuid(rng);
    const line = JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.304', gitBranch: 'main', type, message, uuid: u, timestamp: new Date(at).toISOString(), ...extra });
    at += 1000 + Math.floor(rng() * 20_000);
    parent = u;
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
  };
  const usage = () => ({ input_tokens: Math.floor(rng() * 40), cache_creation_input_tokens: Math.floor(rng() * 9000), cache_read_input_tokens: Math.floor(rng() * 90_000), output_tokens: Math.floor(rng() * 900), service_tier: 'standard' });
  while (bytes < size) {
    push('user', { role: 'user', content: sentence(8 + Math.floor(rng() * 30)) }, { promptSource: 'typed' });
    const calls = 1 + Math.floor(rng() * 6);
    for (let c = 0; c < calls && bytes < size; c++) {
      const tool = `toolu_01${hex(rng, 22)}`;
      const kind = rng();
      if (kind < 0.55) {
        const file = pick(rng, files);
        push('assistant', { model: 'claude-opus-5-5', id: `msg_01${hex(rng, 22)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: tool, name: 'Read', input: { file_path: file.path } }], stop_reason: 'tool_use', usage: usage() });
        push('user', { role: 'user', content: [{ tool_use_id: tool, type: 'tool_result', content: file.body.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n') }] }, { toolUseResult: { type: 'text', file: { filePath: file.path, numLines: file.body.length } } });
      } else if (kind < 0.8) {
        const passing = Math.floor(rng() * 200);
        const out = [`> ${pick(rng, vocab)}@1.0.0 test`, ...Array.from({ length: 10 + Math.floor(rng() * 60) }, () => `  ${rng() < 0.9 ? '✓' : '✗'} ${sentence(5)} (${Math.floor(rng() * 40)} ms)`), `${passing} passing`];
        push('assistant', { model: 'claude-opus-5-5', id: `msg_01${hex(rng, 22)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: tool, name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }], stop_reason: 'tool_use', usage: usage() });
        push('user', { role: 'user', content: [{ tool_use_id: tool, type: 'tool_result', content: out.join('\n'), is_error: false }] });
      } else {
        const file = pick(rng, files);
        const old = pick(rng, file.body);
        push('assistant', { model: 'claude-opus-5-5', id: `msg_01${hex(rng, 22)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: tool, name: 'Edit', input: { file_path: file.path, old_string: old, new_string: codeLine() } }], stop_reason: 'tool_use', usage: usage() });
        push('user', { role: 'user', content: [{ tool_use_id: tool, type: 'tool_result', content: `The file ${file.path} has been updated.` }] });
      }
    }
    push('assistant', { model: 'claude-opus-5-5', id: `msg_01${hex(rng, 22)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: sentence(20 + Math.floor(rng() * 80)) }], stop_reason: 'end_turn', usage: usage() });
  }
  return { id, cwd, lines, bytes };
}

/** Where Claude Code keeps a generated session's transcript. */
export const pathOf = (env: Env, g: Generated): string => join(claudeFolder(env, g.cwd), `${g.id}.jsonl`);
/** Writes the first `count` lines of a generated session (all when omitted), replacing what was there. */
export function writeSession(env: Env, g: Generated, count = g.lines.length): string {
  const path = pathOf(env, g);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, g.lines.slice(0, count).map((l) => `${l}\n`).join(''));
  return path;
}
/** Appends lines `from`…`to` (exclusive) of a generated session, as the agent does while it runs. */
export function appendSession(env: Env, g: Generated, from: number, to: number): void {
  appendFileSync(pathOf(env, g), g.lines.slice(from, to).map((l) => `${l}\n`).join(''));
}
/** The line count at which a session's transcript first reaches `size` bytes. */
export function linesUpTo(g: Generated, size: number): number {
  let bytes = 0;
  for (let i = 0; i < g.lines.length; i++) {
    bytes += Buffer.byteLength(g.lines[i]!) + 1;
    if (bytes >= size) return i + 1;
  }
  return g.lines.length;
}
