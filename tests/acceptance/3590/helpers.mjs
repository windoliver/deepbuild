import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { machineRepo, PAIRS, sandbox, until } from '../1117/helpers.mjs';
import { HOLD, lines, start, THROTTLE, within } from '../3334/helpers.mjs';

export { PAIRS, HOLD, within, lines, until };
export const STALL = '0.05';
export const WAVES = 10;

export function fixture(t) {
  const box = sandbox(t);
  for (const name of ['DEEP_TEST_GRANT_STALL', 'DEEP_TEST_GRANT_WAIT', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN']) delete box.env[name];
  box.table = join(box.home, '.deepbuild', 'throttle');
  return { box, repo: machineRepo(box) };
}

export function tableLog(box) {
  const file = join(box.table, 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsed: line }; }
  });
}
export const showLog = (box) => `log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`;

export function tableNow(box) {
  try {
    const { grants = [], requests = [] } = JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
    return { grants, requests };
  } catch {
    return { grants: [], requests: [] };
  }
}
export const asking = (box, pid) => tableNow(box).requests.some((request) => request.class === 'bay-pair' && request.pid === pid);

export async function holdEveryPair(box) {
  const holders = Array.from({ length: PAIRS }, () => start(box, [process.execPath, THROTTLE, 'bay-pair', '--wait', '10', '--', '/bin/sh', '-c', 'echo "GRANTED $DEEP_THROTTLE"; exec /bin/sleep 600']));
  return Promise.all(holders.map(async (child) => {
    const line = await within(child.line(/^GRANTED bay-pair:\S+$/), 3);
    return line ? { pid: child.pid, id: line.slice('GRANTED bay-pair:'.length), child } : null;
  }));
}

export async function movingLine(box) {
  const gate = join(box.dir, 'go-3590');
  const count = (WAVES + 1) * PAIRS;
  const holders = Array.from({ length: count }, () => start(box, [process.execPath, THROTTLE, 'bay-pair', '--wait', '10', '--', '/bin/sh', '-c',
    'until [ -e "$0" ]; do /bin/sleep 0.1; done; exec /bin/sleep "$1"', gate, HOLD]));
  const pids = new Set(holders.map((child) => child.pid));
  const inLine = () => {
    const { grants, requests } = tableNow(box);
    return [...grants, ...requests].filter((entry) => entry.class === 'bay-pair' && pids.has(entry.pid)).length;
  };
  if (!(await until(() => inLine() === count, 180_000))) return null;
  return { holders, pids, count, go: () => writeFileSync(gate, '') };
}

const CLAIM = `const [script] = process.argv.slice(1);
const { claimPair } = await import(script);
const pair = claimPair(process.cwd(), (line) => console.log(line));
const isPair = pair !== null && typeof pair === 'object' && typeof pair.close === 'function';
console.log('CLAIM ' + JSON.stringify({ pid: process.pid, pair: isPair, index: isPair ? pair.index : null, refused: pair?.refused ?? null, blocked: pair?.blocked ?? null }));
if (isPair) pair.close();
`;

export function claim(box, script, cwd, env = {}) {
  return start(box, [process.execPath, '--input-type=module', '-e', CLAIM, pathToFileURL(script).href], { cwd, env: { ...box.env, ...env } });
}
export function claimOf(result) {
  const line = String(result?.stdout ?? '').split('\n').find((text) => text.startsWith('CLAIM '));
  try { return line ? JSON.parse(line.slice('CLAIM '.length)) : null; } catch { return null; }
}
export const show = (result) => `exit ${result?.status}${result?.signal ? ` (${result.signal})` : ''}\nstdout:\n${result?.stdout ?? ''}\nstderr:\n${String(result?.stderr ?? '').slice(-3000)}`;
