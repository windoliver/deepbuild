# Dispute: the first draft's AC1 fixture needs the transcriber to add no word to the uncut take

This redraft exists because of this dispute. The first draft is `tests/acceptance/1518/heard.test.ts` ("#1518.1dbfdc9b
the strips are heard back as the kept words in order; with the record 150 ms late every kept word is still heard; the
planted cut_on_raw_times there FAILs cut.heard with cut.word_lost naming a word it cut into").

## What fails

Before it judges any cut, the first draft checks its own fixture: the pinned transcriber, whisper-cpp@1.9.5 through
`narration.transcript`, must hear the uncut 60 s take as exactly its 81 words, through `media_heard`, whose match allows
no extra word. On this Mac the transcriber hears every one of the 81 words in order and then adds "you" after the take's
last sentence, in its closing silence. The test therefore reads BLOCKED, never reaching the cut, the shifted record or
the planted recipe:

```
AssertionError: BLOCKED: the fixture: whisper-cpp@1.9.5 hears the uncut recording as its 81 words, but missing [],
extra ["you"], wrong [] in "We heard the loud train arrive. She bought fresh warm bread this morning. … The store raised
the weekly price again. you": expected false to be true
```

The added word is the transcriber's, on the base: no strip and no recipe is involved. The design's `cut.heard` fails
only a kept word lost or a removed word heard (`cut.word_lost`, `cut.word_left`), so a word the transcriber adds that is
no word of the recording is not a failure there; the first draft's fixture check is stricter than the criterion, so AC1
can't be judged with it.

## How the redraft was made

AC1 went to a fresh run of a blind job with the same inputs: issue #1518, the design and a base with the first draft
and no implementation (`9c916d5a1`). It never saw the work, its diff or this dispute. It was given one fact of the
base, that the pinned transcriber can add a word that was never spoken when a take ends in silence (on this Mac, "you"
after the first draft's take), and told to write AC1's test only. It reuses the first draft's take and records, and sets
aside a heard word that no word of the recording reads as, while a removed word heard, a kept word heard twice, and a
kept word heard as another still fail.

## What is decided, and what is yours

The first draft's file is kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. This is the dispute that
comes to you (design: Dogfooding): keep the redraft's reading, that a word the transcriber adds and the recording never
held is set aside; or keep the first draft's, which needs a transcriber or a take that adds no word.
