// #67's test-side tools, ../67/hub.ts, imported as they are, but for the one surface #1812 changes: the object a
// `deep workspace` command prints. #1812's Scope: "A command a person runs prints a sentence, and JSON only with
// `--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`"; the design's deep CLI row: "What a
// person runs prints sentences, and JSON only with `--json`". So each form prints a sentence, and its one line of JSON,
// the object it printed before, only with `--json`. The two functions below are ../67/hub.ts's but for that flag, the
// form's last argument, as #1812's suite pins `deep fix <id> --json` (REDRAFT.md, Readings). Every other name is
// ../67/hub.ts's own, so one copy of its state (the processes and folders a test made) serves both.
import { deep, must, shown, type Line, type Workspace, type World } from '../67/hub.ts';

export * from '../67/hub.ts';

/** ../67/hub.ts's: the value when `raw` is one JSON object, else undefined. */
const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

/** A `deep workspace` command's one line of JSON, asked for with `--json` (#1812); anything else fails the test, naming the command. */
export async function workspace(w: World, ...args: string[]): Promise<Line> {
  const asked = [...args, '--json'];
  const r = await deep(w, ['workspace', ...asked]);
  must(r.code === 0, `\`deep workspace ${asked.join(' ')}\` must exit 0: ${shown(r)}`);
  const line = parseObject(r.stdout.trim());
  must(line !== undefined, `\`deep workspace ${asked.join(' ')}\` must print one line of JSON: ${shown(r)}`);
  return line;
}
/** ../67/hub.ts's, through the `workspace` above. */
export async function newWorkspace(w: World, topic: string, ...flags: string[]): Promise<Workspace> {
  return (await workspace(w, 'new', topic, ...flags)) as Workspace;
}
