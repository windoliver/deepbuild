# deep-panel-host

## What it is for

The process agent-built panels run in (#358). It loads one panel under the empty policy plus DeepBuild's module and, per invalidation, runs its script on this process's main thread and writes the element tree on stdout, one JSON object a line. It owns no screen and no authority: a focus move it sees is only reported, and undone unless the app grants it. The JIT is denied before any runtime exists, so the shipping host never has one.

The host hashes each tree it renders, whoever asked for the render (a command, or the panel's own timer), and writes `{"frame": {panel, hash, tree}}` only when the hash changed (#1492), so a panel that re-renders the same thing draws nothing. `stats` and `verdict` read its counts; `--planted redraw_every_render` is the wrong host the tests plant.

`deep-panel-host serve --panel DIR [--draw] [--planted NAME]` takes the app's commands on stdin; `deep-panel-host run --panel DIR --renders N --out FILE` runs the host alone for the JIT's proof. `deep-panel-host-jit-control` is the same `run` with the switch left alone: the control that proves the switch is what turns the JIT off.

## Where new code goes

- `src/lib.rs`: the panel, its window and render loop, `serve`, `run` and the flag reader.
- `src/main.rs`: the shipping binary; it denies native code and caps the heap before anything else.
- `src/jit_control.rs`: the JIT-on control binary, read from `DEEP_358_*` variables.
- Tests: the acceptance tests in tests/acceptance/358 drive the binaries.

## What it may import

deep-app (the panel runtime, module and tree parser), gpui-kit's headless context, gpui-shell's script view, quickjs-jit-runtime and serde_json. Nothing imports it: the app's `panel-check`, `panel-bench` and `panel-keys` commands (the `panel-check` feature, off in the shipping app) start it as a process of its own. The shipping app starts none yet: every installed view mounts in the app's process (#358).

## Deviations

None.
