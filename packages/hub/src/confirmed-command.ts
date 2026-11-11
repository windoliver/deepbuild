// `deep library on | off | rule`, `deep pack rule`, `deep job rule` and `deep person invite | revoke`: each is one call
// the hub takes only from your own terminal, once the OS confirms you (#1731, #1820, #1922, #1338); run inside an
// agent's process tree, it changes nothing. A library ships off, so `deep library on` is what puts it in deep_kinds'
// asset search, and `deep person invite` prints the one-time invite `deep join` takes.
import { callAsYou } from './client.js';

type Obj = Record<string, unknown>;
/** One call, and the line that says what it did. */
interface Call { method: string; params: Obj; done(result: Obj): string }

const USAGE: Record<string, string> = {
  library: 'Usage: deep library on <library>\n       deep library off <library>\n       deep library rule <library> <license>...',
  pack: 'Usage: deep pack rule <owner/name> <license>...',
  job: 'Usage: deep job rule <tool@version> <usd>',
  person: "Usage: deep person invite <login> --address <host>:<port>, in a clone of the project's repo\n       deep person revoke <login>",
};

/** The call a command line makes, or undefined when it is none of its command's forms: a flag is never read as a name. */
function parsed([command, verb, name, ...rest]: readonly string[]): Call | undefined {
  if (!name || name.startsWith('-')) return undefined;
  const licenses = rest.length > 0 && rest.every((arg) => !arg.startsWith('-'));
  if (command === 'library' && (verb === 'on' || verb === 'off') && !rest.length) return { method: `library.${verb}`, params: { library: name }, done: () => `Turned ${name} ${verb}.` };
  if (command === 'library' && verb === 'rule' && licenses) return { method: 'library.rule', params: { library: name, licenses: rest }, done: () => `${name} fetches under ${rest.join(', ')} with no ask.` };
  if (command === 'pack' && verb === 'rule' && licenses) return { method: 'pack.rule', params: { pack: name, licenses: rest }, done: () => `${name} fetches its assets under ${rest.join(', ')} with no ask.` };
  if (command === 'job' && verb === 'rule' && rest.length === 1 && /^\d+(?:\.\d+)?$/.test(rest[0]!)) return { method: 'job.rule', params: { tool: name, usd: Number(rest[0]) }, done: () => `${name} runs at up to $${rest[0]} a run with no ask.` };
  if (command === 'person' && verb === 'invite' && rest.length === 2 && rest[0] === '--address') {
    return { method: 'person.invite', params: { person: name, repo: process.cwd(), address: rest[1] }, done: (r) => `Invited ${name}. They run deep join <repo link> --invite with this, in a clone of the repo, within 24 hours:\n${String(r.invite)}` };
  }
  if (command === 'person' && verb === 'revoke' && !rest.length) return { method: 'person.revoke', params: { person: name }, done: (r) => `Revoked ${String(r.revoked)} of ${name}'s credentials and invites.` };
  return undefined;
}

/** Exit 0 done, 2 usage or a name the hub doesn't hold, 3 not decided: not confirmed, an agent's command, or no hub. */
export async function confirmedCommand(args: readonly string[]): Promise<number> {
  const asked = parsed(args);
  if (!asked) {
    process.stderr.write(`${USAGE[args[0]!]}\n`);
    return 2;
  }
  const result = await callAsYou(asked.method, asked.params, 'nothing changed');
  if (typeof result === 'number') return result;
  process.stdout.write(`${asked.done(result)}\n`);
  return 0;
}
