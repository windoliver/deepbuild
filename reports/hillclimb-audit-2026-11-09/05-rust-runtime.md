# 05 — small runtime Rust crates

Audit of `crates/deep-hook`, `deep-contracts` (handwritten part), `deep-relay`, `deep-codecs`, `deep-logic`,
`deep-sandbox-wasmtime`, `deep-canvas-sandbox`, `deep-input`, `deep-panel-host` at 6a6d6b4f. Read-only: nothing was
built, run or measured. Every gain below is a count worked out from the code (syscalls, allocations, copies); none is
a wall time. Syscall counts assume macOS `realpath(3)`, which makes about one `getattrlist` per path component.

Answers to the prompt's direct questions about deep-hook's start-up:

- **No regex engine is linked.** `crates/deep-hook/Cargo.toml` depends on `deep-contracts` (std only), `rustls` and
  `ring`. Every matcher is hand-written (`shell::glob`, `matcher::holds_word`, the Pike VM in deep-contracts is used
  only by the generated types, which deep-hook never calls). There are no static initializers in the crate's own code:
  only `const` tables, atomics and `OnceLock`s.
- **rules.json**: the shipped file is 24.7 KB, 296 JSON objects, 722 keys. deep-hook reads only `entries`, `classes`
  and `standing`; `proofs` (planted calls and twins, the hub's) is 9.9 KB and 257 of the 296 objects, parsed and thrown
  away on every PreToolUse (F4 cuts what each of those objects costs; moving `proofs` to its own file would change
  the file the hub writes, so it is not proposed).
- **The stdin payload** is never re-serialized, but it is parsed into a full `Value` (every string copied) and its raw
  text is copied three more times before the socket write (F5).
- **Before the connect**, a PreToolUse with the shipped rules reads `config.json` four times (F6), walks the checkout
  twice (F1), resolves each write path once per glob (F2) and reads the shell line twice (F3).

Findings are ranked by gain over risk. F1–F13 are CONFIRMED; F14–F17 are PLAUSIBLE.

---

## F1 — deep-hook resolves the session's checkout twice on every PreToolUse, for calls that write nothing and run no git

**Status**: CONFIRMED. **Risk**: low. **Lines**: 2 added.

**Where**: `crates/deep-hook/src/matcher.rs:623-625` (`effect`, class `top-level-folder`),
`crates/deep-hook/src/matcher.rs:728-729` (`other_checkout`), `matcher.rs:1720-1744` (`checkout`),
`crates/deep-hook/src/shell.rs:251-274` (`real`).

**What**: The shipped rules hold `record-new-top-level-folder` (`effect:top-level-folder`) and
`no-git-other-checkout` (`git:other-checkout`). Both call `checkout(self.cwd)` first and only then look at what the
call does:

```rust
// matcher.rs:624
if class == "top-level-folder" {
    let root = checkout(self.cwd.as_deref()?)?.root;
    let new = self.writes.iter().zip(&self.by.0).find_map(|(w, by)| { ... })?;
// matcher.rs:728
fn other_checkout(&self) -> Option<String> {
    let own = checkout(self.cwd.as_deref()?)?;
    for run in self.runs.iter().filter(|r| r.is("git")) {
```

`checkout` runs `real(dir)` (one `fs::canonicalize` per component, so d(d+1)/2 component lookups for a d-deep folder),
then `fs::metadata(".git")` per level up, then for a plain repo `real(.git)` twice (`gitdir: real(&dot), common:
real(&dot)`, lines 1728-1729), or for a worktree a read of `.git`, `real(gitdir)`, a read of `commondir` and
`real(common)`. For this worktree (cwd 6 deep, `.git` a file) that is about 90 path syscalls per `checkout`, so about
180 per PreToolUse, for every tool with a `tool_name` (`call()` builds a `Call` for Read, Glob, MCP tools and `ls`
alike). With no writes the first can't hit; with no git run the second can't.

**Change**:

```rust
// matcher.rs, in `effect`, first line inside `if class == "top-level-folder" {`
if self.writes.is_empty() {
    return None;
}
// matcher.rs, first line of `other_checkout`
if !self.runs.iter().any(|r| r.is("git")) {
    return None;
}
```

Also free: `matcher.rs:1728-1729`, `let git = real(&dot);` once, then `gitdir: git.clone(), common: git`.

**Why it is safe**: With `writes` empty, `find_map` over an empty iterator is `None` and the `?` returns `None`
whatever `checkout` returned. With no run for which `r.is("git")`, the `for` body never runs and the function ends in
`None`. `reads_whole` returning `None` falls through to `may_be(pattern)` in both the old and the new code
(`matcher.rs:227`), so an unread run still meets these entries exactly as before. The guards reuse the same
predicates (`self.writes`, `Run::is`), so a glob program such as `g?t` is still read as git.

**Gain**: about 180 path syscalls fewer on a PreToolUse that writes nothing and runs no git (Read, Grep, most Bash),
about 90 fewer on one that does only one of the two. Unmeasured in time.

**Proof plan**: pinned by `matcher.rs` test `a_folder_made_at_the_checkouts_top_is_new` (line 2254),
`tests/acceptance/316/git.test.ts` (other-checkout), `tests/acceptance/317`, `tests/acceptance/304/defaults.test.ts`
(every default's planted call and twin through `deep-hook check`). Gain shows in `benchmarks/deep-hook.mjs guards`
(`matchP95Ms`: an `ls` with every default against none) and `day-overhead`; count it with `scripts/perf.mjs`'s
instructions retired for `deep-hook-guards`.

---

## F2 — a `write:`/`read:` entry resolves each path once per glob, and each glob once per path

**Status**: CONFIRMED. **Risk**: low to medium (security-relevant matcher; the change only moves pure computations out
of a loop). **Lines**: about 40.

**Where**: `crates/deep-hook/src/matcher.rs:318-339` (the `"write" | "read"` arm), `matcher.rs:685-725`
(`path_matches`, its only caller is that arm, lines 327-328), `shell.rs:251` (`real`), `shell.rs:227` (`same_name`).

**What**: `path_matches(pattern, written)` does, on every call: expand `~`, `real()` the glob's literal part when the
glob is anchored, `lexical(written)`, `real(written)`, `same_name` of each, and a `format!("*/{p}")` per unanchored
pattern per form. The arm calls it for every glob × path pair:

```rust
let k = paths.iter().position(|w| {
    globs.iter().any(|g| self.path_matches(g, w))
        && !but.iter().any(|g| self.path_matches(&g[1..], w))
})?;
```

The shipped rules have 5 `write:` entries with 37 globs (22 anchored) and one `read:` entry with one anchored glob.
A path that matches nothing (the normal case) is tried against all of them. So one Edit of a file 10 folders deep
runs `real(written)` 37 times (55 component lookups each, about 2,000 syscalls) and `real(literal)` 22 times (about
220 more). For a Bash call every non-option word of every run is a read path (`matcher.rs:184-194`), and each one
re-resolves the same literal `~/.deepbuild/control.token`.

**Change**: split `path_matches` in two and call each half once.

```rust
/// A path glob's spellings: as written and, when anchored, with its literal part resolved; ready to match whole.
fn path_glob(&self, pattern: &str) -> Vec<String> {
    // lines 686-708 and 714 as they are, then for an unanchored glob the "*/" prefix of line 721:
    patterns.iter().map(|p| if anchored { same_name(p) } else { format!("*/{}", same_name(p)) }).collect()
}
/// A path's spellings: as written and as its links resolve (lines 709-713 and 716).
fn path_forms(&self, written: &Path) -> Vec<String> { ... }

// the arm
let (paths, by, verb) = ...;                     // moved above the glob work
if paths.is_empty() { return None; }
let (but, globs): (Vec<&str>, Vec<&str>) = rest.split_whitespace().partition(|g| g.starts_with('!'));
let globs: Vec<Vec<String>> = globs.iter().map(|g| self.path_glob(g)).collect();
let mut but_globs: Option<Vec<Vec<String>>> = None;   // read only once some glob matches
let hit = |g: &[String], forms: &[String]| forms.iter().any(|t| g.iter().any(|p| glob_path(p.as_bytes(), t.as_bytes())));
let k = paths.iter().position(|w| {
    let forms = self.path_forms(w);
    globs.iter().any(|g| hit(g, &forms))
        && !but_globs
            .get_or_insert_with(|| but.iter().map(|g| self.path_glob(&g[1..])).collect())
            .iter()
            .any(|g| hit(g, &forms))
})?;
```

Keep both `cfg!(feature = "plant-paths-as-written")` branches where they are (one in each half). A further step, not
needed for the gain above: cache `path_forms` per `Call` (`OnceLock<Vec<Vec<String>>>` beside `writes` and `reads`, so
`Call` stays `Sync` for the semver lane), which takes the 5 `write:` entries from 5 `real(written)` to 1.

**Why it is safe**: the boolean each pair yields is the same expression over the same strings; only where it is
computed moves. `same_name(format!("*/{p}"))` and `format!("*/{}", same_name(p))` are equal because `same_name` maps
`*` and `/` to themselves. `any` is order-independent and nothing in either half has a side effect. `paths.is_empty()`
returns what `position(..)?` returned. The one thing that differs: the file system is read at slightly different
moments within the same hook (a few microseconds apart), and fewer times. The `but` globs are still resolved only
after a positive match, as now.

**Gain**: an Edit/Write 10 deep: about 2,200 path syscalls down to about 500 (5 × 55 + 220); with the per-`Call` cache
about 275. A Bash call with R read words: R − 1 fewer `real(~/.deepbuild/control.token)` (about 10 syscalls each).
Unmeasured in time.

**Proof plan**: `matcher.rs` unit tests on `write:`/`read:` globs; `tests/acceptance/316/symlink.test.ts`,
`config.test.ts`, `corpus.test.ts` (the adversarial corpus), `tests/acceptance/304/defaults.test.ts`. Gain shows in
`benchmarks/deep-hook.mjs day-overhead` (the corpus's Edit, Write and Bash calls); `guards` uses `ls`, which has no
path, so it will not show this one.

---

## F3 — every Bash PreToolUse reads its command line through the shell reader twice

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 15.

**Where**: `crates/deep-hook/src/main.rs:1235-1238` (`call` → `matcher::Call::new` → `shell::runs`, `matcher.rs:158-161`),
`main.rs:1274-1277` and `main.rs:488-506` (`heavy_call`), `crates/deep-hook/src/heavy.rs:251-252`
(`let runs = shell::runs(command, cwd, home);`).

**What**: `forward` builds `called` (which lexes and reads the command into `Call.runs`) and then `heavy_call` calls
`heavy::matched`, which runs `shell::runs` again on the same `command`, the same `cwd` (payload `cwd` when absolute,
derived the same way at `main.rs:456-459` and `main.rs:500-503`) and the same `home`. The reader is the crate's most
allocation-heavy code (a `String` per unquoted or double-quoted character, a `Ctx` clone per pipeline stage), and it
reads script files the line runs (`shell.rs:898-904`, up to 256 KiB), so `sh build.sh` reads and reads through
`build.sh` twice.

**Change**:

```rust
// heavy.rs
pub fn matched(command: &str, cwd: Option<&Path>, home: &Path, plant: Option<&str>) -> Option<Hit> {
    matched_in(&shell::runs(command, cwd, home), command, cwd, plant)
}
/// As `matched`, for a line whose runs are read already.
pub fn matched_in(runs: &[shell::Run], command: &str, cwd: Option<&Path>, plant: Option<&str>) -> Option<Hit> {
    // the body of today's `matched` from `let leased = ...` on, unchanged
}
// main.rs: heavy_call(payload, called.as_ref(), plant)
fn heavy_call(payload: &Value, called: Option<&matcher::Call>, plant: Option<&str>) -> Option<(heavy::Hit, String)> {
    ... // the same guards
    match called {
        Some(call) => heavy::matched_in(&call.runs, command, cwd.as_deref(), plant),
        None => heavy::matched(command, cwd.as_deref(), &home, plant),
    }
    .map(|hit| (hit, command.clone()))
}
```

`heavy_entry` (`deep-hook heavy`, `main.rs:515`) and the unit test at `heavy.rs:308` keep calling `matched`.

**Why it is safe**: `heavy_call` returns early unless `tool_name` is `Bash` or `bash` and `tool_input.command` is a
string. For exactly those payloads `call()` returns `Some` (`main.rs:434`, `445`) and `Call::new` sets
`runs = shell::runs(line, cwd, home)` (`matcher.rs:157-161`) from the same three values; `runs` is a `pub` field
nothing mutates afterwards. `called` is `None` only when the event isn't PreToolUse, where `heavy_call` isn't reached
either (`main.rs:1276`); the `None` arm keeps today's path anyway. `rules()` failing doesn't change `called`
(`rules.unwrap_or_default()`, `main.rs:1234`). Both parses go through the same `cfg!(feature = "plant-issue-spellings")`
switch.

**Gain**: one whole lex + read per Bash PreToolUse, with its allocations and any script-file read. Roughly halves the
shell-reader share of the hook. Unmeasured.

**Proof plan**: `heavy.rs` unit tests, `tests/acceptance/1015/*.test.ts` (claude, codex, focused, own-repo),
`tests/acceptance/1016`, `crates/deep-hook/tests/cli.rs`. Gain shows in `benchmarks/deep-hook.mjs heavy` (both
`heavyP95Ms` and `plainP95Ms` drop; their difference, the budgeted number, should not rise), `unread` (the 13-deep
`sh -c` line is read once instead of twice), `overhead` and `guards`; instruction counts via `scripts/perf.mjs`.

---

## F4 — the JSON parser builds a `HashMap` and clones every key for every object, and copies strings a byte at a time

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 25.

**Where**: `crates/deep-contracts/src/lib.rs:254-288` (`Parser::object`), `lib.rs:180-229` (`Parser::string`).
Callers on the hot path: `crates/deep-hook/src/main.rs:224` (rules.json), `1216` (the payload), `107` (config.json),
`790`/`848`/`883` (hello, ack, reply), `remote.rs:306` (generations.json), `heavy.rs:59` (the compiled-in heavy.json).

**What**: (a) `object` makes `index: HashMap<String, usize>` per object and does `index.insert(key.clone(), ...)` per
member: one table allocation (two with a rehash once past 3 members), one `String` clone and two SipHash runs per key.
The shipped rules.json has 296 objects and 722 keys, parsed on every PreToolUse; a hook that isn't a Bash PreToolUse
creates no other `HashMap`, so this is also what makes std fetch its random hash keys. The index exists for
`tests/jcs.rs::an_object_with_many_keys_parses_in_linear_time` (100,000 keys). (b) `string` pushes one byte at a time
into a `Vec` that grows by doubling, so a 1 MiB tool output costs a million bounds-checked pushes and about 20
reallocations.

**Change**:

```rust
// object(): index only an object big enough for a scan to cost more than a table
let mut members: Vec<(String, Value)> = Vec::new();
let mut index: Option<HashMap<String, usize>> = None;
...
    let at = match &index {
        Some(index) => index.get(&key).copied(),
        None => members.iter().position(|(k, _)| *k == key),
    };
    // As JSON.parse does, a repeated key keeps its last value.
    match at {
        Some(i) => members[i].1 = value,
        None => {
            if let Some(index) = &mut index {
                index.insert(key.clone(), members.len());
            }
            members.push((key, value));
            if index.is_none() && members.len() > 16 {
                index = Some(members.iter().enumerate().map(|(i, (k, _))| (k.clone(), i)).collect());
            }
        }
    }

// string(): the run up to the next quote, escape or control character goes over in one copy
loop {
    let start = self.at;
    while self.bytes.get(self.at).is_some_and(|b| !matches!(b, b'"' | b'\\' | 0x00..=0x1f)) {
        self.at += 1;
    }
    out.extend_from_slice(&self.bytes[start..self.at]);
    let byte = self.peek().ok_or_else(|| self.error("an unterminated string"))?;
    self.at += 1;
    match byte {
        b'"' => break,
        b'\\' => { /* unchanged */ }
        _ => return Err(self.error("a control character in a string")),
    }
}
```

**Why it is safe**: (a) both lookups return the index of the key's first occurrence, the member keeps that position
and takes the last value, exactly as now; past 16 members the table takes over, so parsing stays linear and the
100,000-key test still holds. (b) the inner loop stops at exactly the three byte classes the old `match` treated
specially, so the bytes copied, the order of errors and `self.at` at each error (`at byte N` in the message) are the
same: an unterminated string still reports `at == len`, a control character `at == index + 1`. `Value` output is
byte-identical; nothing else in the crate is touched (generated.rs untouched).

**Gain**: per PreToolUse with the shipped rules: about 300 hash-table allocations, 722 `String` clones and about 1,450
SipHash runs fewer, plus one random-keys fetch fewer on hooks that never run the shell reader. For a payload string of
n bytes: n pushes become one `memcpy` per escape-free run. Unmeasured in time.

**Proof plan**: `crates/deep-contracts/tests/jcs.rs` (all five), the contracts acceptance suite that holds the Rust and
TypeScript parsers alike (`tests/acceptance/311`), `crates/deep-hook/tests/cli.rs`. A grep of `crates/deep-contracts/tests` and
`tests/acceptance/311` found no test that pins "a repeated key keeps its last value"; since the change touches that
branch, it needs one case below and one above 16 members (new behavior coverage the existing tests miss). Gain shows in
`deep-hook-guards` and `deep-hook-overhead` instruction counts (`scripts/perf.mjs`), and in `day-overhead` for the
PostToolUse payloads.

---

## F5 — the hook's payload text is copied three times between stdin and the socket, one of them through a per-char search

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 15.

**Where**: `crates/deep-hook/src/main.rs:1229-1233` (`input.trim().replace(['\n', '\r'], " ")`),
`main.rs:1322-1328` (`format!` of the request), `main.rs:833-836` (`None => request.clone()`).

**What**: for a payload of P bytes (a PostToolUse can pass 1 MiB) the hub-up path holds `input` (capacity up to 2P
from `read_to_string`), the parsed `Value` (every string copied), `payload` (P, made by `str::replace` with a
two-`char` pattern, which walks the text a `char` at a time and has no single-byte fast path), `request` (P) and
`sent` (P, a clone made only so the joined-hub case can prepend its hello). Peak is about 6–7 P against the design's
10 MB.

**Change**:

```rust
// main.rs:1229 — in place: one ASCII byte for another keeps the text UTF-8, and `input` isn't read again
let payload = if parsed.is_some() {
    let mut bytes = std::mem::take(&mut input).into_bytes();
    for b in &mut bytes {
        if matches!(*b, b'\n' | b'\r') {
            *b = b' ';
        }
    }
    let mut text = String::from_utf8(bytes).unwrap_or_default();
    text.truncate(text.trim_end().len());
    let lead = text.len() - text.trim_start().len();
    text.drain(..lead);
    text
} else {
    quoted(&input)
};

// main.rs:833
let with_hello;
let sent: &str = match joined {
    Some(joined) => {
        with_hello = remote::hello(joined) + &request;
        &with_hello
    }
    None => &request,
};
```

**Why it is safe**: `input` is used only at lines 1230 and 1232 (checked to the end of `forward`); the branches are
exclusive. Replace-then-trim equals trim-then-replace: `\n` and `\r` are whitespace and become a space, which is
whitespace, every other character is unchanged, and the byte length is unchanged, so the trimmed range is the same
and its interior is the same. `from_utf8` cannot fail (ASCII bytes replaced by ASCII bytes in valid UTF-8);
`unwrap_or_default` only avoids a panic path. `sent` is last used by `write_all` before any `return (Some(request), ..)`
moves `request`, so the borrow ends in time. The bytes written to the socket and to the spool are identical.

**Gain**: two P-sized allocations and copies fewer, the per-`char` search replaced by a byte loop, peak about 2 P lower
(about 2 MiB at a 1 MiB payload). Unmeasured in time.

**Proof plan**: `crates/deep-hook/tests/cli.rs` (the request line byte for byte, the spooled line), `tests/acceptance/315`
(`reading.test.ts`, `spool.test.ts`, `budgets.test.ts` peak memory), `tests/acceptance/16`. Gain shows in
`day-overhead` (PostToolUse payloads) and in peak bytes of `deep-hook-overhead` under `scripts/perf.mjs`; a 1 MiB
PostToolUse case is not in `benchmarks/deep-hook.mjs` today.

---

## F6 — `config.json` is read and parsed four times per PreToolUse (twice per other hook)

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 20.

**Where**: `crates/deep-hook/src/main.rs:106-109` (`setting` reads and parses the file per call), `117-127`
(`address` calls `worktree_hub()` → `setting("hub","use")`, then `setting("hub","address")`), `main.rs:467`
(`call()` passes `&address()` to `Call::new` for every tool call; only `kill:hub` reads it, `matcher.rs:610`),
`main.rs:779` (`UnixStream::connect(address())`).

**What**: `address()` costs two reads and two parses, and `forward` reaches it twice on a PreToolUse (`call`, then
`exchange`) and once otherwise. `deep setup` writes `runner.login_path` into config.json (`packages/hub/src/setup.ts:287`),
so the file exists on a set-up machine.

**Change**: one read inside `address`, and one `address()` per forwarded hook.

```rust
fn config() -> Option<Value> {
    parse(&fs::read_to_string(home().join("config.json")).ok()?).ok()
}
fn setting(section: &str, key: &str) -> Option<Value> {
    member(member(&config()?, section)?, key).cloned()
}
fn address() -> PathBuf {
    let config = config();
    let hub = |key: &str| config.as_ref().and_then(|c| member(member(c, "hub")?, key));
    if let Some(path) = worktree_hub_in(hub("use")) {
        return path;
    }
    match hub("address") { /* as now */ }
}
fn worktree_hub() -> Option<PathBuf> { worktree_hub_in(setting("hub", "use").as_ref()) }   // actions.rs keeps its caller
```

In `forward`, after `CWD` is set (line 1219): `let socket = std::cell::OnceCell::new();`, pass
`socket.get_or_init(address)` to `call(p, &rules.classes, hub)` (a new `hub: &Path` parameter; `check()` and
`matching()` pass `&address()`), and `&socket` to `exchange`, which uses `socket.get_or_init(address)` at lines 779
and 796.

**Why it is safe**: `address()` stays uncached across calls, so the long-lived modes that must see a changed setting
(`deep-hook match` per line, the waiter per reconnect, `mcp actions`) behave as now; only `forward`, which lives for
one hook, shares one value, and both of its uses come after `CWD` is set, as now. The lazy cell keeps a joined
project's non-PreToolUse hook from reading the file at all, as now. The only difference is that the two `hub`
settings come from one read of the file instead of two reads microseconds apart.

**Gain**: 3 file reads (12 syscalls) and 3 JSON parses fewer per PreToolUse, 1 fewer on other hooks.

**Proof plan**: `crates/deep-hook/tests/cli.rs`, `tests/acceptance/1338` and the `deep hub use` suites (worktree
routing), `tests/acceptance/316` (`kill:hub`). Gain shows in `deep-hook-overhead` and `deep-hook-guards` instruction
counts.

---

## F7 — deep-logic copies an item's whole memory two or three times to hash it, and once to keep a few pages

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 12.

**Where**: `crates/deep-logic/src/world.rs:311-319` (`deep_hash`), `world.rs:484-491` (`checkpoint`, the `Pages`
arm), `crates/deep-logic/src/piece.rs:157-160` (`h64`).

**What**: `deep_hash` builds one buffer to hash: `b.extend(&self.arrays.clone())` (a clone only to be copied) and
`b.extend(self.memory().to_vec())` (the memory copied to a temporary, then copied again into `b`, which reallocates as
it grows). A logic item's memory is 4 MiB by default (`service.rs:72`). `deep_hash` runs at every checkpoint
(`world.rs:473`) and for every item on every frame of a live view (`live.rs:165`, `deep_hashes`). The `Pages` arm of
`checkpoint` does `let m = l.memory().to_vec();` to copy out only the dirty 64 KiB pages; 7 checkpoints of 8 take that
arm.

**Change**:

```rust
fn deep_hash(&mut self) -> u64 {
    use sha2::Digest;
    let pending: usize = self.pending.values().map(VecDeque::len).sum();
    let mut h = sha2::Sha256::default();
    h.update(self.next.to_le_bytes());
    h.update((pending as u32).to_le_bytes());
    h.update(self.encoded());
    h.update(&self.arrays);
    h.update(self.memory());
    u64::from_be_bytes(h.finalize()[..8].try_into().expect("8 bytes"))
}
// checkpoint, Pages arm: borrow the memory
let m = l.memory();
```

**Why it is safe**: SHA-256 over the same bytes in the same order, fed in pieces, is the same digest; `h64` takes the
first 8 bytes big-endian and so does this. `sha2` is already a dependency (`crates/deep-logic/Cargo.toml:24`). In
`checkpoint`, `dirty` is collected into its own `Vec` before `l.memory()` is borrowed and the borrow ends with the
block, before `l.globals()`. No planted switch (`Planted`) reads either path.

**Gain**: per `deep_hash` of a 4 MiB item: about 8–12 MiB of copying and two 4 MiB allocations fewer (the hash itself
stays); per paged checkpoint one 4 MiB allocation and copy fewer. Unmeasured in time.

**Proof plan**: `tests/acceptance/531/ac05-checkpoints.test.ts`, `ac07-pages.test.ts`, `ac09-regions-digest.test.ts`
and the goldens `deep-logic golden_verify` checks (deep hashes are in them, so any change of bytes fails). Measure by
allocation bytes around `World::deep_hashes` in a unit test, not by time.

---

## F8 — each logic step clones every item's arrays, and reallocates its own

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 10.

**Where**: `crates/deep-logic/src/world.rs:534-538` (`run`), `world.rs:659-661` (`step`).

**What**: per time step `run` does `let snapshot = self.published.clone();` (every item's arrays, read or not) and then
`self.published[i] = self.lives[i].arrays.clone()` per stepped item; `step` ends with
`let fresh = memory[w..w + n].to_vec(); l.arrays = fresh;`. That is three allocations and copies of the write region
per item per step, at the piece's step rate.

**Change**:

```rust
// run(): the group reads the arrays as earlier steps left them; its own are published after it
let snapshot = std::mem::take(&mut self.published);
for &i in &group {
    self.step(i, &snapshot, rec);
}
self.published = snapshot;
for i in group {
    self.published[i].clone_from(&self.lives[i].arrays);
}
// step(): the same bytes into the buffer that is already there
l.arrays.copy_from_slice(&l.runner.memory("memory").expect("a memory")[w..w + n]);
```

**Why it is safe**: `step` reads other items' arrays only through its `snapshot` parameter (`world.rs:591`); nothing it
calls reads `self.published` (its other uses are `new`, `restore`, `fork`, `seek`, lines 406, 687, 767, 841, none
reached during a group). After the group `published[i]` holds what it held before for every stepped item, a failed
one included (its arrays are unchanged). `n` is `l.arrays.len()`, so `copy_from_slice` has equal lengths, and an
out-of-range write region panics at the same slice index as now. `l.arrays` and `l.runner` are disjoint fields.

**Gain**: per step, one copy of all items' arrays and 2 allocations per stepped item fewer. Unmeasured.

**Proof plan**: `tests/acceptance/531/ac03-writes.test.ts` (items read each other's arrays as earlier steps left
them), `ac02-seed`, `ac05-checkpoints`, the determinism call (`checks.rs`) and the goldens.

---

## F9 — the relay copies each frame once per recipient

**Status**: CONFIRMED. **Risk**: low. **Lines**: 4.

**Where**: `crates/deep-relay/src/relay.rs:148-160` (`Ok(Message::Binary(frame))` → `forward(.., &frame)`),
`relay.rs:254-281` (`tx.send(Message::binary(frame.to_vec()))`, twice).

**What**: tungstenite 0.29's `Message::Binary` holds `bytes::Bytes` (`message.rs:161`), which clones by reference
count. `forward` takes `&[u8]` and makes a fresh `Vec` per seat: up to 7 copies of up to 65,536 bytes, up to 240 times
a second per sender.

**Change**: `fn forward(state: &State, game: MatchId, from: u8, frame: &tungstenite::Bytes)` and
`tx.send(Message::Binary(frame.clone()))` at both sends. `tungstenite::Bytes` is re-exported (`lib.rs:44`).

**Why it is safe**: the bytes each recipient's socket writes are the same; `frame.len()`, `frame[..16] != game` and
`log(.., &frame)` work through `Deref<Target = [u8]>`. `Bytes` is `Send`, as the `Sender<Message>` already requires.

**Gain**: (players − 1) allocations and copies of the frame per forwarded frame become reference-count bumps.

**Proof plan**: `tests/acceptance/309/frames.test.ts`, `relay-suite.test.ts`, `chosen-relay.test.ts` and
`scripts/relay-kit.mjs` (the relay suite on the shipped relay); count allocations in a unit test of `forward` with 8
seats.

---

## F10 — every sandbox call makes a channel it uses only when the call has a deadline

**Status**: CONFIRMED. **Risk**: low. **Lines**: 8.

**Where**: `crates/deep-sandbox-wasmtime/src/lib.rs:175-188` (`Runner::call`).

**What**: `let (done, wait) = mpsc::channel::<()>();` and `done.send(())` run on every call. A logic step calls with
`deadline: None` (`world.rs:637`), so each step allocates a channel and a message block and frees them unused.

**Change**:

```rust
let watchdog = call.deadline.map(|limit| {
    let (done, wait) = mpsc::channel::<()>();
    let engine = self.engine.clone();
    (done, std::thread::spawn(move || {
        if wait.recv_timeout(limit).is_err() {
            engine.increment_epoch();
        }
    }))
});
let ran = f.call(&mut self.store, &call.args, &mut results);
if let Some((done, w)) = watchdog {
    let _ = done.send(());
    drop(w.join());
}
```

**Why it is safe**: with a deadline the sequence is unchanged (send, then join). Without one, nothing ever received
from the channel.

**Gain**: two allocations and their frees per logic step and per `init`. Small, on the per-step path.

**Proof plan**: `tests/acceptance/238` (the kit, with its 10 s deadline cases), `tests/acceptance/531/ac01-fuel-stack.test.ts`.

---

## F11 — deep-codecs copies whole frames and whole streams it only reads

**Status**: CONFIRMED. **Risk**: low. **Lines**: about 20.

**Where**: `crates/deep-codecs/src/lib.rs:466-476` (`false => p.planes.clone()`), `lib.rs:519-526`
(`data.get(range).unwrap_or_default().to_vec()` per sample) with `crates/deep-codecs/src/apple.rs:378-383`
(`samples: &[(usize, Vec<u8>)]`) and `apple.rs:298-323` (`block` copies the bytes again into the CMBlockBuffer),
`lib.rs:633-637` (the proxy's `bytes.extend_from_slice(&body)`).

**What**: (a) a decode to I420 clones each picture (1.5 × width × height bytes; 3.1 MB at 1080p) only to hand
`std::fs::write` a slice. (b) `video_frames` copies every compressed sample out of `data`, which is already whole in
memory, and `block` copies it again. (c) `proxy` builds `body` (every scaled frame), then copies all of it behind the
one-line header to write and hash it, so the proxy is in memory twice.

**Change**:

```rust
// (a) lib.rs:466
let converted;
let bytes: &[u8] = if bgra {
    converted = color::i420_to_bgra(&p.planes, p.width, p.height, ..);
    &converted
} else {
    &p.planes
};
// (b) apple.rs:382  samples: &[(usize, &[u8])]   and lib.rs:519  (*i, data.get(range).unwrap_or_default())
// (c) lib.rs:633
let head = format!("{head}\n");
let path = job.s("out").ok_or("a proxy names its out file")?;
let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
file.write_all(head.as_bytes()).and_then(|()| file.write_all(&body)).map_err(|e| e.to_string())?;
let mut h = Sha256::new();
h.update(head.as_bytes());
h.update(&body);
let sha: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
```

**Why it is safe**: (a) the same bytes are written. (b) `decode_video` only reads `bytes.len()` and passes the slice
to `block`, which copies it into the buffer VideoToolbox owns; `decode_video`'s one caller is `lib.rs:527`. (c)
`fs::write` is create-truncate-write; the file's bytes and the digest (header, then body) are the same. The `out`
check moves before the write, where it already is.

**Gain**: (a) one frame-sized allocation and copy per decoded frame. (b) one copy of the compressed video track. (c)
peak memory lower by the proxy's size.

**Proof plan**: `tests/acceptance/498/decode` (frame files and proxy `sha256` compared with references).

---

## F12 — a logic item's program is compiled again for every restore, seek and fork

**Status**: CONFIRMED (the recompiles and the safety of sharing); gain unmeasured. **Risk**: medium. **Lines**: about 60.

**Where**: `crates/deep-sandbox-wasmtime/src/lib.rs:72-107` (`Runner::sized`: `Engine::new` and `Module::new` per
runner), `crates/deep-logic/src/world.rs:339-342` (`World::runner`), `world.rs:359` (`World::new`), `world.rs:782-783`
(`World::load`, also `names(bytes)` again), reached from `restore` (`world.rs:712`), `seek` (`679`), `fork` (`809`).
Callers: the live worker's `world.seek(c)` on every scrub back (`live.rs:138`), `lib.rs:315`, `lib.rs:469`,
`checks.rs:224`, `checks.rs:59` (`fork` per probe).

**What**: each `Runner` builds its own `wasmtime::Engine` and compiles the module with Cranelift (wasmtime's compile
cache is off: `Config::new()` with no cache call). "A restore loads [a checkpoint] into a fresh instance", so every
seek back in a live view, every restore and every probe's fork recompiles every item's unchanged bytes. Instantiating
is what a restore needs; compiling is not.

**Change**: split compile from instantiate, and keep the compiled program per item for the worlds made from it.

```rust
// deep-sandbox-wasmtime/src/lib.rs
/// A program compiled once; each `runner` is a fresh instance of it.
#[derive(Clone)]
pub struct Program { engine: Engine, module: Module, map: std::sync::Arc<[Entry]>, shift: i64, written: bool, faults: Faults }
impl Program {
    pub fn new(bytes: &[u8], pages: Option<u64>, faults: Faults, written: bool) -> Result<Program, String> { /* lines 73-95 and `offsets(bytes)` */ }
    pub fn runner(&self) -> Result<Runner, String> { /* lines 96-107 on self.engine / self.module */ }
}
impl Runner {
    pub fn sized(bytes: &[u8], pages: Option<u64>, faults: Faults, written: bool) -> Result<Runner, String> {
        Program::new(bytes, pages, faults, written)?.runner()
    }
}
// deep-logic/src/world.rs: World gains `programs: Vec<Option<(Rc<Program>, Rc<Names>)>>`, one per item,
// `Some` only when compiled from `item.bytes` (never from a `counted` rewrite). `new` fills it; `restore`, `fork`
// and `seek` pass `self.programs[i]` to `load`, which instantiates from it, or compiles as now when it is `None`
// or when `counted` names this item; the world they return carries the same `Rc`s.
```

**Why it is safe**: an instance from a shared `Module` starts from the module's own initial state, as one from a fresh
compile does, so memory, globals and tables are the same before `load` writes the checkpoint into them. Sharing an
`Engine` matters only for epochs: `call` bumps the engine's epoch from its watchdog only when `deadline` is `Some`, and
both `Call`s deep-logic builds have `deadline: None` (`world.rs:383`, `637`); `Sandbox::run` (deadlines) keeps a
`Runner` of its own engine through `Runner::sized`. The cache is keyed by position and holds only programs compiled
from `item.bytes`, because `World::new(.., counted)` may run one item's counted rewrite while `restore(c, None)` and
`fork` use `item.bytes` (`world.rs:756-759`, `818`). Both compile and instantiate errors already map to the one
`instantiate_failed` reply. What differs: nothing in any reply; only when compile work happens.

**Gain**: one `Engine::new` and one Cranelift compile per item fewer on every seek, restore and fork. Compile is
proportional to code size (the design budgets 200 ms to rewrite a 1 MB program; compiling it costs at least as much),
instantiate to memory size. Unmeasured.

**Proof plan**: `tests/acceptance/531/ac05-checkpoints.test.ts` (restores and seeks reproduce deep hashes), the
determinism call (restores at every checkpoint), `ac10-trap-source` (trap offsets through `map`). Count compiles with a
test-only counter around `Module::new`, or wasmtime's instructions retired on a seek-heavy `frame` run.

---

## F13 — the rewrite allocates a fresh function validator's buffers for every function

**Status**: CONFIRMED. **Risk**: low. **Lines**: 3.

**Where**: `crates/deep-canvas-sandbox/src/rewrite.rs:208` (`to_validate.into_validator(FuncValidatorAllocations::default())`).

**What**: wasmparser's documented reuse (`FuncValidator::into_allocations`, wasmparser 0.258.3 `validator/func.rs:346`)
isn't used, so the operand, control and locals vectors are allocated and grown again per function body.

**Change**: `let mut allocs = FuncValidatorAllocations::default();` before the payload loop;
`into_validator(std::mem::take(&mut allocs))`; after the operator loop (after `bodies.push` reads `height`),
`allocs = fv.into_allocations();`.

**Why it is safe**: the allocations are emptied buffers; validation results and `operand_stack_height()` don't depend
on their capacity. An early `?` return drops them, as now.

**Gain**: several allocations per function at check time (a 1 MB program has thousands of functions). Small, once per
program hash.

**Proof plan**: `tests/acceptance/238` (rewritten bytes are compared by hash, and its 200 ms rewrite budget).

---

## F14 — `real()` costs d²/2 lookups for a path d folders deep

**Status**: PLAUSIBLE (security-relevant; needs the #316 corpus and a property test, which could not be run).
**Risk**: medium. **Lines**: 5.

**Where**: `crates/deep-hook/src/shell.rs:251-274`; callers in `matcher.rs` (19 sites: `checkout`, `path_matches`,
`past_targets`, `stops_installed_hub`, …).

**What**: `real` calls `fs::canonicalize` on every prefix of the path. `canonicalize` itself walks every component, so
an existing path 10 deep costs 55 component lookups where one `canonicalize` of the whole path costs 10.

**Change**:

```rust
pub fn real(path: &Path) -> PathBuf {
    // All of it exists: one call resolves what the walk below resolves a component at a time.
    if path.is_absolute() {
        if let Ok(resolved) = fs::canonicalize(path) {
            return resolved;
        }
    }
    // the walk, unchanged
```

**Why it should be safe**: for an absolute path whose whole `canonicalize` succeeds, every prefix exists, and the walk
computes `canonicalize(canonical(prefix) + name)` step by step, which is how `realpath` itself composes, `..`
included (the walk canonicalizes before it pops, `realpath` takes the parent of the resolved folder). Whenever the
whole call fails (a missing leaf, a dangling link, no permission, a name too long) the walk runs as now. The
restriction to absolute paths matters: for a relative path the walk skips `.` and reads a leading `..` as nothing
(`real(".")` is the empty path today), which `canonicalize` would not. **The check I could not do**: run old and new
side by side over a temp tree with links, `..`, dangling links and missing leaves (a property test), plus
`tests/acceptance/316/symlink.test.ts` and the corpus.

**Gain**: after F1 and F2, about 5× fewer lookups on each remaining `real` of an existing path; missing leaves gain
nothing without also resolving the parent first.

---

## F15 — the shell lexer allocates one `String` per double-quoted character

**Status**: PLAUSIBLE (security-relevant reader: the brief asks for the adversarial corpus before any change here).
**Risk**: medium. **Lines**: 6.

**Where**: `crates/deep-hook/src/shell.rs:598-601` (`dquote`: `parts.push(Part::Lit(c.to_string(), true))`), also
`shell.rs:554` (unquoted characters, which must stay one per part: `assignment`, `shell.rs:836-853`, looks for a part
that is exactly `=`).

**What**: a `gh pr create --body "…"` or `python3 -c "…"` of 3 KB makes 3,000 `Part`s (56 bytes each) and 3,000 heap
`String`s, then concatenates them in `value` (`shell.rs:1387-1390`).

**Change**: in `dquote`'s last arm, append to the quoted literal before it:

```rust
_ => {
    match parts.last_mut() {
        Some(Part::Lit(text, true)) => text.push(c),
        _ => parts.push(Part::Lit(c.to_string(), true)),
    }
    self.i += 1;
}
```

**Why it should be safe**: I read every consumer of `Part::Lit` (`shell.rs:461`, `465`, `828`, `840`, `843`, `1387`):
each treats a run of quoted literals as it treats their concatenation (`heredoc` asks whether any is quoted and joins
them; `plain` and `assignment` return `None` at the first quoted part; `value` appends and takes `glob` only from
unquoted ones). `dquote` always pushes an empty quoted literal first, so there is one to append to. **The check I
could not do**: `tests/acceptance/316/corpus.test.ts` and the #1097/#1503/#1676 suites.

**Gain**: one allocation instead of one per character of double-quoted text; halves again with F3. Unmeasured.

---

## F16 — a proxy holds every decoded picture of the video in memory before it writes one

**Status**: PLAUSIBLE (a restructure; one assumption to check). **Risk**: medium to high. **Lines**: about 60.

**Where**: `crates/deep-codecs/src/lib.rs:603-630` (`proxy`), `lib.rs:509-533` (`video_frames`),
`crates/deep-codecs/src/apple.rs:338-374` (`on_picture` pushes every picture), `apple.rs:431-455`.

**What**: `proxy` plans every sample, `decode_video` returns `Vec<Picture>` of all of them at full size (1.5 × w × h
bytes each), and only then is each scaled into `body`. A one-minute 1080p30 clip is 1,800 pictures × 3.1 MB = 5.6 GB;
the worker's caps allow three hours of 8K (`lib.rs:38-46`). The scale loop also does two divisions and a `push` per
output pixel (`lib.rs:620-627`), and `pictures.iter().find(..)` is a scan per frame (`lib.rs:608`).

**Change (outline)**: give `decode_video` a sink (`&mut dyn FnMut(Picture)`) called from `on_picture`; in `proxy`,
map sample → positions in `chosen`, size `body` as `chosen.len() × frame_bytes` once the first picture gives the size,
and scale each picture straight into its slot as it arrives, dropping the picture. Hoist the row offset and an
`x → source x` table per plane out of the pixel loop.

**What could differ**: a stream whose picture size changes midway would today write frames of different sizes; a
pre-sized body assumes one size. That needs a decision or a fallback. Bytes for ordinary streams are the same.

**Gain**: peak memory from N full pictures + two proxy copies to one full picture + one proxy (with F11c).

---

## F17 — a live logic view builds each step's JSON record and drops it

**Status**: PLAUSIBLE (needs a way to tell `Record` to keep nothing; one caller today). **Risk**: medium.

**Where**: `crates/deep-logic/src/live.rs:150`, `157` (`world.run(.., &mut Record::default(), ..)`),
`crates/deep-logic/src/world.rs:865-887` (`report`: a `serde_json::Value` per element of every written array, per
step), `world.rs:641` (`rec.fuel` push), `world.rs:562` (`inputs` built per step, used only when a trap is recorded,
lines 598 and 655).

**What**: the live worker steps the world at frame rate and discards the `Record` after each step, so every `Value`
`report` builds for it is allocated and freed unread. An item that writes 10,000 `f32`s makes 10,000 `Value`s a step.

**Change (outline)**: a `Record` that records nothing (for example `Record::none()`, checked at the top of `report`
and at the `rec.fuel` push), used by `live.rs`; and make `inputs` a closure called at the two trap sites. The second
half is behavior-preserving on its own and CONFIRMED: `inputs` is read only inside the two `rec.traps.push` calls.

**What could differ**: nothing in any reply; `live.rs` never reads the record. It adds a constructor with one caller,
which the repo's rules ask to justify.

---

## Dispositions

| Crate | Disposition |
|---|---|
| `crates/deep-hook` | F1, F2, F3, F5, F6 (CONFIRMED); F14, F15 (PLAUSIBLE). No regex engine linked; no static initializers. Kept as designed: the watchdog thread, the `spool-sync` child per spooled line (documented at `main.rs:915-918`), the `generations.json` read per hook (#1338), `/dev/urandom` for the ULID (3 syscalls). Not proposed: `actions.rs:294-295` keeps a second copy of the two small lists from actions.json (tens of KB in a long-lived server). |
| `crates/deep-contracts` (`lib.rs`, `main.rs`) | F4. `main.rs` keep. Note, not a finding: deep-hook uses only `Value`, `parse` and `jcs`, yet compiles the 71,517-line `generated.rs` with them (build time only; the linker drops it). `matches` (`lib.rs:634-650`) allocates a `Vec` per thread per character, but only the generated types call it and no runtime binary decodes through them today. |
| `crates/deep-relay` | F9. Observed, not proposed (it changes latency): each connection's loop wakes every 2 ms to look at its outbox (`relay.rs:59`, `POLL`), so an idle seat costs 500 wake-ups a second; `wire::digest()` parses all of digests.json per hello. |
| `crates/deep-codecs` | F11 (CONFIRMED), F16 (PLAUSIBLE). `color::i420_to_bgra` (`color.rs:222-251`) does four f64 divisions per pixel; a table per input byte would be bit-identical, left out as lower value. `mp4.rs`, `wav.rs`, `table.rs`, `maps.rs`: keep. |
| `crates/deep-logic` | F7, F8 (CONFIRMED), F12 (with deep-sandbox-wasmtime), F17 (PLAUSIBLE). The checkpoint ring is bounded (`Live::thin`). |
| `crates/deep-sandbox-wasmtime` | F10, F12. `Sandbox::run` compiles per run and copies the whole memory into `Ran.memory` (`service.rs:222-226`); its callers are deep-show's, so a compiled-program cache there belongs to that area's audit. Fuel is the rewrite's own counter; the epoch is used only for the wall-clock watchdog. |
| `crates/deep-canvas-sandbox` | F13. The check validates the module (`check.rs:340`) and the rewrite validates it again for stack heights (`rewrite.rs:156`); both are once per program hash and have different error shapes: keep. |
| `crates/deep-input` | Keep: a test tool, one session per line. |
| `crates/deep-panel-host` | Keep. Observed, not proposed (it changes timer latency and needs a next-deadline read from the headless dispatcher): the serve loop wakes every 2 ms and pumps the clock in 250 µs steps (`lib.rs:285`, `368-377`, `185-197`), about 4,000 executor pumps and 500 focus reads a second for an idle panel. |
