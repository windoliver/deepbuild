// A parser worker: parses each line the event loop hands it and maps a hook request to its events, so a large
// line never holds up the acknowledgements of other sessions. It also reads the rules a call's paths meet (#344).
import { parentPort, workerData } from 'node:worker_threads';
import { parseLine, warm } from './hookmap.js';
import { scopedAt } from './rules.js';
import { shedStartup } from './settle.js';
import type { Plant } from './wire.js';

const { held, plant, dir } = workerData as { held: string[]; plant?: Plant; dir: string };
warm();
shedStartup();
parentPort!.on('message', ({ n, chunks, first, scrub }: { n: number; chunks: Uint8Array[]; first: boolean; scrub?: string[] }) => {
  // Values the core loaded into a stack since the hub started (#332), scrubbed from every line after.
  if (scrub) return void held.push(...scrub);
  const bytes = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
  const parsed = parseLine(bytes, first, held, plant);
  // Your rules at a call's paths (#344) are read here: the event loop walks no folder for them.
  const scoped = parsed.kind === 'hook' ? scopedAt(parsed.meta, dir) : undefined;
  parentPort!.postMessage({ n, parsed: scoped ? { ...parsed, scoped } : parsed });
});
