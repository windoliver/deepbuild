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

interface Person { person: string; token_sha256: string; projects: string[] }
const digest = (token: string): Buffer => createHash('sha256').update(token).digest();

export class People {
  private list: Person[] = [];
  /** The IDs of every project people share here. */
  private shared = new Set<string>();
  private readonly file: string;
  constructor(dir: string) {
    this.file = join(dir, 'people.json');
    this.load();
  }
  /** Reads people.json again, and names the forge repos they share for this thread's repoOf. */
  load(): void {
    try {
      const people = (JSON.parse(readFileSync(this.file, 'utf8')) as { people?: unknown }).people;
      this.list = Array.isArray(people) ? (people as Person[]).filter((p) => typeof p?.person === 'string' && typeof p.token_sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.token_sha256) && Array.isArray(p.projects)) : [];
    } catch {
      this.list = [];
    }
    const forges = this.list.flatMap((p) => p.projects);
    this.shared = new Set(forges.map(projectIdOf));
    shareProjects(forges);
  }
  /** Whether anyone besides the owner is on any project here: without, nothing reads or writes differently. */
  get any(): boolean { return this.list.length > 0; }
  /** The person a credential belongs to; undefined for any other value. */
  holder(token: unknown): string | undefined {
    if (typeof token !== 'string' || !token) return undefined;
    const given = digest(token);
    return this.list.find((p) => timingSafeEqual(Buffer.from(p.token_sha256, 'hex'), given))?.person;
  }
  /** The IDs of the projects a person is on; the owner is on every shared project. */
  projects(person: string): Set<string> {
    return person === OWNER ? this.shared : new Set(this.list.filter((p) => p.person === person).flatMap((p) => p.projects.map(projectIdOf)));
  }
  /**
   * Adds a person to the project of a forge repo, with a new credential, returned once and kept only as its digest; a
   * person already here joins one more project and their earlier credential stops counting.
   */
  add(person: string, forge: string): { person: string; token: string; project: string } {
    if (!NAME.test(person) || person === OWNER) throw Error(`name the person as a forge login (lowercase letters, digits and dashes), not ${JSON.stringify(person)}`);
    const token = randomBytes(32).toString('base64url');
    const at = this.list.find((p) => p.person === person);
    const entry: Person = { person, token_sha256: digest(token).toString('hex'), projects: [...new Set([...(at?.projects ?? []), forge])] };
    const list = [...this.list.filter((p) => p !== at), entry];
    const tmp = `${this.file}.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ v: 1, people: list }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.load();
    return { person, token, project: projectIdOf(forge) };
  }
}

/**
 * Who may see an event (#1337): a project people share is seen by everyone on it; anything else is its actor's personal
 * scope, which for the owner is `you`, as before.
 */
export const scopeOf = (people: People, actor: string, project: string | undefined): string =>
  project && people.projects(OWNER).has(project) ? `repo:${project}` : actor === OWNER ? OWNER : `person:${actor}`;
