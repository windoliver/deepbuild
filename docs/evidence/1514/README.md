# #1514: rule lines an agent never gets

Written by a scratch script from the built CLI at this commit, in temp homes and repos (paths shown as `<tmp>`), with the shipped facts. No network, no model.

### A root and a nested AGENTS.md, 40 KiB together, under Codex's shipped 32 KiB budget

`AGENTS.md` and `packages/core/AGENTS.md`: 320 lines of 64 bytes each (20,480 bytes apiece), a rule every 32 lines. The project is trusted.

`deep doctor --json` run in `<tmp>/budget/packages/core`: exit 1; its rules.not_loaded items:

```json
{"item":"rules.not_loaded","agent":"codex","code":"not_loaded","level":"fail","evidence":"Codex reads AGENTS.md and then packages/core/AGENTS.md in a session started in packages/core, all under one 32,768-byte budget (project_doc_max_bytes), and loads only the first 12,288 bytes of packages/core/AGENTS.md, so line 193 and every line after it never reach Codex: \"- Core rule 193: keep the build reproducible...................\" (as Codex's facts for 0.166.0-alpha.5.1 say).","fix":"Trim the files Codex reads there under 32,768 bytes together, or move rules into a deeper file, or raise project_doc_max_bytes in ~/.codex/config.toml. Until then DeepBuild sends these rules to Codex's sessions itself where they fit."}
```

### The same repo in a project Codex doesn't trust

`~/.codex/config.toml` sets the repo's `trust_level = "untrusted"`.

`deep doctor --json` run in `<tmp>/budget/packages/core`: exit 1; its rules.not_loaded items:

```json
{"item":"rules.not_loaded","agent":"codex","code":"not_loaded","level":"fail","evidence":"Codex loads no rule file in <tmp>/budget: ~/.codex/config.toml sets projects.\"<tmp>/budget\".trust_level to \"untrusted\", so line 1 of AGENTS.md and every line after it never reach Codex (as Codex's facts for 0.166.0-alpha.5.1 say).","fix":"Trust the project in Codex (~/.codex/config.toml) if its rule files should load. Until then DeepBuild sends these rules to Codex's sessions itself where they fit."}
{"item":"rules.not_loaded","agent":"codex","code":"not_loaded","level":"fail","evidence":"Codex loads no rule file in <tmp>/budget: ~/.codex/config.toml sets projects.\"<tmp>/budget\".trust_level to \"untrusted\", so line 1 of packages/core/AGENTS.md and every line after it never reach Codex (as Codex's facts for 0.166.0-alpha.5.1 say).","fix":"Trust the project in Codex (~/.codex/config.toml) if its rule files should load. Until then DeepBuild sends these rules to Codex's sessions itself where they fit."}
```

### CLAUDE.md and AGENTS.md at the root

No `instructionFiles` setting in `~/.claude/settings.json`, so Claude Code's default, `claude-md-or-agents-md`.

`deep doctor --json` run in `<tmp>/both`: exit 1; its rules.not_loaded items:

```json
{"item":"rules.not_loaded","agent":"claude-code","code":"not_loaded","level":"fail","evidence":"Claude Code reads CLAUDE.md instead of AGENTS.md (instructionFiles is claude-md-or-agents-md), so line 1 of AGENTS.md and every line after it never reach Claude Code (as Claude Code's facts for 2.1.308 say).","fix":"Move AGENTS.md's rules into CLAUDE.md, or set instructionFiles in ~/.claude/settings.json so both load. Until then DeepBuild sends these rules to Claude Code's sessions itself where they fit."}
```

### A 307-line memory index (48 bytes a line)

Claude Code's shipped limits: 200 lines and 25,000 bytes.

`deep doctor --json` run in `<tmp>/index-lines`: exit 1; its rules.not_loaded items:

```json
{"item":"rules.not_loaded","agent":"claude-code","code":"not_loaded","level":"fail","evidence":"Claude Code loads only the first 200 lines or 25,000 bytes of its memory index ~/.claude/projects/<tmp, as a folder name>-index-lines/memory/MEMORY.md, whichever comes first, and it has more than 200 lines, so line 201 and every line after it never reach Claude Code: \"- Memory note 201: keep notes short............\" (as Claude Code's facts for 2.1.308 say).","fix":"Shorten ~/.claude/projects/<tmp, as a folder name>-index-lines/memory/MEMORY.md to under 200 lines and 25,000 bytes: one line per entry, the detail in topic files. Until then DeepBuild sends these rules to Claude Code's sessions itself where they fit."}
```

### A 150-line memory index of 300 bytes a line

Claude Code's shipped limits: 200 lines and 25,000 bytes.

`deep doctor --json` run in `<tmp>/index-bytes`: exit 1; its rules.not_loaded items:

```json
{"item":"rules.not_loaded","agent":"claude-code","code":"not_loaded","level":"fail","evidence":"Claude Code loads only the first 200 lines or 25,000 bytes of its memory index ~/.claude/projects/<tmp, as a folder name>-index-bytes/memory/MEMORY.md, whichever comes first, and line 84 ends past 25,000 bytes, so line 84 and every line after it never reach Claude Code: \"- Index entry 084: read the deploy notes before a release.......................................................................................................\" (as Claude Code's facts for 2.1.308 say).","fix":"Shorten ~/.claude/projects/<tmp, as a folder name>-index-bytes/memory/MEMORY.md to under 200 lines and 25,000 bytes: one line per entry, the detail in topic files. Until then DeepBuild sends these rules to Claude Code's sessions itself where they fit."}
```

## Each facts entry, with the version it was read from

- `adapters/claude-code.facts.json` for 2.1.299, 2.1.304, 2.1.308: code.claude.com/docs/en/memory (How CLAUDE.md files load; AGENTS.md: When Claude Code reads AGENTS.md, Choose which instruction files load; Auto memory: How it works) and code.claude.com/docs/en/hooks (InstructionsLoaded), read Nov 18 2026 against 2.1.309. They hold from 2.1.285 on, before these versions: AGENTS.md is read directly from 2.1.277, the setting's plugin ID cc-plugin-agents-md@builtin is read from 2.1.285, and the memory index is measured past its front matter from 2.1.211; the size limit on files loaded on demand starts at 2.1.309, after them
- `adapters/codex.facts.json` for 0.144.0: codex-rs/core/src/agents_md.rs at rust-v0.144.0 (read_agents_md: one project_doc_max_bytes budget for the files from the project root down to the session's folder, a file cut where the remaining budget ends and the rest skipped once it is spent, a blank file costing nothing; candidate_filenames: AGENTS.override.md before AGENTS.md, one per folder; no trust check before a load) and codex-rs/config defaults (project_doc_max_bytes = 32768, project_root_markers = [".git"]), read Nov 18 2026
- `adapters/codex.facts.json` for 0.160.0, 0.163.0-alpha.10.2, 0.166.0-alpha.5.1: codex-rs/core/src/agents_md.rs at rust-v0.160.0, rust-v0.163.0-alpha.10.2 and rust-v0.166.0-alpha.5.1 (load_project_instructions loads no project file when config.active_project.is_untrusted(), a project whose trust_level is "untrusted"; read_agents_md and candidate_filenames as at 0.144.0) and codex-rs/config/src/config_toml.rs (DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024), read Nov 18 2026
