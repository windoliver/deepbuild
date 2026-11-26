//! Issue #1425: `@deepbuild/panel`, the one module a panel imports, so a panel never names the toolkit under it.
//!
//! The names it serves are the checked-in catalog's (`panel-catalog.json`): the module's core (a view, an element, the
//! layout helpers, the dock, DeepBuild's canvas), the toolkit components on the catalog, and the data the app serves.
//! gpui-shell resolves the module: a panel's bare `@deepbuild/panel` is a file under its own root, which [`serve`]
//! writes there before each load, re-exporting each name from the toolkit module the catalog says serves it.
//!
//! [`check`] runs at pack check (`panel@1`) and again at load. It refuses a panel that imports a toolkit module, naming
//! the file and line; one that names a module any way but one plain string (#1847: a template literal, or an
//! `import(…)` or `require(…)` of anything else), naming the file and line, since the served module resolves the
//! toolkit and a name the check can't read could be the toolkit's; one that uses a name off the catalog, naming the
//! closest name on it; and one that uses a component whose script runs per frame, naming the component.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The specifier a panel imports.
pub const MODULE: &str = "@deepbuild/panel";

/// The toolkit's modules, which a panel never imports.
const TOOLKIT: [&str; 6] = [
    "gpui-kit",
    "gpui",
    "gpui-base",
    "gpui-shell",
    "gpui-component",
    "gpui-fps",
];

/// Where [`serve`] writes the module, under a panel's root: where gpui-shell resolves the bare specifier.
const SERVED: &str = "@deepbuild/panel.js";

/// The entry `mount_page` writes beside a panel's `main.js`; DeepBuild's, not the panel's.
pub(crate) const PAGE_ENTRY: &str = ".deepbuild-page.js";

/// The catalog's `from` for a component DeepBuild writes itself (#1470's menu), and its source.
const MENU_MODULE: &str = "deepbuild-menu";
const MENU: &str = include_str!("../panel-menu.js");

/// The elements a script builds from, which DeepBuild serves itself (#3233) so that one given a focus handle is a
/// tab stop, and their source.
const REACHED: [&str; 3] = ["div", "h_flex", "v_flex"];
const REACH: &str = include_str!("../panel-reach.js");

/// The most scripts, and the most folders, the check reads in a panel; a panel holding more is refused, so a package
/// can't make the check walk forever.
const MAX_SCRIPTS: usize = 256;

struct Catalog {
    /// Each name a panel may import, with the module that serves it (`deepbuild` for the app's data).
    offered: BTreeMap<String, String>,
    /// Each toolkit name not offered, with its reason and, for one whose script runs per frame, the module serving it.
    not_offered: BTreeMap<String, (String, Option<String>)>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let value: serde_json::Value = serde_json::from_str(include_str!("../panel-catalog.json"))
            .expect("the panel catalog is valid JSON");
        let text = |entry: &serde_json::Value, key: &str| entry[key].as_str().map(str::to_owned);
        let mut offered = BTreeMap::new();
        for entry in value["core"]
            .as_array()
            .into_iter()
            .chain(value["components"].as_array())
            .flatten()
        {
            let name = text(entry, "name").expect("a catalog name");
            offered.insert(name, text(entry, "from").expect("the module serving it"));
        }
        for name in data() {
            offered.insert(name.to_owned(), "deepbuild".to_owned());
        }
        let not_offered = value["not_offered"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|entry| {
                let per_frame = entry["per_frame"].as_bool() == Some(true);
                (
                    text(entry, "name").expect("a not_offered name"),
                    (
                        text(entry, "reason").unwrap_or_default(),
                        per_frame.then(|| text(entry, "from").expect("the module serving it")),
                    ),
                )
            })
            .collect();
        Catalog {
            offered,
            not_offered,
        }
    })
}

/// The data DeepBuild's `deepbuild` host module serves a panel, as plain values.
fn data() -> Vec<&'static str> {
    #[allow(unused_mut)]
    let mut names = vec!["needs_you", "sessions"];
    // #337's recorded quotes left the shipped module with the spike (#1454).
    #[cfg(feature = "spike")]
    names.push("quotes");
    #[cfg(feature = "panel-check")]
    names.extend(["rebuild_count", "fold"]);
    names
}

use crate::plain::planted;

/// The module's source: each name on the catalog re-exported from the toolkit module that serves it. A panel that
/// imports the module whole gets those names and no others. Only #1425's planted pack check, which lets a component
/// whose script runs per frame through, is served those components too.
fn source() -> &'static str {
    static SOURCE: OnceLock<String> = OnceLock::new();
    static PLANTED: OnceLock<String> = OnceLock::new();
    static RELEASE_PLANTED: OnceLock<String> = OnceLock::new();
    if planted("menu-release-always") {
        RELEASE_PLANTED.get_or_init(|| write_source(false, true))
    } else if planted("panel-per-frame-unchecked") {
        PLANTED.get_or_init(|| write_source(true, false))
    } else {
        SOURCE.get_or_init(|| write_source(false, false))
    }
}

fn write_source(per_frame: bool, release_always: bool) -> String {
    let catalog = catalog();
    let mut by_module: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let per_frame = catalog
        .not_offered
        .iter()
        .filter(|_| per_frame)
        .filter_map(|(name, (_, from))| Some((name, from.as_ref()?)));
    for (name, from) in catalog.offered.iter().chain(per_frame) {
        // DeepBuild's own components are written out below, not re-exported.
        if from == MENU_MODULE || REACHED.contains(&name.as_str()) {
            continue;
        }
        by_module.entry(from).or_default().push(name);
    }
    let mut source = String::from(
        "// Written by DeepBuild each time it loads this panel (#1425): @deepbuild/panel, the one module a panel imports.\n", // copy-exception: script source
    );
    for (module, names) in by_module {
        source.push_str(&format!(
            "export {{ {} }} from \"{module}\";\n", // copy-exception: script source
            names.join(", ")
        ));
    }
    source.push_str(&MENU.replace(
        "const RELEASE_ALWAYS = false;", // copy-exception: script source
        &format!("const RELEASE_ALWAYS = {release_always};"), // copy-exception: script source
    ));
    source.push_str(REACH);
    source
}

/// Writes the module under `dir`, where gpui-shell resolves `@deepbuild/panel`, unless it's there already.
pub fn serve(dir: &Path) -> std::io::Result<()> {
    let path = dir.join(SERVED);
    let source = source();
    if std::fs::read_to_string(&path).is_ok_and(|text| text == source) {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().expect("the module's folder"))?;
    std::fs::write(path, source)
}

/// Checks a panel's scripts: `Err` names the file and line of the first import no panel may make, and why.
pub fn check(dir: &Path) -> Result<(), String> {
    let per_frame_checked = !planted("panel-per-frame-unchecked");
    for path in scripts(dir)? {
        let file = path
            .strip_prefix(dir)
            .unwrap_or(&path)
            .display()
            .to_string();
        let source = std::fs::read_to_string(&path).map_err(|error| format!("{file}: {error}"))?;
        for import in imports(&source) {
            let at = format!("{file}:{}", import.line);
            let specifier = match &import.specifier {
                Ok(specifier) => specifier.as_str(),
                Err(Unread::Spelled) => {
                    return Err(format!(
                        "{at} names the module it imports some other way than one plain string, so the check can't read it; a panel imports only \"{MODULE}\" and its own files, each named by one plain string"
                    ));
                }
                Err(Unread::Character) => {
                    return Err(format!(
                        "{at} has code the check can't read for certain: a character past ASCII, a `\\` or a control character outside a string or comment, or a string no quote closes; a panel's imports are read only from plain code"
                    ));
                }
                Err(Unread::Slash) => {
                    return Err(format!(
                        "{at} has a `/` that reads as either a division or a regex literal, and the two readings see different imports, so the check can't read them; write it so it reads only one way"
                    ));
                }
            };
            if TOOLKIT.contains(&specifier) {
                return Err(format!(
                    "{at} imports \"{specifier}\", the toolkit under DeepBuild's module; a panel imports only \"{MODULE}\""
                ));
            }
            // Anything else names a file under the panel's root, bare (`evil.txt`) or not, and a file of its own is
            // one the check reads: a script, `.js` or `.mjs`, named in plain characters only, since the loader reads
            // some others its own way (gpui-shell cuts a name at its first `?v=`, so `./a?v=1.js` loads `./a`).
            let plain_name = specifier
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-'));
            if specifier != MODULE && !(plain_name && script(specifier)) {
                return Err(format!(
                    "{at} imports \"{specifier}\", which is neither \"{MODULE}\" nor a `.js` or `.mjs` script of its own named in letters, digits, `.`, `_`, `-` and `/`, so the check doesn't read it; a panel imports only \"{MODULE}\" and its own scripts"
                ));
            }
            if specifier != MODULE {
                continue;
            }
            // A panel that takes the module whole gets only what it serves, the catalog's names.
            for name in import.names.unwrap_or_default() {
                refuse_name(&at, &name, per_frame_checked)?;
            }
        }
    }
    Ok(())
}

/// A name a panel imports from the module: `Err` unless it's on the catalog.
fn refuse_name(at: &str, name: &str, per_frame_checked: bool) -> Result<(), String> {
    let catalog = catalog();
    if catalog.offered.contains_key(name) {
        return Ok(());
    }
    match catalog.not_offered.get(name) {
        Some((reason, Some(_))) if per_frame_checked => Err(format!(
            "{at} uses `{name}`, whose script runs per frame, so it is not offered: {reason}"
        )),
        Some((_, Some(_))) => Ok(()),
        not_offered => {
            let closest = catalog
                .offered
                .keys()
                .min_by_key(|offered| distance(name, offered))
                .expect("the catalog offers names");
            let why = not_offered
                .map(|(reason, _)| format!(" {reason}"))
                .unwrap_or_default();
            Err(format!(
                "{at} uses `{name}`, which is not on the panel catalog.{why} The closest name on it is `{closest}`"
            ))
        }
    }
}

/// The panel's scripts: every `.js` and `.mjs` file under its root but the module DeepBuild serves there, kept out only
/// while it holds what DeepBuild wrote. `Err`, rather than leave a script unread the runtime could still open, when
/// there are more than the check reads, a folder or entry it can't list, an entry that is neither a file nor a folder
/// (a pipe would hang the read), or a name past ASCII (a file system that folds case may match it to a script's).
fn scripts(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut found = Vec::new();
    let mut open = vec![dir.to_path_buf()];
    let mut folders = 0;
    let name = |path: &Path| match path.strip_prefix(dir).unwrap_or(path).display().to_string() {
        name if name.is_empty() => ".".to_owned(),
        name => name,
    };
    let unread = |path: &Path, why: String| {
        format!("{}: {why}, so the check can't read the panel", name(path))
    };
    while let Some(folder) = open.pop() {
        folders += 1;
        let entries =
            std::fs::read_dir(&folder).map_err(|error| unread(&folder, error.to_string()))?;
        let mut paths = Vec::new();
        for entry in entries {
            paths.push(
                entry
                    .map_err(|error| unread(&folder, error.to_string()))?
                    .path(),
            );
        }
        paths.sort();
        for path in paths {
            if !path.file_name().is_some_and(|name| name.is_ascii()) {
                return Err(unread(
                    &path,
                    "its name holds a character past ASCII".to_owned(),
                ));
            }
            // gpui-shell resolves `@deepbuild/panel` to a file of that very name before the served `panel.js` (its
            // `.d.ts` typings beside them are no module), so the panel may bring nothing there, in any case.
            if name(&path).eq_ignore_ascii_case(MODULE) {
                return Err(unread(
                    &path,
                    format!("it would load in place of the \"{MODULE}\" DeepBuild serves"),
                ));
            }
            let kind = std::fs::metadata(&path)
                .map_err(|error| unread(&path, error.to_string()))?
                .file_type();
            if kind.is_dir() {
                open.push(path);
            } else if !kind.is_file() {
                return Err(unread(
                    &path,
                    "it is neither a file nor a folder".to_owned(),
                ));
            } else if script(&path.to_string_lossy()) && path != dir.join(SERVED) {
                // The served module is DeepBuild's: `serve` rewrites it before gpui-shell reads it, whatever an
                // earlier build or the panel left there.
                found.push(path);
            }
        }
        if found.len() > MAX_SCRIPTS || folders > MAX_SCRIPTS {
            return Err(format!(
                "the panel holds more than {MAX_SCRIPTS} scripts or folders, more than the check reads"
            ));
        }
    }
    found.sort();
    Ok(found)
}

/// Whether a file's name, or a specifier naming one, is a script's: it ends in `.js` or `.mjs`, in any case, since a
/// file system may not tell them apart. The same test picks the files [`scripts`] reads and the files a panel may
/// import, so a file a panel imports is always one the check read (`.js` alone included).
fn script(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".js") || name.ends_with(".mjs")
}

/// One import a script makes: its specifier, its line, and for a statement the names it takes, or `None` when it
/// takes the module whole (a namespace, `export *` or a dynamic import).
#[derive(Debug, PartialEq)]
struct Import {
    /// The module's name, or why it isn't one this check reads.
    specifier: Result<String, Unread>,
    line: usize,
    names: Option<Vec<String>>,
}

/// Why an import's module isn't read: so it is refused, since a name the check can't read could be the toolkit's.
#[derive(Debug, PartialEq)]
enum Unread {
    /// `import(…)` or `require(…)` taking anything but one plain string, a template literal naming a module, or a
    /// module's name holding an escape or a control character.
    Spelled,
    /// A `/` that reads as either a division or a regex literal, where the two readings see different code.
    Slash,
    /// A character outside a literal or a comment that the check doesn't read: one past ASCII, a `\` or a control.
    Character,
}

/// Every import in `source`: `import … from`, `export … from`, `import "…"`, `import(…)` and `require(…)`, in order.
fn imports(source: &str) -> Vec<Import> {
    let Scan {
        code,
        strings,
        templates,
        calls,
        unread,
    } = scan(source);
    // Where each line ends, by the lexer's own line terminators (`\r\n` once), so a refusal names the line it reads.
    let bytes = source.as_bytes();
    let mut ends = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match terminator(bytes, at) {
            0 => at += 1,
            length => {
                at += length;
                ends.push(at);
            }
        }
    }
    let line = |at: usize| 1 + ends.partition_point(|&end| end <= at);
    let called: std::collections::BTreeSet<usize> = calls.iter().map(|&(at, _)| at).collect();
    let mut found: Vec<(usize, Import)> = Vec::new();
    for &(start, end) in &strings {
        let before = code[..start].trim_end();
        let text = &source[start + 1..end - 1];
        // An escape spells the name some other way than its text (`"gpui\x2dkit"` is the toolkit's), and a control
        // character may end it early where the runtime reads it.
        let specifier = if text.contains('\\') || text.contains(|c: char| c.is_ascii_control()) {
            Err(Unread::Spelled)
        } else {
            Ok(text.to_owned())
        };
        let names = if let Some(head) = keyword_end(before, "from") {
            let Some(statement) = statement(head) else {
                continue;
            };
            named(&head[statement..])
        } else if keyword_end(before, "import").is_some() {
            Some(Vec::new())
        } else if let Some(call) = before.strip_suffix('(') {
            // The call scan found, not a property's (`this.import("en")` is a method's).
            let call = call.trim_end();
            let word = ["import", "require"]
                .into_iter()
                .find(|word| keyword_end(call, word).is_some());
            if !word.is_some_and(|word| called.contains(&(call.len() - word.len()))) {
                continue;
            }
            None
        } else {
            continue;
        };
        found.push((
            start,
            Import {
                specifier,
                line: line(start),
                names,
            },
        ));
    }
    let refused = |at: usize, why: Unread| Import {
        specifier: Err(why),
        line: line(at),
        names: None,
    };
    // A template literal as a statement's module name.
    for &start in &templates {
        let before = code[..start].trim_end();
        let named_here = keyword_end(before, "from").is_some_and(|head| statement(head).is_some())
            || keyword_end(before, "import").is_some();
        if named_here {
            found.push((start, refused(start, Unread::Spelled)));
        }
    }
    // A call to `import` or `require` whose argument isn't one plain string literal.
    let starts: BTreeMap<usize, usize> = strings.iter().copied().collect();
    let bytes = code.as_bytes();
    // The next token at or after `at`: white space in the code is skipped, a blanked literal isn't.
    let token = |mut at: usize| {
        while bytes.get(at).is_some_and(|&b| space(b) || line_end(b))
            && !starts.contains_key(&at)
            && !templates.contains(&at)
        {
            at += 1;
        }
        at
    };
    // Each `(`'s matching `)`, found in one pass.
    let mut closes = BTreeMap::new();
    let mut open = Vec::new();
    for (at, &byte) in bytes.iter().enumerate() {
        match byte {
            b'(' => open.push(at),
            b')' => {
                if let Some(start) = open.pop() {
                    closes.insert(start, at);
                }
            }
            _ => {}
        }
    }
    for (at, word) in calls {
        let end = at + word.len();
        let after = token(end);
        let argument = match bytes.get(after) {
            Some(b'(') => token(after + 1),
            // `` require`…` `` calls it with a template.
            _ if word == "require" && templates.contains(&after) => after,
            _ => continue,
        };
        if bytes.get(after) == Some(&b'(')
            && closes
                .get(&after)
                .is_some_and(|&close| method(&code[..at], bytes, source.as_bytes(), close))
        {
            continue;
        }
        let plain = starts
            .get(&argument)
            .is_some_and(|&close| matches!(bytes.get(token(close)), Some(b')' | b',')));
        if !plain {
            found.push((at, refused(at, Unread::Spelled)));
        }
    }
    if let Some((at, why)) = unread {
        found.push((at, refused(at, why)));
    }
    found.sort_by_key(|(at, _)| *at);
    found.into_iter().map(|(_, import)| import).collect()
}

/// Whether the `(` whose `)` is at `close` begins the parameters of a method named `import` or `require`,
/// `import(name) {`, not a call: the name stands where only a method's can (`before` ends with `{`, `}`, `;`, `,`, `*`,
/// `static`, `get`, `set` or `async`), and its `)` is followed by `{` on the same line, with only white space between
/// in the source (a template's blanked text is no white space: ``import(m)`${{}}` `` is a call). A call there followed
/// by `{` doesn't parse; one elsewhere may (`class A extends import(n) {}`), so it stays a call.
fn method(before: &str, code: &[u8], source: &[u8], close: usize) -> bool {
    let before = before.trim_end();
    let name_place = before.ends_with(['{', '}', ';', ',', '*'])
        || ["static", "get", "set", "async"]
            .iter()
            .any(|word| keyword_end(before, word).is_some());
    if !name_place {
        return false;
    }
    let mut at = close + 1;
    while source.get(at).is_some_and(|&b| space(b)) {
        at += 1;
    }
    source.get(at) == Some(&b'{') && code.get(at) == Some(&b'{')
}

/// Where the clause of the `import` or `export` statement whose `from` ends `head` starts, if one does.
fn statement(head: &str) -> Option<usize> {
    ["import", "export"]
        .iter()
        .filter_map(|keyword| keyword_start(head, keyword).map(|at| at + keyword.len()))
        .max()
}

/// The names an import clause takes by name (`{ A, B as C }` gives A and B), or `None` when it takes more.
fn named(clause: &str) -> Option<Vec<String>> {
    let clause = clause.trim();
    let inner = clause.strip_prefix('{')?.strip_suffix('}')?;
    Some(
        inner
            .split(',')
            .filter_map(|name| name.split_whitespace().next().map(str::to_owned))
            .collect(),
    )
}

/// JavaScript's white space within ASCII: space, tab, vertical tab and form feed. Anything past ASCII in code is
/// refused rather than read, so the check never needs the rest.
fn space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | 0x0b | 0x0c)
}

/// An ASCII line terminator: `\n`, or `\r` alone or before `\n`.
fn line_end(byte: u8) -> bool {
    matches!(byte, b'\n' | b'\r')
}

/// How many bytes of a line terminator start at `at`: `\n`, `\r\n`, `\r`, U+2028 or U+2029.
fn terminator(bytes: &[u8], at: usize) -> usize {
    match bytes[at..] {
        [b'\r', b'\n', ..] => 2,
        [b'\n' | b'\r', ..] => 1,
        [0xe2, 0x80, 0xa8 | 0xa9, ..] => 3,
        _ => 0,
    }
}

/// What [`scan`] reads of a script.
struct Scan {
    /// The script with its comments, string literals, template literals' text (not their `${…}` code) and regex
    /// literals blanked, newlines kept.
    code: String,
    /// Where each plain string literal starts and ends, quotes included.
    strings: Vec<(usize, usize)>,
    /// Where each template literal starts.
    templates: Vec<usize>,
    /// Where each `import` and `require` in the code is, as a word of its own and not a property's name.
    calls: Vec<(usize, &'static str)>,
    /// Where the first place is the scan can't read for certain, and why; the scan stops there.
    unread: Option<(usize, Unread)>,
}

/// What came before a `/`, which decides whether it divides or starts a regex literal.
#[derive(Clone, Copy, PartialEq)]
enum Before {
    /// A value (a name, a number, a literal, `)` or `]`): a `/` divides.
    Value,
    /// An operator, a keyword that takes an expression, an opening bracket or the start: a `/` starts a regex.
    Operator,
    /// `}`, or a word that is a keyword only sometimes (`of`, `yield`, `await`): either reading may be the script's.
    Either,
}

/// The keywords after which an expression starts, so a `/` there starts a regex literal.
const EXPRESSION_KEYWORDS: [&str; 13] = [
    "return",
    "typeof",
    "instanceof",
    "in",
    "new",
    "delete",
    "void",
    "throw",
    "case",
    "do",
    "else",
    "extends",
    "default",
];

/// Reads `source` as JavaScript's lexer does, far enough to tell code from comments and literals (see [`Scan`]).
fn scan(source: &str) -> Scan {
    let bytes = source.as_bytes();
    let mut code = bytes.to_vec();
    let mut strings = Vec::new();
    let mut templates = Vec::new();
    let mut calls = Vec::new();
    // For each open `(`: whether it is the head of `if`, `for`, `for await`, `while` or `with`, after which a `/`
    // starts a regex.
    let mut parens: Vec<bool> = Vec::new();
    // For each open `{`: whether it is a template literal's `${`.
    let mut braces: Vec<bool> = Vec::new();
    let mut before = Before::Operator;
    // The two words just before, white space and comments aside, a property's name (after a `.`) as "".
    let mut words: [&str; 2] = ["", ""];
    // Whether a `.` that reaches a property came just before, and a line terminator since the last token.
    let mut after_dot = false;
    let mut new_line = false;
    let blank = |code: &mut Vec<u8>, from: usize, to: usize| {
        for byte in &mut code[from..to] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    };
    let done = |code: Vec<u8>, strings, templates, calls, unread| Scan {
        code: String::from_utf8(code).expect("blanking keeps UTF-8"),
        strings,
        templates,
        calls,
        unread,
    };
    // A byte-order mark is no code.
    let mut at = if source.starts_with('\u{feff}') { 3 } else { 0 };
    blank(&mut code, 0, at);
    if source[at..].starts_with("#!") {
        at = (at..bytes.len())
            .find(|&at| terminator(bytes, at) > 0)
            .unwrap_or(bytes.len());
        blank(&mut code, 0, at);
    }
    while at < bytes.len() {
        let byte = bytes[at];
        let next = bytes.get(at + 1).copied();
        // Tokens set these again; white space and comments keep them.
        let (last_words, dotted, was_new_line) = (words, after_dot, new_line);
        words = [last_words[1], ""];
        after_dot = false;
        new_line = false;
        let keep = |line: bool| (last_words, dotted, was_new_line || line);
        match byte {
            b'/' if next == Some(b'/') => {
                let end = (at..bytes.len())
                    .find(|&at| terminator(bytes, at) > 0)
                    .unwrap_or(bytes.len());
                blank(&mut code, at, end);
                at = end;
                (words, after_dot, new_line) = keep(false);
            }
            b'/' if next == Some(b'*') => {
                let end = source[at + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |end| at + 2 + end + 2);
                let line = (at..end).any(|at| terminator(bytes, at) > 0);
                blank(&mut code, at, end);
                at = end;
                (words, after_dot, new_line) = keep(line);
            }
            b'/' => {
                let regex = regex_end(bytes, at);
                // A line terminator after a value ends the statement where it can't go on (`let a`, `debugger`, an
                // import with no `;`), and then the `/` starts a regex: the token before can't tell which.
                let reading = if before == Before::Value && was_new_line {
                    Before::Either
                } else {
                    before
                };
                let starts_regex = match reading {
                    Before::Value => false,
                    Before::Operator => true,
                    Before::Either => {
                        // Either reading may be the script's: they agree only when the would-be regex holds no
                        // literal, bracket, `*`, import or slash of its own (`[/*]` opens a comment as division), and
                        // no slash follows it.
                        let Some(end) = regex else {
                            before = Before::Operator;
                            at += 1;
                            continue;
                        };
                        let body = &source[at..end];
                        let close = body.rfind('/').map_or(end, |slash| at + slash + 1);
                        // Read as division, the text between the slashes must end in a value, or the closing `/`
                        // starts a regex there (`a / / */`, `a / x in /`).
                        let inner = source[at + 1..close - 1].trim_end_matches([' ', '\t']);
                        let last = inner.rsplit(|c: char| !ident(c)).next().unwrap_or("");
                        let ends_in_value = inner.ends_with(ident)
                            && !EXPRESSION_KEYWORDS.contains(&last)
                            && !matches!(last, "of" | "yield" | "await")
                            || inner.ends_with("++")
                            || inner.ends_with("--");
                        if !ends_in_value
                            || body.contains(['"', '\'', '`', '{', '}', '(', ')', '[', ']', '*'])
                            || body
                                .get(1..close - at - 1)
                                .is_some_and(|inner| inner.contains('/'))
                            || body.contains("import")
                            || body.contains("require")
                            || matches!(bytes.get(close), Some(b'*' | b'/'))
                            || bytes[end..].iter().find(|&&b| !space(b) && !line_end(b))
                                == Some(&b'/')
                        {
                            return done(
                                code,
                                strings,
                                templates,
                                calls,
                                Some((at, Unread::Slash)),
                            );
                        }
                        true
                    }
                };
                match regex.filter(|_| starts_regex) {
                    Some(end) => {
                        blank(&mut code, at, end);
                        before = Before::Value;
                        at = end;
                    }
                    None => {
                        before = Before::Operator;
                        at += 1;
                    }
                }
            }
            b'"' | b'\'' => {
                let start = at;
                at += 1;
                let mut closed = false;
                while at < bytes.len() {
                    if bytes[at] == byte {
                        closed = true;
                        break;
                    }
                    if line_end(bytes[at]) {
                        break;
                    }
                    if bytes[at] == b'\\' {
                        // A `\` before a line terminator continues the string past it, `\r\n` whole.
                        at += 1 + terminator(bytes, at + 1).max(1);
                    } else {
                        at += 1;
                    }
                }
                let end = (at + 1).min(bytes.len());
                if !closed {
                    // A string no quote closes is no script QuickJS runs; read no further.
                    return done(
                        code,
                        strings,
                        templates,
                        calls,
                        Some((start, Unread::Character)),
                    );
                }
                blank(&mut code, start, end);
                strings.push((start, end));
                at = end;
                before = Before::Value;
            }
            b'`' => {
                templates.push(at);
                at = template_text(bytes, &mut code, at + 1, at, &mut braces);
                before = if code_resumed(bytes, at) {
                    Before::Operator
                } else {
                    Before::Value
                };
            }
            b'}' if braces.last() == Some(&true) => {
                braces.pop();
                at = template_text(bytes, &mut code, at + 1, at, &mut braces);
                before = if code_resumed(bytes, at) {
                    Before::Operator
                } else {
                    Before::Value
                };
            }
            b'{' => {
                braces.push(false);
                before = Before::Operator;
                at += 1;
            }
            b'}' => {
                braces.pop();
                before = Before::Either;
                at += 1;
            }
            b'(' => {
                let head = matches!(last_words[1], "if" | "for" | "while" | "with")
                    || last_words == ["for", "await"];
                parens.push(head);
                before = Before::Operator;
                at += 1;
            }
            b')' => {
                before = if parens.pop() == Some(true) {
                    Before::Operator
                } else {
                    Before::Value
                };
                at += 1;
            }
            b']' => {
                before = Before::Value;
                at += 1;
            }
            b'+' | b'-' if next == Some(byte) => {
                // Postfix after a value on its line (`a++ / b` divides); prefix otherwise (`++/re/.lastIndex`), as
                // a line terminator before `++` ends the statement.
                before = match before {
                    Before::Value if !was_new_line => Before::Value,
                    // `of++` is postfix on a name `of`; `of ++x` isn't: what follows reads either way.
                    Before::Either => Before::Either,
                    _ => Before::Operator,
                };
                at += 2;
            }
            b'.' if bytes[at..].starts_with(b"...") => {
                before = Before::Operator;
                at += 3;
            }
            _ if space(byte) || line_end(byte) => {
                at += 1;
                (words, after_dot, new_line) = keep(line_end(byte));
            }
            _ if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'#') => {
                let start = at;
                // A number's one `.` (`1.5`) is part of it, after decimal digits only; a second (`1.5.x`, `1..x`,
                // `1e5.x`, `0x1.x`) reaches a property.
                let number = byte.is_ascii_digit();
                at += 1;
                while at < bytes.len()
                    && (bytes[at].is_ascii_alphanumeric()
                        || matches!(bytes[at], b'_' | b'$')
                        || (number
                            && bytes[at] == b'.'
                            && bytes[start..at]
                                .iter()
                                .all(|&b| b.is_ascii_digit() || b == b'_')))
                {
                    at += 1;
                }
                let word = &source[start..at];
                // A property's name is no keyword. A name after a number's own `.` is none (`1. in /re/`), as only
                // a `.` of its own reaches a property.
                let property = dotted;
                if !dotted {
                    if let Some(call) = ["import", "require"].into_iter().find(|w| *w == word) {
                        if last_words[1] != "function" {
                            calls.push((start, call));
                        }
                    }
                }
                words = [last_words[1], if dotted { "" } else { word }];
                before = if property {
                    Before::Value
                } else if EXPRESSION_KEYWORDS.contains(&word) {
                    Before::Operator
                } else if matches!(word, "of" | "yield" | "await") {
                    Before::Either
                } else {
                    Before::Value
                };
            }
            _ if byte >= 0x80 || byte == b'\\' || byte < 0x20 => {
                return done(
                    code,
                    strings,
                    templates,
                    calls,
                    Some((at, Unread::Character)),
                );
            }
            _ => {
                after_dot = byte == b'.';
                before = Before::Operator;
                at += 1;
            }
        }
    }
    done(code, strings, templates, calls, None)
}

/// Where the regex literal starting with the `/` at `at` ends (after its flags), if one ends on its line.
fn regex_end(bytes: &[u8], at: usize) -> Option<usize> {
    let mut class = false;
    let mut end = at + 1;
    loop {
        if end >= bytes.len() || terminator(bytes, end) > 0 {
            return None;
        }
        match bytes[end] {
            b'\\' => {
                end += 1;
                if end < bytes.len() && terminator(bytes, end) > 0 {
                    return None;
                }
            }
            b'[' => class = true,
            b']' => class = false,
            b'/' if !class => break,
            _ => {}
        }
        end += 1;
    }
    end += 1;
    while bytes
        .get(end)
        .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'$')
    {
        end += 1;
    }
    Some(end)
}

/// Blanks a template literal's text from `at`, the byte after its `` ` `` or a `${…}`'s `}` (`opened`, blanked too),
/// to its closing `` ` `` or its next `${`, which it opens on `braces`. Returns where the scan goes on.
fn template_text(
    bytes: &[u8],
    code: &mut [u8],
    mut at: usize,
    opened: usize,
    braces: &mut Vec<bool>,
) -> usize {
    while at < bytes.len() {
        match bytes[at] {
            b'\\' => at += 2,
            b'`' => {
                at += 1;
                break;
            }
            b'$' if bytes.get(at + 1) == Some(&b'{') => {
                braces.push(true);
                at += 2;
                break;
            }
            _ => at += 1,
        }
    }
    let at = at.min(bytes.len());
    for byte in &mut code[opened..at] {
        if *byte != b'\n' {
            *byte = b' ';
        }
    }
    at
}

/// Whether the template text that ended just before `at` ended at a `${`, so code resumes there.
fn code_resumed(bytes: &[u8], at: usize) -> bool {
    at >= 2 && &bytes[at - 2..at] == b"${"
}

fn ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// When `text` ends with `word` as a whole word, what comes before it.
fn keyword_end<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    let head = text.strip_suffix(word)?;
    (!head.chars().next_back().is_some_and(ident)).then_some(head)
}

/// Where the last `word` in `text` starts as a whole word.
fn keyword_start(text: &str, word: &str) -> Option<usize> {
    text.rmatch_indices(word).map(|(at, _)| at).find(|&at| {
        !text[..at].chars().next_back().is_some_and(ident)
            && !text[at + word.len()..].chars().next().is_some_and(ident)
    })
}

/// Edit distance, to name the catalog name a misspelt one is closest to.
fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let next = (diagonal + usize::from(ca != *cb))
                .min(row[j] + 1)
                .min(row[j + 1] + 1);
            diagonal = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_are_read_with_their_lines_and_names() {
        let source = "// import { x } from \"gpui-kit\";\nimport { View, div as d } from \"@deepbuild/panel\";\n/* \"gpui-base\" */ import * as P from 'gpui-base';\nconst s = \"from 'gpui-shell'\";\nimport \"./side.js\";\nexport { a } from \"./a.js\";\nconst m = await import(\"gpui-fps\");\n";
        let found = imports(source);
        let seen: Vec<(&str, usize, Option<Vec<String>>)> = found
            .iter()
            .map(|i| {
                (
                    i.specifier.as_deref().expect("plain"),
                    i.line,
                    i.names.clone(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                (
                    "@deepbuild/panel",
                    2,
                    Some(vec!["View".to_owned(), "div".to_owned()])
                ),
                ("gpui-base", 3, None),
                ("./side.js", 5, Some(vec![])),
                ("./a.js", 6, Some(vec!["a".to_owned()])),
                ("gpui-fps", 7, None),
            ]
        );
    }

    /// Each import `source` makes, as its specifier or `?` when it isn't read, with its line.
    fn read(source: &str) -> Vec<(String, usize)> {
        imports(source)
            .into_iter()
            .map(|i| (i.specifier.unwrap_or_else(|_| "?".to_owned()), i.line))
            .collect()
    }

    #[test]
    fn a_module_named_any_way_but_one_plain_string_is_not_read() {
        let spelled = [
            "await import(`gpui-kit`);",
            "await import(`gpui-${\"kit\"}`);",
            "const m = \"gpui-\" + \"kit\"; await import(m);",
            "await import(\"gpui-\" + \"kit\");",
            "await import((\"gpui-kit\"));",
            "await import(/* a */ name);",
            "const m = \"gpui-kit\"; require(m);",
            "require(`gpui-kit`);",
            "require`gpui-kit`;",
            "import { Chart } from `gpui-kit`;",
            "export * from `gpui-kit`;",
        ];
        for line in spelled {
            let source = format!("import {{ View }} from \"@deepbuild/panel\";\n\n{line}\n");
            let found = read(&source);
            assert!(found.contains(&("?".to_owned(), 3)), "{line}: {found:?}");
        }
    }

    #[test]
    fn regex_literals_and_templates_hide_no_import() {
        let cases = [
            // RUST-APP-15: the regex's quote isn't a string's.
            (
                "const q = /\"/; import { Chart } from \"gpui-kit\";",
                "gpui-kit",
            ),
            (
                "const q = /['`]/g; import { Chart } from \"gpui-kit\";",
                "gpui-kit",
            ),
            ("if (ok) /'/.test(s); import \"gpui-base\";", "gpui-base"),
            (
                "const t = `${ `${\"x\"}` }`; import(\"gpui-fps\");",
                "gpui-fps",
            ),
            (
                "const t = `a ${ { b: 1 }.b } c`; import(\"gpui-fps\");",
                "gpui-fps",
            ),
            ("const r = a / b / \"x\".length; import(\"gpui\");", "gpui"),
            ("const t = `${ import(\"gpui-shell\") }`;", "gpui-shell"),
        ];
        for (source, specifier) in cases {
            assert!(
                read(source).contains(&(specifier.to_owned(), 1)),
                "{source}: {:?}",
                read(source)
            );
        }
        // And literals that only look like imports stay unread.
        let quiet = "const a = `import(\"gpui-kit\")`; const b = /import(\"gpui-kit\")/; obj.import(m); obj.require(m); function require(m) {} this.import(\"en\"); loader.require('lodash');\n";
        assert_eq!(read(quiet), vec![]);
        // A refusal names the line as the lexer reads lines: a bare `\r` ends one.
        assert_eq!(
            read("// a\r// b\rconst m = await import(n);"),
            vec![("?".to_owned(), 3)]
        );
    }

    #[test]
    fn a_slash_after_a_brace_that_reads_two_ways_is_not_read() {
        let found = read("const o = {}\n/\"/; import { Chart } from \"gpui-kit\";\n");
        assert_eq!(found.first(), Some(&("?".to_owned(), 2)), "{found:?}");
        // One that reads the same either way is read.
        assert_eq!(
            read("const x = {}.a / 2;\nimport(\"./a.js\");\n"),
            vec![("./a.js".to_owned(), 2)]
        );
    }

    #[test]
    fn what_the_review_found_is_not_read_or_is_read_as_the_toolkit() {
        // Each line imports the toolkit in valid module code QuickJS runs; the reader must refuse it on its line.
        let cases = [
            "import { Chart } from \"gpui\\x2dkit\";",
            "const m = await import(\"gpui\\u002Dkit\");",
            "// hi\rimport { Chart } from \"gpui-kit\";",
            "// hi\u{2028}import { Chart } from \"gpui-kit\";",
            "const s = \"a\\\r\nb\"; import { Chart } from \"gpui-kit\";",
            "const r = void\u{a0}/'/; import { Chart } from \"gpui-kit\";",
            "if\u{a0}(1) /'/.test(\"\"); import { Chart } from \"gpui-kit\";",
            "const m = await import\u{a0}(n);",
            "const m = await import\u{0b}(n);",
            "const m = await import\u{feff}(n);",
            "for await (const x of []) /'/.test(\"\"); import { Chart } from \"gpui-kit\";",
            "++/'/.lastIndex; import { Chart } from \"gpui-kit\";",
            "o.if(0) / import(n).then((m) => m) / 1;",
            "({ ...import(n).then((m) => m) });",
            "let x = 1.\nimport(n);",
            "a\n++/'/.lastIndex; import { Chart } from \"gpui-kit\";",
            "1..if(0) / import(n) / 1;",
            "const m = await \\u0069mport(n);",
            // Round 2: a heritage is a call followed by `{`.
            "try { class A extends import(n) {} } catch (e) {}",
            "class B extends require(n) {}",
            // Round 8: a line terminator ends a statement that can't go on, so the `/` after it starts a regex;
            // and a name after a number's own `.` is an operator or keyword, not a property.
            "import { View } from \"@deepbuild/panel\"\n/'/; import { Chart } from \"gpui-kit\"; //'",
            "let a\n/'/; import { Chart } from \"gpui-kit\"; //'",
            "debugger\n/'/; import { Chart } from \"gpui-kit\"; //'",
            "for (;;) { break\n/'/; import(n); //'\n}",
            "const r = 1. in /'/; import { Chart } from \"gpui-kit\"; //'",
            "const r = 1. instanceof /'/; import { Chart } from \"gpui-kit\"; //'",
            "let x = 1.\ntypeof /'/; import { Chart } from \"gpui-kit\"; //'",
            // Round 9: as division, `[/*]` opens an array and a comment that hides the regex's end.
            "let a = 1\nlet x = a\n/ [/*] / \"*/ + import('gpui-kit') + /\"/ ]",
            "let x = {} / [/*] / \"*/ + import('gpui-kit') + /\"/ ];",
            "for (const x of [/*] / \"*/ + import('gpui-kit') + /\"/ ]) {}",
            // Round 10, from a fuzzer checked against V8: a number's second `.` reaches a property; `of++` may be
            // postfix; a template's text is no white space before a method's `{`; a slash read either way whose
            // division ends in no value.
            "let x = 1.5. in / 1; import('gpui-kit'); x = x /1;",
            "let x = 1e5. in / 1; import('gpui-kit'); x = x /1;",
            "let of = 0;\nof++ / 1; import(\"gpui-kit\"); 0 /1;",
            ";import(n)`${{}}`",
            "{import(`gpui-kit`)`${{}}`}",
            "String(1, `${import(n)}${{}}`);",
            "let a = 1;\na\n/ / */; import(\"gpui-kit\"); 0 /1;",
            "let a = 1;\na\n/ + / */; import(\"gpui-kit\"); 0 /1;",
        ];
        for case in cases {
            let source = format!("const n = \"gpui-\" + \"kit\";\n{case}\n");
            let found = read(&source);
            assert!(
                found.iter().any(|(specifier, line)| *line >= 2
                    && (specifier == "?" || TOOLKIT.contains(&specifier.as_str()))),
                "{case:?}: {found:?}"
            );
        }
    }

    #[test]
    fn private_fields_and_methods_named_import_read_as_plain_code() {
        let source = "import { View, div } from \"@deepbuild/panel\";\nclass Loader { #n = 1; import(name) { return this.#n; } }\nconst api = { require(id) { return id; } };\nconst lazy = await import(\n  \"./lazy.js\" /* c */\n);\r\nimport \"./side.mjs\";\r\n";
        assert_eq!(
            read(source),
            vec![
                (MODULE.to_owned(), 1),
                ("./lazy.js".to_owned(), 5),
                ("./side.mjs".to_owned(), 7),
            ]
        );
        // A tagged `` require`…` `` is a call, whatever parentheses come later on the line.
        assert_eq!(
            read("x;\nrequire`gpui-kit`; function f(a) {}"),
            vec![("?".to_owned(), 2)]
        );
    }

    #[test]
    fn calls_that_never_close_are_read_in_one_pass() {
        // Each `import(` used to scan to the end of the file for its `)`: 50 000 of them took minutes.
        let source = ";import(".repeat(50_000);
        let started = std::time::Instant::now();
        let found = imports(&source);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(10),
            "{:?}",
            started.elapsed()
        );
        assert!(!found.is_empty() && found.iter().all(|i| i.specifier.is_err()));
    }

    #[test]
    fn a_panel_is_refused_its_files_the_check_does_not_read() {
        let dir = std::env::temp_dir().join(format!("deep-1847-unit-{}", std::process::id()));
        let write = |files: &[(&str, &str)]| {
            let _ = std::fs::remove_dir_all(&dir);
            for (name, text) in files {
                let path = dir.join(name);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, text).unwrap();
            }
            check(&dir)
        };
        let kit = "export * from \"gpui-kit\";";
        for evil in [
            "./evil.txt",
            "evil.txt",
            "sub/evil.txt",
            "./evil",
            "./evil.cjs",
        ] {
            let main = format!(
                "import {{ View, div }} from \"@deepbuild/panel\";\nimport {{ k }} from \"{evil}\";\n"
            );
            let refused =
                write(&[("main.js", &main), (evil.trim_start_matches("./"), kit)]).unwrap_err();
            assert!(refused.contains("main.js:2"), "{evil}: {refused}");
        }
        // A bare name of a script of its own is read like any script.
        let refused = write(&[("main.js", "import \"sub/s.js\";"), ("sub/s.js", kit)]).unwrap_err();
        assert!(refused.contains("s.js:1"), "{refused}");
        // A script named `.js` alone, or in capitals, is read too (round 3 of #1847's review).
        for (name, file) in [
            ("./.js", ".js"),
            (".js", ".js"),
            ("./sub/.mjs", "sub/.mjs"),
            ("./evil.JS", "evil.JS"),
        ] {
            let main = format!("import \"{name}\";\n");
            let refused = write(&[("main.js", &main), (file, kit)]).unwrap_err();
            assert!(refused.contains(&format!("{file}:1")), "{name}: {refused}");
        }
        assert!(write(&[("main.js", "import \"./a\\u{0}.js\";")]).is_err());
        // Round 5: the loader cuts `./a?v=1.js` to `./a`, which the check never read.
        let qv = write(&[
            ("main.js", "import \"./a?v=1.js\";"),
            ("a?v=1.js", ""),
            ("a", kit),
        ])
        .unwrap_err();
        assert!(qv.contains("main.js:1"), "{qv}");
        // A folder it can't list, an entry that is neither a file nor a folder, and a name past ASCII are refused.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let hidden = dir.join("hidden");
            let main = "import \"./hidden/evil.js\";";
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&hidden).unwrap();
            std::fs::write(dir.join("main.js"), main).unwrap();
            std::fs::write(hidden.join("evil.js"), kit).unwrap();
            std::fs::set_permissions(&hidden, std::fs::Permissions::from_mode(0o311)).unwrap();
            // Unless the tests run as a user who lists it anyway.
            if std::fs::read_dir(&hidden).is_err() {
                let refused = check(&dir).unwrap_err();
                assert!(refused.contains("hidden"), "{refused}");
            }
            std::fs::set_permissions(&hidden, std::fs::Permissions::from_mode(0o755)).unwrap();
            write(&[("main.js", "")]).unwrap();
            let socket = std::os::unix::net::UnixListener::bind(dir.join("pipe.js")).unwrap();
            let refused = check(&dir).unwrap_err();
            assert!(refused.contains("pipe.js"), "{refused}");
            drop(socket);
        }
        assert!(write(&[("main.js", ""), ("evil.j\u{17f}", kit)])
            .unwrap_err()
            .contains("past ASCII"));
        // A byte-order mark is no code.
        let marked = "\u{feff}import { View } from \"@deepbuild/panel\";\n";
        assert_eq!(write(&[("main.js", marked)]), Ok(()));
        // Round 6: a file of the module's own name would load in place of the served one; typings beside it may stay.
        for shadow in [
            "@deepbuild/panel",
            "@DeepBuild/Panel",
            "@deepbuild/panel/x.js",
        ] {
            let main = "import { View } from \"@deepbuild/panel\";";
            let refused = write(&[("main.js", main), (shadow, kit)]).unwrap_err();
            assert!(refused.contains("in place of"), "{shadow}: {refused}");
        }
        let typed = [
            ("main.js", "import { View } from \"@deepbuild/panel\";"),
            ("@deepbuild/gpui-kit.d.ts", ""),
        ];
        assert_eq!(write(&typed), Ok(()));
        // A page entry the panel brought itself is read like any script.
        let page =
            "import { View, div } from \"@deepbuild/panel\";\nimport \"./.deepbuild-page.js\";\n";
        let refused = write(&[
            ("main.js", page),
            (PAGE_ENTRY, "export * from \"gpui-kit\";"),
        ])
        .unwrap_err();
        assert!(refused.contains(".deepbuild-page.js:1"), "{refused}");
        // The served module left by an earlier load, by another build or brought by the panel, is DeepBuild's to
        // write: `serve` rewrites it before gpui-shell reads it, so it neither refuses the panel nor runs.
        let stale = "// Written by DeepBuild each time it loads this panel (#1425)\nexport { quotes } from \"deepbuild\";\nexport { View, div } from \"gpui-kit\";";
        assert_eq!(
            write(&[
                ("main.js", "import { View } from \"@deepbuild/panel\";"),
                (SERVED, stale)
            ]),
            Ok(())
        );
        serve(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(SERVED)).unwrap(), source());
        assert_eq!(
            write(&[
                ("main.js", "import { View } from \"@deepbuild/panel\";"),
                (SERVED, source())
            ]),
            Ok(())
        );
        // More scripts than the check reads is a refusal, not a pass on the ones it read.
        let many: Vec<(String, &str)> = (0..=MAX_SCRIPTS)
            .map(|n| (format!("s{n}.js"), ""))
            .collect();
        let many: Vec<(&str, &str)> = many
            .iter()
            .map(|(name, text)| (name.as_str(), *text))
            .collect();
        assert!(write(&many).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A small seeded generator, so the property tests need no crate: xorshift64*.
    struct Seeded(u64);
    impl Seeded {
        fn below(&mut self, n: usize) -> usize {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 33) as usize % n
        }
    }

    /// Lines a panel may hold, each importing only `@deepbuild/panel` or its own files by one plain string, among
    /// comments, strings, templates and regex literals that mention the toolkit and imports.
    const ALLOWED: [&str; 26] = [
        "import { View, div } from \"@deepbuild/panel\";",
        "import * as P from '@deepbuild/panel';",
        "import \"./side.js\";",
        "export { a } from './a.js';",
        "export * from \"./b.js\";",
        "const lazy = await import(\"./lazy.js\");",
        "const m = await import('@deepbuild/panel', { with: {} });",
        "// import { Chart } from \"gpui-kit\"; import(`gpui-kit`)",
        "/* require(m) \" ' ` */ const c = 1;",
        "const s = \"import(`gpui-kit`) from 'gpui-kit'\";",
        "const t = `import(${ \"gpui\" + '-kit' }) ${ `${a}` }`;",
        "const q = /\"/;",
        "const r = /['`/]\\//g.test(s);",
        "if (ok) /'/.test(s);",
        "const d = a / b / c;",
        "const e = (a + b) / 2;",
        "x++ / 2;",
        "obj.import(m); obj.require(`gpui-kit`);",
        "const o = { from: 1, import: 2 };",
        "const f = o.from / o.import;",
        "for (const x of xs) { y(x); }",
        "const u = `${ { k: \"v\" }.k }`;",
        "class C { #n = 1; m() { return this.#n / 2; } }",
        "const api = { import(name) { return name; } };",
        "const s = \"caf\u{e9} \\u00e9\";",
        "const en = this.import(\"en\"); loader.require('lodash');",
    ];

    /// Lines no panel may hold: each imports the toolkit, or names its module some other way than one plain string.
    const REFUSED: [&str; 10] = [
        "import { Chart } from \"gpui-kit\";",
        "const k = await import(`gpui-kit`);",
        "const k = await import(`gpui-${\"kit\"}`);",
        "const k = await import(name);",
        "const k = await import(\"gpui-\" + \"kit\");",
        "const k = require(name);",
        "const k = require(\"gpui-\" + kit);",
        "const k = await import(/* the toolkit */ `gpui-kit`);",
        "const q = /\"/; import { Chart } from \"gpui-kit\";",
        "export { Chart } from `gpui-kit`;",
    ];

    fn panel(seed: &mut Seeded) -> Vec<&'static str> {
        (0..1 + seed.below(12))
            .map(|_| ALLOWED[seed.below(ALLOWED.len())])
            .collect()
    }

    #[test]
    fn property_a_panel_of_plain_imports_reads_only_its_plain_imports() {
        // The first seven lines import one module each, the rest none.
        let counts: Vec<usize> = ALLOWED.iter().map(|line| read(line).len()).collect();
        assert_eq!(counts, [vec![1; 7], vec![0; ALLOWED.len() - 7]].concat());
        let mut seed = Seeded(0x1847);
        for _ in 0..2000 {
            let lines = panel(&mut seed);
            let source = lines.join(if seed.below(2) == 0 { "\n" } else { "\r\n" });
            // Read whole, the panel's imports are each line's own, on its line: what comes before changes none.
            let alone: Vec<(String, usize)> = lines
                .iter()
                .enumerate()
                .flat_map(|(at, line)| {
                    read(line)
                        .into_iter()
                        .map(move |(specifier, _)| (specifier, at + 1))
                })
                .collect();
            assert_eq!(read(&source), alone, "in:\n{source}");
            for (specifier, line) in alone {
                assert!(
                    specifier == MODULE || specifier.starts_with("./"),
                    "line {line} read as {specifier:?} in:\n{source}"
                );
            }
        }
    }

    #[test]
    fn property_one_refused_line_anywhere_is_read_on_its_line() {
        let mut seed = Seeded(0x15);
        for _ in 0..2000 {
            let mut lines = panel(&mut seed);
            let at = seed.below(lines.len() + 1);
            let bad = REFUSED[seed.below(REFUSED.len())];
            lines.insert(at, bad);
            let source = lines.join("\n");
            let refused = read(&source).into_iter().any(|(specifier, line)| {
                line == at + 1 && (specifier == "?" || TOOLKIT.contains(&specifier.as_str()))
            });
            assert!(refused, "line {} not refused in:\n{source}", at + 1);
        }
    }

    #[test]
    fn property_any_text_scans_to_code_of_the_same_shape() {
        let alphabet = [
            "/", "\"", "'", "`", "${", "{", "}", "(", ")", "[", "]", "\\", "\n", "*", " ", "a",
            "1", ".", "+", "import", "require", "if", "of", "return", "é", "=", "#", "\r",
            "\u{2028}", "\u{a0}", "...", "++", "for", "await",
        ];
        let mut seed = Seeded(0xdeb);
        for _ in 0..5000 {
            let source: String = (0..seed.below(40))
                .map(|_| alphabet[seed.below(alphabet.len())])
                .collect();
            let scan = scan(&source);
            assert_eq!(scan.code.len(), source.len(), "{source:?}");
            for (a, b) in scan.code.bytes().zip(source.bytes()) {
                assert_eq!(a == b'\n', b == b'\n', "{source:?}");
            }
            imports(&source);
        }
    }

    #[test]
    fn the_served_module_holds_every_catalog_name_once() {
        let source = source();
        for name in catalog().offered.keys() {
            assert_eq!(
                source.matches(&format!(" {name},")).count()
                    + source.matches(&format!(" {name} }}")).count(),
                1,
                "{name} in {source}"
            );
        }
        // A panel importing the module whole reaches nothing off the catalog.
        for name in catalog()
            .not_offered
            .keys()
            .filter(|name| !catalog().offered.contains_key(*name))
        {
            assert!(
                !source.contains(&format!(" {name},")) && !source.contains(&format!(" {name} }}")),
                "{name} in {source}"
            );
        }
    }
}
