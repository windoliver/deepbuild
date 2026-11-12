// #1409 AC5: a run under its limits gets the same exit status and output as with none. The planted allocator (96 MiB)
// and writer (6 MiB), each under its parent and each ending with an exit status of its own, run once with no `limits`
// and once under `{ memory_mb: 128, file_mb: 8 }`. The child reads its own file-size limit into its folder, never its
// output, which shows the limits were in force in the second run (README, How the issue was read).
import { describe, expect, it } from 'vitest';
import { fsize, MIB, openWorld, runPlanted, tempDir, type Ran, type World } from './helpers.ts';

const LIMITS = { memory_mb: 128, file_mb: 8 };
/** What a run ended with that its caller sees: its exit status, its output and the output's digests. */
const seen = (r: Ran) => (r.exit === 'running' ? 'running' : { code: r.exit.code, signal: r.exit.signal, stdout: r.stdout, stderr: r.stderr, evidence: r.exit.evidence });

async function twice(w: World, args: (dir: string) => string[]): Promise<{ none: Ran; under: Ran; limit: string | undefined }> {
  const plain = tempDir('none');
  const none = await runPlanted(w, { dir: plain, args: args(plain) });
  const limited = tempDir('under');
  const under = await runPlanted(w, { dir: limited, args: args(limited), limits: LIMITS });
  return { none, under, limit: fsize(limited) };
}

describe('AC5 #1409 a run under its limits ends as it would with none', () => {
  it('AC5 the allocator and the writer under memory_mb 128 and file_mb 8 get the same exit status and output as with no limits', async () => {
    const w = await openWorld();
    try {
      const alloc = await twice(w, (dir) => ['alloc', dir, '96', '128', '1000', '3']);
      const write = await twice(w, (dir) => ['write', dir, 'small.bin', '6', '4']);
      for (const [name, r] of [['allocator', alloc], ['writer', write]] as const) {
        // 8 MiB, or 8 MB: the issue gives sizes in MiB, and the field's name in MB.
        const bytes = Number(r.limit);
        expect(bytes >= 8_000_000 && bytes <= 8 * MIB, `the ${name}'s run had its file limit in force: its child's RLIMIT_FSIZE was ${r.limit}`).toBe(true);
        expect(seen(r.none), `the ${name}'s run with no limits ended on its own`).toMatchObject({ code: name === 'allocator' ? 3 : 4, signal: null });
        expect(seen(r.under), `the ${name}'s run under its limits ended with the same exit status and output as with none`).toEqual(seen(r.none));
      }
    } finally {
      await w.close();
    }
  }, 300_000);
});
