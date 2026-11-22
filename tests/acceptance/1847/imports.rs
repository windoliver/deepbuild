//! #1847: a panel's imports are refused whatever way their name is spelled, not only as one plain string. Written blind
//! (README.md here). Each test's name carries its criterion's ID.
//!
//! - AC1 `#1847.675d2963`: the planted panels (a dynamic import naming the toolkit in a template literal, a dynamic
//!   import whose name is computed, a `require` whose name is computed) are each refused at pack check
//!   (`deep_replica::kit::panel`) and at load (`deep-panel-host serve --panel`, which loads through
//!   `deep_app::mount_panel`), naming the file and the line. Beside them, from the owner's audit comment and not a
//!   checkbox criterion, a static toolkit import after a regex literal holding a quote. And through the check the issue
//!   names (`deep_app::panel_module::check`), generated panels with one such import at a random line are refused naming
//!   that file and line.
//! - AC2 `#1847.fc64718b`: a panel importing only `@deepbuild/panel` and its own files, by plain strings, passes the pack
//!   check and loads unchanged (its tree is the merge base's, `base-trees/plain-imports.txt`); every shipped panel still
//!   passes and loads; generated panels whose every import is one plain string pass the check.
//!
//! Wired into deep-replica by one `[[test]]` entry (no harness: on macOS the pack check's headless window wants the
//! main thread). Build the panel host first, then run from the checkout:
//!     cargo build --locked -p deep-panel-host
//!     cargo test --locked -p deep-replica --test acceptance_1847 [-- <part of a name>]
//! With `DEEP_1847_OUT=<dir>`, the plain panel's tree is also written to `<dir>/plain-imports.txt` (how base-trees/ was
//! captured at the base).

use std::io::{BufRead as _, BufReader, Write as _};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

const AC1_PACK: &str = "#1847.675d2963 each planted panel is refused at pack check, naming the file and the line";
const AC1_LOAD: &str = "#1847.675d2963 each planted panel is refused at load, naming the file and the line";
const AC1_OWNER_PACK: &str = "#1847.675d2963 (owner's audit comment) a static toolkit import after a regex literal holding a quote is refused at pack check, naming the module, file and line";
const AC1_OWNER_LOAD: &str = "#1847.675d2963 (owner's audit comment) a static toolkit import after a regex literal holding a quote is refused at load, naming the module, file and line";
const AC1_OWNER_SPELLING: &str = "#1847.675d2963 (owner's audit comment) the comment's own line is refused by the check as the same import alone is";
const AC1_PROPERTY: &str = "#1847.675d2963 property: a generated panel with one import not named by one plain string, at a random line, is refused naming its file and line";
const AC2_PACK: &str = "#1847.fc64718b a panel importing only @deepbuild/panel and its own files by plain strings passes the pack check";
const AC2_LOAD: &str = "#1847.fc64718b a panel importing only @deepbuild/panel and its own files by plain strings loads unchanged";
const AC2_SHIPPED: &str = "#1847.fc64718b every shipped panel still passes the pack check and loads";
const AC2_PROPERTY: &str = "#1847.fc64718b property: a generated panel whose every import is one plain string passes the check";

/// The planted panels of AC1: the fixture, and the line of its `reach.js` that holds the planted import.
const PLANTED: [(&str, usize); 3] = [
    ("dynamic-template", 4),
    ("dynamic-computed", 6),
    ("require-computed", 5),
];
/// The owner's audit comment's spelling: the fixture and its line.
const OWNER: (&str, usize) = ("regex-quote", 3);
/// The file of each planted panel that holds its planted import.
const PLANTED_FILE: &str = "reach.js";
/// Shipped panels that import `quotes`, a name served only in a `spike` build (#1454): the base refuses them in this
/// build too, so they aren't read here.
const SPIKE_ONLY: [&str; 2] = ["claude-code", "codex"];
/// The plain panel of AC2.
const PLAIN: &str = "plain-imports";

/// Property cases per property test, each from its own seed.
const CASES: u64 = 300;

type Check = fn() -> Outcome;

enum Outcome {
    Pass,
    Fail(String),
}

fn main() {
    let tests: [(&str, Check); 10] = [
        (AC1_PACK, ac1_pack),
        (AC1_LOAD, ac1_load),
        (AC1_OWNER_PACK, ac1_owner_pack),
        (AC1_OWNER_LOAD, ac1_owner_load),
        (AC1_OWNER_SPELLING, ac1_owner_spelling),
        (AC1_PROPERTY, ac1_property),
        (AC2_PACK, ac2_pack),
        (AC2_LOAD, ac2_load),
        (AC2_SHIPPED, ac2_shipped),
        (AC2_PROPERTY, ac2_property),
    ];
    let filters: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();
    let chosen: Vec<_> = tests
        .iter()
        .filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str())))
        .collect();
    println!("\nrunning {} tests", chosen.len());
    let (mut passed, mut failed) = (0, 0);
    for (name, check) in &chosen {
        let outcome = catch_unwind(AssertUnwindSafe(check)).unwrap_or_else(|panic| {
            let what = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                .unwrap_or_default();
            Outcome::Fail(format!("panicked: {what}"))
        });
        match outcome {
            Outcome::Pass => {
                passed += 1;
                println!("test {name} ... ok");
            }
            Outcome::Fail(message) => {
                failed += 1;
                println!("test {name} ... FAILED\n\n---- {name} ----\n{message}\n");
            }
        }
    }
    let word = if failed == 0 { "ok" } else { "FAILED" };
    println!("test result: {word}. {passed} passed; {failed} failed\n");
    std::process::exit(i32::from(failed > 0));
}

fn repo() -> PathBuf {
    deep_replica::repo_root()
}

fn fixture(name: &str) -> PathBuf {
    repo().join("tests/acceptance/1847/fixtures").join(name)
}

/// A fresh scratch folder for this process.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("deep-1847-{}", std::process::id())).join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch folder");
    dir
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("a copy's folder");
    for entry in std::fs::read_dir(from).expect("a fixture folder").flatten() {
        let path = entry.path();
        if path.is_dir() {
            copy_tree(&path, &to.join(entry.file_name()));
        } else {
            std::fs::copy(&path, to.join(entry.file_name())).expect("a fixture file copies");
        }
    }
}

/// A copy of a panel's folder, so neither the check nor a load writes into the checkout.
fn copy_of(dir: &Path, name: &str) -> PathBuf {
    let to = scratch(name);
    copy_tree(dir, &to);
    to
}

/// Whether `text` holds `word` with no letter, digit or `_` on either side.
fn names(text: &str, word: &str) -> bool {
    let edge = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    text.match_indices(word)
        .any(|(at, _)| edge(text[..at].chars().next_back()) && edge(text[at + word.len()..].chars().next()))
}

/// Whether a refusal names line `line` of `file`: `<file>:<line>` or `line <line>`, the number whole.
fn names_line(text: &str, file: &str, line: usize) -> bool {
    [format!("{file}:{line}"), format!("line {line}")].iter().any(|form| {
        text.match_indices(form.as_str()).any(|(at, _)| {
            !text[..at].ends_with(|c: char| c.is_alphanumeric())
                && !text[at + form.len()..].starts_with(|c: char| c.is_ascii_digit())
        })
    })
}

/// The judge of every refusal AC1 asks for: refused, naming the file and the line. A failure names the panel.
fn judge_refused(panel: &str, at: &str, file: &str, line: usize, result: Result<(), String>) -> Result<(), String> {
    match result {
        Ok(()) => Err(format!(
            "{panel}: {at} admitted it, though {file}:{line} imports a module not named by one plain string"
        )),
        Err(why) if names(&why, file) && names_line(&why, file, line) => Ok(()),
        Err(why) => Err(format!(
            "{panel}: {at} refused it without naming the file {file} and line {line} ({file}:{line} or line {line}): {why}"
        )),
    }
}

/// The pack check: `Ok(())` when `panel@1` passes the package, `Err(its refusal)` when it refuses.
fn pack(dir: &Path) -> Result<(), String> {
    let verdict = deep_replica::kit::panel(dir);
    if verdict.pass {
        Ok(())
    } else {
        Err(verdict.names.unwrap_or_else(|| "(a refusal that names nothing)".into()))
    }
}

/// What the panel host made of a panel.
enum Load {
    /// It loaded: the tree of its first invalidation.
    Loaded(String),
    /// It refused the panel before it was ready: what it wrote on stderr.
    Refused(String),
}

/// The panel host built beside this test binary (`target/<profile>/deep-panel-host`), when it's no older than the
/// sources it's built from; else why not.
fn host() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let host = exe
        .parent()
        .and_then(Path::parent)
        .map(|dir| dir.join("deep-panel-host"))
        .ok_or("no target folder")?;
    let built = std::fs::metadata(&host)
        .and_then(|m| m.modified())
        .map_err(|_| format!("BLOCKED: no panel host at {}; run `cargo build --locked -p deep-panel-host` first", host.display()))?;
    let mut newest = SystemTime::UNIX_EPOCH;
    let mut look = vec![
        repo().join("crates/deep-app/src"),
        repo().join("crates/deep-app/panel-catalog.json"),
        repo().join("crates/deep-panel-host/src"),
    ];
    while let Some(path) = look.pop() {
        if path.is_dir() {
            look.extend(std::fs::read_dir(&path).into_iter().flatten().flatten().map(|e| e.path()));
        } else if let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) {
            newest = newest.max(modified);
        }
    }
    if built < newest {
        return Err(format!(
            "BLOCKED: the panel host at {} is older than its sources; run `cargo build --locked -p deep-panel-host` first",
            host.display()
        ));
    }
    Ok(host)
}

/// One load in the panel host, as the app runs an agent-built panel: `serve --panel <dir>` with HOME and nothing
/// else of this environment, its `ready` line, then one invalidation and its tree. The host is stopped by its PID.
fn load(dir: &Path) -> Result<Load, String> {
    let host = host()?;
    let mut child = Command::new(&host)
        .args(["serve", "--panel"])
        .arg(dir)
        .env_clear()
        .env("HOME", std::env::var_os("HOME").unwrap_or_default())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("the panel host didn't start: {e}"))?;
    let stdout = child.stdout.take().expect("a piped stdout");
    let mut stderr = child.stderr.take().expect("a piped stderr");
    let (lines, inbox) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut stderr, &mut text);
        text
    });
    let wait = Duration::from_secs(120);
    let result = (|| {
        let first = match inbox.recv_timeout(wait) {
            Ok(line) => line,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(None),
            Err(mpsc::RecvTimeoutError::Timeout) => return Err("the host said nothing for 120 s".to_owned()),
        };
        let ready: serde_json::Value = serde_json::from_str(&first).map_err(|_| format!("the host wrote {first}"))?;
        if ready["ready"] != true {
            return Err(format!("the host said {first}"));
        }
        let mut stdin = child.stdin.take().expect("a piped stdin");
        writeln!(stdin, "{{\"cmd\":\"invalidate\"}}").map_err(|e| e.to_string())?;
        let reply = inbox
            .recv_timeout(wait)
            .map_err(|_| "the host answered no invalidation".to_owned())?;
        let reply: serde_json::Value = serde_json::from_str(&reply).map_err(|_| format!("the host wrote {reply}"))?;
        drop(stdin);
        match reply["tree"].as_str() {
            Some(tree) => Ok(Some(tree.to_owned())),
            None => Err(format!("the invalidation answered {reply}")),
        }
    })();
    let _ = child.kill();
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr = errors.join().unwrap_or_default();
    match result {
        Ok(Some(tree)) => Ok(Load::Loaded(tree)),
        Ok(None) if !status.success() => Ok(Load::Refused(stderr)),
        Ok(None) => Err(format!("the host closed its output and exited {status} without a refusal: {stderr}")),
        Err(why) => Err(format!("{why}\n{stderr}")),
    }
}

/// A load as a refusal judge reads it: `Ok(())` loaded, `Err(the refusal)`.
fn load_verdict(dir: &Path) -> Result<Result<(), String>, String> {
    Ok(match load(dir)? {
        Load::Loaded(_) => Ok(()),
        Load::Refused(why) => Err(why),
    })
}

fn collect(problems: Vec<String>) -> Outcome {
    if problems.is_empty() {
        Outcome::Pass
    } else {
        Outcome::Fail(problems.join("\n"))
    }
}

fn ac1_pack() -> Outcome {
    let mut problems = Vec::new();
    for (name, line) in PLANTED {
        let dir = copy_of(&fixture(name), name);
        if let Err(why) = judge_refused(name, "the pack check", PLANTED_FILE, line, pack(&dir)) {
            problems.push(why);
        }
    }
    collect(problems)
}

fn ac1_load() -> Outcome {
    let mut problems = Vec::new();
    for (name, line) in PLANTED {
        let dir = copy_of(&fixture(name), name);
        match load_verdict(&dir) {
            Ok(result) => {
                if let Err(why) = judge_refused(name, "the load", PLANTED_FILE, line, result) {
                    problems.push(why);
                }
            }
            Err(why) if why.starts_with("BLOCKED") => return Outcome::Fail(why),
            Err(why) => problems.push(format!("{name}: the load broke: {why}")),
        }
    }
    collect(problems)
}

/// The owner's case also names the module, as the same import alone is refused naming it (#1425; design, Panel).
fn judge_owner(at: &str, result: Result<(), String>) -> Result<(), String> {
    let (name, line) = OWNER;
    judge_refused(name, at, PLANTED_FILE, line, result.clone())?;
    match result {
        Err(why) if names(&why, "gpui-kit") => Ok(()),
        Err(why) => Err(format!("{name}: {at} refused it without naming the module \"gpui-kit\": {why}")),
        Ok(()) => unreachable!("judged refused above"),
    }
}

fn ac1_owner_pack() -> Outcome {
    let dir = copy_of(&fixture(OWNER.0), OWNER.0);
    match judge_owner("the pack check", pack(&dir)) {
        Ok(()) => Outcome::Pass,
        Err(why) => Outcome::Fail(why),
    }
}

fn ac1_owner_load() -> Outcome {
    let dir = copy_of(&fixture(OWNER.0), OWNER.0);
    match load_verdict(&dir) {
        Ok(result) => match judge_owner("the load", result) {
            Ok(()) => Outcome::Pass,
            Err(why) => Outcome::Fail(why),
        },
        Err(why) => Outcome::Fail(format!("{}: the load broke: {why}", OWNER.0)),
    }
}

/// The comment's line exactly, alone in a file and after another line, against the same import alone: each refused by
/// the check the issue names, naming the module, the file and the line.
fn ac1_owner_spelling() -> Outcome {
    const LINE: &str = "const q = /\"/; import { Chart } from \"gpui-kit\";";
    const ALONE: &str = "import { Chart } from \"gpui-kit\";";
    let mut problems = Vec::new();
    for (case, source, line) in [
        ("the import alone", format!("{ALONE}\n"), 1),
        ("the comment's line", format!("{LINE}\n"), 1),
        ("the comment's line on line 2", format!("const before = 1;\n{LINE}\n"), 2),
    ] {
        let dir = scratch("owner-spelling");
        std::fs::write(dir.join("main.js"), &source).expect("a script");
        let result = deep_app::panel_module::check(&dir);
        let judged = judge_refused(case, "the check", "main.js", line, result.clone()).and_then(|()| match result {
            Err(why) if names(&why, "gpui-kit") => Ok(()),
            other => Err(format!("{case}: the check refused it without naming \"gpui-kit\": {other:?}")),
        });
        if let Err(why) = judged {
            problems.push(format!("{why}\n  source: {source:?}"));
        }
    }
    collect(problems)
}

fn ac2_pack() -> Outcome {
    let dir = copy_of(&fixture(PLAIN), PLAIN);
    if let Err(why) = deep_app::panel_module::check(&dir) {
        return Outcome::Fail(format!("{PLAIN}: the check refused it: {why}"));
    }
    match pack(&dir) {
        Ok(()) => Outcome::Pass,
        Err(why) => Outcome::Fail(format!("{PLAIN}: the pack check refused it: {why}")),
    }
}

fn ac2_load() -> Outcome {
    let dir = copy_of(&fixture(PLAIN), PLAIN);
    let tree = match load(&dir) {
        Ok(Load::Loaded(tree)) => tree,
        Ok(Load::Refused(why)) => return Outcome::Fail(format!("{PLAIN}: the load refused it: {why}")),
        Err(why) => return Outcome::Fail(format!("{PLAIN}: the load broke: {why}")),
    };
    if let Some(out) = std::env::var_os("DEEP_1847_OUT") {
        let out = PathBuf::from(out);
        std::fs::create_dir_all(&out).expect("the out folder");
        std::fs::write(out.join(format!("{PLAIN}.txt")), &tree).expect("the tree writes");
    }
    let base = repo().join(format!("tests/acceptance/1847/base-trees/{PLAIN}.txt"));
    let Ok(base) = std::fs::read_to_string(&base) else {
        return Outcome::Fail(format!("no merge-base tree at {}", base.display()));
    };
    if tree == base {
        Outcome::Pass
    } else {
        Outcome::Fail(format!("{PLAIN}: its tree differs from the merge base's\n  base: {base:?}\n  now:  {tree:?}"))
    }
}

fn ac2_shipped() -> Outcome {
    let panels = repo().join("crates/deep-app/panels");
    let mut names: Vec<String> = std::fs::read_dir(&panels)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().join("main.js").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !SPIKE_ONLY.contains(&name.as_str()))
        .collect();
    names.sort();
    if names.is_empty() {
        return Outcome::Fail("no shipped panels under crates/deep-app/panels".into());
    }
    let mut problems = Vec::new();
    for name in &names {
        let dir = copy_of(&panels.join(name), name);
        if let Err(why) = deep_app::panel_module::check(&dir) {
            problems.push(format!("{name}: the check refused it: {why}"));
            continue;
        }
        if let Err(why) = pack(&dir) {
            problems.push(format!("{name}: the pack check refused it: {why}"));
        }
        match load(&dir) {
            Ok(Load::Loaded(_)) => {}
            Ok(Load::Refused(why)) => problems.push(format!("{name}: the load refused it: {why}")),
            Err(why) => problems.push(format!("{name}: the load broke: {why}")),
        }
    }
    collect(problems)
}

// ---- The property tests: generated panels through the check the issue names, `deep_app::panel_module::check`. ----

/// xorshift64*, seeded per case, so a counterexample is replayed by its seed.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 33) as usize % n
    }
}

/// One line of valid module code whose every import, if it has one, is named by one plain string literal: imports of
/// `@deepbuild/panel` and of the panel's own file, beside comments, strings, template literals, regex literals and
/// divisions that hold quotes, slashes, backticks and the words `import(` and `require(`. `i` keeps names unique.
fn plain_line(rng: &mut Rng, i: usize) -> String {
    match rng.below(22) {
        0 => format!("import {{ View as View_{i}, div as div_{i} }} from \"@deepbuild/panel\";"),
        1 => format!("import * as Panel_{i} from '@deepbuild/panel';"),
        2 => format!("import {{ side as side_{i} }} from \"./side.js\";"),
        3 => "import \"./side.js\";".to_owned(),
        4 => format!("export {{ side as side_out_{i} }} from './side.js';"),
        5 => format!("const later_{i} = () => import(\"./side.js\");"),
        6 => format!("const later_{i} = () => import('./side.js');"),
        7 => format!("const required_{i} = () => require(\"./side.js\");"),
        8 => "// a comment: import(name), require(name) and \"gpui-kit\", read as words".to_owned(),
        9 => "/* a block comment: \"gpui-kit\", import(`gpui-kit`) and require(name) */".to_owned(),
        10 => format!("const text_{i} = \"a string: import(name), require(name) and 'gpui-kit'\";"),
        11 => format!("const single_{i} = 'it\\'s a \"quoted\" word';"),
        12 => format!("const template_{i} = `a template ${{1 + 2}} holding \"gpui-kit\" and import(name)`;"),
        13 => format!("const regex_{i} = /\"/;"),
        14 => format!("const regex_{i} = /'/g;"),
        15 => format!("const regex_{i} = /`/;"),
        16 => format!("const regex_{i} = /[/\"]/;"),
        17 => format!("const regex_{i} = /import\\(/;"),
        18 => format!("const half_{i} = 10 / 2 / 1;"),
        19 => format!("const ratio_{i} = (8 / 4) / 2;"),
        20 => format!("const nested_{i} = `outer ${{`inner ${{\"x\"}}`}}`;"),
        _ => String::new(),
    }
}

/// One line holding one import whose module isn't named by one plain string literal (or names the toolkit), each a
/// spelling the issue or the owner's comment states, and a word for it.
fn planted_line(kind: usize, i: usize) -> (&'static str, String) {
    match kind % 8 {
        0 => ("a dynamic import of the toolkit in a template literal", format!("const m_{i} = await import(`gpui-kit`);")),
        1 => ("a dynamic import of a template literal with a substitution", format!("const m_{i} = await import(`./${{\"side\"}}.js`);")),
        2 => ("a dynamic import of a computed name", format!("const name_{i} = \"gpui-\" + \"kit\"; const m_{i} = await import(name_{i});")),
        3 => ("a dynamic import of a concatenation", format!("const m_{i} = await import(\"gpui-\" + \"kit\");")),
        4 => ("a require of a template literal", format!("const r_{i} = () => require(`gpui-kit`);")),
        5 => ("a require of a computed name", format!("const r_{i} = () => require([\"gpui\", \"kit\"].join(\"-\"));")),
        6 => ("a static toolkit import after a regex literal holding a quote", format!("const q_{i} = /\"/; import {{ Chart as Chart_{i} }} from \"gpui-kit\";")),
        _ => ("a dynamic import of the toolkit by a plain string", format!("const m_{i} = await import(\"gpui-kit\");")),
    }
}

/// A generated panel: a clean `main.js`, the stub `src/side.js`, and `src/gen.js` from `lines`.
fn write_generated(dir: &Path, lines: &[String]) {
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir.join("src")).expect("a panel folder");
    std::fs::write(
        dir.join("main.js"),
        "import { View, div } from \"@deepbuild/panel\";\nimport \"./src/gen.js\";\n\nexport default class Generated extends View {\n  render() {\n    return div();\n  }\n}\n",
    )
    .expect("main.js");
    std::fs::write(dir.join("src/side.js"), "export const side = 1;\n").expect("side.js");
    std::fs::write(dir.join("src/gen.js"), lines.join("\n") + "\n").expect("gen.js");
}

fn ac2_property() -> Outcome {
    let dir = scratch("generated-plain");
    for case in 0..CASES {
        let seed = 1847_0000 + case;
        let mut rng = Rng::new(seed);
        let count = 1 + rng.below(40);
        let lines: Vec<String> = (0..count).map(|i| plain_line(&mut rng, i)).collect();
        write_generated(&dir, &lines);
        if let Err(why) = deep_app::panel_module::check(&dir) {
            return Outcome::Fail(format!(
                "seed {seed}: a panel whose every import is one plain string was refused: {why}\n--- src/gen.js ---\n{}",
                lines.join("\n")
            ));
        }
    }
    Outcome::Pass
}

fn ac1_property() -> Outcome {
    let dir = scratch("generated-planted");
    for case in 0..CASES {
        let seed = 1847_5000 + case;
        let mut rng = Rng::new(seed);
        let count = rng.below(40);
        let mut lines: Vec<String> = (0..count).map(|i| plain_line(&mut rng, i)).collect();
        let at = rng.below(count + 1);
        let (what, line) = planted_line(case as usize, count);
        lines.insert(at, line);
        write_generated(&dir, &lines);
        let result = deep_app::panel_module::check(&dir);
        if let Err(why) = judge_refused("a generated panel", "the check", "gen.js", at + 1, result) {
            return Outcome::Fail(format!(
                "seed {seed}, {what} on line {}: {why}\n--- src/gen.js ---\n{}",
                at + 1,
                lines.join("\n")
            ));
        }
    }
    Outcome::Pass
}
