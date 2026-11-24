// #788: a block-mode guard entry still decides first. A call it matches is blocked with the entry's words and the
// extension's tool.before handler is never asked about it.
//
// The handler counts every call it is asked about that names `probe-me`, and gives the count as context on a call
// naming `report-me` (helpers.ts). So what the handler was asked is read from the handler itself: after a blocked
// probe the count is 0, and after one probe no entry matches it is 1, which shows the count works.
import { describe, expect, it } from 'vitest';
import { BLOCK, DENY_WORDS, EXT, contextOf, withWorld } from './helpers.ts';

describe('#788 a block-mode guard entry and an extension on the same call', () => {
  it('#788.8c6af1bc a block-mode entry still decides first: the extension isn\'t asked', async () => {
    await withWorld({ [BLOCK.name]: BLOCK.entry }, async (w) => {
      const blocked = await w.call('echo probe-me', [BLOCK.name]);
      expect(blocked.reply.exit, 'the block-mode entry blocks the call').toBe(2);
      expect(blocked.reply.stderr, 'with its own reason').toContain(BLOCK.entry.reason);
      expect(blocked.reply.stderr, 'naming the entry').toContain(BLOCK.name);
      expect(blocked.reply.stderr, 'the extension has no word in the block').not.toContain(EXT);

      // A call the extension would deny, also blocked by the entry: the entry's block is the reply, not the extension's.
      const both = await w.call('echo probe-me deny-me', [BLOCK.name]);
      expect(both.reply.exit).toBe(2);
      expect(both.reply.stderr, 'the entry decides').toContain(BLOCK.entry.reason);
      expect(both.reply.stderr, 'the extension was not asked, so its deny is not there').not.toContain(DENY_WORDS);
      expect(both.reply.stderr).not.toContain(EXT);

      const before = await w.call('true report-me');
      expect(before.reply.exit).toBe(0);
      expect(contextOf(before.reply), 'the handler was asked about none of the two blocked calls').toContain('0 probes seen');

      // The count works: a probe no entry matches is put to the handler, and the next report says so.
      const open = await w.call('true probe-me');
      expect(open.reply.exit, 'an unmatched probe runs').toBe(0);
      const after = await w.call('true report-me');
      expect(contextOf(after.reply), 'the handler counted the probe it was asked about').toContain('1 probes seen');
    });
  }, 300_000);
});
