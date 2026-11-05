// A plug-in's model jobs (#366): `deep.runner.run` goes to the runner R1 built, on your own agent, headless on your
// plan. Here are the job's shape as the plug-in gives it, the prompt the agent reads and what its run answered. The
// host checks each handle against the plug-in's grant before any of this, and filters what the answer cites after.
import type { JobRecord } from '@deepbuild/runner';

/** What a plug-in asks for: its prompt, its inputs by handle, a budget in USD and a deadline in ms. */
export interface JobRequest { prompt: string; inputs: string[]; budget: { usd: number }; deadline: number }
/** What the plug-in gets: a reading with its own handle, as old as the oldest reading it cites. */
export interface Answer { handle: string; value: unknown; cites: string[]; as_of: number; stale_at: number | null }

const HANDLE = /^[a-z]+:.+$/;

/** The plug-in's request, held to deep.runner.run's shape; a call that isn't refuses naming what is wrong. */
export function jobRequest(given: unknown): JobRequest {
  const r = (typeof given === 'object' && given !== null ? given : {}) as Record<string, unknown>;
  const refuse = (why: string): never => { throw Error(`deep.runner.run: ${why}`); };
  if (typeof r.prompt !== 'string' || !r.prompt) refuse('a job has a prompt');
  if (!Array.isArray(r.inputs) || !r.inputs.every((h) => typeof h === 'string' && HANDLE.test(h))) refuse('a job names its inputs as a list of handles, such as reading:<id>');
  const usd = (r.budget as { usd?: unknown } | undefined)?.usd;
  if (typeof usd !== 'number' || !(usd > 0)) refuse('a job has a budget in USD above 0, as { usd }');
  if (!Number.isSafeInteger(r.deadline) || (r.deadline as number) < 1) refuse('a job has a deadline in ms');
  return { prompt: r.prompt as string, inputs: [...new Set(r.inputs as string[])], budget: { usd: usd as number }, deadline: r.deadline as number };
}

/** What the agent reads: what DeepBuild asks of every job, each input's content by its handle, then the plug-in's prompt as given. */
export function jobPrompt(piece: string, inputs: { handle: string; content: unknown }[], prompt: string): string {
  return [
    `DeepBuild runs this job for the plug-in ${piece}. Use only the inputs below; read no file and call no tool.`,
    'Answer with one JSON object and nothing else: {"value": <your answer>, "cites": [<the handles below your answer rests on>]}.',
    '',
    'Inputs, by handle:',
    ...(inputs.length ? inputs.map((i) => `${i.handle}: ${JSON.stringify(i.content)}`) : ['(none)']),
    '',
    'The plug-in asks:',
    prompt,
  ].join('\n');
}

/** What a finished job answered: its value and the handles it cites. A job that didn't finish rejects with its stop cause, never with text. */
export function answered(rec: JobRecord, budget: { usd: number }): { value: unknown; cites: string[] } {
  if (rec.state !== 'finished' || rec.stop) {
    throw Error(`deep.runner.run: the job ${rec.job} failed: ${rec.stop?.cause ?? rec.refused ?? rec.state}`);
  }
  if ((rec.cost_usd ?? 0) > budget.usd) throw Error(`deep.runner.run: the job ${rec.job} cost $${rec.cost_usd}, over its budget of $${budget.usd}, so its answer is dropped`);
  const text = (rec.result ?? '').trim();
  // An agent may wrap the object it was asked for in a code fence or a sentence: the outermost braces are its answer.
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  let given: unknown;
  try {
    given = JSON.parse(from >= 0 && to > from ? text.slice(from, to + 1) : text);
  } catch {
    given = undefined;
  }
  const g = given as { value?: unknown; cites?: unknown } | undefined;
  if (typeof g !== 'object' || g === null || !('value' in g)) throw Error(`deep.runner.run: the job ${rec.job} finished without the JSON object {value, cites} it was asked for`);
  const cites = Array.isArray(g.cites) ? g.cites.filter((c): c is string => typeof c === 'string') : [];
  return { value: g.value, cites: [...new Set(cites)] };
}
