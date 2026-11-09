// People in the record (#1337; design: One hub for a project shared by several people, and People in the record under
// Socket roles). The hub's owner is `you`, as every event has always named. Each other person on a project holds a
// credential of their own, kept here only as its digest, and a connection that presents it stamps that person as the
// actor of every event it sends. An event's own fields never name its actor. The people on a project are those this
// hub holds credentials for; with none, the hub reads and writes exactly as a one-person hub always has.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectIdOf, shareProjects } from './paths.js';

/** The hub's owner: the actor every event of a one-person hub names, and every event an older record holds. */
export const OWNER = 'you';
/** A person's name: a forge login's shape, never the owner's. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

/**
 * One credential: its holder, its digest, and from #1338 the ID of the key it is bound to, which the holder's machine
 * proves over the network connection. A person holds one per machine they joined from.
 */
interface Person { person: string; token_sha256: string; projects: string[]; key?: string }
/** A one-time invite (#1338), kept only as its digest until it is spent or it lapses. */
interface Invite { person: string; secret_sha256: string; project: string; expires: number }
const digest = (token: string): Buffer => createHash('sha256').update(token).digest();
/** How long an invite stays good. */
const INVITE_MS = 24 * 3_600_000;

export class People {
  private list: Person[] = [];
  private invites: Invite[] = [];
  /** The IDs of every project people share here. */
  private shared = new Set<string>();
  private readonly file: string;
  constructor(dir: string) {
    this.file = join(dir, 'people.json');
    this.load();
  }
  /** Reads people.json again, and names the forge repos they share for this thread's repoOf. */
  load(): void {
    let read: { people?: unknown; invites?: unknown } = {};
    try { read = JSON.parse(readFileSync(this.file, 'utf8')) as typeof read; } catch { /* none yet */ }
    this.list = Array.isArray(read.people) ? (read.people as Person[]).filter((p) => typeof p?.person === 'string' && typeof p.token_sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.token_sha256) && Array.isArray(p.projects)) : [];
    this.invites = Array.isArray(read.invites) ? (read.invites as Invite[]).filter((i) => typeof i?.secret_sha256 === 'string' && typeof i.project === 'string' && i.expires > Date.now()) : [];
    const forges = [...this.list.flatMap((p) => p.projects), ...this.invites.map((i) => i.project)];
    this.shared = new Set(forges.map(projectIdOf));
    shareProjects(forges);
  }
  /** Whether anyone besides the owner is on any project here, an invited person included: without, nothing reads or writes differently. */
  get any(): boolean { return this.list.length > 0 || this.invites.length > 0; }
  /** The person a credential belongs to, with the key it is bound to; undefined for any other value. */
  holder(token: unknown): { person: string; key: string | undefined } | undefined {
    if (typeof token !== 'string' || !token) return undefined;
    const given = digest(token);
    const found = this.list.find((p) => timingSafeEqual(Buffer.from(p.token_sha256, 'hex'), given));
    return found && { person: found.person, key: found.key };
  }
  /** The IDs of the projects a person is on; the owner is on every shared project. */
  projects(person: string): Set<string> {
    return person === OWNER ? this.shared : new Set(this.list.filter((p) => p.person === person).flatMap((p) => p.projects.map(projectIdOf)));
  }
  private save(list: Person[], invites: Invite[]): void {
    const tmp = `${this.file}.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ v: 1, people: list, invites }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.load();
  }
  /**
   * Adds a person to the project of a forge repo, with a new credential, returned once and kept only as its digest; a
   * person already here joins one more project and their earlier credential stops counting.
   */
  add(person: string, forge: string): { person: string; token: string; project: string } {
    named(person);
    const token = randomBytes(32).toString('base64url');
    const at = this.list.filter((p) => p.person === person);
    const entry: Person = { person, token_sha256: digest(token).toString('hex'), projects: [...new Set([...at.flatMap((p) => p.projects), forge])] };
    this.save([...this.list.filter((p) => !at.includes(p)), entry], this.invites);
    return { person, token, project: projectIdOf(forge) };
  }
  /** A one-time invite for a person to the project of a forge repo (#1338): its secret, returned once. */
  invite(person: string, forge: string): string {
    named(person);
    const secret = randomBytes(32).toString('base64url');
    this.save(this.list, [...this.invites, { person, secret_sha256: digest(secret).toString('hex'), project: forge, expires: Date.now() + INVITE_MS }]);
    return secret;
  }
  /**
   * Spends an invite (#1338): a new credential for its person, bound to the key `key` the joining machine proved, and
   * the person on its project. An invite counts once; a spent, lapsed or unknown one is undefined.
   */
  redeem(secret: unknown, key: string): { person: string; token: string; project: string } | undefined {
    if (typeof secret !== 'string' || !secret) return undefined;
    this.load();
    const given = digest(secret);
    const found = this.invites.find((i) => timingSafeEqual(Buffer.from(i.secret_sha256, 'hex'), given));
    if (!found) return undefined;
    const token = randomBytes(32).toString('base64url');
    this.save([...this.list, { person: found.person, token_sha256: digest(token).toString('hex'), projects: [found.project], key }], this.invites.filter((i) => i !== found));
    return { person: found.person, token, project: found.project };
  }
  /** Revokes every credential and open invite a person holds (#1338); how many there were. */
  revoke(person: string): number {
    const gone = this.list.filter((p) => p.person === person).length + this.invites.filter((i) => i.person === person).length;
    this.save(this.list.filter((p) => p.person !== person), this.invites.filter((i) => i.person !== person));
    return gone;
  }
}

function named(person: string): void {
  if (!NAME.test(person) || person === OWNER) throw Error(`name the person as a forge login (lowercase letters, digits and dashes), not ${JSON.stringify(person)}`);
}

/**
 * Who may see an event (#1337): a project people share is seen by everyone on it; anything else is its actor's personal
 * scope, which for the owner is `you`, as before.
 */
export const scopeOf = (people: People, actor: string, project: string | undefined): string =>
  project && people.projects(OWNER).has(project) ? `repo:${project}` : actor === OWNER ? OWNER : `person:${actor}`;

/** What an invite carries (#1338): where the hub is reached, its ID, the one-time secret, and the project and person. */
export interface InviteText { v: 1; address: string; hub: string; secret: string; project: string; person: string }
const INVITE_PREFIX = 'deepbuild-invite:';
export const inviteText = (invite: InviteText): string => `${INVITE_PREFIX}${Buffer.from(JSON.stringify(invite)).toString('base64url')}`;
/** An invite's text read back, or why it isn't one. */
export function inviteOf(text: string): InviteText | string {
  if (!text.startsWith(INVITE_PREFIX)) return `an invite starts ${INVITE_PREFIX}`;
  try {
    const v = JSON.parse(Buffer.from(text.slice(INVITE_PREFIX.length), 'base64url').toString('utf8')) as Partial<InviteText>;
    if (v.v === 1 && [v.address, v.hub, v.secret, v.project, v.person].every((x) => typeof x === 'string' && x)) return v as InviteText;
  } catch { /* below */ }
  return 'the invite is cut or altered: copy it again, whole';
}
