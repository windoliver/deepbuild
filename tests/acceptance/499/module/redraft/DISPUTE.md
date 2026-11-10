# Dispute: AC5's first draft (`module/seal.test.ts`, first test)

The first draft's board holds a `test.probe@1` item but its `requires.modules` doesn't name `test.probe`. The base
document check refuses every module kind its document doesn't declare (canvas primitives: Document envelope,
`requires`; `crates/deep-canvas/src/document/check.rs`, "kind `…` is the `…` module's, and `requires.modules` does not
name it"), as #305's suite declares `test.a` for its own test module. So the first draft fails on its own fixture, not
on the program:

```text
AssertionError: the board 01JB499M000000000000000001 with the test.probe@1 item has no error issue
+ "{\"code\":\"out_of_range\",\"ids\":[\"probe\"],\"path\":\"items/probe/kind\",\"actual\":\"test.probe@1\",
   \"what\":\"kind `test.probe@1` is the `test.probe` module's, and `requires.modules` does not name it\"}"
```

Its second test (the planted module refused at the seal, naming media) passed on the same build.

The criterion went to a fresh run of the blind job with the same inputs and the criterion, never the work, the diff or
this dispute (design: Dogfooding). Its draft is `seal-redraft.test.ts` here (REDRAFT.md). Swapping it in for the first
draft is the owner's call.
