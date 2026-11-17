// AC3 #518.0204e16d: "A planted tool that reports success for a file it truncated is caught by export.fidelity on the
// delivery's own bytes, naming the first missing frame; and a document that names a tool its brief didn't pin is
// refused at check, naming the tool"
//
// The planted tool is this suite's own (README: The suite's tools): the test plug-in registers `suite-truncates@1.0.0`
// through `deep.registerJobTool`, a PNG sequence writer that takes its frames by copy. Of the 5 s fixture film's 120
// frames it writes frames 0 to 76 whole, cuts frame 77's file to half its bytes and writes none after it, then
// answers every frame, reports all 120 as written and exits 0. The export runs it because the request names it and
// its brief pins it; the scenario's `job_tools` holds it as the hub holds an installed tool. Nothing the tool says
// may count: export.fidelity must read the delivery's own bytes and fail, naming frame 77, and nothing is delivered.
// The same film through `suite-frames@1.0.0`, the same program writing every frame, is delivered, so it is the
// truncation that fails.
//
// The pin: a request that names a tool without a brief that pins it, or under a brief that pins another, is refused
// at check, before a frame is drawn, naming the tool. The merge base, which reads no `tool`, delivers the film.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, PNG_SEQ, SUITE, TIMEOUT, encoderOf, entriesIn, exportCall, film, filmRun, filesOfSize, framesNamed, issueLines, issuesOf, namesTool, pinned, pngFrames,
  receiptOf, show, suiteTool, toolId, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SECONDS = 5; const FRAMES = 120; const CUT = SUITE.truncates.behaviour.cut_at;
const FRAME_BYTES = 160 * 90 * 4;

describe(`${AC[3]} a tool's own report is never trusted, and a tool is named only when the brief pins it`, () => {
  it(`${AC[3]} a planted tool that cuts frame 77's file short, writes none after it and reports success for all 120 is caught by export.fidelity on the delivery's own bytes, naming frame 77`, () => {
    const evidence = temp(); const dir = temp(); const clean = temp();
    const tools = [suiteTool(dir, SUITE.truncates), suiteTool(dir, SUITE.frames)];
    const out = join(dir, 'out'); const frames = join(out, 'frames');
    const [cut, whole] = filmRun(shows.bin(FULL), evidence, film(evidence, SECONDS), [
      exportCall({ out: frames, ...PNG_SEQ, ...pinned(toolId(SUITE.truncates)) }),
      exportCall({ out: join(clean, 'frames'), ...PNG_SEQ, ...pinned(toolId(SUITE.frames)) }),
    ], 'the 5 s fixture film through the truncating tool, then through the whole one', { tools });
    const said = issueLines(cut!).join(' | ').slice(0, 1200);
    expect(cut!['outcome'], `the truncated delivery is not delivered, whatever its tool reported: ${said}`).toBe('failed');
    const named = issuesOf(cut!, 'export.fidelity').flatMap(framesNamed);
    expect(named.length > 0 && Math.min(...named), `export.fidelity names frame ${CUT}, the first frame the delivery lacks: ${said}`).toBe(CUT);
    expect(entriesIn(out), 'the failed export left nothing at the destination or beside it').toEqual([]);
    // The same program writing every frame is delivered: the truncation is what failed.
    const r = receiptOf(whole!, 'the whole delivery');
    expect(encoderOf(r.raw, 'the whole delivery').tool, 'the whole delivery was encoded by the suite\'s tool').toBe(toolId(SUITE.frames));
    expect([r.frame_hashes.length, pngFrames(join(clean, 'frames'), 'the whole delivery').length], 'the whole delivery holds the film\'s 120 frames').toEqual([FRAMES, FRAMES]);
  }, TIMEOUT);

  it(`${AC[3]} an export that names a tool with no brief, or under a brief that pins another tool, is refused at check, naming the tool, with no frame drawn and nothing written`, () => {
    const evidence = temp(); const dir = temp();
    const tools = [suiteTool(dir, SUITE.frames), suiteTool(dir, SUITE.truncates)];
    const named = toolId(SUITE.frames);
    const cases: [string, JsonObject][] = [
      ['with no brief', { tool: named }],
      ['under a brief that pins no tool', { tool: named, brief: {} }],
      ['under a brief that pins another tool', { tool: named, brief: { tools: [toolId(SUITE.truncates)] } }],
    ];
    const outs = cases.map((_, i) => join(dir, `out-${i}`));
    const before = filesOfSize(evidence, FRAME_BYTES);
    const replies = filmRun(shows.bin(FULL), evidence, film(evidence, SECONDS), cases.map(([, ask], i) => exportCall({ out: join(outs[i]!, 'frames'), ...PNG_SEQ, readback: true, ...ask })),
      'the 5 s fixture film naming a tool its brief didn\'t pin', { tools });
    cases.forEach(([what], i) => {
      const reply = replies[i]!;
      expect(reply['outcome'], `${what}: the export is refused at check: ${show(reply, 800)}`).toBe('refused');
      expect(namesTool(reply, named), `${what}: the refusal names the tool ${named}: ${show(reply, 800)}`).toBe(true);
      expect(entriesIn(outs[i]!), `${what}: the refused export wrote nothing`).toEqual([]);
    });
    // Refused at check: with readback asked for, a frame drawn would be in the evidence store.
    expect(filesOfSize(evidence, FRAME_BYTES) - before, 'no frame was drawn for a refused export (readback keeps each drawn frame in the evidence store)').toBe(0);
  }, TIMEOUT);
});
