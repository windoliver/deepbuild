//! Issue #2403: every word the app draws of its own, one table per language by key. English (`copy/en.json`) is the
//! source; each other language is a table beside it (`copy/<tag>.json`) whose entries each record the hash of the
//! English they were written from. A key a language lacks, or whose English changed after its translation was written
//! (stale), draws its English; `scripts/app-copy-lint.mjs` lists both and fails a release that ships either.
//!
//! An entry is a string, or plural forms by CLDR's cardinal categories (`one`, `two`, `few`, `many`, `other`, with
//! `other` required) at the pinned release `deep_canvas_marks::plural` reads, and `zero`, which a count of 0 reads in
//! every language that has it, so "Nothing needs you" is the count's own form.
//! Placeholders are `{0}`, `{1}` and on, one per argument; a plural entry picks its form by argument `{0}`, so no
//! sentence is ever joined from a word and a number. What stays as written never goes through here: an agent's words,
//! your words, file paths, handles, commands and the five verdict words.
//!
//! The language is the first of the system's preferred languages the app has, read at launch, unless `language` in
//! `config.json` names one (the box sets it, #1998). A replica's launch sets it from its `locale`.

use std::{
    collections::HashMap,
    fmt::Display,
    sync::{
        atomic::{AtomicUsize, Ordering},
        LazyLock, Mutex,
    },
};

use deep_canvas_marks::plural::{Operands, Table};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The source language's tag.
pub const SOURCE: &str = "en";

/// Each language the app has, the source first: its tag and its table.
const TABLES: [(&str, &str); 2] = [
    (SOURCE, include_str!("../copy/en.json")),
    ("zh-Hans", include_str!("../copy/zh-Hans.json")), // copy-exception: a language's tag
];

/// One entry: a string, or forms by plural category.
#[derive(Clone, Debug)]
enum Entry {
    Text(&'static str),
    Forms(Vec<(&'static str, &'static str)>),
}

/// A language's entries by key, each with the hash of the English it was written from (none for the source).
struct Language {
    tag: &'static str,
    entries: HashMap<&'static str, (Entry, Option<&'static str>)>,
}

static LANGUAGES: LazyLock<Vec<Language>> = LazyLock::new(|| {
    TABLES
        .iter()
        .map(|(tag, text)| Language {
            tag,
            entries: parse(text).unwrap_or_else(|e| panic!("copy/{tag}.json: {e}")),
        })
        .collect()
});

/// The language the app draws in, as an index into [`LANGUAGES`].
static SHOWN: AtomicUsize = AtomicUsize::new(0);

/// A table's text read into entries: `key: string | {forms…}`, and in a translation `key: {text: string | {forms…},
/// source}`.
fn parse(
    text: &'static str,
) -> Result<HashMap<&'static str, (Entry, Option<&'static str>)>, String> {
    let json: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let leak = |s: &str| -> &'static str { Box::leak(s.to_owned().into_boxed_str()) };
    let Value::Object(map) = json else {
        return Err("a table is an object of keys".into());
    };
    let mut out = HashMap::new();
    for (key, value) in map {
        let key = leak(&key);
        let (entry, source) = match &value {
            Value::String(s) => (Entry::Text(leak(s)), None),
            Value::Object(o) => {
                let source = o.get("source").and_then(Value::as_str).map(leak);
                let entry = match o.get("text") {
                    Some(Value::String(s)) => Entry::Text(leak(s)),
                    Some(Value::Object(forms)) => Entry::Forms(forms_of(key, forms, leak)?),
                    None if source.is_none() => Entry::Forms(forms_of(key, o, leak)?),
                    _ => return Err(format!("{key} is neither a string nor plural forms")),
                };
                (entry, source)
            }
            _ => return Err(format!("{key} is neither a string nor plural forms")),
        };
        out.insert(key, (entry, source));
    }
    Ok(out)
}

fn forms_of(
    key: &str,
    forms: &serde_json::Map<String, Value>,
    leak: impl Fn(&str) -> &'static str,
) -> Result<Vec<(&'static str, &'static str)>, String> {
    if !forms.contains_key("other") {
        return Err(format!("{key}'s plural forms have no other"));
    }
    forms
        .iter()
        .map(|(form, text)| match text {
            Value::String(s) => Ok((leak(form), leak(s))),
            _ => Err(format!("{key}'s form {form} isn't a string")),
        })
        .collect()
}

/// The hash a translation records of the English it was written from: SHA-256, in hex, of the string, or of the
/// plural forms as compact JSON with the forms in sorted order (`scripts/copy-table.mjs` computes the same).
fn source_hash(english: &Value) -> String {
    let text = match english {
        Value::String(s) => s.clone(),
        Value::Object(forms) => {
            let mut pairs: Vec<(&String, &Value)> = forms.iter().collect();
            pairs.sort_by(|a, b| a.0.cmp(b.0));
            let body: Vec<String> = pairs
                .iter()
                .map(|(form, text)| format!("{}:{text}", Value::String((*form).clone())))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        other => other.to_string(),
    };
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The hash of each source entry, by key.
static SOURCE_HASHES: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let source: Value = serde_json::from_str(TABLES[0].1).expect("copy/en.json is JSON");
    source
        .as_object()
        .map(|o| o.iter().map(|(k, v)| (k.clone(), source_hash(v))).collect())
        .unwrap_or_default()
});

fn english_hash(key: &str) -> Option<&'static str> {
    SOURCE_HASHES.get(key).map(String::as_str)
}

/// The language the app has for a preferred-language tag: the same tag; else one with the same language and script, a
/// missing script filled in from the language and region (`zh-CN` reads Simplified, `zh-TW` Traditional); else the
/// same language with no script of its own. None when the app has none.
fn has(tag: &str) -> Option<&'static str> {
    let parts: Vec<&str> = tag.split(['-', '_']).filter(|p| !p.is_empty()).collect();
    let language = parts.first()?.to_ascii_lowercase();
    let script = parts
        .iter()
        .skip(1)
        .find(|p| p.len() == 4 && p.chars().all(|c| c.is_ascii_alphabetic()))
        .map(|s| s.to_ascii_lowercase());
    let region = parts
        .iter()
        .skip(1)
        .find(|p| p.len() == 2 || (p.len() == 3 && p.chars().all(|c| c.is_ascii_digit())))
        .map(|s| s.to_ascii_uppercase());
    // CLDR's likely subtags for the languages written in more than one script that the app may carry.
    let script = script.or_else(|| match language.as_str() {
        "zh" => Some(
            match region.as_deref() {
                Some("TW" | "HK" | "MO") => "hant",
                _ => "hans",
            }
            .to_owned(),
        ),
        _ => None,
    });
    TABLES.iter().map(|(t, _)| *t).find(|have| {
        let mut parts = have.split('-');
        let (l, s) = (parts.next().unwrap_or(""), parts.next());
        l.eq_ignore_ascii_case(&language)
            && match (s, &script) {
                (Some(s), Some(want)) => s.eq_ignore_ascii_case(want),
                (Some(_), None) => false,
                (None, _) => true,
            }
    })
}

/// The first of `preferred` the app has, else the source.
pub fn choose<'a>(preferred: impl IntoIterator<Item = &'a str>) -> &'static str {
    preferred.into_iter().find_map(has).unwrap_or(SOURCE)
}

/// Draws in `tag`'s table from now on (a tag the app has; anything else draws the source).
pub fn show(tag: &str) {
    let at = TABLES.iter().position(|(t, _)| *t == tag).unwrap_or(0);
    SHOWN.store(at, Ordering::Relaxed);
}

/// What the app reads at launch: `language` in config.json, else the system's preferred languages.
fn at_launch(config_language: Option<&str>, system: &[String]) -> &'static str {
    match config_language.and_then(has) {
        Some(tag) => tag,
        None => choose(system.iter().map(String::as_str)),
    }
}

/// Shows, from launch on, the language `language` in config.json names (the box writes it), else the first of the
/// system's preferred languages the app has.
pub fn read_at_launch() {
    let config = std::fs::read_to_string(crate::hub::root().join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let said = config
        .as_ref()
        .and_then(|config| config.get("language")?.as_str());
    show(at_launch(said, &system_languages()));
}

/// The system's preferred languages, most preferred first.
#[cfg(target_os = "macos")]
fn system_languages() -> Vec<String> {
    objc2_foundation::NSLocale::preferredLanguages()
        .iter()
        .map(|tag| tag.to_string())
        .collect()
}

/// The system's preferred languages, most preferred first: `LANGUAGE`'s list, else the locale the messages are in.
#[cfg(not(target_os = "macos"))]
fn system_languages() -> Vec<String> {
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    let list = var("LANGUAGE").map(|l| l.split(':').map(str::to_owned).collect::<Vec<_>>());
    list.or_else(|| {
        ["LC_ALL", "LC_MESSAGES", "LANG"]
            .into_iter()
            .find_map(var)
            .map(|l| vec![l.split(['.', '@']).next().unwrap_or_default().to_owned()])
    })
    .unwrap_or_default()
}

/// The entry `key` draws in the language shown, falling back to the source's when that language has none or has a
/// stale one (the lint lists both, and the release check fails them). A key the source lacks draws itself, as the UI
/// check's raw-key audit would name it.
fn entry(key: &'static str) -> Option<&'static Entry> {
    entry_in(SHOWN.load(Ordering::Relaxed), key)
}

/// [`entry`] in the language at `at` in [`LANGUAGES`].
fn entry_in(at: usize, key: &'static str) -> Option<&'static Entry> {
    let languages = &*LANGUAGES;
    let shown = &languages[at];
    let source = languages[0].entries.get(key).map(|(e, _)| e);
    if shown.tag == SOURCE {
        return source;
    }
    match shown.entries.get(key) {
        // #2403's planted translation, in an env-plants build only: each string repeated until it is at least twice as
        // many characters as its English, for the layout check to catch.
        Some(_) if crate::plain::planted("zh-twice-as-long") => twice(at, key),
        Some((e, hash)) if hash.is_some_and(|h| english_hash(key).is_some_and(|now| now == h)) => {
            Some(e)
        }
        // Missing or stale: its English.
        _ => source,
    }
}

/// The planted translation of `key` in the language at `at`: each of its strings repeated until it holds at least twice
/// as many characters as its English, and at least twice.
fn twice(at: usize, key: &'static str) -> Option<&'static Entry> {
    static TWICE: LazyLock<Mutex<HashMap<(usize, &'static str), &'static Entry>>> =
        LazyLock::new(Mutex::default);
    let languages = &*LANGUAGES;
    let (Some((shown, _)), Some((english, _))) = (
        languages[at].entries.get(key),
        languages[0].entries.get(key),
    ) else {
        return None;
    };
    let long = |s: &'static str, english: &str| -> &'static str {
        let (n, want) = (s.chars().count().max(1), 2 * english.chars().count());
        Box::leak(s.repeat(want.div_ceil(n).max(2)).into_boxed_str())
    };
    let made = match (shown, english) {
        (Entry::Text(s), Entry::Text(e)) => Entry::Text(long(s, e)),
        (Entry::Forms(forms), english) => {
            let widest = match english {
                Entry::Text(e) => e,
                Entry::Forms(e) => e
                    .iter()
                    .map(|(_, s)| *s)
                    .max_by_key(|s| s.len())
                    .unwrap_or(""),
            };
            Entry::Forms(forms.iter().map(|(f, s)| (*f, long(s, widest))).collect())
        }
        (Entry::Text(s), Entry::Forms(e)) => Entry::Text(long(
            s,
            e.iter()
                .map(|(_, s)| *s)
                .max_by_key(|s| s.len())
                .unwrap_or(""),
        )),
    };
    let mut cache = TWICE.lock().ok()?;
    Some(
        *cache
            .entry((at, key))
            .or_insert_with(|| Box::leak(Box::new(made))),
    )
}

/// A sentence the hub wrote in English (a row's why, an agent's reach), drawn in the language shown: the `hub.` entry
/// whose English it reads as, each placeholder taking what the hub wrote there, as written (a path, a quote, a count);
/// parts the hub joined with " · " each on their own. As the hub wrote it in English, or when no entry reads it.
pub fn hub(said: &str) -> String {
    if SHOWN.load(Ordering::Relaxed) == 0 {
        return said.to_owned();
    }
    hub_one(said).unwrap_or_else(|| {
        said.split(" · ")
            .map(|part| hub_one(part).unwrap_or_else(|| part.to_owned()))
            .collect::<Vec<_>>()
            .join(" · ")
    })
}

/// One sentence of the hub's read as a `hub.` entry: the entry with the most English of its own first.
fn hub_one(said: &str) -> Option<String> {
    static HUB: LazyLock<Vec<(&'static str, &'static str)>> = LazyLock::new(|| {
        let mut hub: Vec<(&'static str, &'static str)> = LANGUAGES[0]
            .entries
            .iter()
            .filter(|(key, _)| key.starts_with("hub."))
            .filter_map(|(key, (entry, _))| match entry {
                Entry::Text(english) => Some((*key, *english)),
                Entry::Forms(_) => None,
            })
            .collect();
        let own = |english: &str| put(english, &[]).len() - 3 * english.matches('{').count();
        hub.sort_by(|a, b| own(b.1).cmp(&own(a.1)).then(a.0.cmp(b.0)));
        hub
    });
    HUB.iter().find_map(|(key, english)| {
        let args = read_as(english, said)?;
        let args: Vec<&dyn Display> = args.iter().map(|a| a as &dyn Display).collect();
        Some(put(text(key), &args))
    })
}

/// What `said` holds at each placeholder of `english`, when it reads as `english` whole; none otherwise. A
/// placeholder holds something, and the text after the last one ends the sentence.
fn read_as(english: &str, said: &str) -> Option<Vec<String>> {
    let mut pieces = english.split('{');
    let mut rest = said.strip_prefix(pieces.next().unwrap_or_default())?;
    let mut held: Vec<(usize, String)> = Vec::new();
    let mut pieces = pieces.peekable();
    while let Some(piece) = pieces.next() {
        let (hole, literal) = piece.split_once('}')?;
        let hole: usize = hole.parse().ok()?;
        let at = match (literal.is_empty(), pieces.peek().is_none()) {
            (true, true) => rest.len(),
            (false, true) => rest.strip_suffix(literal).map(str::len)?,
            (true, false) => return None,
            (false, false) => rest.find(literal)?,
        };
        if at == 0 {
            return None;
        }
        held.push((hole, rest[..at].to_owned()));
        rest = &rest[at + literal.len()..];
    }
    if !rest.is_empty() {
        return None;
    }
    held.sort_by_key(|(hole, _)| *hole);
    Some(held.into_iter().map(|(_, text)| text).collect())
}

/// The string `key` draws in the language shown.
pub fn text(key: &'static str) -> &'static str {
    match entry(key) {
        Some(Entry::Text(s)) => s,
        Some(Entry::Forms(forms)) => other(forms),
        None => key,
    }
}

fn other(forms: &[(&'static str, &'static str)]) -> &'static str {
    forms
        .iter()
        .find(|(f, _)| *f == "other")
        .map_or("", |(_, s)| *s)
}

/// `key`'s string with each `{i}` replaced by `args[i]`.
pub fn fill(key: &'static str, args: &[&dyn Display]) -> String {
    put(text(key), args)
}

/// `key`'s source string, whatever language is shown, with each `{i}` replaced by `args[i]`: for what DeepBuild sends
/// to an agent, which stays in English.
pub fn english(key: &'static str, args: &[&dyn Display]) -> String {
    let text = match LANGUAGES[0].entries.get(key) {
        Some((Entry::Text(s), _)) => *s,
        Some((Entry::Forms(forms), _)) => other(forms),
        None => key,
    };
    put(text, args)
}

/// `key`'s plural form for `n`, by the shown language's cardinal rule (`zero` first, for 0, when the entry has it),
/// with `{0}` the number and `{1}` on the rest of `args`.
pub fn count(key: &'static str, n: u64, args: &[&dyn Display]) -> String {
    count_in(SHOWN.load(Ordering::Relaxed), key, n, args)
}

/// [`count`] in the language at `at` in [`LANGUAGES`].
fn count_in(at: usize, key: &'static str, n: u64, args: &[&dyn Display]) -> String {
    let text = match entry_in(at, key) {
        Some(Entry::Forms(forms)) => {
            let category = match rules(TABLES[at].0)
                .category(&Operands::parse(&n.to_string()).expect("digits"))
            {
                _ if n == 0 && forms.iter().any(|(f, _)| *f == "zero") => "zero",
                // `zero` is the empty count's own form, never another number's.
                "zero" => "other",
                category => category,
            };
            forms
                .iter()
                .find(|(f, _)| *f == category)
                .map_or_else(|| other(forms), |(_, s)| *s)
        }
        Some(Entry::Text(s)) => s,
        None => key,
    };
    let mut all: Vec<&dyn Display> = vec![&n];
    all.extend_from_slice(args);
    put(text, &all)
}

fn rules(tag: &str) -> deep_canvas_marks::plural::Rules {
    static PINNED: LazyLock<Table> = LazyLock::new(Table::pinned);
    PINNED.of(tag)
}

/// Each `{i}` of `text` replaced by `args[i]`; `{{` and `}}` are braces.
fn put(text: &str, args: &[&dyn Display]) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut rest = text;
    while let Some(at) = rest.find(['{', '}']) {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        if tail.starts_with("{{") || tail.starts_with("}}") {
            out.push_str(&tail[..1]);
            rest = &tail[2..];
            continue;
        }
        match tail[1..]
            .find('}')
            .and_then(|end| Some((end, tail[1..1 + end].parse::<usize>().ok()?)))
        {
            Some((end, i)) if tail.starts_with('{') => {
                match args.get(i) {
                    Some(arg) => out.push_str(&arg.to_string()),
                    None => out.push_str(&tail[..end + 2]),
                }
                rest = &tail[end + 2..];
            }
            _ => {
                out.push_str(&tail[..1]);
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preferred_language_finds_the_table_it_reads() {
        assert_eq!(has("zh-Hans-CN"), Some("zh-Hans"));
        assert_eq!(has("zh-CN"), Some("zh-Hans"));
        assert_eq!(has("zh"), Some("zh-Hans"));
        assert_eq!(has("zh-TW"), None);
        assert_eq!(has("zh-Hant-HK"), None);
        assert_eq!(has("en-GB"), Some("en"));
        assert_eq!(has("fr-FR"), None);
        assert_eq!(choose(["fr-FR", "zh-Hans-CN", "en-US"]), "zh-Hans");
        assert_eq!(choose(["zh-TW", "en-US"]), "en");
        assert_eq!(choose(["de"]), "en");
        assert_eq!(at_launch(Some("en"), &["zh-Hans-CN".into()]), "en");
        assert_eq!(at_launch(Some("tlh"), &["zh-Hans-CN".into()]), "zh-Hans");
    }

    #[test]
    fn placeholders_take_their_arguments_by_number() {
        assert_eq!(put("{0} of {1}", &[&3, &"ten"]), "3 of ten");
        assert_eq!(put("{1}, {0}", &[&"a", &"b"]), "b, a");
        assert_eq!(put("{{0}} {0}", &[&7]), "{0} 7");
        assert_eq!(put("{2} stays", &[&1]), "{2} stays");
    }

    #[test]
    fn a_sentence_reads_as_a_template_only_whole() {
        assert_eq!(read_as("an ask open", "an ask open"), Some(vec![]));
        assert_eq!(
            read_as("{0} asks open", "3 asks open"),
            Some(vec!["3".into()])
        );
        assert_eq!(
            read_as(
                "{0}, so those hooks can't run",
                "a, b, so those hooks can't run"
            ),
            Some(vec!["a, b".into()])
        );
        assert_eq!(
            read_as("round {0} of {1}", "round 2 of 3"),
            Some(vec!["2".into(), "3".into()])
        );
        assert_eq!(read_as("{0} asks open", " asks open"), None);
        assert_eq!(read_as("an ask open", "an ask open now"), None);
        assert_eq!(read_as("its turn stopped", "its turn ended failed"), None);
    }

    #[test]
    fn a_source_hash_is_the_one_the_release_check_computes() {
        // The values scripts/copy-table.mjs's sourceHash gives for the same entries.
        assert_eq!(
            source_hash(&serde_json::json!("Hello")),
            "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969"
        );
        let forms = serde_json::json!({
            "other": "{0} asks need you", "zero": "Nothing \"needs\" you", "one": "{0} ask\nneeds you",
        });
        assert_eq!(
            source_hash(&forms),
            "860be4e45fc11b89207164eec2fc9fc63419d614368bb2adaae475f58f624a4a"
        );
    }

    #[test]
    fn a_count_reads_its_form_by_the_shown_language_and_zero_reads_nothing() {
        for (n, english) in [
            (0, "Nothing needs you"),
            (1, "1 ask needs you"),
            (2, "2 asks need you"),
            (11, "11 asks need you"),
        ] {
            assert_eq!(count("views.asks_need_you", n, &[]), english);
        }
        // Read from the zh-Hans table directly: the shown language is the process's, which other tests read.
        let at = TABLES.iter().position(|(t, _)| *t == "zh-Hans").unwrap();
        let chinese: Vec<String> = [0, 1, 2, 11]
            .into_iter()
            .map(|n| count_in(at, "views.asks_need_you", n, &[]))
            .collect();
        assert_eq!(
            chinese,
            [
                "没有待你处理的事",
                "1 个请求待你处理",
                "2 个请求待你处理",
                "11 个请求待你处理"
            ]
        );
    }
}
