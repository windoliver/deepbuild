# Acceptance tests for #509, Oracle lane: the pinned upstream tests run against our transcriber, comparison, normalizer and refusal

Written first, blind, from issue #509 (`gh issue view 509 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/509.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that page
pins (read from that branch's `doneright/oracles/vendor/`), the #509 suite's surface (`tests/acceptance/509/README.md`
and `helpers.ts`, written by the same job) and base commit `0e377fbd7`, by a job that never saw an implementation of
#509; none existed, and no other worktree, branch or PR was read. #136's rule applies: a linked test counts only when
run against our output, so every upstream case here is asserted against what `deep-show run` or the hub's deep_job
answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criteria 1, 2, 5 and 6, the four the Oracle page links an upstream test to. Their parts the page calls ours stay
in `tests/acceptance/509/` (the 300 ms cut twin and its naming, the Latin name, the refusal's shape, the fixture of six
forms).

## Sources

| Criterion | Upstream, pinned | Files | Use | Licence |
|---|---|---|---|---|
| 1 | whisper.cpp `d1be6fde11ac6e0407606b4e42fe72d34add8037` | `tests/run-tests.sh` (its `urls_en`, the 16 kHz mono conversion, the diff against `en-<i>-ref.txt`), `tests/en-0-ref.txt`, `en-1-ref.txt`, `en-2-ref.txt`, `tests/librispeech/eval.py` (WER after a normalizer on both sides) | run on our code; port | MIT (The ggml authors); nothing copied: the recordings and reference texts are read from a cache folder |
| 1 | jitsi/jiwer `19e88eae1815e7ca40db9b45b14af5f1f9d8b6ce` | `tests/test_alignment.py` (TestAlignmentVisualizationWords), `tests/test_measures.py` (TestMeasuresContiguousSentencesTransform) | port | Apache-2.0 (Copyright 2018 8x8, Inc.), its notice kept in `alignment.test.ts` |
| 2, 5 | pypinyin `df101577145af2eb1abe5656e592e34e3bb56d23` | `tests/test_pinyin.py` (test_pinyin_initials, test_pinyin_finals, test_lazy_pinyin, the 朝阳 heteronym table, test_custom_pinyin_dict2) | port | MIT (Copyright (c) 2016 mozillazg, 闲耘), its notice kept in `pinyin.test.ts` |
| 6 | openai/whisper `31243bad24cc746f07d4c8bfdd2d974872cb1803` | `tests/test_normalizer.py` | port | MIT (Copyright (c) 2022 OpenAI), its notice kept in `normalizer.test.ts` |

| File | Upstream cases | Our output |
|---|---|---|
| `transcriber.test.ts` | run-tests.sh's three English recordings with their ref.txt, scored as eval.py scores (WER after a normalizer on both sides) | deep_job `narration.transcript` on whisper-cpp@1.9.5 of each recording's 16 kHz mono PCM; the record's `text` against the reference through `media_heard`; WER at most 0.2 each *(chosen bound)* |
| `alignment.test.ts` | insertion, deletion, substitution, all three, show_measures, empty hypothesis, empty reference; three measure cases | `media_heard`'s `missing` (D), `extra` (I), `wrong` (S): exact where upstream's alignment is the only one of its cost, the error count (WER × the reference's words) where equal-cost alignments exist |
| `pinyin.test.ts` | 中心 [zhong, xin], 中国人 [zhong, guo, ren], 嗷嗷 [ao, ao], 朝阳 [[zhao, chao], [yang]]; 行 in 同行 (hang, xing); 中's two readings, one without tones | `media_heard` (zh-CN) of each heard as other characters of those syllables (match), one syllable changed (no match), 早 for 朝 (no match); a line holding 朝 or 行 with no reading in `say` refused with `narration.polyphonic` naming it and its readings, compiling with its reading; a line holding 中 compiling with none |
| `normalizer.test.ts` | 16 `std(x) == y` cases: cardinals, adjacent groups, years, ordinals, `percent`, contractions, British spelling | `media_heard {expected: x, heard: y}` matches, and x's tokens after normalizer@1 joined by spaces are y (the percentage: the match only) |

Not ported, and why: whisper.cpp's CMake tests (they run the CLI on its own sample and check nothing of the text) and
its other languages (an `.en` model runs English only); the alignment tests' "one" against "1" cases (normalizer@1 reads
both as 1 by design), layout and character tests; the normalizer cases normalizer@1 states no rule for (currency,
decimals, "double", signs, fractions, plurals of numbers, "per cent", dates, units, titles, "he's"); pypinyin's styles
other than NORMAL and its custom-dictionary loading. Which characters stand for a syllable in a heard text is this
lane's choice; the syllables are upstream's.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                       # once, if node_modules is missing
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/509-oracle alignment.test.ts --testTimeout=3600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/509-oracle normalizer.test.ts --testTimeout=3600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/509-oracle pinyin.test.ts --testTimeout=3600000
npm run build --workspaces && cargo build --locked -p deep-hook               # transcriber.test.ts runs a hub
node node_modules/vitest/vitest.mjs run --root tests/acceptance/509-oracle transcriber.test.ts --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/509-oracle/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/509-oracle/node_modules/.vite
```

Each file builds `deep-show` once through `tests/acceptance/509/helpers.ts`. **`scripts/lanes.mjs` needs
`'tests/acceptance/509-oracle/'` in its `alone` list**; the line is in the #509 README (this job writes only its
folders). Every `it` passes a 3,600,000 ms timeout. `pinyin.test.ts` speaks nothing (its lines' sound is a tone);
`transcriber.test.ts` starts a hub and deepbuild/speech's host on 8720, as the #509 suite's hub files do, with the same
safety rules (README there: Run them).

A lane whose runner is missing fails with a line starting `BLOCKED:`, never passes, with one unblock line:

- `transcriber.test.ts` reads `en-0.ogg`, `en-1.ogg`, `en-2.wav` (run-tests.sh's `urls_en`, saved under run-tests.sh's
  names) and `en-0-ref.txt` to `en-2-ref.txt` from `~/Library/Caches/deepbuild/whisper-cpp-tests/` *(chosen)*, or the
  folder `DEEP_WHISPER_TESTS` names, and converts them with an installed `ffmpeg` (PATH, `/opt/homebrew/bin`,
  `/usr/local/bin`, or `DEEP_FFMPEG`), as run-tests.sh does. Without them it is BLOCKED, and its line gives the one
  command that fetches the three recordings from run-tests.sh's URLs and the three reference texts from the Oracle
  page's vendored folder. It also needs what the #509 suite's hub files need (`uv`, the host's port free).
- The other three files need only `deep-show`: no outside runner.

## Readings

- **WER 0.2** (transcriber): run-tests.sh is read by eye and eval.py prints its WER with no bound; the references were
  made by a larger model, so the pinned base.en is held to a bound a working transcriber, normalizer and comparison
  meet and a broken one misses by far. WER is (missing + extra + wrong) over the reference's tokens after normalizer@1.
- **Ties** (alignment): `test_all_three` and `test_show_measures` have more than one alignment of least cost; only the
  count is upstream's to give.
- **Toneless syllables**: a heard character matches when one of its readings in zh.readings@1 is one of the expected
  character's; the heard texts use common characters with one toneless reading.

## Not settled

- The cache folder, its file names and the 0.2 bound are this lane's.
- Whether `media_heard`'s Chinese tokens are characters or syllables: only `match` and the counts are read here.
