# @deepbuild/checks-host

## What it is for

R3's check kinds for hosts (#1943), each a `check.kind@1` plug-in under #68's rules: `setting` (a machine's setting holds in its settings file, read from the host at each run) and `machine` (a user service is enabled and survives a restart, nothing listens beyond what was asked, the disk keeps its margin). A kind reaches a host only through the host link it's handed, `ssh -F` an SSH config to a host that config names (#1942's link); a host the config doesn't name is never contacted. A runner returns a run outcome, never a verdict. Each kind declares its budget per run and ships its own kit, run on a test host, with a planted failure it catches. `draftMachine` drafts what done means for a machine after a probe of its facts; a reboot is never a check, only a question that waits for your yes. `tests/acceptance/1943` drives the kinds on this Mac's Lima VMs.

## Where new code goes

- `src/index.ts`: the plug-in entry, each kind's budget and its fill (`hostFill`, `hostKit`); `src/types.ts`: the shapes.
- `src/run.ts`: one run, the kind's work in `runtime/probe.mjs` in a process group of its own, so the deadline ends it and its ssh.
- `src/kit.ts`: each kind's `check.kind@1` kit, its cases made on a test host, with its planted runners; `src/draft.ts`: the draft after a probe.
- Tests: `test/`; the acceptance suite in `tests/acceptance/1943` is never edited.

## What it may import

A plug-in on the core: only `@deepbuild/conformance` and `node:` built-ins, through their public entries. It never imports the record, the hub, CLI or app.

## Deviations

- The probe reads which hosts an SSH config names with its own copy of the hub's Host-line reading (`packages/hub/src/hosts.ts`, `Hosts.names`), since a plug-in can't import the hub.
- The hub's kind table (`packages/hub/src/kinds.ts`) doesn't hold these kinds yet; Remove it (#1946) and the full setup (#1947) wire them to definitions.
