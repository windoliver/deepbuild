// `deep doctor`'s app.footprint item (#1431; technical design: Numbers version 0 has to hold, "The app's footprint"):
// the running app's reading, asked on its socket (app.sock under ~/.deepbuild, as `deep open` asks it), as one
// doctor.item@1. Every value known reads `footprint B = heap B + gauges B (name B, …) + unaccounted B` and is healthy; a
// value that couldn't be read reads `unknown (<the read>)`, never 0, and the item warns; with no app answering, the item
// isn't checked. The app's last hour of minutes follows: their mean `unaccounted`, the void minutes left out of it.
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord as isObj } from '@deepbuild/contracts';
import type { Item } from './doctor.js';

type Obj = Record<string, unknown>;
const AGENT = 'deepbuild';
const ITEM = 'app.footprint';
const FIX = 'Nothing to do.';
const OPEN = 'Open the DeepBuild app, then run `deep doctor` again.';

/** The app's answer to `footprint` on its socket, or why there is none. */
function ask(socket: string): Promise<Obj | string> {
  return new Promise((done) => {
    const app = net.connect(socket);
    let reply = '';
    const end = (value: Obj | string): void => { app.destroy(); done(value); };
    app.setTimeout(3_000, () => end('the app didn\'t answer within 3 s'));
    app.on('connect', () => app.write('footprint\n'));
    app.on('data', (data) => {
      reply += data;
      if (!reply.includes('\n')) return;
      try {
        const parsed = JSON.parse(reply.slice(0, reply.indexOf('\n'))) as unknown;
        end(isObj(parsed) ? parsed : 'the app answered no reading');
      } catch {
        end(`the app answered ${reply.trim().slice(0, 200)}`);
      }
    });
    app.on('error', () => end('the app isn\'t running'));
  });
}

const bytes = (v: unknown): string => (typeof v === 'number' ? `${v} B` : 'unknown');

/** The item for the app's answer, or for why there is none. */
export function footprintItem(answer: Obj | string): Item {
  if (typeof answer === 'string' || !isObj(answer.reading)) {
    const why = typeof answer === 'string' ? answer : 'the app answered no reading';
    return { item: ITEM, agent: AGENT, code: 'not_checked', level: 'skip', evidence: `not checked: ${why}, so its footprint wasn't read`, fix: OPEN };
  }
  const r = answer.reading;
  const unknown = (Array.isArray(r.unknown) ? r.unknown : []).filter(isObj);
  const readOf = (field: string): string | undefined => unknown.find((u) => u.field === field)?.read as string | undefined;
  const value = (field: string, v: unknown, from: string[] = [field]): string => {
    if (typeof v === 'number') return `${v} B`;
    const reads = from.map(readOf).filter((x): x is string => x !== undefined);
    return `unknown (${reads.length ? reads.join(', ') : `${field} wasn't read`})`;
  };
  const gauges = (Array.isArray(r.gauges) ? r.gauges : []).filter(isObj);
  const sum = gauges.reduce((s, g) => s + (typeof g.bytes === 'number' ? g.bytes : 0), 0);
  const each = gauges.map((g) => `${String(g.name)} ${bytes(g.bytes)}`).join(', ');
  let evidence = `footprint ${value('footprint', r.footprint)} = heap ${value('heap', r.heap)} + gauges ${sum} B (${each || 'none'}) + unaccounted ${value('unaccounted', r.unaccounted, ['footprint', 'heap'])}`;
  const minutes = Array.isArray(answer.minutes) ? answer.minutes.length : 0;
  if (minutes) {
    const mean = typeof answer.unaccounted_mean === 'number' ? `${Math.round(answer.unaccounted_mean)} B` : 'unknown';
    evidence += `; over the app's last ${minutes} minutes, unaccounted averaged ${mean}, ${Number(answer.void_minutes ?? 0)} void minutes left out`;
  }
  const known = r.footprint !== null && r.heap !== null && r.unaccounted !== null && !unknown.length;
  return known
    ? { item: ITEM, agent: AGENT, code: 'healthy', level: 'ok', evidence, fix: FIX }
    : { item: ITEM, agent: AGENT, code: 'footprint_unknown', level: 'warn', evidence, fix: 'A read the reading names failed; run `deep doctor` again, and if it stays unknown attach `deep debug bundle` to a bug report.' };
}

/** The running app's footprint, as `deep doctor` shows it. */
export async function appFootprintItem(env: NodeJS.ProcessEnv): Promise<Item> {
  return footprintItem(await ask(join(env.HOME ?? homedir(), '.deepbuild', 'app.sock')));
}
