// What the asks core reads from files: your ask settings in config.json, which setup drafts, a repo's done.yaml asks
// block, and the ask.sources@2 table beside the package.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonValue } from '@deepbuild/contracts';
import { AskRefused, isObj } from './model.js';
import type { Obj } from './model.js';
import type { AskSource } from './api.js';

/** What setup drafts into your config.json (design: the done.yaml asks block). */
const DRAFTED = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  // An ask that first shows with less than this left before its deadline takes its default no sooner than this after it shows (#908).
  notice: { taste: '1h', authority: '1h', unblock: '1h', exception: '1h', choice: '1h', definition: '1h' },
  fallback: ['change-owner'],
  fold: 5,
  // A few visits a day, at 00:00, 08:00 and 16:00 UTC, showing at most 20 asks a day.
  batch: { every: '8h', cap: 20 },
};

/** Setup: drafts your own ask settings into <home>/config.json, keeping every value you already set. */
export async function draftAskSettings(home: string): Promise<void> {
  const file = join(home, 'config.json');
  let config: JsonValue = {};
  if (existsSync(file)) {
    // A file that doesn't parse is left as it is: setup never writes over what it can't read.
    try {
      config = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
    } catch (error) {
      throw new Error(`${file} isn't valid JSON, so setup leaves it as it is: ${(error as Error).message}`);
    }
    if (!isObj(config)) throw new Error(`${file} doesn't hold an object, so setup leaves it as it is`);
  }
  config.asks = over(DRAFTED, isObj(config.asks) ? config.asks : {});
  mkdirSync(home, { recursive: true });
  // Written whole or not at all.
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(next, file);
}

/** b over a, key by key, one level into each map: how a repo's done.yaml overrides your settings. */
export function over(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = isObj(a[key]) && isObj(value) ? { ...a[key], ...value } : value;
  return out;
}

export function readJson(file: string): Obj {
  // A file that is missing or doesn't parse declares nothing: what depends on its values is BLOCKED, naming the value.
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
    return isObj(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The `asks:` block of a repo's .deepbuild/done.yaml: maps and lists of scalars, in block or flow style. A line in
 * it this reader can't follow leaves the repo's asks BLOCKED, naming the line, rather than your settings in its place.
 */
export function doneYamlAsks(worktree: string): Obj {
  let text: string;
  try {
    text = readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8');
  } catch {
    return {};
  }
  const block: Obj = {};
  let inside = false;
  let indent = -1;
  /** The key whose value is on the lines below it: a map, or a list of `- item` lines. */
  let below: string | undefined;
  for (const [at, raw] of text.split('\n').entries()) {
    const unread = () => new AskRefused(`BLOCKED: the repo's asks settings can't be read at .deepbuild/done.yaml line ${at + 1}: ${raw.trim()}`, { field: 'asks' });
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      inside = /^asks\s*:/.test(line);
      if (inside && line !== 'asks:') throw unread();
      below = undefined;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item) {
      const under = below === undefined ? undefined : block[below];
      // Items go under a key with nothing else below it.
      if (below === undefined || (isObj(under) && Object.keys(under).length > 0)) throw unread();
      const list: JsonValue[] = Array.isArray(under) ? under : [];
      list.push(yamlScalar(item[1]!, unread));
      block[below] = list;
      continue;
    }
    const m = /^(\s+)([\w-]+):\s*(.*)$/.exec(line);
    if (!m) throw unread();
    const [, lead, key, value] = m as unknown as [string, string, string, string];
    if (indent < 0) indent = lead.length;
    const map = below === undefined ? undefined : block[below];
    if (lead.length > indent) {
      // Two levels deep at most: a kind under deadline or default, and its value on the same line.
      if (!isObj(map) || !value) throw unread();
      map[key] = yamlScalar(value, unread);
    } else if (lead.length < indent) throw unread();
    else if (value) [block[key], below] = [yamlScalar(value, unread), undefined];
    else [block[key], below] = [{}, key];
  }
  return block;
}

/** A value on one line: a scalar, or one flow map or list of scalars. */
function yamlScalar(text: string, unread: () => Error, nested = false): JsonValue {
  const items = (inner: string) => inner.split(',').map((s) => s.trim()).filter(Boolean);
  const flow = /^\{(.*)\}$/.exec(text);
  const list = /^\[(.*)\]$/.exec(text);
  if ((flow || list) && nested) throw unread();
  if (flow) {
    return Object.fromEntries(items(flow[1]!).map((pair) => {
      const at = pair.indexOf(':');
      if (at <= 0) throw unread();
      return [pair.slice(0, at).trim(), yamlScalar(pair.slice(at + 1).trim(), unread, true)];
    }));
  }
  if (list) return items(list[1]!).map((item) => yamlScalar(item, unread, true));
  if (/[{}[\]]/.test(text)) throw unread();
  if (/^-?\d+$/.test(text)) return Number(text);
  return text.replace(/^(["'])(.*)\1$/, '$2');
}

let sources: AskSource[] | undefined;
/** The ask.sources@2 table, as data beside the package. */
export const askSources = (): AskSource[] =>
  structuredClone((sources ??= JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8')) as AskSource[]));
