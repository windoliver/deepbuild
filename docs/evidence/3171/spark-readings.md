# #3171: the span test's readings on the Spark, 2026-11-22

Spark: Linux 7.0.0-1025-nvidia aarch64, NVIDIA GB10 (driver 580.178.04, Vulkan). Main 852cbc10a with a diagnostic
copy of the base test (crates/deep-gpu/src/spans.rs, not committed): the same two passes 200 ms apart, printing the
spans' own start and end marks beside the passes' own timestamps. The load was a second process (the same test
binary's diagnostic loop) drawing a full-screen pass of N loops a pixel, over and over. Times in ms on the GPU's clock.

Columns: covered = the spans' reading; own = the union of the two passes' own timestamps; extra = covered - own;
s1->h0 = span 1's start to the heavy pass's begin; h1->e1 = the heavy pass's end to span 1's end; s2->l0, l1->e2 the
same for the light pass; e1->l0 = span 1's end to the light pass's begin, the part of the CPU's 200 ms gap the GPU saw.


## Which of the two it is

Both, in a sense. On a shared GPU the span does count time that isn't its submission's: another process's pass. It
counts only that, never the CPU's gap. So the 100 ms bound can't judge such a trial, and it reads INCONCLUSIVE.

- Alone the spans add 0.18 to 0.26 ms to the passes' own time, in every trial.
- Beside a load, all the extra time is in one place: between the heavy pass's own end and span 1's end (h1->e1). That is
  33.8 ms in every trial beside the 40,000-loop pass, and 54.4 ms in one trial of ten beside the 57 ms passes. Each is
  one of the other process's passes, held whole. The start side (s1->h0, s2->l0) stays at 0.01 ms, and span 1 always
  ends 137 to 194 ms before the light pass begins (e1->l0), so no span reaches into the CPU's gap.
- The reason: a span's end is a submission of its own (`done_with` submits a mark after its work was submitted), so the
  GPU's scheduler can run another context's pending pass between the work and the mark. Beside one load process whose
  passes come one at a time, the trials fell into step with them and nothing landed in between (139 ms passes, 20 of 20
  trials at 0.24 ms). With more than one other context pending, one always did.
- In the whole-workspace runs (#1121) the other contexts are deep-gpu's own library tests: cargo runs one test binary
  at a time, but libtest runs a binary's tests on parallel threads, each with its own device. 153.6 ms covered against
  13.6 own fits one of their passes, about 140 ms long, in the same place (inferred: that run printed no marks).

So the 100 ms bound can't judge a trial on a shared GPU. The fix (the test in `crates/deep-gpu/src/spans.rs`) measures
the share. Right after each span's end it submits a timestamped witness pass outside the spans, which begins late only by
the time the GPU spent on others' work. The span's own marks give any wait from its start to its pass's begin. A trial
past the bound by no more than those waits reads `INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: …`;
past it by more it is still FAIL ("the gap counted"). The test panics with that line. The unit lane reads any libtest panic
as FAIL until #3100's third criterion makes it read a panic starting `INCONCLUSIVE:` as INCONCLUSIVE, so until then #3171's
second criterion stays open.

## Alone (load 5)

```
trial  covered    own    extra  s1->h0   h1->e1  s2->l0  l1->e2    e1->l0
  0    13.678  13.469    0.209   0.008    0.032   0.009   0.159   194.001
  1    13.659  13.465    0.194   0.009    0.025   0.009   0.152   187.271
  2    13.645  13.464    0.181   0.009    0.024   0.009   0.139   187.277
  3    13.655  13.467    0.188   0.010    0.025   0.008   0.146   187.168
  4    13.676  13.465    0.211   0.009    0.024   0.009   0.168   187.192
  5    13.675  13.466    0.209   0.009    0.025   0.008   0.166   187.164
  6    13.664  13.462    0.202   0.009    0.025   0.009   0.159   187.139
  7    13.659  13.468    0.191   0.008    0.026   0.009   0.147   187.166
  8    13.749  13.488    0.261   0.009    0.083   0.009   0.159   187.080
  9    13.663  13.461    0.202   0.009    0.025   0.010   0.159   187.212

```

## Beside one process of 65,536-loop passes (about 57 ms each: 434 in 25 s)

```
trial  covered    own    extra  s1->h0   h1->e1  s2->l0  l1->e2    e1->l0
  0    13.821  13.576    0.245   0.009    0.200   0.010   0.026   165.017
  1    13.817  13.571    0.246   0.011    0.199   0.010   0.026   165.536
  2    13.816  13.572    0.244   0.010    0.199   0.009   0.026   165.518
  3    13.812  13.570    0.242   0.010    0.196   0.010   0.026   164.950
  4    13.809  13.566    0.243   0.009    0.197   0.011   0.026   165.018
  5    13.815  13.569    0.246   0.009    0.200   0.010   0.026   165.306
  6    13.809  13.568    0.241   0.010    0.198   0.010   0.024   165.115
  7    68.049  13.570   54.479   0.010   54.435   0.010   0.024   165.287
  8    13.809  13.568    0.241   0.009    0.197   0.010   0.025   165.306
  9    13.810  13.567    0.243   0.010    0.199   0.010   0.024   165.010

```

## Beside one process of 163,840-loop passes (about 139 ms each: 287 in 40 s)

```
trial  covered    own    extra  s1->h0   h1->e1  s2->l0  l1->e2    e1->l0


```

## Beside three processes of 163,840-, 40,000- and 9,000-loop passes

```
trial  covered    own    extra  s1->h0   h1->e1  s2->l0  l1->e2    e1->l0
  0    47.485  13.680   33.805   0.010   33.759   0.010   0.026   144.532
  1    47.485  13.677   33.808   0.010   33.762   0.010   0.026   144.485
  2    47.453  13.672   33.781   0.011   33.733   0.010   0.026   144.546
  3    47.483  13.675   33.808   0.009   33.762   0.011   0.026   144.483
  4    47.343  13.568   33.775   0.009   33.730   0.010   0.027   144.491
  5    47.528  13.678   33.850   0.010   33.757   0.009   0.073   144.504
  6    47.465  13.672   33.793   0.010   33.746   0.010   0.026   144.526
  7    47.466  13.668   33.798   0.011   33.752   0.009   0.027   144.540
  8    47.484  13.676   33.808   0.010   33.763   0.010   0.025   144.551
  9    47.480  13.670   33.810   0.010   33.764   0.010   0.026   144.539
 10    47.483  13.676   33.807   0.010   33.763   0.010   0.025   144.537
 11    47.475  13.670   33.805   0.010   33.758   0.010   0.026   144.496
 12    47.469  13.674   33.795   0.009   33.750   0.011   0.024   144.524
 13    47.470  13.670   33.800   0.010   33.757   0.009   0.024   144.498
 14    47.468  13.671   33.797   0.010   33.750   0.011   0.027   144.494
 15    47.478  13.674   33.804   0.010   33.757   0.010   0.026   144.496
 16    47.465  13.670   33.795   0.010   33.749   0.011   0.026   144.528
 17    47.465  13.670   33.795   0.011   33.751   0.009   0.025   144.483
 18    47.478  13.672   33.806   0.010   33.762   0.010   0.025   144.500
 19    47.472  13.674   33.798   0.010   33.753   0.010   0.025   144.512
 20    47.473  13.675   33.798   0.010   33.754   0.010   0.025   144.545
 21    47.478  13.676   33.802   0.010   33.755   0.010   0.027   144.550
 22    47.473  13.675   33.798   0.010   33.753   0.009   0.025   144.544
 23    47.516  13.673   33.843   0.068   33.742   0.010   0.025   144.484
 24    47.579  13.673   33.906   0.010   33.759   0.073   0.066   144.660
 25    47.480  13.674   33.806   0.010   33.760   0.011   0.026   144.522
 26    47.464  13.673   33.791   0.010   33.748   0.009   0.025   144.532
 27    47.475  13.671   33.804   0.009   33.758   0.011   0.026   144.539
 28    47.468  13.676   33.792   0.010   33.746   0.009   0.027   144.475
 29    47.468  13.667   33.801   0.010   33.756   0.010   0.025   144.462

```

## The fixed test on the Spark (24bc6ec65), alone and beside the suite's load

Each run is `cargo test -p deep-gpu --lib -- spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it
--show-output`; "beside" starts `tests/acceptance/3171/load.rs` (passes of about 200 ms) first. The second half plants the
blind suite's gap-counted wrong program in the product (only a frame's first submission begins a span) under the fixed
test: it reads FAIL alone and beside the load. Vulkan loader noise (a freedreno ICD line) removed.

```
### change
clone at 24bc6ec65; load 36.49 25.35 31.64
== alone, run 1
trial 0: 13.89148798584938 ms covered, the passes' own 13.680000007152557; the heavy pass's own 13.670240014791489; this test's work waited behind others' for 0.39955198764801025
trial 1: 13.862304002046585 ms covered, the passes' own 13.675967991352081; the heavy pass's own 13.666207998991013; this test's work waited behind others' for 0.3835200071334839
trial 2: 14.390367984771729 ms covered, the passes' own 13.678880006074905; the heavy pass's own 13.669055998325348; this test's work waited behind others' for 1.0036480128765106
trial 3: 13.962495982646942 ms covered, the passes' own 13.675807982683182; the heavy pass's own 13.666079998016357; this test's work waited behind others' for 0.6010880172252655
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.24s
== alone, run 2
trial 0: 13.83238399028778 ms covered, the passes' own 13.67273598909378; the heavy pass's own 13.662496000528336; this test's work waited behind others' for 0.2956799864768982
trial 1: 13.882272005081177 ms covered, the passes' own 13.68025603890419; the heavy pass's own 13.670624017715454; this test's work waited behind others' for 0.3784639537334442
trial 2: 14.41907200217247 ms covered, the passes' own 13.669376015663147; the heavy pass's own 13.659680008888245; this test's work waited behind others' for 1.149535983800888
trial 3: 14.033344000577927 ms covered, the passes' own 13.677888005971909; the heavy pass's own 13.668191999197006; this test's work waited behind others' for 0.7511680126190186
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.27s
== alone, run 3
trial 0: 13.871679991483688 ms covered, the passes' own 13.67087996006012; the heavy pass's own 13.66092798113823; this test's work waited behind others' for 0.3588160276412964
trial 1: 14.017792016267776 ms covered, the passes' own 13.672768026590347; the heavy pass's own 13.66345602273941; this test's work waited behind others' for 0.7751999497413635
trial 2: 14.78742402791977 ms covered, the passes' own 13.67263999581337; the heavy pass's own 13.663231998682022; this test's work waited behind others' for 3.0329600274562836
trial 3: 13.971904009580612 ms covered, the passes' own 13.672672003507614; the heavy pass's own 13.66329601407051; this test's work waited behind others' for 0.6321920156478882
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.25s
== beside the load (acceptance_3171_load), run 1
grep: /tmp/load3171.3842960: No such file or directory
load: busy 406.8
trial 0: 217.1321920156479 ms covered, the passes' own 14.587615996599197; the heavy pass's own 14.578175991773605; this test's work waited behind others' for 202.56883201003075
trial 1: 14.633279979228973 ms covered, the passes' own 14.391328006982803; the heavy pass's own 14.381888002157211; this test's work waited behind others' for 202.20015996694565
trial 2: 217.68470400571823 ms covered, the passes' own 14.660031974315643; the heavy pass's own 14.647008001804352; this test's work waited behind others' for 405.2828800082207
trial 3: 216.20643198490143 ms covered, the passes' own 14.393759995698929; the heavy pass's own 14.384319990873337; this test's work waited behind others' for 202.2225599884987
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:576:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 217.1321920156479 ms covered, the passes' own 14.587615996599197; the GPU ran others' work for 202.56883201003075 ms while this test's passes and their span ends waited
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 6.90s
== beside the load (acceptance_3171_load), run 2
load: 
trial 0: 215.9722240269184 ms covered, the passes' own 14.62959998846054; the heavy pass's own 14.620063990354538; this test's work waited behind others' for 201.36697602272034
trial 1: 14.834752023220062 ms covered, the passes' own 14.581216007471085; the heavy pass's own 14.572064012289047; this test's work waited behind others' for 0.2778240144252777
trial 2: 14.830111980438232 ms covered, the passes' own 14.572640031576157; the heavy pass's own 14.559488028287888; this test's work waited behind others' for 0.28124794363975525
trial 3: 216.51155200600624 ms covered, the passes' own 14.377920001745224; the heavy pass's own 14.368416011333466; this test's work waited behind others' for 405.84860798716545
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:576:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 215.9722240269184 ms covered, the passes' own 14.62959998846054; the GPU ran others' work for 201.36697602272034 ms while this test's passes and their span ends waited
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 6.90s
== beside the load (acceptance_3171_load), run 3
load: busy 407.6
trial 0: 219.30848002433777 ms covered, the passes' own 14.80044800043106; the heavy pass's own 14.791007995605469; this test's work waited behind others' for 204.53222399950027
trial 1: 218.41462397575378 ms covered, the passes' own 14.671968013048172; the heavy pass's own 14.66252800822258; this test's work waited behind others' for 203.76627197861671
trial 2: 218.61276799440384 ms covered, the passes' own 14.527199983596802; the heavy pass's own 14.514207988977432; this test's work waited behind others' for 204.10969603061676
trial 3: 220.2062399983406 ms covered, the passes' own 14.824608027935028; the heavy pass's own 14.815136015415192; this test's work waited behind others' for 205.40511998534203
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:576:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 219.30848002433777 ms covered, the passes' own 14.80044800043106; the GPU ran others' work for 204.53222399950027 ms while this test's passes and their span ends waited
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 6.60s
### planted: only a frame's first submission begins a span
clone at 24bc6ec65; load 43.41 28.24 32.37
== alone, run 1
trial 0: 214.84873601794243 ms covered, the passes' own 13.669792026281357; the heavy pass's own 13.66006401181221; this test's work waited behind others' for 0.5413119792938232
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 214.84873601794243 ms covered, the passes' own 13.669792026281357: the gap counted (0.5413119792938232 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.55s
== alone, run 2
trial 0: 214.64403200149536 ms covered, the passes' own 13.67126402258873; the heavy pass's own 13.661504000425339; this test's work waited behind others' for 0.3742079734802246
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 214.64403200149536 ms covered, the passes' own 13.67126402258873: the gap counted (0.3742079734802246 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.55s
== alone, run 3
trial 0: 214.4946239888668 ms covered, the passes' own 13.6737280189991; the heavy pass's own 13.663967996835709; this test's work waited behind others' for 0.2879999876022339
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 214.4946239888668 ms covered, the passes' own 13.6737280189991: the gap counted (0.2879999876022339 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.55s
== beside the load (acceptance_3171_load), run 1
load: busy 408.9
trial 0: 423.0499199926853 ms covered, the passes' own 13.811135977506638; the heavy pass's own 13.801855981349945; this test's work waited behind others' for 204.43017601966858
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 423.0499199926853 ms covered, the passes' own 13.811135977506638: the gap counted (204.43017601966858 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 3.09s
== beside the load (acceptance_3171_load), run 2
load: busy 408.9
trial 0: 423.11939200758934 ms covered, the passes' own 13.81504002213478; the heavy pass's own 13.805248022079468; this test's work waited behind others' for 204.42982399463654
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 423.11939200758934 ms covered, the passes' own 13.81504002213478: the gap counted (204.42982399463654 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 2.87s
== beside the load (acceptance_3171_load), run 3
load: busy 409.1
trial 0: 422.9747200012207 ms covered, the passes' own 13.814208000898361; the heavy pass's own 13.804672002792358; this test's work waited behind others' for 204.4228160083294
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:565:13:
trial 0: 422.9747200012207 ms covered, the passes' own 13.814208000898361: the gap counted (204.4228160083294 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 2.90s
```
