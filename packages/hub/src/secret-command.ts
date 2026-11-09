// `deep secret add <package> <name>` and `deep secret list [--json]` (#70): on Linux the CLI is the trusted path for
// secrets until the app ships there. The value is typed at a terminal with echo off, so it's never in an argument, a
// variable or the scrollback, and the hub keeps it only in the OS secret store, once the OS confirms you.
import { callAsYou } from './client.js';

/** One line typed at the terminal with echo off, or undefined when you stop it with Ctrl-C or Ctrl-D. */
function typed(prompt: string): Promise<string | undefined> {
  return new Promise((done) => {
    const input = process.stdin;
    process.stdout.write(prompt);
    const bytes: number[] = [];
    const finish = (result: string | undefined) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', key);
      process.stdout.write('\n');
      done(result);
    };
    const key = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3 || byte === 4) return finish(undefined);
        if (byte === 10 || byte === 13) return finish(Buffer.from(bytes).toString('utf8'));
        if (byte === 127 || byte === 8) bytes.pop();
        else bytes.push(byte);
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', key);
  });
}

export async function secretCommand(args: string[]): Promise<number> {
  if (args[0] === 'list' && args.length <= 2 && (args[1] === undefined || args[1] === '--json')) {
    const result = await callAsYou('secret.list', {}, 'no secret was read');
    if (typeof result === 'number') return result;
    const held = result.held as { secret: string; provider: string }[];
    for (const one of held) process.stdout.write(args[1] ? `${JSON.stringify(one)}\n` : `${one.provider} ${one.secret}\n`);
    return 0;
  }
  const [verb, extension, name] = args;
  if (verb !== 'add' || !extension || !name || args.length !== 3) {
    process.stderr.write('usage: deep secret add <package> <name> | deep secret list [--json]\n');
    return 2;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write('deep secret add reads the value at your terminal, and this has none, so nothing was saved\n');
    return 3;
  }
  const value = await typed(`The value of ${name} for ${extension}: `);
  if (!value) {
    process.stderr.write('nothing was saved\n');
    return 3;
  }
  const result = await callAsYou('secret.enter', { extension, name, value }, 'nothing was saved');
  if (typeof result === 'number') return result;
  process.stdout.write(result.saved ? `Saved ${name} for ${extension} in the OS secret store.\n` : `${name} wasn't saved: its key test didn't pass.\n`);
  return result.saved ? 0 : 3;
}
