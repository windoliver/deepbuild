// #84 URL_PLAIN and TRUSTED_PATH: an unblock names a provider or a secret, never a URL, and the trusted path supplies
// where to go (design: Tasks only you can do; Question card: "A URL in the ask's text draws as plain text with its host,
// never as a link or a button"). Wrong program: DEEP_HUB_PLANT=link-from-agent-url, a view that makes the URL a link.
import { isDeepStrictEqual } from 'node:util';
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  TRUSTED_PATH, URL_PLAIN, cardOf, cleanup, CodexSession, deepInbox, failureOf, item, lastPos, linkFields, linkInText, makeWorld, must, needsYou, optionsOf, reachedYou, Session,
  startCodexOnItem, startHub, startOnItem, verdict, type Ev, type Hub, type Line, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

const HOST = 'login-github.example';

/** The card's document, or a failure saying the surface is missing. */
async function theCard(hub: Hub, task: Ev, who: string): Promise<Line> {
  try {
    return await cardOf(hub, task);
  } catch (error) {
    throw Error(`${who} ask.card over the hub's socket gives the question card's document (README, Surfaces the implementer must provide): ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Views { task: Ev; row: Line; inbox: Ran; card: Line }
async function viewsOf(plant?: string): Promise<Views> {
  const w = makeWorld({ items: [item(911)] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await startOnItem(hub, s, 911, URL_PLAIN);
  await s.bump();
  const since = await lastPos(hub);
  await s.stop(`unblock: sign in at https://${HOST}/session to continue`);
  const task = await reachedYou(hub, s, since, URL_PLAIN);
  const row = (await needsYou(hub)).find((r) => r.ask === `ask:${task.id}`)!;
  return { task, row, inbox: await deepInbox(w), card: await theCard(hub, task, URL_PLAIN) };
}
function judged(v: Views): void {
  must(JSON.stringify(v.row).includes(HOST), `${URL_PLAIN} Needs you shows the URL as plain text with its host, ${HOST}: ${JSON.stringify(v.row).slice(0, 400)}`);
  const inRow = linkFields(v.row, HOST);
  must(inRow.length === 0, `${URL_PLAIN} Needs you turned the agent's URL into a link or a button: ${inRow.join('; ')}`);
  must(v.inbox.code === 0 && v.inbox.stdout.includes(HOST), `${URL_PLAIN} deep inbox shows the URL as plain text with its host, ${HOST}: ${v.inbox.stdout.slice(0, 400)}`);
  const inInbox = linkInText(v.inbox.stdout);
  must(inInbox === undefined, `${URL_PLAIN} deep inbox turned the agent's URL into a link: ${JSON.stringify(inInbox)} in ${JSON.stringify(v.inbox.stdout.slice(0, 400))}`);
  must(JSON.stringify(v.card).includes(HOST), `${URL_PLAIN} the question card shows the URL as plain text with its host, ${HOST}: ${JSON.stringify(v.card).slice(0, 400)}`);
  const onCard = linkFields(v.card, HOST);
  must(onCard.length === 0, `${URL_PLAIN} the question card turned the agent's URL into a link or a button: ${onCard.join('; ')}`);
}

describe(`${URL_PLAIN} an agent that ends its turn with "unblock: sign in at https://${HOST}/session to continue" raises a task whose URL shows as plain text with its host, with no button or link to it`, () => {
  it(`${URL_PLAIN} the task's URL is plain text with its host in Needs you, in deep inbox and on the question card, with no link or button`, async (ctx) => verdict(ctx, async () => {
    judged(await viewsOf());
  }), 600_000);

  it(`${URL_PLAIN} (wrong program) a view that turns the agent's URL into a link or a button (DEEP_HUB_PLANT=link-from-agent-url) fails this test`, async (ctx) => verdict(ctx, async () => {
    const v = await viewsOf('link-from-agent-url');
    const failure = await failureOf(async () => judged(v));
    must(failure !== null, `${URL_PLAIN} the planted view must fail this test: it passed`);
    must(/link or a button|into a link/.test(failure), `${URL_PLAIN} the failure names the link: ${failure}`);
  }), 600_000);
});

/** Fails unless the task opens `want`, shown in every view, and holds no URL the agent wrote where you'd go. */
async function opens(hub: Hub, inbox: Ran, task: Ev, want: Line, line: string, agentHost: string, who: string): Promise<void> {
  const card = await theCard(hub, task, who);
  must(isDeepStrictEqual(card.opens, want), `${who} the card opens ${JSON.stringify(want)} (README, Surfaces the implementer must provide): ${JSON.stringify(card).slice(0, 500)}`);
  const row = (await needsYou(hub)).find((r) => r.ask === `ask:${task.id}`);
  must(isDeepStrictEqual(row?.opens, want), `${who} Needs you opens ${JSON.stringify(want)}: ${JSON.stringify(row).slice(0, 500)}`);
  must(inbox.stdout.includes(line), `${who} deep inbox says ${line}: ${inbox.stdout.slice(0, 400)}`);
  const where = JSON.stringify({ opens: card.opens, where: task.data.where, steps: task.data.steps, options: optionsOf(task) });
  must(!where.includes(agentHost) && !/https?:/.test(where), `${who} the task sends you nowhere the agent wrote: ${where.slice(0, 500)}`);
}

describe(`${TRUSTED_PATH} a task that names the secret \`STRIPE_API_KEY\` opens that secret's entry field, and one that names Codex's sign-in offers \`codex login\`, each with no URL the agent wrote`, () => {
  it(`${TRUSTED_PATH} the secret's task opens its entry field and Codex's sign-in offers codex login, though each agent wrote a URL`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(921), item(922)] });
    const hub = await startHub(w);

    const claude = new Session(w);
    await startOnItem(hub, claude, 921, TRUSTED_PATH);
    await claude.bump();
    const since1 = await lastPos(hub);
    await claude.stop('unblock: set the secret STRIPE_API_KEY at https://keys-stripe.example/new so the payment check can run.');
    const secret = await reachedYou(hub, claude, since1, `${TRUSTED_PATH} (a secret)`);

    const codex = new CodexSession(w);
    await startCodexOnItem(hub, codex, 922, TRUSTED_PATH);
    await codex.shell('true');
    const since2 = await lastPos(hub);
    await codex.stop('unblock: sign in to Codex at https://auth-codex.example/device to continue.');
    const signIn = await reachedYou(hub, codex, since2, `${TRUSTED_PATH} (Codex's sign-in)`);

    const inbox = await deepInbox(w);
    await opens(hub, inbox, secret, { kind: 'secret', name: 'STRIPE_API_KEY' }, 'STRIPE_API_KEY', 'keys-stripe.example', `${TRUSTED_PATH} (a secret)`);
    await opens(hub, inbox, signIn, { kind: 'sign_in', command: 'codex login' }, 'codex login', 'auth-codex.example', `${TRUSTED_PATH} (Codex's sign-in)`);
  }), 600_000);
});
