// `deep "<words>" [--file <path>]... [--json]` (#1342): your words, with any file you attach, to the running hub as
// the app's box sends them. It waits until the card is ready, or the brief is refused, and says which in plain words;
// with --json, the card's ask or the reason. It asks nothing itself: the card comes to your list.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = 'Usage: deep "<what you want done>" [--file <path>]... [--json]';
/** How often it reads where the brief is, and how long it waits for the card. */
const EVERY_MS = 1000;
const WAIT_MS = 30 * 60_000;

export async function wordsCommand(args: readonly string[]): Promise<number> {
  const files: string[] = [];
  let json = false;
  let words: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--file' && args[i + 1]) files.push(resolve(args[++i]!));
    else if (words === undefined) words = args[i];
    else { process.stderr.write(`${USAGE}\n`); return 2; }
  }
  if (!words?.trim()) { process.stderr.write(`${USAGE}\n`); return 2; }
  const say = async (): Promise<Record<string, unknown>> => {
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), 'box.say', { words, files });
    if ('error' in reply) throw new Refusal(reply.error.remediation);
    return reply.result as Record<string, unknown>;
  };
  try {
    // The same words again only read where their brief is: nothing new is written.
    let r = await say();
    if (r.state === 'working' && !json) process.stdout.write(`Working on it: ${String(r.heading)}. It shows in your list while the research runs.\n`);
    for (const end = Date.now() + WAIT_MS; (r.state === 'working' || r.state === 'applying') && Date.now() < end;) {
      await sleep(EVERY_MS);
      r = await say();
    }
    if (json) process.stdout.write(`${JSON.stringify(r)}\n`);
    else if (typeof r.unread === 'string') process.stdout.write(`${r.unread}\n`);
    else if (r.state === 'needs you') process.stdout.write(`Its card is ready: deep inbox shows it (${String(r.ask)}).\n`);
    else if (r.state === 'running') process.stdout.write(`${String(r.heading)} is made and running, in ${String(r.folder)}.\n`);
    else if (r.state === 'refused') process.stdout.write(`No card: ${String(r.reason)}\n`);
    else process.stdout.write(`Still working on ${String(r.heading)}; deep shows it in your list.\n`);
    return typeof r.unread === 'string' || r.state === 'refused' ? 2 : r.state === 'working' ? 3 : 0;
  } catch (error) {
    process.stderr.write(error instanceof Refusal ? `${error.message}\n` : `BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof Refusal ? 1 : 3;
  }
}
class Refusal extends Error {}
