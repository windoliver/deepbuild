//! The contract types deep-hook and the app read, generated from the JSON Schemas in
//! `packages/contracts/schemas` (the `generated` module), and the small runtime they build on: a JSON
//! value, its parser, its RFC 8785 text, and the helpers each generated `Contract` impl calls.

extern crate self as deep_contracts;

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

// Written by generateRust in @deepbuild/contracts; the acceptance tests hold it equal to the generator's output.
#[allow(clippy::all)]
#[rustfmt::skip]
pub mod generated;
pub use generated::roundtrip;

/// A JSON value. An object keeps its members in the order read; RFC 8785 text sorts them.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

/// A generated type's JSON form: decoding refuses a missing field, an unlisted field or a wrong type,
/// naming the field's JSON Pointer.
pub trait Contract: Sized {
    fn from_json(value: &Value, at: &str) -> Result<Self, String>;
    fn to_json(&self) -> Value;
}

/// A `seq`: on the wire a canonical decimal string from 0 to 2^63 - 1, in code a 64-bit integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Seq(i64);

impl Seq {
    /// None for a negative number, which no seq is.
    pub fn new(seq: i64) -> Option<Seq> {
        (seq >= 0).then_some(Seq(seq))
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

fn pointer(at: &str, key: &str) -> String {
    format!("{at}/{}", key.replace('~', "~0").replace('/', "~1"))
}

fn here(at: &str) -> &str {
    if at.is_empty() {
        "/"
    } else {
        at
    }
}

pub fn parse(text: &str) -> Result<Value, String> {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        at: 0,
    };
    parser.space();
    let value = parser.value(0)?;
    parser.space();
    if parser.at != parser.bytes.len() {
        return Err(parser.error("text after the value"));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn error(&self, what: &str) -> String {
        format!("not JSON: {what} at byte {}", self.at)
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.peek() != Some(byte) {
            return Err(self.error(&format!("expected {:?}", byte as char)));
        }
        self.at += 1;
        Ok(())
    }

    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > 256 {
            return Err(self.error("nesting too deep"));
        }
        match self.peek() {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => self.string().map(Value::String),
            Some(b't') => self.word("true", Value::Bool(true)),
            Some(b'f') => self.word("false", Value::Bool(false)),
            Some(b'n') => self.word("null", Value::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(self.error("expected a value")),
        }
    }

    fn word(&mut self, word: &str, value: Value) -> Result<Value, String> {
        if !self.bytes[self.at..].starts_with(word.as_bytes()) {
            return Err(self.error("expected a value"));
        }
        self.at += word.len();
        Ok(value)
    }

    fn digits(&mut self) -> usize {
        let start = self.at;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
        self.at - start
    }

    fn number(&mut self) -> Result<Value, String> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        if self.peek() == Some(b'0') {
            self.at += 1;
        } else if self.digits() == 0 {
            return Err(self.error("expected digits"));
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if self.digits() == 0 {
                return Err(self.error("expected digits after the point"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if self.digits() == 0 {
                return Err(self.error("expected exponent digits"));
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at]).map_err(|e| e.to_string())?;
        match text.parse::<f64>() {
            Ok(number) if number.is_finite() => Ok(Value::Number(number)),
            _ => Err(self.error("a number with no finite double")),
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let text = self
            .bytes
            .get(self.at..self.at + 4)
            .filter(|b| b.iter().all(u8::is_ascii_hexdigit))
            .and_then(|b| std::str::from_utf8(b).ok())
            .ok_or_else(|| self.error("a \\u escape without four hex digits"))?;
        let code = u32::from_str_radix(text, 16).map_err(|_| self.error("a bad \\u escape"))?;
        self.at += 4;
        Ok(code)
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = Vec::new();
        loop {
            let byte = self
                .peek()
                .ok_or_else(|| self.error("an unterminated string"))?;
            self.at += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let escape = self.peek().ok_or_else(|| self.error("a cut escape"))?;
                    self.at += 1;
                    let c = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let high = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&high) {
                                if !self.bytes[self.at..].starts_with(b"\\u") {
                                    return Err(self.error("a lone surrogate"));
                                }
                                self.at += 2;
                                let low = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&low) {
                                    return Err(self.error("a lone surrogate"));
                                }
                                0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)
                            } else {
                                high
                            };
                            char::from_u32(code).ok_or_else(|| self.error("a lone surrogate"))?
                        }
                        _ => return Err(self.error("an unknown escape")),
                    };
                    let mut buffer = [0; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
                }
                0x00..=0x1f => return Err(self.error("a control character in a string")),
                _ => out.push(byte),
            }
        }
        String::from_utf8(out).map_err(|e| e.to_string())
    }

    fn array(&mut self, depth: usize) -> Result<Value, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.space();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.space();
            items.push(self.value(depth + 1)?);
            self.space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(self.error("expected , or ]")),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, String> {
        self.expect(b'{')?;
        let mut members: Vec<(String, Value)> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        self.space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Value::Object(members));
        }
        loop {
            self.space();
            let key = self.string()?;
            self.space();
            self.expect(b':')?;
            self.space();
            let value = self.value(depth + 1)?;
            // As JSON.parse does, a repeated key keeps its last value.
            match index.get(&key) {
                Some(&i) => members[i].1 = value,
                None => {
                    index.insert(key.clone(), members.len());
                    members.push((key, value));
                }
            }
            self.space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Value::Object(members));
                }
                _ => return Err(self.error("expected , or }")),
            }
        }
    }
}

/// RFC 8785 (JCS) text: members sorted by their keys' UTF-16 code units, numbers in ECMAScript's form.
pub fn jcs(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&number(*n)),
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out);
            }
            out.push(']');
        }
        Value::Object(members) => {
            let mut sorted: Vec<&(String, Value)> = members.iter().collect();
            sorted.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            out.push('{');
            for (i, (key, item)) in sorted.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_value(item, out);
            }
            out.push('}');
        }
    }
}

fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn scientific(text: &str) -> (String, i32) {
    let (mantissa, exponent) = text.split_once('e').expect("LowerExp writes an exponent");
    let exponent = exponent
        .parse()
        .expect("LowerExp writes an integer exponent");
    (mantissa.chars().filter(|c| *c != '.').collect(), exponent)
}

/// The shortest digits that read back as `n`; of two equally near, the even one, as ECMAScript picks.
fn shortest(n: f64) -> (String, i32) {
    let (digits, exponent) = scientific(&format!("{n:e}"));
    let k = digits.len();
    if digits.as_bytes()[k - 1] % 2 == 0 || !format!("{n:.k$e}").contains("5e") {
        return (digits, exponent);
    }
    // A tie only when the exact value has one more digit, a 5; 1100 places hold any double exactly.
    let (exact, exact_exponent) = scientific(&format!("{n:.1100e}"));
    let (head, tail) = exact.split_at(k);
    if exact_exponent != exponent || !tail.starts_with('5') || tail[1..].bytes().any(|b| b != b'0')
    {
        return (digits, exponent);
    }
    let other = if digits == head {
        let mut up = head.as_bytes().to_vec();
        let mut i = k;
        while i > 0 && up[i - 1] == b'9' {
            up[i - 1] = b'0';
            i -= 1;
        }
        if i == 0 {
            return (digits, exponent);
        }
        up[i - 1] += 1;
        String::from_utf8(up).expect("ASCII digits")
    } else {
        head.to_string()
    };
    match format!("{}.{}e{exponent}", &other[..1], &other[1..]).parse::<f64>() {
        Ok(back) if back == n => (other, exponent),
        _ => (digits, exponent),
    }
}

/// ECMAScript's Number::toString for a finite double.
fn number(n: f64) -> String {
    if n == 0.0 {
        return "0".to_string();
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let (digits, exponent) = shortest(n.abs());
    let k = digits.len() as i32;
    let point = exponent + 1;
    let body = if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        format!(
            "{}.{}",
            &digits[..point as usize],
            &digits[point as usize..]
        )
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let e = point - 1;
        let mantissa = if k == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!("{mantissa}e{}{}", if e > 0 { "+" } else { "-" }, e.abs())
    };
    format!("{sign}{body}")
}

/// An object's members, refusing any member whose key the type doesn't list.
pub fn members<'a>(
    value: &'a Value,
    at: &str,
    listed: &[&str],
) -> Result<&'a [(String, Value)], String> {
    let Value::Object(members) = value else {
        return Err(format!("{}: expected an object", here(at)));
    };
    if let Some((key, _)) = members
        .iter()
        .find(|(key, _)| !listed.contains(&key.as_str()))
    {
        return Err(format!("{}: field is not listed", pointer(at, key)));
    }
    Ok(members)
}

pub fn required<T: Contract>(
    members: &[(String, Value)],
    at: &str,
    key: &str,
) -> Result<T, String> {
    let path = pointer(at, key);
    match members.iter().find(|(k, _)| k == key) {
        Some((_, value)) => T::from_json(value, &path),
        None => Err(format!("{path}: required field is missing")),
    }
}

pub fn optional<T: Contract>(
    members: &[(String, Value)],
    at: &str,
    key: &str,
) -> Result<Option<T>, String> {
    match members.iter().find(|(k, _)| k == key) {
        Some((_, value)) => T::from_json(value, &pointer(at, key)).map(Some),
        None => Ok(None),
    }
}

pub fn constant(value: &Value, at: &str, text: &str) -> Result<(), String> {
    if jcs(value) == jcs(&parse(text)?) {
        Ok(())
    } else {
        Err(format!("{}: expected {text}", here(at)))
    }
}

pub fn string<'a>(value: &'a Value, at: &str) -> Result<&'a str, String> {
    match value {
        Value::String(s) => Ok(s),
        _ => Err(format!("{}: expected a string", here(at))),
    }
}

/// A union's tag, as RFC 8785 text.
pub fn tag(value: &Value, at: &str, key: &str) -> Result<String, String> {
    let Value::Object(members) = value else {
        return Err(format!("{}: expected an object", here(at)));
    };
    match members.iter().find(|(k, _)| k == key) {
        Some((_, tag)) => Ok(jcs(tag)),
        None => Err(format!("{}: required field is missing", pointer(at, key))),
    }
}

impl Contract for Value {
    fn from_json(value: &Value, _: &str) -> Result<Self, String> {
        Ok(value.clone())
    }
    fn to_json(&self) -> Value {
        self.clone()
    }
}

impl Contract for bool {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            Value::Bool(b) => Ok(*b),
            _ => Err(format!("{}: expected a boolean", here(at))),
        }
    }
    fn to_json(&self) -> Value {
        Value::Bool(*self)
    }
}

impl Contract for i64 {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            // As the TypeScript validator does: an integer both languages hold exactly, within ±(2^53 - 1).
            Value::Number(n) if n.fract() == 0.0 && n.abs() <= 9007199254740991.0 => Ok(*n as i64),
            _ => Err(format!(
                "{}: expected an integer within ±(2^53 - 1)",
                here(at)
            )),
        }
    }
    fn to_json(&self) -> Value {
        Value::Number(*self as f64)
    }
}

impl Contract for f64 {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            Value::Number(n) => Ok(*n),
            _ => Err(format!("{}: expected a number", here(at))),
        }
    }
    fn to_json(&self) -> Value {
        Value::Number(*self)
    }
}

impl Contract for String {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        string(value, at).map(str::to_string)
    }
    fn to_json(&self) -> Value {
        Value::String(self.clone())
    }
}

impl Contract for Seq {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let canonical = |s: &str| {
            s == "0"
                || (s.starts_with(|c: char| ('1'..='9').contains(&c))
                    && s.bytes().all(|b| b.is_ascii_digit()))
        };
        match value {
            Value::String(s) if canonical(s) => s
                .parse::<i64>()
                .map(Seq)
                .map_err(|_| format!("{}: a seq runs to 9223372036854775807", here(at))),
            _ => Err(format!("{}: a seq is a canonical decimal string", here(at))),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(self.0.to_string())
    }
}

impl<T: Contract> Contract for Option<T> {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            Value::Null => Ok(None),
            _ => T::from_json(value, at).map(Some),
        }
    }
    fn to_json(&self) -> Value {
        self.as_ref().map_or(Value::Null, Contract::to_json)
    }
}

impl<T: Contract> Contract for Vec<T> {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            Value::Array(items) => items
                .iter()
                .enumerate()
                .map(|(i, item)| T::from_json(item, &format!("{at}/{i}")))
                .collect(),
            _ => Err(format!("{}: expected an array", here(at))),
        }
    }
    fn to_json(&self) -> Value {
        Value::Array(self.iter().map(Contract::to_json).collect())
    }
}

impl<T: Contract> Contract for BTreeMap<String, T> {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match value {
            Value::Object(members) => members
                .iter()
                .map(|(key, item)| Ok((key.clone(), T::from_json(item, &pointer(at, key))?)))
                .collect(),
            _ => Err(format!("{}: expected an object", here(at))),
        }
    }
    fn to_json(&self) -> Value {
        Value::Object(
            self.iter()
                .map(|(key, item)| (key.clone(), item.to_json()))
                .collect(),
        )
    }
}

/// One step of a schema pattern's program, which `@deepbuild/contracts` compiles from the pattern: a
/// class of code point ranges, a fork, a jump, or the match.
#[derive(Debug)]
pub enum Inst {
    Char(&'static [(u32, u32)]),
    Split(usize, usize),
    Jmp(usize),
    Match,
}

/// Whether a pattern's program matches all of `text`. A Pike VM: it runs every thread in step over the
/// code points, so it takes time linear in the text whatever the pattern.
pub fn matches(program: &[Inst], text: &str) -> bool {
    // seen[pc] is the step a thread last reached pc in, so each step runs each pc once.
    let mut seen = vec![usize::MAX; program.len()];
    let mut current = Vec::new();
    let mut next = Vec::new();
    let add = |list: &mut Vec<usize>, seen: &mut [usize], start: usize, step: usize| {
        let mut stack = vec![start];
        while let Some(pc) = stack.pop() {
            if seen[pc] == step {
                continue;
            }
            seen[pc] = step;
            match program[pc] {
                Inst::Jmp(to) => stack.push(to),
                Inst::Split(x, y) => {
                    stack.push(y);
                    stack.push(x);
                }
                _ => list.push(pc),
            }
        }
    };
    add(&mut current, &mut seen, 0, 0);
    for (step, c) in text.chars().enumerate() {
        next.clear();
        for &pc in &current {
            if let Inst::Char(ranges) = program[pc] {
                if ranges
                    .iter()
                    .any(|&(lo, hi)| (lo..=hi).contains(&(c as u32)))
                {
                    add(&mut next, &mut seen, pc + 1, step + 1);
                }
            }
        }
        std::mem::swap(&mut current, &mut next);
        if current.is_empty() {
            return false;
        }
    }
    current.iter().any(|&pc| matches!(program[pc], Inst::Match))
}

/// A listed string format the Rust types check; `seq` is the `Seq` type's own.
#[derive(Debug)]
pub enum Format {
    Ulid,
}

/// What a schema says of a value beyond its type: a string's length, format and pattern, a number's range,
/// an array's length and items, a map's keys and values. A record, a union, an enum and a constant check
/// themselves when they decode.
#[derive(Debug)]
pub enum Rule {
    String {
        min: Option<usize>,
        max: Option<usize>,
        format: Option<Format>,
        pattern: Option<&'static [Inst]>,
    },
    Number {
        min: Option<f64>,
        max: Option<f64>,
    },
    Array {
        min: Option<usize>,
        max: Option<usize>,
        items: Option<&'static Rule>,
    },
    Map {
        keys: &'static [Inst],
        values: Option<&'static Rule>,
    },
    Nullable(&'static Rule),
}

fn ulid(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 26
        && (b'0'..=b'7').contains(&bytes[0])
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_digit() || (b.is_ascii_uppercase() && !b"ILOU".contains(b)))
}

/// Refuses a value its rule refuses, naming its JSON Pointer. A value of the wrong type passes here and is
/// refused when it decodes.
pub fn check(value: &Value, at: &str, rule: &Rule) -> Result<(), String> {
    let refused = |what: &str| Err(format!("{}: {what}", here(at)));
    match (rule, value) {
        (Rule::Nullable(_), Value::Null) => Ok(()),
        (Rule::Nullable(inner), _) => check(value, at, inner),
        (
            Rule::String {
                min,
                max,
                format,
                pattern,
            },
            Value::String(s),
        ) => {
            if matches!(format, Some(Format::Ulid)) && !ulid(s) {
                return refused("not a ulid");
            }
            if pattern.is_some_and(|p| !matches(p, s)) {
                return refused("does not match the pattern");
            }
            let length = s.chars().count();
            if min.is_some_and(|m| length < m) || max.is_some_and(|m| length > m) {
                return refused("length is out of range");
            }
            Ok(())
        }
        (Rule::Number { min, max }, Value::Number(n)) => {
            if min.is_some_and(|m| *n < m) || max.is_some_and(|m| *n > m) {
                return refused("out of range");
            }
            Ok(())
        }
        (Rule::Array { min, max, items }, Value::Array(values)) => {
            if min.is_some_and(|m| values.len() < m) || max.is_some_and(|m| values.len() > m) {
                return refused("item count is out of range");
            }
            match items {
                Some(rule) => values
                    .iter()
                    .enumerate()
                    .try_for_each(|(i, item)| check(item, &format!("{at}/{i}"), rule)),
                None => Ok(()),
            }
        }
        (Rule::Map { keys, values }, Value::Object(members)) => {
            members.iter().try_for_each(|(key, item)| {
                if !matches(keys, key) {
                    return Err(format!(
                        "{}: key does not match the pattern",
                        pointer(at, key)
                    ));
                }
                values.map_or(Ok(()), |rule| check(item, &pointer(at, key), rule))
            })
        }
        _ => Ok(()),
    }
}

/// Checks a record's member against its rule, when the record has it.
pub fn check_member(
    members: &[(String, Value)],
    at: &str,
    key: &str,
    rule: &Rule,
) -> Result<(), String> {
    match members.iter().find(|(k, _)| k == key) {
        Some((_, value)) => check(value, &pointer(at, key), rule),
        None => Ok(()),
    }
}
