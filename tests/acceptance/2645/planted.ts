// The wrong reader #2645 AC3 names, "a planted reader that drops a line cut by a block's edge", in test code, for the
// untagged test in same.test.ts that holds AC3's check to "fails, naming the line" at any block size. The planted
// programs the proof lanes lay over the hub are the twins list-drops-cut-line and readings-drops-cut-line, with the same
// defect (twins.json). This one is the merge base's reader (merge-base.ts) with a read that takes the file a block at a
// time from its end, as the issue's reader does, and keeps only the lines that lie whole inside one block: a line that
// a block's edge cuts is dropped instead of joined. Everything else, which line names the tool, which assigns the list,
// every reading, is the merge base's, so the one thing it gets wrong is the line the edge cuts.
import { readFile } from 'node:fs/promises';
import type { Read } from './merge-base.ts';

/** A read that drops each line cut by an edge of blocks of `block` bytes, counted from the file's end. */
export function dropsCutLines(block: number): Read {
  return async (transcript) => {
    const bytes = await readFile(transcript);
    // Block 0 is the file's last `block` bytes, block 1 the ones before, and so on to the file's start.
    const blockOf = (offset: number): number => Math.floor((bytes.length - 1 - offset) / block);
    const kept: string[] = [];
    for (let start = 0; start < bytes.length;) {
      const newline = bytes.indexOf(10, start);
      const end = newline < 0 ? bytes.length : newline + 1;
      if (blockOf(start) === blockOf(end - 1)) kept.push(bytes.subarray(start, newline < 0 ? end : newline).toString('utf8'));
      start = end;
    }
    return kept.join('\n');
  };
}
