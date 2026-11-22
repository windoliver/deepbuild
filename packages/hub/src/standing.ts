// Standing rules (#23; design: Before each command): adding a dependency or creating a cloud resource the plan
// doesn't name is a decision, answered by your standing rule or asked, and a permission prompt is an authority ask a
// saved decision can answer. This module says what each such call is about, as the subject the asks core keys it
// from (never the call's words), and which standing rules for cloud resources the hub copies into rules.json, so
// deep-hook can let a covered one through with the hub down. The account a command names is its `--profile`'s, read
// from ~/.aws/config.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { addedSince, noteOf, ranReading, readingWords, readRegistry, settled } from './dependencies.js';
import type { Holds } from './holds.js';
import type { Gated, HookMeta } from './wire.js';

type Obj = Record<string, unknown>;

/** What a call is about, as an authority ask's subject, with the ask's source and question. */
export interface About {
  source: string;
  subject: { effect: string; target: { kind: string; ref: string; owner: string }; change: null };
  question: string;
  options: [string, string];
}

/** A command's words, split as a shell would split simple words: enough to read a package or a profile. */
const words = (command: string): string[] => command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];

/** The packages a command adds, after its install or add word, and the tool that adds them. */
function packages(command: string): { manager: string; names: string[] } | undefined {
  const w = words(command);
  const at = w.findIndex((x, i) => i > 0 && ['install', 'i', 'add'].includes(x));
  if (at < 1) return undefined;
  const names = w.slice(at + 1).filter((x) => !x.startsWith('-'));
  return names.length ? { manager: w[at - 1]!.replace(/^.*\//, ''), names } : undefined;
}

/** The account a profile signs into, from ~/.aws/config: its sso_account_id, else none. */
function accountOf(home: string, profile: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(home, '.aws', 'config'), 'utf8');
  } catch {
    return undefined;
  }
  // Readers split anything but printable ASCII, tabs and line ends into lines and words differently, the CLI's and
  // deep-hook's among them: a file holding any is read as naming no account.
  if (/[^\t\n -~]/.test(text.replace(/\r\n/g, '\n'))) return undefined;
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    // The CLI reads a named profile from `[profile <name>]` alone, and the default from `[default]` (#2134).
    // A header is read as the CLI's parser reads it: up to its last `]`, whatever follows.
    const header = /^\[(.+)\]/.exec(line)?.[1];
    const head = header === undefined ? undefined : /^(?:profile\s+(.+)|(default))$/.exec(header);
    if (header !== undefined) section = head ? (head[1] ?? head[2]!).trim() : '';
    else if (section !== '' && section === profile) {
      const kv = /^sso_account_id\s*=\s*(\S+)$/.exec(line);
      if (kv) return kv[1];
    }
  }
  return undefined;
}

/**
 * deep-hook's notes on a call whose one creating run it read whole (#2134): an aws run, with the profile it signs in
 * with said whole, and any other tool's run. Its other notes, as on a line with more than one creating run, name no
 * owner.
 */
const AWS_CREATE = /^It creates a cloud resource under the AWS profile ([!-9;-~]+): aws(?:\s+(\S+))?/;
const TOOL_CREATE = /^It creates a cloud resource: (\S+)/;

/**
 * The cloud and account a cloud command creates under, as deep-hook's note reads it: an AWS run's account, else its
 * tool. A line whose note names no owner is owned by itself alone, so no standing rule for an account or a tool
 * covers it (#2134).
 */
function cloudOf(command: string, notes: Record<string, string> | undefined, home: string): { owner: string; kind: string; named: string } {
  const said = Object.values(notes ?? {});
  const aws = said.map((n) => AWS_CREATE.exec(n)).find((m) => m);
  if (aws) {
    const profile = aws[1]!;
    const account = accountOf(home, profile);
    return { owner: account ? `aws:${account}` : `aws-profile:${profile}`, kind: `aws ${aws[2] ?? ''}`.trim(), named: account ? `AWS account ${account} (profile ${profile})` : `the AWS profile ${profile}` };
  }
  const tool = said.map((n) => TOOL_CREATE.exec(n)?.[1]).find((t) => t !== undefined && t !== 'aws');
  if (tool) return { owner: tool, kind: tool, named: tool };
  return { owner: `cloud-line:${command}`, kind: 'cloud', named: 'more than one cloud command, or one that can\'t be read whole,' };
}

/** What a PreToolUse's call of a decided class is about, with deep-hook's notes on it; undefined for one this module can't read. */
export function aboutCall(classes: readonly string[], command: string, notes: Record<string, string> | undefined, home: string): About | undefined {
  if (classes.includes('cloud-resource')) {
    const cloud = cloudOf(command, notes, home);
    return {
      source: 'effect.cloud_resource',
      subject: { effect: 'cloud-resource', target: { kind: cloud.kind, ref: command, owner: cloud.owner }, change: null },
      question: `Create a cloud resource in ${cloud.named}: \`${command}\`? No plan names it.`,
      options: ['Create it', "Don't create it"],
    };
  }
  if (classes.includes('dependency')) {
    const added = packages(command);
    return added ? aboutDependency(added.manager, added.names, command, false) : undefined;
  }
  return undefined;
}

/**
 * What a call that adds a dependency is about: the packages, keyed by the tool that adds them, so a standing rule for
 * that tool covers them all; one run straight from a registry is asked as a run (#1509).
 */
export function aboutDependency(manager: string, names: readonly string[], command: string, run: boolean): About {
  return {
    source: 'effect.dependency',
    subject: { effect: 'dependency', target: { kind: 'package', ref: names.join(' '), owner: manager }, change: null },
    question: run ? `Run ${names.join(', ')} straight from its registry (\`${command}\`)? No plan names it.` : `Add the dependency ${names.join(', ')} (\`${command}\`)? No plan names it.`,
    options: run ? ['Run it', "Don't run it"] : ['Add it', "Don't add it"],
  };
}

/**
 * What a permission prompt is about: the tool, and the call itself (a shell command's words, white space collapsed,
 * or any other tool's input by its digest), so a saved answer covers that same call and nothing wider.
 */
export function aboutPermission(tool: string, input: Obj): About {
  const command = typeof input.command === 'string' ? input.command.trim().replace(/\s+/g, ' ') : undefined;
  const label = command ?? `${tool} ${JSON.stringify(input).slice(0, 200)}`;
  return {
    source: 'permission.request',
    subject: { effect: 'permission', target: { kind: `tool:${tool}`, ref: label, owner: command ? `run:${command}` : `input:${sha256Hex(canonicalize(input as JsonValue))}` }, change: null },
    question: `Allow the agent to run \`${label}\`?`,
    options: ['Allow it', 'Deny it'],
  };
}

/** A standing rule rules.json carries for deep-hook: a cloud owner (an AWS account) your saved yes covers. */
interface Standing { effect: 'cloud-resource'; owner: string; account: string | null; decision: string }

/** The standing rules for cloud resources in force: each active decision saving a yes to one, by its owner. */
export function standingRules(rows: readonly { id: string; answer: string; subject: Obj | null; state: string }[]): Standing[] {
  return rows.flatMap((r) => {
    const target = r.subject && typeof r.subject.target === 'object' && r.subject.target !== null ? (r.subject.target as Obj) : undefined;
    if (r.state === 'revoked' || r.answer !== 'approve' || r.subject?.effect !== 'cloud-resource' || typeof target?.owner !== 'string') return [];
    const account = /^aws:(\d+)$/.exec(target.owner)?.[1] ?? null;
    return [{ effect: 'cloud-resource', owner: target.owner, account, decision: `decision:${r.id}` }];
  });
}

/** What the gate's decision on a dependency or a cloud resource uses of the hub. */
export interface Gate {
  holds: Pick<Holds, 'decide'>;
  /** Whether a saved decision covers what a call is about, asked with nothing raised. */
  covered(session: string, about: About): Promise<boolean>;
  now(): number;
  /** Records a reading of the session. */
  reading(session: string, agent: string, text: string): Promise<void>;
  /** The registry a test names in place of the public ones (DEEP_HUB_TEST_REGISTRY). */
  registry: string | undefined;
  plant: string | undefined;
}

/**
 * A call the guards class as a dependency or a cloud resource no plan names (#23, #1509). A bare install that adds no
 * name since the base runs, and your standing rule answers the rest. Otherwise each package's version is read from its
 * registry. A package run straight from it, whose version and name are both at least a week old, still runs with no
 * ask, kept for the return card's what-changed line with their ages; a new version, a new name, one the registry
 * couldn't say, and every package added to the project is asked, the question carrying the reading.
 */
export async function decide(g: Gate, meta: HookMeta, call: Gated): Promise<{ held?: string; allow?: string; deny?: string }> {
  const note = call.decided?.includes('dependency') && !call.decided.includes('cloud-resource') ? noteOf(meta.notes) : undefined;
  if (!note) {
    const about = call.decided?.length && call.command ? aboutCall(call.decided, call.command, meta.notes, homedir()) : undefined;
    return about ? g.holds.decide(meta, about) : {};
  }
  const names = note.form === 'manifest' ? await addedSince(note.items) : note.items;
  if (!names.length) return {};
  const command = call.command ?? call.label;
  const about = aboutDependency(note.manager, names, command, note.form === 'run');
  if (await g.covered(meta.session, about)) return g.holds.decide(meta, about);
  const readings = await Promise.all(names.map((n) => readRegistry(note.registry, n, g.registry)));
  const now = g.now();
  // The planted wrong program asks for every package run straight from a registry, whatever its age.
  if (note.form === 'run' && readings.every((r) => settled(r, now)) && g.plant !== 'asks-every-registry-run') {
    await g.reading(meta.session, meta.agent, ranReading(note, readings, command, now));
    return {};
  }
  return g.holds.decide(meta, { ...about, question: `${about.question} ${readings.map((r) => readingWords(r, note.registry, now)).join(' ')}` });
}
