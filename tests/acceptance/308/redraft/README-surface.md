# README.md lines the surface redraft replaces

Each old line of `../README.md` (by line number at commit `1ba8afd6`) and its replacement. No other README line
changes. Line 8 (the conventions taken from #372's `deep-canvas` binary) stays: it credits a convention, not the surface.

Line 32-33, old:

```
1. **`deep-canvas input`**, a new subcommand of #389's binary (`target/debug/deep-canvas`), for controls and the
   input track's handling.
```

new:

```
1. **`deep-input input`**, the subcommand of the input module's proof binary (`target/debug/deep-input`, package
   `crates/deep-input`, beside the module as #391's `deep-motion` is beside motion), for controls and the input
   track's handling.
```

Line 36, old:

```
3. **Cargo features and `--planted` names** of `deep-show` and `deep-canvas input` for the planted programs.
```

new:

```
3. **Cargo features and `--planted` names** of `deep-show` and `deep-input input` for the planted programs.
```

Line 38, old:

```
### 1. `deep-canvas input`
```

new:

```
### 1. `deep-input input`
```

Line 119, old:

```
### Planted names of `deep-canvas input` (`"planted"`)
```

new:

```
### Planted names of `deep-input input` (`"planted"`)
```
