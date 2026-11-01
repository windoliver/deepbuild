// Planted wrong program (#45): each number is the figure the doc says, in the reading and in the output.
export * from './impl.js';
import { recomputeBaseline as realRecomputeBaseline } from './impl.js';

export function recomputeBaseline(...args: Parameters<typeof realRecomputeBaseline>): ReturnType<typeof realRecomputeBaseline> {
  const read = realRecomputeBaseline(...args);
  for (const m of read.measures) {
    const named = args[0].measures.find((x) => x.id === m.id);
    if (named?.copied_from_doc !== undefined) {
      m.value = named.copied_from_doc;
      m.status = 'recomputed';
      read.output.text += `${m.id} ${named.copied_from_doc}\n`;
    }
  }
  return read;
}
