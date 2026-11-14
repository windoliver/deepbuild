//! A structured field's forms (#1973; canvas primitives: Canvas module, Registry and seal:
//! registries): the shapes a `json` param's reader takes, declared beside the param in the form
//! language the canvas primitives write fields in, and parsed from that declaration. `deep_kinds`
//! prints each form from the parsed declaration, and the document check refuses a value no form
//! takes, naming the form it expected and the form it got, so neither can drift from it.
//!
//! The language:
//! - `a | b`: either form.
//! - `[x, y, z]`: exactly these slots, in order; a slot named by a word that is no type is a
//!   number (`x`), and `name: form` gives a slot its form. `[form]` is any number of one form,
//!   `[form] ≤ n` at most n.
//! - `{a, b: form, c?}`: an object; a field with no form takes any value, and an object may hold
//!   fields its form doesn't name. `{key → form}`: any keys, each value of the form.
//! - `word {fields}`: the word on its own, or `{word: {fields}}`.
//! - A number's unit or type (`m`, `deg`, `f32`, `u16`, `0..1`, `1 to 4`) is a number; `bool` is
//!   true or false; a name (`ID`, `item ID`, `role`, `text`, `<logic>.<name>`) is a string;
//!   `vec2`, `vec3`, `vec4`, `quat`, `linear RGB` and `polygon` are their vectors; any other word
//!   is that word itself, as is any word in backticks (`` `u8` ``, a string naming a type).
//! - `form ≤ n` bounds a list's length; `form (note)` carries a note printed with it.
//!
//! A null value is the field left out, so every form takes it.

use serde_json::Value;

/// One form of a structured value.
#[derive(Clone, Debug, PartialEq)]
pub enum Form {
    /// A number; its unit or type as declared (`m`, `u16`, `0..1`), empty for a named slot's.
    Number(String),
    Bool,
    /// A string; what it names as declared (`ID`, `role`).
    Text(String),
    /// Exactly this word.
    Word(String),
    /// `word {fields}`: the word, or an object holding only the word, whose value takes the body.
    Tagged(String, Box<Form>),
    /// `[a, b]`: exactly these slots, each with its name when the declaration gave one.
    Tuple(Vec<(Option<String>, Form)>),
    /// `[form]`, at most `max` long when bounded.
    List(Box<Form>, Option<usize>),
    /// `{a, b: form, c?}`.
    Object(Vec<Field>),
    /// `{key → form}`.
    Map(String, Box<Form>),
    /// `a | b`.
    OneOf(Vec<Form>),
    /// `form ≤ n` on anything but a list: printed, not checked.
    Bounded(Box<Form>, usize),
    /// `form (note)`.
    Noted(Box<Form>, String),
}

/// One field of an object form.
#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    pub name: String,
    pub optional: bool,
    /// `None`: the field takes any value.
    pub form: Option<Form>,
}

/// A declaration the language can't read: the text and why.
#[derive(Clone, Debug, PartialEq)]
pub struct Unreadable {
    pub text: String,
    pub why: String,
}

/// The vectors the language names (canvas primitives: Units and axes).
fn alias(name: &str) -> Option<&'static str> {
    Some(match name {
        "vec2" => "[x, y]",
        "vec3" => "[x, y, z]",
        "vec4" | "quat" => "[x, y, z, w]",
        "linear RGB" => "[r, g, b]",
        "polygon" => "[[x, y]]",
        _ => return None,
    })
}

/// The units and number types a number is declared in.
const NUMBERS: &[&str] = &[
    "m",
    "mm",
    "cm",
    "nm",
    "km",
    "deg",
    "rad",
    "s",
    "ms",
    "px",
    "u",
    "pt",
    "em",
    "f32",
    "f64",
    "number",
    "integer",
    "u8",
    "u16",
    "u32",
    "u64",
    "i8",
    "i16",
    "i32",
    "i64",
    "K",
    "lux",
    "lm",
    "lumens",
    "EV100",
    "ratio",
    "seed",
    "1/m",
    "Hz",
    "dB",
    "st",
    "fraction",
    "flick",
    "frame",
    "bytes",
    "fps",
    "px/s",
    "m/s",
    "deg/s",
    "index",
    "edge index",
    "count",
];

/// The names a string is declared by.
const TEXTS: &[&str] = &[
    "text",
    "string",
    "name",
    "role",
    "sha256",
    "channel",
    "collection",
    "grapheme",
    "path",
    "occurrence list",
    "material name",
    "named part",
    "font",
    "locale",
    "table",
    "column",
    "key",
    "time",
    "span",
    "hash",
    "url",
    "language",
    "expr",
    "glyph",
    "blend",
    "ease",
    "binding",
];

fn is_number_name(name: &str) -> bool {
    NUMBERS.contains(&name) || name.starts_with(|c: char| c.is_ascii_digit() || c == '-')
}

fn is_text_name(name: &str) -> bool {
    TEXTS.contains(&name) || name == "ID" || name.ends_with(" ID") || name.contains('<')
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Open(char),
    Close(char),
    Comma,
    Bar,
    Colon,
    Question,
    Arrow,
    AtMost,
    Note(String),
    Word(String),
    /// A word in backticks: the word itself, even where it names a type.
    Literal(String),
}

fn tokens(text: &str) -> Result<Vec<Tok>, String> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut Vec<Tok>| {
        if !word.is_empty() {
            out.push(Tok::Word(std::mem::take(word)));
        }
    };
    while let Some(c) = chars.next() {
        match c {
            '[' | '{' => {
                flush(&mut word, &mut out);
                out.push(Tok::Open(c));
            }
            ']' | '}' => {
                flush(&mut word, &mut out);
                out.push(Tok::Close(c));
            }
            ',' => {
                flush(&mut word, &mut out);
                out.push(Tok::Comma);
            }
            '|' => {
                flush(&mut word, &mut out);
                out.push(Tok::Bar);
            }
            ':' => {
                flush(&mut word, &mut out);
                out.push(Tok::Colon);
            }
            '?' => {
                flush(&mut word, &mut out);
                out.push(Tok::Question);
            }
            '→' => {
                flush(&mut word, &mut out);
                out.push(Tok::Arrow);
            }
            '≤' => {
                flush(&mut word, &mut out);
                out.push(Tok::AtMost);
            }
            '<' if chars.peek() == Some(&'=') => {
                chars.next();
                flush(&mut word, &mut out);
                out.push(Tok::AtMost);
            }
            '(' => {
                flush(&mut word, &mut out);
                let mut depth = 1;
                let mut note = String::new();
                for c in chars.by_ref() {
                    match c {
                        '(' => depth += 1,
                        ')' => depth -= 1,
                        _ => {}
                    }
                    if depth == 0 {
                        break;
                    }
                    note.push(c);
                }
                if depth != 0 {
                    return Err("a note's `(` is never closed".into());
                }
                out.push(Tok::Note(note.trim().to_string()));
            }
            '`' => {
                flush(&mut word, &mut out);
                let literal: String = chars.by_ref().take_while(|c| *c != '`').collect();
                out.push(Tok::Literal(literal));
            }
            c if c.is_whitespace() => flush(&mut word, &mut out),
            c => word.push(c),
        }
    }
    flush(&mut word, &mut out);
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at)
    }

    fn eat(&mut self, t: &Tok) -> bool {
        if self.peek() == Some(t) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, t: &Tok, what: &str) -> Result<(), String> {
        if self.eat(t) {
            Ok(())
        } else {
            Err(format!("expected {what} at token {}", self.at + 1))
        }
    }

    /// Words up to the next delimiter, joined by one space: `item ID`, `1 to 4`.
    fn name(&mut self) -> Option<String> {
        let mut words = Vec::new();
        while let Some(Tok::Word(w)) = self.peek() {
            words.push(w.clone());
            self.at += 1;
        }
        (!words.is_empty()).then(|| words.join(" "))
    }

    fn form(&mut self, slot: bool) -> Result<(Option<String>, Form), String> {
        let mut alts = vec![self.suffixed(slot)?];
        while self.eat(&Tok::Bar) {
            alts.push(self.suffixed(false)?);
        }
        if alts.len() == 1 {
            return Ok(alts.remove(0));
        }
        // A slot of alternatives is no named number: `[line | area]` is a list of words.
        let alts = alts
            .into_iter()
            .map(|(name, form)| match (name, form) {
                (Some(n), Form::Number(u)) if u.is_empty() => word_form(&n),
                (_, form) => Ok(form),
            })
            .collect::<Result<_, _>>()?;
        Ok((None, Form::OneOf(alts)))
    }

    /// A primary form with its bound and its note.
    fn suffixed(&mut self, slot: bool) -> Result<(Option<String>, Form), String> {
        let (name, mut form) = self.primary(slot)?;
        if self.eat(&Tok::AtMost) {
            let n = self
                .name()
                .and_then(|n| n.parse::<usize>().ok())
                .ok_or("`≤` takes a whole number")?;
            form = match form {
                Form::List(of, _) => Form::List(of, Some(n)),
                other => Form::Bounded(Box::new(other), n),
            };
        }
        if let Some(Tok::Note(note)) = self.peek().cloned() {
            self.at += 1;
            form = Form::Noted(Box::new(form), note);
        }
        Ok((name, form))
    }

    fn primary(&mut self, slot: bool) -> Result<(Option<String>, Form), String> {
        if self.eat(&Tok::Open('[')) {
            let mut items = vec![self.form(true)?];
            while self.eat(&Tok::Comma) {
                items.push(self.form(true)?);
            }
            self.expect(&Tok::Close(']'), "`]`")?;
            if items.len() == 1 {
                // One element is a list of it: a slot's bare word reads as a form again.
                let (name, form) = items.remove(0);
                let of = match (name, form) {
                    (Some(n), Form::Number(u)) if u.is_empty() => word_form(&n)?,
                    (_, f) => f,
                };
                return Ok((None, Form::List(Box::new(of), None)));
            }
            return Ok((None, Form::Tuple(items)));
        }
        if self.peek() == Some(&Tok::Open('{')) {
            return Ok((None, self.object()?));
        }
        if let Some(Tok::Literal(w)) = self.peek().cloned() {
            self.at += 1;
            return Ok((None, Form::Word(w)));
        }
        let name = self
            .name()
            .ok_or_else(|| format!("expected a form at token {}", self.at + 1))?;
        if self.peek() == Some(&Tok::Open('{')) && !name.contains(' ') && typed(&name).is_none() {
            let body = self.object()?;
            return Ok((None, Form::Tagged(name, Box::new(body))));
        }
        if slot && !name.contains(' ') && typed(&name).is_none() {
            // A slot's own name: a number, unless `name: form` gives it a form.
            if self.eat(&Tok::Colon) {
                let (_, form) = self.form(false)?;
                return Ok((Some(name), form));
            }
            return Ok((Some(name), Form::Number(String::new())));
        }
        Ok((None, word_form(&name)?))
    }

    fn object(&mut self) -> Result<Form, String> {
        self.expect(&Tok::Open('{'), "`{`")?;
        let mut fields = Vec::new();
        loop {
            let names = {
                let mut names = vec![self.name().ok_or("an object's field needs a name")?];
                while self.eat(&Tok::Bar) {
                    names.push(self.name().ok_or("an object's field needs a name")?);
                }
                names
            };
            if self.eat(&Tok::Arrow) {
                let (_, value) = self.form(false)?;
                self.expect(&Tok::Close('}'), "`}` after a map's `key → form`")?;
                return Ok(Form::Map(names.join(" | "), Box::new(value)));
            }
            let optional = self.eat(&Tok::Question) || names.len() > 1;
            let form = if self.eat(&Tok::Colon) {
                Some(self.form(false)?.1)
            } else {
                None
            };
            for name in names {
                fields.push(Field {
                    name,
                    optional,
                    form: form.clone(),
                });
            }
            if self.eat(&Tok::Close('}')) {
                return Ok(Form::Object(fields));
            }
            self.expect(&Tok::Comma, "`,` or `}` in an object")?;
        }
    }
}

/// What a name declares as a type: a vector, a number, a string or a flag; `None` for a word.
fn typed(name: &str) -> Option<Result<Form, String>> {
    if let Some(text) = alias(name) {
        return Some(parse(text).map_err(|u| u.why));
    }
    if name == "bool" {
        return Some(Ok(Form::Bool));
    }
    if is_number_name(name) {
        return Some(Ok(Form::Number(name.to_string())));
    }
    if is_text_name(name) {
        return Some(Ok(Form::Text(name.to_string())));
    }
    None
}

/// A name at a form's place: its type, or the word itself.
fn word_form(name: &str) -> Result<Form, String> {
    match typed(name) {
        Some(form) => form,
        None if name.contains(' ') => Err(format!("`{name}` is no type the form language names")),
        None => Ok(Form::Word(name.to_string())),
    }
}

/// Parses a declaration.
pub fn parse(text: &str) -> Result<Form, Unreadable> {
    let fail = |why: String| Unreadable {
        text: text.to_string(),
        why,
    };
    let toks = tokens(text).map_err(fail)?;
    let mut p = Parser { toks, at: 0 };
    let (_, form) = p.form(false).map_err(fail)?;
    if p.at != p.toks.len() {
        return Err(fail(format!("unread text from token {}", p.at + 1)));
    }
    Ok(form)
}

impl Form {
    /// The forms a field prints: one per alternative.
    pub fn alternatives(&self) -> Vec<&Form> {
        match self {
            Form::OneOf(alts) => alts.iter().flat_map(Form::alternatives).collect(),
            other => vec![other],
        }
    }

    /// The form as the language writes it.
    pub fn print(&self) -> String {
        match self {
            Form::Number(u) if u.is_empty() => "number".into(),
            Form::Word(w) if typed(w).is_some() => format!("`{w}`"),
            Form::Number(u) | Form::Text(u) | Form::Word(u) => u.clone(),
            Form::Bool => "bool".into(),
            Form::Tagged(w, body) => format!("{w} {}", body.print()),
            Form::Tuple(slots) => {
                let slots: Vec<String> = slots
                    .iter()
                    .map(|(name, form)| match (name, form) {
                        (Some(n), Form::Number(u)) if u.is_empty() => n.clone(),
                        (Some(n), f) => format!("{n}: {}", f.print()),
                        (None, f) => f.print(),
                    })
                    .collect();
                format!("[{}]", slots.join(", "))
            }
            Form::List(of, None) => format!("[{}]", of.print()),
            Form::List(of, Some(n)) => format!("[{}] ≤ {n}", of.print()),
            Form::Object(fields) => {
                let fields: Vec<String> = fields
                    .iter()
                    .map(|f| {
                        let q = if f.optional { "?" } else { "" };
                        match &f.form {
                            Some(form) => format!("{}{q}: {}", f.name, form.print()),
                            None => format!("{}{q}", f.name),
                        }
                    })
                    .collect();
                format!("{{{}}}", fields.join(", "))
            }
            Form::Map(key, value) => format!("{{{key} → {}}}", value.print()),
            Form::OneOf(alts) => alts.iter().map(Form::print).collect::<Vec<_>>().join(" | "),
            Form::Bounded(form, n) => format!("{} ≤ {n}", form.print()),
            Form::Noted(form, note) => format!("{} ({note})", form.print()),
        }
    }

    /// The form in words, for a refusal: `3 numbers in m`. `unit` is the field's.
    pub fn gist(&self, unit: &str) -> String {
        let in_unit = |u: &str| -> String {
            let u = if u.is_empty() { unit } else { u };
            if u.is_empty() || !is_unit(u) {
                String::new()
            } else {
                format!(" in {u}")
            }
        };
        match self {
            Form::Number(u) => format!("a number{}", in_unit(u)),
            Form::Bool => "true or false".into(),
            Form::Text(what) => format!("a string ({what})"),
            Form::Word(w) => format!("`{w}`"),
            Form::Tagged(w, body) => format!("`{w}` or {{{w}: {}}}", body.print()),
            Form::Tuple(slots) => {
                let units: Vec<&str> = slots
                    .iter()
                    .filter_map(|(_, f)| match f {
                        Form::Number(u) => Some(u.as_str()),
                        _ => None,
                    })
                    .collect();
                if units.len() == slots.len() && units.iter().all(|u| *u == units[0]) {
                    format!("{} numbers{}", slots.len(), in_unit(units[0]))
                } else {
                    format!("{} values, {}", slots.len(), self.print())
                }
            }
            Form::List(of, max) => {
                let most = max.map(|n| format!(" (at most {n})")).unwrap_or_default();
                format!("a list of {}{most}", of.gist(unit))
            }
            Form::Object(_) | Form::Map(..) => format!("an object {}", self.print()),
            Form::OneOf(alts) => alts
                .iter()
                .map(|a| a.gist(unit))
                .collect::<Vec<_>>()
                .join(" or "),
            Form::Bounded(form, _) | Form::Noted(form, _) => form.gist(unit),
        }
    }

    /// `None` when the form takes `v`; else what it got, in words, at the first place no form
    /// takes: `2 numbers`, `the string "x" at by_angle/angle`.
    pub fn miss(&self, v: &Value) -> Option<String> {
        self.missed(v).map(|(got, at)| {
            if at.is_empty() {
                got
            } else {
                let at: Vec<String> = at.into_iter().rev().collect();
                format!("{got} at {}", at.join("/"))
            }
        })
    }

    /// What `v` got and where, innermost place first.
    fn missed(&self, v: &Value) -> Option<(String, Vec<String>)> {
        if v.is_null() {
            return None;
        }
        let here = || Some((got(v), Vec::new()));
        let inside = |m: Option<(String, Vec<String>)>, at: String| {
            m.map(|(g, mut path)| {
                path.push(at);
                (g, path)
            })
        };
        match self {
            Form::Number(_) => {
                if v.is_number() {
                    None
                } else {
                    here()
                }
            }
            Form::Bool => {
                if v.is_boolean() {
                    None
                } else {
                    here()
                }
            }
            Form::Text(_) => {
                if v.is_string() {
                    None
                } else {
                    here()
                }
            }
            Form::Word(w) => {
                if v.as_str() == Some(w) {
                    None
                } else {
                    here()
                }
            }
            Form::Tagged(w, body) => {
                if v.as_str() == Some(w) {
                    return None;
                }
                match v.as_object() {
                    Some(o) if o.len() == 1 && o.contains_key(w) => {
                        inside(body.missed(&o[w]), w.clone())
                    }
                    _ => here(),
                }
            }
            Form::Tuple(slots) => match v.as_array() {
                Some(a) if a.len() == slots.len() => a
                    .iter()
                    .zip(slots)
                    .enumerate()
                    .find_map(|(i, (x, (_, f)))| inside(f.missed(x), i.to_string())),
                _ => here(),
            },
            Form::List(of, max) => match v.as_array() {
                Some(a) if max.is_some_and(|n| a.len() > n) => here(),
                Some(a) => a
                    .iter()
                    .enumerate()
                    .find_map(|(i, x)| inside(of.missed(x), i.to_string())),
                None => here(),
            },
            Form::Object(fields) => match v.as_object() {
                Some(o) => fields.iter().find_map(|f| {
                    let x = o.get(&f.name)?;
                    inside(f.form.as_ref()?.missed(x), f.name.clone())
                }),
                None => here(),
            },
            Form::Map(_, value) => match v.as_object() {
                Some(o) => o
                    .iter()
                    .find_map(|(k, x)| inside(value.missed(x), k.clone())),
                None => here(),
            },
            Form::OneOf(alts) => {
                if alts.iter().any(|a| a.missed(v).is_none()) {
                    return None;
                }
                // The one alternative of the value's own JSON type names where it went wrong.
                let same: Vec<&Form> = alts.iter().filter(|a| a.holds_type_of(v)).collect();
                match same.as_slice() {
                    [one] => one.missed(v),
                    _ => here(),
                }
            }
            Form::Bounded(form, _) | Form::Noted(form, _) => form.missed(v),
        }
    }

    /// Whether the form's values are of `v`'s JSON type.
    fn holds_type_of(&self, v: &Value) -> bool {
        match self {
            Form::Number(_) => v.is_number(),
            Form::Bool => v.is_boolean(),
            Form::Text(_) | Form::Word(_) => v.is_string(),
            Form::Tagged(..) => v.is_string() || v.is_object(),
            Form::Tuple(_) | Form::List(..) => v.is_array(),
            Form::Object(_) | Form::Map(..) => v.is_object(),
            Form::OneOf(alts) => alts.iter().any(|a| a.holds_type_of(v)),
            Form::Bounded(form, _) | Form::Noted(form, _) => form.holds_type_of(v),
        }
    }
}

/// Whether a declared number type is a unit a refusal names (`m`), not a type (`f32`).
fn is_unit(name: &str) -> bool {
    !matches!(
        name,
        "f32"
            | "f64"
            | "number"
            | "integer"
            | "u8"
            | "u16"
            | "u32"
            | "u64"
            | "i8"
            | "i16"
            | "i32"
            | "i64"
            | "ratio"
            | "seed"
            | "fraction"
            | "index"
            | "edge index"
            | "count"
    ) && !name.starts_with(|c: char| c.is_ascii_digit() || c == '-')
}

/// A value's form in words: `2 numbers`, `a string`, `an object with a, b`.
pub fn got(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(_) => "a number".into(),
        Value::String(s) => {
            let short: String = s.chars().take(24).collect();
            let more = if s.chars().count() > 24 { "…" } else { "" };
            format!("the string \"{short}{more}\"")
        }
        Value::Array(a) if !a.is_empty() && a.iter().all(Value::is_number) => {
            format!("{} number{}", a.len(), if a.len() == 1 { "" } else { "s" })
        }
        Value::Array(a) => format!("a list of {}", a.len()),
        Value::Object(o) if o.is_empty() => "an empty object".into(),
        Value::Object(o) => {
            let keys: Vec<&str> = o.keys().take(4).map(String::as_str).collect();
            let more = if o.len() > 4 { ", …" } else { "" };
            format!("an object with {}{more}", keys.join(", "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_vector_prints_its_slots_and_refuses_a_short_value_naming_both_forms() {
        let f = parse("vec3").unwrap();
        assert_eq!(f.print(), "[x, y, z]");
        assert_eq!(f.gist("m"), "3 numbers in m");
        assert_eq!(f.miss(&json!([1, 1, 1])), None);
        assert_eq!(f.miss(&json!([20, 20])).as_deref(), Some("2 numbers"));
    }

    #[test]
    fn alternatives_tags_lists_and_objects_read_and_print_as_declared() {
        let f = parse("smooth | flat | by_angle {angle: deg}").unwrap();
        let printed: Vec<String> = f.alternatives().iter().map(|a| a.print()).collect();
        assert_eq!(printed, ["smooth", "flat", "by_angle {angle: deg}"]);
        assert_eq!(f.miss(&json!("by_angle")), None);
        assert_eq!(f.miss(&json!({"by_angle": {"angle": 20}})), None);
        assert_eq!(
            f.miss(&json!({"by_angle": {"angle": "x"}})).as_deref(),
            Some("the string \"x\" at by_angle/angle")
        );
        assert!(f.miss(&json!("round")).is_some());
        let list = parse("[ID] ≤ 2").unwrap();
        assert_eq!(list.print(), "[ID] ≤ 2");
        assert!(list.miss(&json!(["a", "b", "c"])).is_some());
        let words = parse("[line | area]").unwrap();
        assert_eq!(words.print(), "[line | area]");
        assert_eq!(words.miss(&json!(["area", "line"])), None);
        assert!(words.miss(&json!([5])).is_some());
        let tuple = parse("[cols, rows: u16]").unwrap();
        assert_eq!(tuple.print(), "[cols, rows: u16]");
        assert_eq!(parse("{count, part?}").unwrap().print(), "{count, part?}");
        assert_eq!(parse("{name → f32}").unwrap().print(), "{name → f32}");
        assert_eq!(parse("[px] (each)").unwrap().print(), "[px] (each)");
        let words = parse("`bool` | `u8` | auto").unwrap();
        assert_eq!(words.print(), "`bool` | `u8` | auto");
        assert_eq!(words.miss(&json!("u8")), None);
        assert!(words.miss(&json!(8)).is_some());
    }

    #[test]
    fn a_multi_word_name_no_type_declares_is_unreadable() {
        assert!(parse("status binding").is_err());
        assert!(parse("[x, y").is_err());
    }
}
