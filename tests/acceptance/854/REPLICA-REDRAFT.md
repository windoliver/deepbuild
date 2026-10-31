# Blind redraft for #854.0393e70f: the planted replica

Written by the blind redraft job (AGENTS.md, Proof; design: Dogfooding), from issue #854, the design and the base
commit `6f637e33` and the original suite (commit `d23d7659`), never an implementation. It replaces one case of
`replica.test.ts`; no original file changes.

## The dispute

The disputed case is "a planted replica that compiles its pipelines on the first frame lists them so, and on the
reference Mac the lane fails it past 300 ms, naming the pipelines". It required the planted replica's five cold
starts to be over 300 ms by the margin (`judgeOver`) and the lane to FAIL it on `first_settled_ms`.

The implementer measured on the reference Mac (Mac15,7, mains power), release build, five runs after warm-up:
the shipped replica at about 150–175 ms, its four pipelines compiled as the view opened; the planted one at about
155–170 ms, the same four compiled on the first frame. Once the warm-up has filled macOS's shader cache, a compile
costs a few ms wherever it happens. Only a planted program slowed on purpose would pass the original case.

## The decision

The original case is wrong, and the fault is in its reading, not the measurement:

- Cold start counts every compile: "from opening the document in a fresh process to its first settled frame, its
  compiles, decodes, shaping and bakes included" (The cost model). The planted replica does the same compiles in the
  same process before the same settled frame; it only moves them into the first frame. So spawn-to-settled time
  can't tell the two apart, by design, on any cache state.
- What is wrong with it is the design's rule that pipelines "compile off-screen before the swap, so a change never
  stalls a frame" (Meter and degrade ladder). That is a fact of the program, and the report already reads it:
  `runs[].pipelines[].on_first_frame`.
- The criterion ties the failure to "naming the pipelines", which only a judgment of the pipelines needs. The suite
  already reads the other planted programs this way: the unpaged query fails on `page_rows`, the vsync clock on
  `frames`, both counts judged on any machine.

So a run whose first frame compiled a pipeline fails `first_settled_ms`, on any machine and whatever its time, as
the judge treats counts: FAIL when any run has one. The reason names every pipeline compiled on the first frame
in the failing runs, as the README already asks. The 300 ms target is unchanged. It is still judged by the
design's timing rule on a reference Mac, and the shipped replica's tests in `replica.test.ts` stand as written.

## What `replica-redraft.test.ts` asserts

Through the README's surface only (the `replica-cold-start` report and `node benchmarks/canvas.mjs judge`):

| Test | Asserts | Wrong programs it fails on |
|---|---|---|
| The planted replica, recorded | On any Mac (skips as INCONCLUSIVE off macOS only): each of the five runs marks at least one pipeline `on_first_frame`; those are the fixture's pipelines as the shipped replica lists them; the lane's verdict is `FAIL`, `targets.first_settled_ms.status` `FAIL` with `limit` 300 and its `runs` the five `ms`; `reason` names every pipeline compiled on a first frame. The times are printed, not judged. | the base; a task with no planted replica; a judge that fails only past 300 ms or never fails; a reason naming no pipeline |
| A made-up reading and its twin | On a reference Mac's fingerprint, five runs at 150–154 ms: with `marks2d.fill` and `text.glyphs` compiled on every first frame it FAILs on `first_settled_ms`, naming both; the twin with none compiled there PASSes | a judge that passes a first-frame compile within 300 ms; one that fails everything; one that names nothing |
| One run, and off the reference Macs | Run 3 alone compiling `text.glyphs` on its first frame FAILs naming it; the planted reading on a Mac16,1 fingerprint FAILs naming both pipelines | a judge that wants all five runs, or gates the compile on the reference Mac like a timing |

At the base all three fail: `canvas.mjs` has no `replica-cold-start` mode ("Unknown task replica-cold-start"), and
its `judge` throws on the report ("Unknown class undefined").

The disputed case in `replica.test.ts` stays in the file (no test is edited or deleted without an approved
proposal); this redraft is the case that proves the criterion's planted half in its place.

## The swap

On Oct 31, 2026 the owner approved replacing the disputed case with this redraft. The case "a planted replica that
compiles its pipelines on the first frame lists them so, and on the reference Mac the lane fails it past 300 ms,
naming the pipelines" was removed from `replica.test.ts`, with the helpers only it used; `replica-redraft.test.ts`
proves the criterion's planted half in its place. Nothing else in the original suite changed.
