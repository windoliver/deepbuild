// The readers #992 AC3's redraft (proposed/tests/acceptance/992/agree.test.ts.proposed) runs on a replay: `deep status`
// as current main prints it, and the app's list as the real replica draws it over the same hub's record.
//
// Reused by import, each implementing the current contract: #992's replay of a recorded session into a hub of its own,
// the stand-in agent, its temp homes, `run` and `childEnv` (../992/helpers.ts); #1463's `deep-drive` builds (plain, and
// with the replica's env-plants feature, whose app reads DEEP_HUB_PLANT) and its driver over #124's protocol, launched
// with `launch.from: "record_copy"` so it reads that hub's record (../1463/helpers.ts). Not reused: #992's `statusOf`,
// `WORDS` and `wordOf` (a row by its short ID, and six words), `appRows` and app.rs (a row by `session:<id>` alone, so
// no quiet session reads), which #2018 and #1461 left behind.
//
// Safety: every process gets a temp HOME (#992's and #16's homes under /tmp), is stopped by the PID it started with, and
// nothing reads the real ~/.deepbuild or ~/.claude. No network, no model.
import { childEnv, CLI, type Home, NODE, run, shown } from '../992/helpers.ts';
import { Drive, driveBinaries } from '../1463/helpers.ts';
import { appSessionWord, type Row, type Snapshot, statusTextWord } from './judges.ts';

/** `deep status --json` and `deep status`, read back to back with HOME the replay's home; BLOCKED unless both exit 0. */
export interface StatusRead { log_pos: number; rows: Row[]; text: string }
export async function readStatus(h: Home): Promise<StatusRead> {
  const env = childEnv(h);
  const json = await run(NODE, [CLI, 'status', '--json'], { env, timeoutMs: 60_000 });
  let parsed: { log_pos?: unknown; rows?: unknown } | undefined;
  try { parsed = JSON.parse(json.stdout) as typeof parsed; } catch { parsed = undefined; }
  if (json.code !== 0 || typeof parsed?.log_pos !== 'number' || !Array.isArray(parsed.rows)) throw Error(`BLOCKED: deep status --json must read the hub, exit 0 and print {log_pos, rows}: ${shown(json)}`);
  const text = await run(NODE, [CLI, 'status'], { env, timeoutMs: 60_000 });
  if (text.code !== 0) throw Error(`BLOCKED: deep status must read the hub and exit 0: ${shown(text)}`);
  return { log_pos: parsed.log_pos, rows: parsed.rows as Row[], text: text.stdout };
}
/** The session's row in `deep status --json`: by its `session`, or its id `session:<ID>`. */
export const rowOf = (read: StatusRead, session: string): Row | undefined => read.rows.find((r) => r.session === session || r.id === `session:${session}`);

/** Polls `deep status --json` until the session's row says `want`, or `ms` pass; the last read either way. */
export async function statusWithin(h: Home, session: string, ms: number, want: (word: string | undefined) => boolean): Promise<StatusRead> {
  const deadline = Date.now() + ms;
  for (;;) {
    const read = await readStatus(h);
    if (want(rowOf(read, session)?.word) || Date.now() >= deadline) return read;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The word `deep status` names the session with: its JSON row's word where its text line says the same, else none. */
export function statusWord(read: StatusRead, session: string): { word: string | undefined; said: string; row: Row | undefined } {
  const row = rowOf(read, session);
  if (!row) return { word: undefined, said: `no row in deep status --json (rows ${read.rows.map((r) => r.id).join(', ') || 'none'})`, row };
  const text = statusTextWord(read.text, row);
  return { word: text.word, said: text.word === undefined ? `--json "${row.word}", its text ${JSON.stringify(text.said)}` : text.said, row };
}

/**
 * The app's list over the replay's hub, as the real replica draws it: `deep-drive` with HOME the replay's home,
 * launched from a copy of that hub's record, then `see`. `plant` is DEEP_HUB_PLANT in the replica's process, which the
 * app reads only in the env-plants build, so a plant takes that build.
 */
export async function appSee(h: Home, plant: string | undefined): Promise<{ snapshot: Snapshot; log_pos: number | undefined }> {
  const bins = driveBinaries();
  const drive = await Drive.start(plant ? bins.plants : bins.plain, h.home, plant);
  try {
    await drive.must({ call: 'launch', launch: { from: 'record_copy' } });
    const seen = await drive.must({ call: 'see' });
    return { snapshot: seen.snapshot as Snapshot, log_pos: typeof seen.log_pos === 'number' ? seen.log_pos : undefined };
  } finally {
    await drive.stop();
  }
}
/** The word the app's list names the session with, read from what `appSee` drew for `row` (its row, or its project's quiet row). */
export const appWord = (snapshot: Snapshot, row: Row | undefined): { word: string | undefined; node: string } => {
  if (!row) return { word: undefined, node: 'no deep status row to find it by' };
  const w = appSessionWord(snapshot, row);
  return { word: w.word, node: w.node };
};
