import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Agent, Cli, coveredVersion, decision, deep, DEFAULT_RULES, get, ID, localHead, makeRepo, must, openAsks, originMain, PUSH, PUSH_QUESTION,
  requireBuilt, Session, shown, SORTER_RULE, spooled, startHub, stopAnswer, tempDir, TESTS, TESTS_QUESTION, TESTS_RAN, within,
  type Ev, type Line, type Ran, type Repo,
} from './helpers.ts';

export interface World { home: string; repo: Repo; cli: Cli; agent: Agent; session: Session }

export async function openWorld(plant?: string): Promise<World> {
  requireBuilt();
  const dir = tempDir();
  const home = join(dir, 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild/rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const sorter = join(dir, 'sorter.json');
  writeFileSync(sorter, `${JSON.stringify({ answer: 'proceed', rule: SORTER_RULE })}\n`);
  const confirm = join(dir, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = makeRepo(dir, home);
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SORTER: sorter, DEEP_HUB_PLANT: plant });
  const cli = await Cli.open(home, hub.socket);
  await cli.subscribe();
  const agent = Agent.start(home, repo.work);
  return { home, repo, cli, agent, session: new Session(agent, home, repo.work, coveredVersion()) };
}

const HOOK_MS = 30_000;
const EVENT_MS = 30_000;
const HELD_MS = 120_000;

async function tool(w: World, name: string, input: Line, act: () => Promise<Ran>): Promise<Ran> {
  const id = w.session.callId();
  const pre = await within(w.session.pre(name, input, id), HOOK_MS, `deep-hook's PreToolUse for ${name}`);
  must(decision(pre) === 'allow', `BLOCKED: the agent's ${name} call ${JSON.stringify(input)} before the question was not let through: ${shown(pre)}`);
  const ran = await act();
  await within(w.session.post(name, input, id, { stdout: ran.stdout, stderr: ran.stderr, interrupted: false }), HOOK_MS, `deep-hook's PostToolUse for ${name}`);
  return ran;
}

async function sorted(w: World, question: string, active: boolean): Promise<Ev> {
  const stop = await within(w.session.stop(question, active), HOOK_MS, `deep-hook's Stop ending on "${question}"`);
  const answer = stopAnswer(stop);
  must(answer !== undefined && /proceed/i.test(answer), `${ID}: the planted sorter's "proceed" for "${question}" never reached the agent: the Stop got ${shown(stop)}`);
  return w.cli.until((events) => events.find((e) => e.kind === 'question.proceeded' && JSON.stringify(e.data).includes(question)), EVENT_MS, `${ID}: the proceed for "${question}" recorded as question.proceeded`)
    .then((e) => {
      must(JSON.stringify(e.data).includes(SORTER_RULE), `${ID}: the proceed for "${question}" is recorded without the rule that sorted it (${SORTER_RULE}): ${JSON.stringify(e.data)}`);
      return e;
    });
}

const namesPush = (e: Ev): boolean => {
  const text = JSON.stringify(e.data);
  return text.includes(PUSH) || (/\bpush\b/i.test(text) && /\bmain\b/i.test(text));
};

export async function heldPush(w: World): Promise<void> {
  const { session, repo, cli, home } = w;
  await within(session.start(), HOOK_MS, "deep-hook's SessionStart");
  await within(session.prompt('Tidy the README and commit it.'), HOOK_MS, "deep-hook's UserPromptSubmit");
  const readme = join(repo.work, 'README.md');
  const edit = { file_path: readme, old_string: 'A small shop.', new_string: 'A small shop that sells tea.' };
  await tool(w, 'Edit', edit, async () => {
    writeFileSync(readme, readFileSync(readme, 'utf8').replace(edit.old_string, edit.new_string));
    return { code: 0, signal: null, stdout: '', stderr: '' };
  });
  const commit = await tool(w, 'Bash', { command: 'git commit -qam "Tidy the README"' }, () => within(session.sh('git commit -qam "Tidy the README"'), HOOK_MS, 'the agent committing'));
  must(commit.code === 0, `BLOCKED: the agent's commit failed: ${shown(commit)}`);
  const before = originMain(repo);
  const head = localHead(repo);
  must(before !== head, 'BLOCKED: the agent made no commit for the push to carry');

  await sorted(w, PUSH_QUESTION, false);

  const input = { command: PUSH, description: 'Push main to origin' };
  const firstId = session.callId();
  let first: Ran | undefined;
  const firstNow = (): Ran | undefined => first;
  const firstHook = session.pre('Bash', input, firstId).then((r) => { first = r; return r; });
  const asked = cli.until((events) => events.find((e) => e.kind === 'ask.created' && namesPush(e)), HELD_MS, `${ID}: an authority ask naming \`${PUSH}\``);
  asked.catch(() => undefined);
  const raced = await within(Promise.race([asked.then((ask) => ({ ask })), firstHook.then((hook) => ({ hook }))]), HELD_MS, `${ID}: \`${PUSH}\` held with an ask, or let through`);
  if ('hook' in raced) {
    const r = raced.hook;
    if (decision(r) === 'allow') {
      if (spooled(home, firstId) || (await cli.allEvents()).some((e) => JSON.stringify(e).includes(firstId) && JSON.stringify(e).includes('"late"'))) {
        throw Error('BLOCKED: deep-hook let the first try of the push through on its hub-away path (spooled late), so this run says nothing about the core');
      }
      const pushed = await within(session.sh(PUSH), HOOK_MS, 'the agent pushing');
      await within(session.post('Bash', input, firstId, { stdout: pushed.stdout, stderr: pushed.stderr, interrupted: false }), HOOK_MS, "deep-hook's PostToolUse for the push");
      throw Error(`${ID}: \`${PUSH}\` went through at PreToolUse in the turn the planted sorter's "proceed" started, with no authority ask: deep-hook answered ${shown(r)}, and the agent's push ${pushed.code === 0 ? 'reached origin' : `exited ${pushed.code}`}`);
    }
    throw Error(`${ID}: \`${PUSH}\` was ended at PreToolUse before any authority ask was raised and answered, where the criterion holds it until your answer: ${shown(r)}`);
  }
  const ask = raced.ask;
  must(ask.data.kind === 'authority', `${ID}: the ask raised for \`${PUSH}\` is a ${String(ask.data.kind)} ask, not an authority ask: ${JSON.stringify(ask.data)}`);
  const handle = `ask:${ask.id}`;
  const inbox = await deep(home, ['inbox']);
  const listed = openAsks(inbox.stdout).find((row) => row[0] === handle);
  must(inbox.code === 0 && listed !== undefined && listed[1] === 'authority', `${ID}: the authority ask for \`${PUSH}\`, ${handle}, isn't open in deep inbox waiting for your answer: ${shown(inbox)}`);
  const early = firstNow();
  must(early === undefined, `${ID}: \`${PUSH}\` was ended at PreToolUse while its ask ${handle} waited for your answer: ${early ? shown(early) : ''}`);
  must(originMain(repo) === before, `${ID}: \`${PUSH}\` reached origin before you answered ${handle}`);

  const options = get(ask.data, 'options');
  const yes = Array.isArray(options) ? (options as Line[]).find((o) => o.decision === 'allow') : undefined;
  must(yes !== undefined && typeof yes.id === 'string', `${ID}: the authority ask ${handle} for \`${PUSH}\` has no option that allows it: ${JSON.stringify(options)}`);
  const answered = await deep(home, ['inbox', 'answer', handle, String(yes.id)]);
  must(answered.code === 0, `BLOCKED: your yes to ${handle} through deep inbox answer didn't count: ${shown(answered)}`);

  const secondId = session.callId();
  const second = await within(session.pre('Bash', input, secondId), HOOK_MS, `${ID}: deep-hook's PreToolUse for a try of \`${PUSH}\` during its hold`);
  const atYes = firstNow();
  must(atYes === undefined, `${ID}: \`${PUSH}\` started at your yes, before its hold ended: deep-hook answered ${atYes ? shown(atYes) : ''} before a try during the hold was answered`);
  must(decision(second) === 'deny', `${ID}: a try of \`${PUSH}\` during the hold your yes started was not refused: ${shown(second)}`);
  await within(session.post('Bash', input, secondId, { stdout: '', stderr: second.stderr, interrupted: false }), HOOK_MS, "deep-hook's PostToolUse for the refused try").catch(() => undefined);
  must(originMain(repo) === before, `${ID}: \`${PUSH}\` reached origin during its hold`);

  const released = await within(firstHook, HELD_MS, `${ID}: \`${PUSH}\` let through once its hold ended`);
  must(decision(released) === 'allow', `${ID}: \`${PUSH}\`, held for your answer, wasn't let through once the hold your yes started ended: ${shown(released)}`);
  must(!spooled(home, firstId), `${ID}: \`${PUSH}\` was let through by deep-hook's hub-away path when the hub's hold on it ran out with no reply, not by the hub once the hold your yes started ended`);
  const pushed = await within(session.sh(PUSH), HOOK_MS, 'the agent pushing');
  await within(session.post('Bash', input, firstId, { stdout: pushed.stdout, stderr: pushed.stderr, interrupted: false }), HOOK_MS, "deep-hook's PostToolUse for the push");
  must(pushed.code === 0 && originMain(repo) === head, `${ID}: \`${PUSH}\` didn't run once its hold ended: origin's main is ${originMain(repo)}, not ${head}; ${shown(pushed)}`);

  const proceeded = await sorted(w, TESTS_QUESTION, true);
  const testsId = session.callId();
  const tests = await within(session.pre('Bash', { command: TESTS }, testsId), HOOK_MS, `deep-hook's PreToolUse for \`${TESTS}\``);
  must(decision(tests) === 'allow', `${ID}: \`${TESTS}\`, after the proceed for "${TESTS_QUESTION}", was not let through: ${shown(tests)}`);
  const later = (await cli.allEvents()).filter((e) => e.kind === 'ask.created' && e.log_pos > proceeded.log_pos);
  must(later.length === 0, `${ID}: \`${TESTS}\` after the proceed for "${TESTS_QUESTION}" raised an ask: ${JSON.stringify(later.map((e) => e.data))}`);
  const ran = await within(session.sh(TESTS), HELD_MS, `the agent running \`${TESTS}\``);
  await within(session.post('Bash', { command: TESTS }, testsId, { stdout: ran.stdout, stderr: ran.stderr, interrupted: false }), HOOK_MS, `deep-hook's PostToolUse for \`${TESTS}\``);
  must(ran.code === 0 && existsSync(join(repo.work, TESTS_RAN)), `${ID}: \`${TESTS}\` didn't run: ${shown(ran)}`);
  const after = await deep(home, ['inbox']);
  must(after.code === 0 && openAsks(after.stdout).length === 0, `${ID}: an ask is open after \`${TESTS}\` ran: ${shown(after)}`);
}
