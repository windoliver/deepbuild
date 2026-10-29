// Standing rules (#23; design: Before each command): adding a dependency or creating a cloud resource the plan
// doesn't name is a decision, answered by your standing rule or asked, and a permission prompt is an authority ask a
// saved decision can answer. This module says what each such call is about, as the subject the asks core keys it
// from (never the call's words), and which standing rules for cloud resources the hub copies into rules.json, so
// deep-hook can let a covered one through with the hub down. The account a command names is its `--profile`'s, read
// from ~/.aws/config.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';

type Obj = Record<string, unknown>;

/** The effect classes a standing rule decides at PreToolUse, by their `effect:` guard entries. */
export const DECIDED = new Set(['dependency', 'cloud-resource']);

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

/** The AWS profile a command names, `--profile <name>` or `--profile=<name>`, else the default. */
function profileOf(command: string): string {
  const w = words(command);
  const at = w.findIndex((x) => x === '--profile' || x.startsWith('--profile='));
  if (at < 0) return 'default';
  return w[at]!.includes('=') ? w[at]!.slice('--profile='.length) : w[at + 1] ?? 'default';
}

/** The account a profile signs into, from ~/.aws/config: its sso_account_id, else none. */
function accountOf(home: string, profile: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(home, '.aws', 'config'), 'utf8');
  } catch {
    return undefined;
  }
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const head = /^\[(?:profile\s+)?([^\]]+)\]$/.exec(line);
    if (head) section = head[1]!.trim();
    else if (section === profile) {
      const kv = /^sso_account_id\s*=\s*(\S+)$/.exec(line);
      if (kv) return kv[1];
    }
  }
  return undefined;
}

/** The cloud and account a cloud command names: an AWS command's account, else its tool. */
function cloudOf(command: string, home: string): { owner: string; kind: string; named: string } {
  const w = words(command);
  if (w[0] === 'aws') {
    const profile = profileOf(command);
    const account = accountOf(home, profile);
    return { owner: account ? `aws:${account}` : `aws-profile:${profile}`, kind: `aws ${w[1] ?? ''}`.trim(), named: account ? `AWS account ${account} (profile ${profile})` : `the AWS profile ${profile}` };
  }
  return { owner: w[0] ?? 'cloud', kind: w[0] ?? 'cloud', named: w[0] ?? 'a cloud' };
}

/** What a PreToolUse's call of a decided class is about; undefined for one this module can't read. */
export function aboutCall(classes: readonly string[], command: string, home: string): About | undefined {
  if (classes.includes('cloud-resource')) {
    const cloud = cloudOf(command, home);
    return {
      source: 'effect.cloud_resource',
      subject: { effect: 'cloud-resource', target: { kind: cloud.kind, ref: command, owner: cloud.owner }, change: null },
      question: `Create a cloud resource in ${cloud.named}: \`${command}\`? No plan names it.`,
      options: ['Create it', "Don't create it"],
    };
  }
  if (classes.includes('dependency')) {
    const added = packages(command);
    if (!added) return undefined;
    return {
      source: 'effect.dependency',
      subject: { effect: 'dependency', target: { kind: 'package', ref: added.names.join(' '), owner: added.manager }, change: null },
      question: `Add the dependency ${added.names.join(', ')} (\`${command}\`)? No plan names it.`,
      options: ['Add it', "Don't add it"],
    };
  }
  return undefined;
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
export interface Standing { effect: 'cloud-resource'; owner: string; account: string | null; decision: string }

/** The standing rules for cloud resources in force: each active decision saving a yes to one, by its owner. */
export function standingRules(rows: readonly { id: string; answer: string; subject: Obj | null; state: string }[]): Standing[] {
  return rows.flatMap((r) => {
    const target = r.subject && typeof r.subject.target === 'object' && r.subject.target !== null ? (r.subject.target as Obj) : undefined;
    if (r.state === 'revoked' || r.answer !== 'approve' || r.subject?.effect !== 'cloud-resource' || typeof target?.owner !== 'string') return [];
    const account = /^aws:(\d+)$/.exec(target.owner)?.[1] ?? null;
    return [{ effect: 'cloud-resource', owner: target.owner, account, decision: `decision:${r.id}` }];
  });
}
