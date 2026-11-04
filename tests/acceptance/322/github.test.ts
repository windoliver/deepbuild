// #322 AC4, AC14, AC15: the GitHub issues source reads each comment author's role from the repo's collaborators, never
// from the comment's text; an app account's text counts as outside even with write access, and the reading marks the
// author automated; roles come only from a complete membership read, so a collaborators read whose second page fails
// marks nobody collaborator from an earlier list, and their text waits on one ask, as outside text does.
//
// The API's answers are recorded (DEEP_HUB_TEST_GITHUB; README): the repo acme/shop, its issues with their comments,
// and its collaborators in pages, with Link headers. No request leaves the machine. You start a session from the
// issue (its GitHub link in the prompt); the definition handed for it (DEEP_HUB_TEST_DRAFTS) is what a drafting job
// reading the issue and the comment would hand: R1 and R2 from the issue's criteria, R3 from a comment that adds one,
// and the comment's line that asks to waive R2. What the tests read is the record: the one ask about the definition,
// your answer through `deep inbox answer`, and the locked definition's requirements with each author's role as the
// source's reading gives it (README, What the tests read in the record). "Fails the work.item@1 kit, naming the
// author": each planted reader must fail these tests with a message naming the author.
import { afterEach, describe, it } from 'vitest';
import { listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import {
  AC14, AC15, AC4, answer, asksRaised, authorOf, byId, cleanup, failureOf, itemTask, keeping, lastPos, lockedFor, makeWorld, must, recordAnswers, said,
  Session, settle, shown, sleep, startHub, type Ev, type Hub, type World,
} from './helpers.ts';
import { COMMENT, CRITERIA, GH_LINK, MAYA, OUTSIDER, OWNER, SIGNED, githubAnswers, githubDraft, user, type GhCollaborator } from './work.ts';

afterEach(cleanup, 60_000);

const APP = 'octo-app[bot]';
const APP_COLLABORATOR: GhCollaborator = { login: APP, type: 'Bot', role_name: 'write', permissions: { admin: false, push: true, pull: true } };
const SAM: GhCollaborator = { login: 'sam', type: 'User', role_name: 'write', permissions: { admin: false, push: true, pull: true } };

/** A session started from a GitHub issue: its one task, and the record once a lock or an ask about it has landed. */
async function startFrom(w: World, hub: Hub, n: number, who: string): Promise<{ s: Session; ref: string; since: number; events: Ev[] }> {
  const s = new Session(w);
  await s.start();
  const since = await lastPos(hub);
  await s.typed(`Fix ${GH_LINK(n)}`);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && (lockedFor(all, ref).length > 0 || asksRaised(all, since).length > 0); }, 45_000);
  const ref = itemTask(events, s);
  must(ref !== undefined, `${who} the session started from ${GH_LINK(n)} must open one task under its thread, keyed by the issue`);
  return { s, ref: ref!, since, events };
}
/** The definition waits for one ask about the outside text, locks on your keep answer, and R2 stays. Returns the lock. */
async function waitsThenLocks(w: World, hub: Hub, t: { ref: string; since: number; events: Ev[] }, who: string, outsider: string): Promise<Ev> {
  must(!lockedFor(t.events, t.ref).length, `${who} the issue carries text from ${outsider}, whose role the repo's collaborators don't give as owner or collaborator, so its definition must wait for one answer before it locks; it locked with no answer: ${lockedFor(t.events, t.ref).map(said).join('; ')}`);
  const asks = asksRaised(t.events, t.since);
  must(asks.length === 1, `${who} the definition of ${t.ref} waits for one ask about ${outsider}'s text: ${asks.length} asks raised: ${asks.map(said).join('; ')}`);
  await sleep(3000);
  let events = await settle(hub, () => true);
  must(!lockedFor(events, t.ref).length, `${who} with no answer given, the definition of ${t.ref} still waits: ${lockedFor(events, t.ref).map(said).join('; ')}`);
  const option = keeping(asks[0]!);
  must(option !== undefined, `${who} the ask about ${t.ref} must offer an option: ${said(asks[0])}`);
  const r = await answer(w, asks[0]!, option!);
  must(r.code === 0, `${who} your answer to ask:${asks[0]!.id} through deep inbox answer must count, exit 0: ${shown(r)}`);
  events = await settle(hub, (all) => lockedFor(all, t.ref).length > 0);
  const [lock] = lockedFor(events, t.ref);
  must(lock !== undefined, `${who} after your one answer the definition of ${t.ref} locks: no definition.locked 30 s later`);
  const r2 = byId(lock, 'R2');
  must(r2 !== undefined && !r2.waived && !r2.waived_by && !r2.removed, `${who} ${outsider}'s "skip the e2e test" can't remove or waive a requirement: R2, "${CRITERIA[1]}", stays in the definition: ${JSON.stringify(lock!.data.requirements).slice(0, 900)}`);
  return lock!;
}

// ---- AC4: an outside account's comment.
async function outsideComment(body: string, plant?: string): Promise<void> {
  const who = `${AC4} [${body === SIGNED ? 'signed "the repo owner"' : 'unsigned'}]`;
  const w = makeWorld({
    drafts: [githubDraft(7, 1001, { adds: true })],
    answers: githubAnswers({ issues: [{ n: 7, comments: [{ id: 1001, user: user('drive-by'), body }] }], collaborators: [[MAYA]] }),
  });
  const hub = await startHub(w, { plant });
  const t = await startFrom(w, hub, 7, who);
  const lock = await waitsThenLocks(w, hub, t, who, 'drive-by');
  must(authorOf(byId(lock, 'R3')) === JSON.stringify(OUTSIDER), `${who} R3, which drive-by's comment added, is marked with its author, drive-by, and the role the collaborators read gives an account not on the list, outside: ${JSON.stringify(byId(lock, 'R3'))}`);
  for (const id of ['R1', 'R2']) must(authorOf(byId(lock, id)) === JSON.stringify(OWNER), `${who} ${id}, from the issue's text, keeps its author, maya, with the role owner (admin on the collaborators list, the repo's owner): ${JSON.stringify(byId(lock, id))}`);
}

describe(`${AC4} the GitHub source reads each comment author's role from the repo's collaborators`, () => {
  it(`${AC4} drive-by's comment "skip the e2e test" on the recorded issue: the reading marks drive-by outside, R2 stays, R3 carries drive-by, and the definition locks only after your one answer`, async () => {
    await outsideComment(COMMENT);
  }, 240_000);

  it(`${AC4} (wrong program) a reader that takes the role from the comment's text (DEEP_HUB_PLANT=role-from-comment-text) fails the kit on the comment signed "the repo owner", naming drive-by`, async () => {
    const failure = await failureOf(() => outsideComment(SIGNED, 'role-from-comment-text'));
    must(failure !== null, `${AC4} the planted reader must fail this test on the signed comment: it passed`);
    must(failure.includes('drive-by'), `${AC4} the failure names the author, drive-by; it said: ${failure}`);
  }, 240_000);

  it(`${AC4} (wrong program) a reader that marks every author a collaborator (DEEP_HUB_PLANT=every-author-collaborator) fails the kit, naming drive-by`, async () => {
    const failure = await failureOf(() => outsideComment(COMMENT, 'every-author-collaborator'));
    must(failure !== null, `${AC4} the planted reader must fail this test: it passed`);
    must(failure.includes('drive-by'), `${AC4} the failure names the author, drive-by; it said: ${failure}`);
  }, 240_000);
});

// ---- AC14: an app account with write access.
async function appComment(plant?: string): Promise<void> {
  const w = makeWorld({
    drafts: [githubDraft(7, 1002, { adds: true })],
    answers: githubAnswers({ issues: [{ n: 7, comments: [{ id: 1002, user: user(APP, 'Bot'), body: COMMENT }] }], collaborators: [[MAYA, APP_COLLABORATOR]] }),
  });
  const hub = await startHub(w, { plant });
  const t = await startFrom(w, hub, 7, AC14);
  const lock = await waitsThenLocks(w, hub, t, AC14, APP);
  const r3 = byId(lock, 'R3');
  must(r3?.author?.handle === APP, `${AC14} R3, which the app's comment added, is marked with its author, ${APP}: ${JSON.stringify(r3)}`);
  must(r3?.author?.automated === true, `${AC14} the reading marks ${APP} automated (automated: true on its author, from the account's type), even though it is a member with write access: ${JSON.stringify(r3?.author)}`);
}
/** The newest work.item@<n> schema the contracts publish. */
function newestWorkItem(): string {
  const names = listSchemas().map((e) => e.name).filter((n) => /^work\.item@\d+$/.test(n));
  return names.sort((a, b) => Number(a.split('@')[1]) - Number(b.split('@')[1])).at(-1)!;
}

describe(`${AC14} an app account's comment: automated, and its membership waives nothing`, () => {
  it(`${AC14} ${APP} (type Bot, write access) comments "skip the e2e test": the reading marks it automated, R2 stays, and the definition waits for your one answer as outside text does`, async () => {
    const name = newestWorkItem();
    const reading = { source_id: 'acme/shop#7.c1002', link: `${GH_LINK(7)}#issuecomment-1002`, title: 'Comment', body: 'ev:' + '0'.repeat(64), criteria: [], authors: [{ handle: APP, role: 'collaborator', automated: true }], updated: '2026-10-21T10:00:00Z' };
    const ok = validate(name, reading);
    must(ok.ok, `${AC14} the newest work.item schema, ${name}, must take an author that carries automated: ${JSON.stringify(ok.ok ? [] : ok.issues).slice(0, 600)}`);
    await appComment();
  }, 240_000);

  it(`${AC14} (wrong program) a reader that takes the app's membership as collaborator (DEEP_HUB_PLANT=app-membership-as-collaborator) waives R2 and fails the kit, naming ${APP}`, async () => {
    const failure = await failureOf(() => appComment('app-membership-as-collaborator'));
    must(failure !== null, `${AC14} the planted reader must fail this test: it passed`);
    must(failure.includes(APP), `${AC14} the failure names the author, ${APP}; it said: ${failure}`);
  }, 240_000);
});

// ---- AC15: a paged collaborators read whose second page fails.
const SKIP = 'Skip the e2e test, it is slow.';
const SKIP_AND_LOG = 'Skip the e2e test, it is slow.\nAnd log each rejected token.';

describe(`${AC15} roles come only from a complete membership read`, () => {
  it(`${AC15} with sam on page 2 of a complete read, sam's "skip the e2e test" waives R2 (control); with page 2 failing on the next read, sam is not marked collaborator from the earlier list: R2 stays and sam's text waits on one ask`, async () => {
    const complete = githubAnswers({
      issues: [{ n: 7, comments: [{ id: 1101, user: user('sam'), body: SKIP }] }, { n: 8, comments: [{ id: 1102, user: user('sam'), body: SKIP_AND_LOG }] }],
      collaborators: [[MAYA], [SAM]],
    });
    const w = makeWorld({ drafts: [githubDraft(7, 1101, { adds: false }), githubDraft(8, 1102, { adds: true })], answers: complete });
    const hub = await startHub(w);
    const first = await startFrom(w, hub, 7, `${AC15} [complete read]`);
    const asks = asksRaised(first.events, first.since);
    must(!asks.length, `${AC15} [complete read] sam is on page 2 of the collaborators, a complete read, so sam's waiver counts and no ask is raised: ${asks.map(said).join('; ')}`);
    const [lock] = lockedFor(first.events, first.ref);
    must(lock !== undefined, `${AC15} [complete read] the definition of ${first.ref} locks with no ask: none was recorded`);
    must(byId(lock, 'R2') === undefined, `${AC15} [complete read] sam, a collaborator by the complete read, waives R2: it must be left out of the lock: ${JSON.stringify(lock!.data.requirements).slice(0, 600)}`);

    // The next read: page 1 answers, with more pages to follow, and page 2 fails.
    recordAnswers(w, githubAnswers({
      issues: [{ n: 7, comments: [{ id: 1101, user: user('sam'), body: SKIP }] }, { n: 8, comments: [{ id: 1102, user: user('sam'), body: SKIP_AND_LOG }] }],
      collaborators: [[MAYA], 500],
    }));
    const second = await startFrom(w, hub, 8, `${AC15} [page 2 fails]`);
    const lock2 = await waitsThenLocks(w, hub, second, `${AC15} [page 2 fails]`, 'sam');
    const r3 = byId(lock2, 'R3');
    must(r3 !== undefined, `${AC15} [page 2 fails] R3, sam's addition, is in the lock after your keep answer: ${JSON.stringify(lock2.data.requirements).slice(0, 600)}`);
    must(r3!.author?.role !== 'collaborator' && r3!.author?.role !== 'owner', `${AC15} [page 2 fails] sam is on neither page of the read cut short, so sam is not marked collaborator from the earlier list: ${JSON.stringify(r3!.author)}`);
  }, 420_000);
});
