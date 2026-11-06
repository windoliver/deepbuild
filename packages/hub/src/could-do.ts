// Could the agent do it? (#84; design: Could the agent do it?, Tasks only you can do.) Before a step goes to you, what
// it needs is read from the step's words and matched against what the session really has: its tools, your standing
// grants, a signed-in browser profile you leased, credentials held by reference, and who has access to a repo. No
// model. A step that names none of these reaches you; one that does goes back naming what to use.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface ReachTool { name: string; kind: 'cli' | 'mcp' | 'browser' | 'computer'; provider?: string; signed_in?: boolean; connector?: string; read_only?: boolean; reads?: string[] }
export interface Reach {
  tools: ReachTool[];
  profiles: { profile: string; provider: string; leased: boolean }[];
  credentials: { secret: string; provider?: string }[];
  grants: { grant: string; step: string }[];
  access: { repo: string; who: 'you' | 'agent'; via: string }[];
}
/** What a check found: the tool, profile, grant or secret to use, by the name the agent knows it by. */
export interface Found { use: string; how: string }

const SIGN_IN = /\bsign(?:ed|ing)?[ -]?in\b|\blog(?:ged|ging)?[ -]?in\b|\bauthenticat/i;
const SECRET = /\b(?:key|token|secret|credential|password)s?\b/i;
/** A step made on a screen: a press, a dialog, an app's window. */
const ON_SCREEN = /\b(?:click|press|tap|drag)\b|\bdialog\b|\bopen the app\b/i;
const REPO = /\b[\w.-]+\/[\w.-]+\b/g;
/** A secret's name as it is written in an environment. */
export const SECRET_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|TOKEN|SECRET|PASSWORD)\b/;

const word = (text: string, name: string) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);

/** What in `reach` could take the step `step` describes, best first: nothing when only you can. */
export function couldDo(step: string, reach: Reach): Found[] {
  const found: Found[] = [];
  for (const p of reach.profiles) if (p.leased && word(step, p.provider) && SIGN_IN.test(step)) found.push({ use: p.profile, how: `the signed-in browser profile ${p.profile} you leased` });
  for (const c of reach.credentials) {
    if (word(step, c.secret) || (c.provider && word(step, c.provider) && SECRET.test(step))) found.push({ use: c.secret, how: `the secret ${c.secret}, held by reference` });
  }
  for (const g of reach.grants) if (word(step, g.step)) found.push({ use: g.grant, how: `your standing grant ${g.grant}` });
  for (const repo of step.match(REPO) ?? []) {
    const a = reach.access.find((x) => x.repo === repo);
    if (a) found.push({ use: a.via, how: `${a.via}, which reaches ${repo} ${a.who === 'agent' ? 'as the agent' : 'with your access'}` });
  }
  for (const t of reach.tools) {
    if (t.reads?.some((table) => word(step, table))) found.push({ use: t.name, how: `${t.name}, which reads that` });
    else if (t.provider && t.signed_in && word(step, t.provider)) found.push({ use: t.name, how: `${t.name}, signed in to ${t.provider}` });
    else if (t.kind === 'computer' && ON_SCREEN.test(step)) found.push({ use: t.name, how: `${t.name}, on a screen you lease` });
    else if (!t.read_only && word(step, t.name)) found.push({ use: t.name, how: t.name });
  }
  return found.filter((f, i) => found.findIndex((o) => o.use === f.use) === i);
}

/** An option the agent has no tool for: a write through a connector the session holds read-only. */
export function struck(label: string, reach: Reach): boolean {
  return /\b(?:write|save|update|post|create|send|delete)\b/i.test(label) && reach.tools.some((t) => t.read_only && t.connector !== undefined && word(label, t.connector));
}

/** The command-line tools the check knows, and the file each keeps a sign-in in. */
const CLIS: [string, string, string][] = [
  ['gh', 'github', '.config/gh/hosts.yml'], ['vercel', 'vercel', 'Library/Application Support/com.vercel.cli/auth.json'],
  ['aws', 'aws', '.aws/credentials'], ['gcloud', 'google', '.config/gcloud/credentials.db'], ['stripe', 'stripe', '.config/stripe/config.toml'],
];
const onPath = (name: string): boolean => (process.env.PATH ?? '').split(delimiter).some((dir) => {
  try { accessSync(join(dir, name), constants.X_OK); return true; } catch { return false; }
});

/**
 * What this machine gives a session: the command-line tools on its PATH, each signed in when its file is there, and
 * what the record and the leases say (`more`). `DEEP_HUB_TEST_REACH`, which only tests set, stands in for all of it.
 */
export function reachOf(more: Partial<Reach>): Reach {
  const test = process.env.DEEP_HUB_TEST_REACH;
  if (test) {
    const given = JSON.parse(readFileSync(test, 'utf8')) as Partial<Reach>;
    return { tools: [], profiles: [], credentials: [], grants: [], access: [], ...given };
  }
  const clis = CLIS.filter(([name]) => onPath(name)).map(([name, provider, file]): ReachTool => ({ name, kind: 'cli', provider, signed_in: existsSync(join(homedir(), file)) }));
  return { tools: [...clis, ...(more.tools ?? [])], profiles: more.profiles ?? [], credentials: more.credentials ?? [], grants: more.grants ?? [], access: more.access ?? [] };
}
