// Criterion 9: "The headless fixture game is played with 40 scripted presses while 20 patches that keep the layout
// land, and 20 of the presses are sent in the frame a patch lands. Afterward the input track holds exactly those 40
// presses, each once, and no other entry. A planted join that writes an entry for each join leaves 60 and fails, naming
// the first"
//
// The run (helpers: pressRun): the jumper under rule 1 played 620 frames; a patch lands in every 30th frame from 30 to
// 600, alternating the game’s two programs, which keep one layout; a press is sent in each of those 20 frames and 15
// frames before each. A press sent in frame k is stamped at step k + 1 (README: Frames and steps). Afterward the `track`
// call reads the document’s input track as the hub holds it. The judge matches each scripted press to one entry; what
// is left over is named, earliest first. The planted join is `--planted join_writes_entry`: the first join carries on
// from step 31.
import { describe, expect, it } from "vitest";
import { AC, DOC, JUMP, PRESS_FRAMES, STEP, TIMEOUT, arr, caughtNaming, isObject, none, obj, pressRun, show, stampOf, useBuild, useEvidence, type JsonObject, type Planted } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();

/** The track against the scripted presses: each press is one entry of `jump`, value 1, at its stamp; each failure
 * names what differs, the first entry left over first. */
function judgeTrack(track: JsonObject[]): string[] {
  const left = [...track];
  const out: string[] = [];
  for (const k of PRESS_FRAMES) {
    const i = left.findIndex((e) => e["t"] === stampOf(k) * STEP && e["control"] === JUMP && e["value"] === 1);
    if (i < 0) out.push(`the press sent in frame ${k} (step ${stampOf(k)}) isn’t on the track`);
    else left.splice(i, 1);
  }
  left.sort((a, b) => (a["t"] as number) - (b["t"] as number));
  if (left.length) out.unshift(`the track holds ${track.length} entries, not ${PRESS_FRAMES.length}; the first that is no scripted press: ${show(left[0])} (step ${(left[0]!["t"] as number) / STEP})`);
  if (track.length !== PRESS_FRAMES.length && !left.length) out.unshift(`the track holds ${track.length} entries, not ${PRESS_FRAMES.length}`);
  return out;
}

function trackAfter(planted?: Planted): JsonObject[] {
  const { after } = pressRun(bin(), evidence(), "40 presses while 20 patches land", planted, [{ call: "track", doc: DOC }]);
  return arr(obj(after[0], "the track call")["track"], "the track").map((e, i) => obj(e, `the track’s entry ${i}`));
}

describe(`${AC[9]} the input track after 20 joins`, () => {
  it(`${AC[9]} the track holds exactly the 40 scripted presses, each once, and no other entry`, () => {
    expect(PRESS_FRAMES.length, "the script sends 40 presses").toBe(40);
    const track = trackAfter();
    expect(track.every((e) => isObject(e)), "every entry is an object").toBe(true);
    none(judgeTrack(track), "the input track");
  }, TIMEOUT);

  it(`${AC[9]} a planted join that writes an entry for each join (join_writes_entry) leaves 60 and fails, naming the first`, () => {
    const track = trackAfter("join_writes_entry");
    expect(track.length, "the planted joins leave 60 entries").toBe(60);
    caughtNaming(judgeTrack(track), ["holds 60 entries", "(step 31)"], "join_writes_entry");
  }, TIMEOUT);
});
