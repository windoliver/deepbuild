# #1620: deep-replica's three known failures, a blind assessment

Inputs: the base archive at `ccbdefd1`, `issue-1620.json`, `issue-326.json`, `issue-327.json`, `AGENTS.md`, the design. No branch, diff, transcript, network or tool beyond Read/Glob/Grep/Write. **Nothing here was run**; every claim about behaviour is from reading source, and says so where it matters.

Files: this README and `planted_loader_proposal.rs` (a proposal, wired nowhere, replacing nothing). No existing file was edited.

## Summary

| Known failure | Product code can resolve it? | Needs |
|---|---|---|
| `acceptance_326_panels_planted › base_loader_reaches_the_network` | **No.** The product is already right; the check's wrong program is stale. | Independent redraft (maintainer-approved): `planted_loader_proposal.rs` |
| `acceptance_327_card` | **Not wholly.** Three cases are hard-coded BLOCKED and the suite can't consume evidence. Whether the other cases pass is unknown (not run). | Manual evidence that doesn't exist, plus a maintainer decision on how the suite may consume it |
| `headless › replica_equals_live_tree` | Undetermined; **no longer listed** in `scripts/known-failures.json` at this base. | A fresh live capture on the reference Mac if the live tree is stale; never an edit to the stored tree |

## 1. `base_loader_reaches_the_network` (#326 AC5)

Criterion (`#326.0a9b47e1`): a panel whose gpui-shell manifest lists a git dependency "is refused at install, naming the dependency, and loading it makes no network request".

Evidence:
- `tests/acceptance/326/panels/planted.rs:374-397` calls `deep_app::mount_panel` on the fixture and asserts `listener.connections() > 0` ("the base loader reached no host, so this wrong program can't fail the load check"). Its header (lines 15-16) and the README table (`326/panels/README.md:57`) call that function "the base's loader", written when `mount_panel` was bare gpui-shell.
- At this base `crates/deep-app/src/lib.rs:376-387` `mount_panel` starts with `admit(dir)?`, and `admit` (408-417) bails on `fetched_dependency(dir)` with `fetch_refusal`, naming the dependency, before `runtime.load_application` is reached. The same check is in `panel_check.rs:548` and `panel_keys.rs:674`.
- So the listener never sees a connection and the planted assertion fails. That is the product doing what AC5 requires. This is exactly the criterion's right behaviour, and `panels.rs › git_dependency_refused_at_install_and_never_fetched` (lines 140-185) asserts it on the app.

Conclusion: no product change can turn this green without putting the network fetch back, which would contradict the issue and the design. The only product-side "fix" is to delete the refusal; I do not recommend it. The planted program must stop being the product's own function. This is the same defect `326/panels/redraft-ac7/README.md` already redrafted for AC7 (a planted host must not ride the app's loader). The AC5 planted test wasn't included in that redraft.

### Proposed redraft: `planted_loader_proposal.rs`

Built only from gpui-kit and gpui-shell (`gpui_shell::components::new_isolated_runtime()`, `ShellRuntime::load_application` / `mount_application`, an empty policy), with the existing `326/panels/common.rs` (`Listener`, `Scratch`, `copy_fixture`) and the existing `fetched-dependency` fixture reused by path; nothing copied. The real public surfaces are the same ones AC5 names: a package manifest with a git dependency, a TCP listener counting connections, a refusal message.

A local `judge_load` states AC5's two observations in `panels.rs`'s words (refusal names the dependency; zero connections). Three wrong programs:

| Test | Wrong program | Assertion that rejects it |
|---|---|---|
| `bare_gpui_shell_loader_is_rejected` | gpui-shell's loader, no admission | judge reports "the load reached the dependency's host" **and** "no refusal naming pad-326"; the test also requires the first, so the fixture must actually reach the host |
| `refuse_after_fetching_loader_is_rejected` | loads, then refuses naming `pad-326` | only "the load reached the dependency's host" (exactly one line) |
| `refuse_without_naming_loader_is_rejected` | refuses before loading, names nothing | only "doesn't name the dependency pad-326", and no connection |

The correct loader's acceptance stays with `panels.rs` (the control). It is not duplicated.

Invocation, after a maintainer adds the `[[test]]` entry (shown in the file header; I could not edit `Cargo.toml`):

```sh
cargo test --locked -p deep-replica --test acceptance_1620_planted_loader
```

Expected: 3 ok on macOS. Elsewhere INCONCLUSIVE, exit 1.

Replacement: if approved, the maintainers drop `base_loader_reaches_the_network` from `planted.rs`/its README row, add the new target, and remove its known-failure entry. Not done here.

Unverified: that gpui-shell at the pinned rev fetches during `load_application` (the fixture comment and the old passing base say so; I did not read gpui-shell), and that the code compiles (closure capture in `load`, the unused `outcome` on the Bare path). If the bare loader reaches no host, the first test fails on its own "fixture doesn't show the fault" assertion rather than passing silently.

## 2. `acceptance_327_card`

The target is one binary; the entry is the whole target. Reading `tests/acceptance/327/card.rs` and `common.rs`:

- `ac5_with_voice_control_…`, `ac5_with_switch_control_…` and `ac5_voiceover_…` (`card.rs:169-194`) unconditionally `panic!("BLOCKED: …")`. `common::run` (`327/common.rs:305-340`) counts blocked as not passed and returns exit 1. So **the target exits non-zero by construction, whatever the product does.** That is correct under AGENTS.md invariant 2 (unrun is never PASS).
- Nothing can consume evidence: the cases don't read any file; the "manual section" in `327/BASE-FAILURE.txt:124-128` is prose that says "not run" ×3, and no script references it (grep of `scripts/` for it: none). Even if a person wrote results there, the existing check would still print BLOCKED.

What's absent, exactly (AC5, `#327.d3f997a2`), from a person on a real Mac:
1. Voice Control on: for each of the seven kinds (`fixtures/kinds/*`), say "Click <option label>" on the armed card, pass the Touch ID/password prompt, see that the ask is answered with that option (`deep inbox`); cancel one prompt, see the ask stays open.
2. Switch Control: the same, per kind.
3. VoiceOver: per kind, it speaks the question, every option label, the deadline and the default.

No such record exists in this archive (`docs/evidence` and `reports` hold known-failure lapse lines for this target and nothing about these steps). I haven't invented any and the draft adds none.

Other cases: I can't tell whether they pass. `reports/*` only show the lapse line, not the case results. Each is judged against `Replica` surfaces and planted twins, which are in `acceptance_327_planted`; if some fail on main, those are product bugs to fix without touching the tests. I couldn't determine which.

Conclusion: product code cannot make `acceptance_327_card` pass; a target with BLOCKED cases is correctly red until evidence exists. Not recommended, and not done: removing/skipping the three cases, marking them ok, or hiding them in the known-failure list as if it were a fix. Options for the maintainer, each needing approval:
- (a) Have a person run the three manual steps and record the results, and have a blind redraft of AC5 define a machine-readable record format the suite reads (and rejects when absent, stale, or for a different commit). That redraft is the thing to commission; I did not draft it, because a format is an invented fixture until approved.
- (b) Keep the target red and accept that the lint lane reports it; the known-failure list is then the wrong tool (it lapses in 14 days by design, #1333).

## 3. `headless › replica_equals_live_tree`

- `scripts/known-failures.json` at this base lists only the other two #1620 entries; this one is already gone. Whether it was fixed or dropped, I can't tell.
- The check (`crates/deep-replica/headless.rs:515-538`) compares a fresh replica snapshot with `docs/spikes/338/out/live/{needs-you,sidebar,session}.json`, captured by `deep-live` "on the reference Mac" (its own panic message). Those live files are manual evidence from the real app's accessibility tree.
- If it fails, the cause is either the replica/app drifting from the real tree (a product bug, fix in the app) or the stored live capture being stale after intended UI changes. For the latter, the legitimate fix is a new `deep-live` capture on the reference Mac, reviewed. Editing the stored JSON, loosening `first_difference`, or skipping a view is the "modify to get green" this job refuses. I did not diff the stored trees against current code, so which case applies is unknown.
- Also at this base: `headless` is one suite where a missing live file panics, so a non-macOS run is not a PASS.

Exact evidence needed if stale: `deep-live` output for the three views from the reference Mac, at the commit under test, committed with its provenance.

## Unrun limitations

- No test, cargo build, node script or app was run; the proposal is uncompiled.
- I did not read gpui-shell or gpui-kit sources, the full design text (the Dogfooding bullet is a single very long line I could only grep), or `Replica` internals behind `card.rs`.
- Results of the other `acceptance_327_card` cases and of `replica_equals_live_tree` on this base are unknown.
