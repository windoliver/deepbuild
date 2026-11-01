# Dispute: `#185.da9aab76 … B passes the kit and its release build seals` (kit.test.ts)

The original test builds `core,test-sim-b,test-sim-behavior`, runs the kit over every module to write a ledger, and
embeds that ledger in a release build of the same features. The release build refuses to start because the ledger
shows `look` and `text` FAIL. B (`test.sim`) passes the kit in that run, including all three behavior fixtures.

`look` and `text` fail the kit in any `core`-set build, before this change. On the base c9225aa3 the same kit call
over a `core` build gives this (debug build, `{"call":"kit","sequences":100,"param_sets":50}`):

```
Base c9225aa3, deep-show --no-default-features --features core (debug), {"call":"kit","sequences":100,"param_sets":50}:
core: FAIL; parts not PASS: ['fixtures', 'catalog']; first failures: [{"code": "twin_passed", "module": "core", "part": "fixtures", "case": "parity/kernel/board.board#check0"}, {"code": "unexpected_codes", "module": "core", "part": "fixtures", "case": "parity/framework/code-derived-item.scene#codes", "fixture": "parity/framework/code-derived-item.scene", "extra": ["ref_unresolved"], "missing": ["derived_item"]}]
look: FAIL; parts not PASS: ['fixtures']; first failures: [{"code": "twin_passed", "module": "look", "part": "fixtures", "case": "parity/look/roles.board#check0"}]
text: FAIL; parts not PASS: ['fixtures', 'catalog']; first failures: [{"code": "twin_passed", "module": "text", "part": "fixtures", "case": "parity/text/counter.board#check0"}, {"code": "twin_passed", "module": "text", "part": "fixtures", "case": "parity/text/status.board#check0"}]
```

Without marks2d, the core kinds draw nothing (#388), so every pixel twin passes and the fixtures part reads INVALID.

The failing output on the work:

```
AssertionError: deep-show run starts and exits 0 (no signal); stdout: {"ok":false,"code":"seal_refused","reason":"kit_failed","modules":["look","text"],"operators":[],"arrays":[],"what":"look, text hasn't passed the canvas conformance kit at its digest","interface":"look@1","implementations":["look","text"]}
```

The blind redraft (`kit-behavior-redraft.test.ts`, written from the issue, the design and the base, without the work,
the diff or this note) builds the `full` set with the same two features, and it passes on the work. Under the
design's Dogfooding rule, the swap is the owner's call. Both drafts stay in the tree until then.

Resolved Nov 1: the owner asked to close the gaps, which approves the swap (as with #246's redraft for #879). The
original test is replaced in kit.test.ts by a pointer comment; the redraft proves that condition.
