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
the time the GPU spent on others' work. A trial past the bound by no more than the witnesses waited reads INCONCLUSIVE,
saying the GPU was shared. Past it by more, it is still FAIL ("the gap counted"). The unit lane reads the test's
`INCONCLUSIVE:` panic as INCONCLUSIVE (`cargoResults`, scripts/lanes.mjs).

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

## The fixed test on the Spark (head 3a1de3769's spans.rs), alone and beside the suite's load

Each run is `cargo test -p deep-gpu --lib -- spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it
--show-output`; "beside" starts `tests/acceptance/3171/load.rs` (passes of about 200 ms) first. The second half plants the
blind suite's gap-counted wrong program in the product (only a frame's first submission begins a span) under the fixed
test: it reads FAIL alone and beside the load. Vulkan loader noise (a freedreno ICD line) removed.

```
### change
clone at d63b612a0, its spans.rs replaced by 3a1de3769's; load 4.20 5.87 12.04
== alone, run 1
trial 0: 13.620543986558914 ms covered, the passes' own 13.466527998447418; the heavy pass's own 13.45686399936676; the witnesses waited 0.26531198620796204
trial 1: 13.63152003288269 ms covered, the passes' own 13.465119987726212; the heavy pass's own 13.455327987670898; the witnesses waited 0.28707200288772583
trial 2: 13.626175969839096 ms covered, the passes' own 13.46592003107071; the heavy pass's own 13.456448018550873; the witnesses waited 0.28259196877479553
trial 3: 13.634752005338669 ms covered, the passes' own 13.469184011220932; the heavy pass's own 13.460224002599716; the witnesses waited 0.2852480113506317
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.29s
== alone, run 2
trial 0: 13.63663998246193 ms covered, the passes' own 13.470527976751328; the heavy pass's own 13.461311995983124; the witnesses waited 0.28649601340293884
trial 1: 13.62975999712944 ms covered, the passes' own 13.463007986545563; the heavy pass's own 13.45363199710846; the witnesses waited 0.2868160009384155
trial 2: 13.645951986312866 ms covered, the passes' own 13.462144017219543; the heavy pass's own 13.452960014343262; the witnesses waited 0.31647998094558716
trial 3: 13.615488022565842 ms covered, the passes' own 13.4619520008564; the heavy pass's own 13.453408002853394; the witnesses waited 0.29257601499557495
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.27s
== alone, run 3
trial 0: 13.626080006361008 ms covered, the passes' own 13.473951995372772; the heavy pass's own 13.464287996292114; the witnesses waited 0.26899200677871704
trial 1: 13.612320005893707 ms covered, the passes' own 13.468096017837524; the heavy pass's own 13.458432018756866; the witnesses waited 0.2766079902648926
trial 2: 13.633183985948563 ms covered, the passes' own 13.461728006601334; the heavy pass's own 13.452160000801086; the witnesses waited 0.29292798042297363
trial 3: 13.626528024673462 ms covered, the passes' own 13.461824029684067; the heavy pass's own 13.452864021062851; the witnesses waited 0.29865598678588867
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out; finished in 1.27s
== beside the load (acceptance_3171_load), run 1
load: busy 401.8
trial 0: 214.4367360174656 ms covered, the passes' own 13.56886401772499; the heavy pass's own 13.559808015823364; the witnesses waited 200.87257599830627
trial 1: 415.19068801403046 ms covered, the passes' own 13.56758400797844; the heavy pass's own 13.558304011821747; the witnesses waited 401.63257598876953
trial 2: 13.809823989868164 ms covered, the passes' own 13.568320006132126; the heavy pass's own 13.5591039955616; the witnesses waited 0.24531197547912598
trial 3: 214.42585602402687 ms covered, the passes' own 13.568576008081436; the heavy pass's own 13.559744000434875; the witnesses waited 200.86147198081017
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:558:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 214.4367360174656 ms covered, the passes' own 13.56886401772499; the GPU ran others' work for 200.87257599830627 ms between a pass and its span's end
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 7.95s
== beside the load (acceptance_3171_load), run 2
load: busy 401.7
trial 0: 214.41948798298836 ms covered, the passes' own 13.566080033779144; the heavy pass's own 13.55680000782013; the witnesses waited 200.85855999588966
trial 1: 415.1778239905834 ms covered, the passes' own 13.564128041267395; the heavy pass's own 13.55484801530838; the witnesses waited 401.6185279786587
trial 2: 214.5770239830017 ms covered, the passes' own 13.569151997566223; the heavy pass's own 13.55987200140953; the witnesses waited 201.0177280008793
trial 3: 214.40979200601578 ms covered, the passes' own 13.567903995513916; the heavy pass's own 13.559808015823364; the witnesses waited 200.8433280289173
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:558:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 214.41948798298836 ms covered, the passes' own 13.566080033779144; the GPU ran others' work for 200.85855999588966 ms between a pass and its span's end
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 7.76s
== beside the load (acceptance_3171_load), run 3
load: busy 401.6
trial 0: 214.42457601428032 ms covered, the passes' own 13.57123202085495; the heavy pass's own 13.562463998794556; the witnesses waited 200.85750398039818
trial 1: 13.808735996484756 ms covered, the passes' own 13.566336005926132; the heavy pass's own 13.557440012693405; the witnesses waited 0.2460480034351349
trial 2: 13.812319993972778 ms covered, the passes' own 13.56921598315239; the heavy pass's own 13.559935986995697; the witnesses waited 0.24457600712776184
trial 3: 13.921600013971329 ms covered, the passes' own 13.670560002326965; the heavy pass's own 13.661632001399994; the witnesses waited 0.2534400224685669
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:558:13:
INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: trial 0: 214.42457601428032 ms covered, the passes' own 13.57123202085495; the GPU ran others' work for 200.85750398039818 ms between a pass and its span's end
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 7.75s
### mutant: only the first submission begins a span
clone at d63b612a0, its spans.rs replaced by 3a1de3769's; load 4.94 5.89 11.81
== alone, run 1
trial 0: 214.66214400529861 ms covered, the passes' own 13.571424007415771; the heavy pass's own 13.561599999666214; the witnesses waited 0.29398399591445923
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 214.66214400529861 ms covered, the passes' own 13.571424007415771: the gap counted (0.29398399591445923 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.64s
== alone, run 2
trial 0: 214.53110399842262 ms covered, the passes' own 13.512447983026505; the heavy pass's own 13.503104001283646; the witnesses waited 0.43648001551628113
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 214.53110399842262 ms covered, the passes' own 13.512447983026505: the gap counted (0.43648001551628113 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.64s
== alone, run 3
trial 0: 214.64783999323845 ms covered, the passes' own 13.62243202328682; the heavy pass's own 13.612576007843018; the witnesses waited 0.3425599932670593
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 214.64783999323845 ms covered, the passes' own 13.62243202328682: the gap counted (0.3425599932670593 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 0.65s
== beside the load (acceptance_3171_load), run 1
load: busy 403.1
trial 0: 418.9860799908638 ms covered, the passes' own 13.676576018333435; the heavy pass's own 13.667776018381119; the witnesses waited 202.4055359661579
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 418.9860799908638 ms covered, the passes' own 13.676576018333435: the gap counted (202.4055359661579 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 3.47s
== beside the load (acceptance_3171_load), run 2
load: busy 404.8
trial 0: 418.87411201000214 ms covered, the passes' own 13.674432009458542; the heavy pass's own 13.665439993143082; the witnesses waited 202.40038400888443
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 418.87411201000214 ms covered, the passes' own 13.674432009458542: the gap counted (202.40038400888443 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 3.52s
== beside the load (acceptance_3171_load), run 3
load: busy 404.8
trial 0: 418.9487039744854 ms covered, the passes' own 13.673535972833633; the heavy pass's own 13.664351999759674; the witnesses waited 202.40051200985909
thread 'spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it' (<tid>) panicked at crates/deep-gpu/src/spans.rs:547:13:
trial 0: 418.9487039744854 ms covered, the passes' own 13.673535972833633: the gap counted (202.40051200985909 ms of it was the GPU's on other work)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 53 filtered out; finished in 3.50s
```
