//! A formula's parts: their ids, the fragments that join the part before them, the parts that
//! split a term, and each part converted to Typst.

use serde_json::{json, Value};

/// The syntax a job's sources are written in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Syntax {
    LatexMath,
    LatexText,
    TypstMath,
    Typst,
}

impl Syntax {
    pub fn of(name: &str) -> Option<Self> {
        Some(match name {
            "latex_math" => Self::LatexMath,
            "latex_text" => Self::LatexText,
            "typst_math" => Self::TypstMath,
            "typst" => Self::Typst,
            _ => return None,
        })
    }

    pub fn is_math(self) -> bool {
        matches!(self, Self::LatexMath | Self::TypstMath)
    }

    fn is_latex(self) -> bool {
        matches!(self, Self::LatexMath | Self::LatexText)
    }
}

/// One part as typeset: its source, its id, the byte at which each of its pieces starts in
/// the job's source (a joined fragment is a piece of its own), and its code in Typst.
#[derive(Clone, Debug)]
pub struct Part {
    pub source: String,
    pub id: String,
    pieces: Vec<(usize, usize)>,
    pub code: String,
}

/// An issue that stops the job, named as the design names it.
#[derive(Debug, PartialEq)]
pub struct Issue(pub Value);

/// A part once fragments have joined it: its source, its own id, and where each of its pieces
/// starts, in the part and in the job's source.
type Joined = (String, Option<String>, Vec<(usize, usize)>);

/// A part as given: its source and its own id, if any.
pub struct Given {
    pub source: String,
    pub id: Option<String>,
}

/// `t-` and the source with each byte outside A-Z, a-z and 0-9 written as `_` and two hex digits.
pub fn id_of(source: &str) -> String {
    let mut id = String::from("t-");
    for b in source.bytes() {
        if b.is_ascii_alphanumeric() {
            id.push(b as char);
        } else {
            id.push_str(&format!("_{b:02x}"));
        }
    }
    id
}

/// The job's source: its parts' sources joined by one space.
pub fn source_of(given: &[Given]) -> String {
    given
        .iter()
        .map(|g| g.source.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The parts, with fragments joined to the part before them, ids given, and each converted.
pub fn parts(
    given: &[Given],
    syntax: Syntax,
    macros: &[String],
) -> Result<Vec<Part>, Result<Issue, String>> {
    if given.is_empty() {
        return Err(Err("a typeset job takes at least one part".into()));
    }
    // Join each fragment (a source that opens with ^, _ or ') to the part before it.
    let mut at = 0;
    let mut joined: Vec<Joined> = Vec::new();
    for g in given {
        if g.source.trim().is_empty() {
            return Err(Err("a part's source is empty".into()));
        }
        let fragment = syntax.is_math() && g.source.trim_start().starts_with(['^', '_', '\'']);
        match joined.last_mut() {
            Some((source, _, pieces)) if fragment => {
                pieces.push((source.len(), at));
                source.push_str(&g.source);
            }
            _ => joined.push((g.source.clone(), g.id.clone(), vec![(0, at)])),
        }
        at += g.source.len() + 1;
    }
    apart(&joined, syntax).map_err(Ok)?;
    // Ids: a part's own, else from its source, a repeat taking .2, .3 in reading order.
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::with_capacity(joined.len());
    for (source, own, pieces) in joined {
        let id = match own {
            Some(id) => id,
            None => {
                let base = id_of(&source);
                let n = seen.iter().filter(|s| **s == source).count();
                seen.push(source.clone());
                if n == 0 {
                    base
                } else {
                    format!("{base}.{}", n + 1)
                }
            }
        };
        if out.iter().any(|p: &Part| p.id == id) {
            return Err(Err(format!(
                "two parts of one formula would both be {id}; give one of them its own id"
            )));
        }
        let code = convert(&source, syntax, macros).map_err(|e| match e {
            Converted::Unknown(command, range) => {
                let at = |i: usize| pieces.iter().rev().find(|(s, _)| *s <= i).map_or(i, |(s, o)| o + (i - s));
                Ok(Issue(json!({"code": "typeset.unknown_command", "command": command, "at": [at(range.0), at(range.0) + (range.1 - range.0)]})))
            }
            Converted::Failed(why) => Err(why),
        })?;
        out.push(Part {
            source,
            id,
            pieces,
            code,
        });
    }
    Ok(out)
}

impl Part {
    /// Where the part's first piece starts in the job's source.
    pub fn start(&self) -> usize {
        self.pieces[0].1
    }
}

/// Parts that only close together: the first run whose braces, environments or `\left`…`\right`
/// open in one part and close in a later one.
fn apart(parts: &[Joined], syntax: Syntax) -> Result<(), Issue> {
    let mut depth = 0i64;
    let mut run: Option<usize> = None;
    for (i, (source, _, _)) in parts.iter().enumerate() {
        let (low, end) = if syntax.is_latex() {
            latex_depth(source)
        } else {
            typst_depth(source)
        };
        if run.is_none() && (low < 0 || end != 0) {
            run = Some(i);
        }
        depth += end;
        if let Some(first) = run {
            if depth <= 0 || i + 1 == parts.len() {
                let names: Vec<&str> = parts[first..=i]
                    .iter()
                    .map(|(s, _, _)| s.as_str())
                    .collect();
                if names.len() > 1 || depth != 0 || low < 0 {
                    return Err(Issue(
                        json!({"code": "typeset.parts_apart", "parts": names}),
                    ));
                }
                run = None;
                depth = 0;
            }
        }
    }
    Ok(())
}

/// The lowest depth a LaTeX source reaches and the depth it ends at, counting `{`…`}`,
/// `\begin`…`\end` and `\left`…`\right`; escaped braces and comments don't count.
fn latex_depth(source: &str) -> (i64, i64) {
    let b = source.as_bytes();
    let (mut depth, mut low, mut i) = (0i64, 0i64, 0);
    while i < b.len() {
        match b[i] {
            b'%' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'\\' => {
                let start = i + 1;
                let mut j = start;
                while j < b.len() && b[j].is_ascii_alphabetic() {
                    j += 1;
                }
                match &source[start..j] {
                    "begin" | "left" => depth += 1,
                    "end" | "right" => depth -= 1,
                    _ => {}
                }
                // A one-character command such as \{ or \\ is skipped whole.
                i = if j == start { start + 1 } else { j };
                low = low.min(depth);
                continue;
            }
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        low = low.min(depth);
        i += 1;
    }
    (low, depth)
}

/// The same for Typst: brackets and parentheses of calls, outside strings.
fn typst_depth(source: &str) -> (i64, i64) {
    let (mut depth, mut low, mut string, mut escaped) = (0i64, 0i64, false, false);
    for c in source.chars() {
        if string {
            match (c, escaped) {
                ('\\', false) => escaped = true,
                ('"', false) => string = false,
                _ => escaped = false,
            }
            continue;
        }
        match c {
            '"' => string = true,
            '[' | '{' => depth += 1,
            ']' | '}' => depth -= 1,
            _ => {}
        }
        low = low.min(depth);
    }
    (low, depth)
}

enum Converted {
    Unknown(String, (usize, usize)),
    Failed(String),
}

/// A part's code in Typst: LaTeX through mitex, with the job's macros before it; Typst as written.
fn convert(source: &str, syntax: Syntax, macros: &[String]) -> Result<String, Converted> {
    if !syntax.is_latex() {
        return Ok(source.to_owned());
    }
    let mut text = String::new();
    for m in macros {
        text.push_str(m);
        text.push('\n');
    }
    text.push_str(source);
    let converted = match syntax {
        Syntax::LatexMath => mitex::convert_math(&text, None),
        _ => mitex::convert_text(&text, None),
    };
    converted.map_err(|why| {
        let bare = why.strip_prefix("error: ").unwrap_or(&why);
        let unknown = bare
            .strip_prefix("unknown command: ")
            .map(|c| (c.to_owned(), c.to_owned()));
        let env = bare
            .strip_prefix("unknown environment: \\")
            .map(|e| (format!("\\begin{{{e}}}"), format!("\\begin{{{e}}}")));
        match unknown.or(env) {
            Some((command, needle)) => match find_command(source, &needle) {
                Some(at) => Converted::Unknown(command, (at, at + needle.len())),
                None => Converted::Failed(format!("{why}, in the job's macros")),
            },
            None => Converted::Failed(why),
        }
    })
}

/// Where a command first stands whole in a source: not followed by another letter.
fn find_command(source: &str, command: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = source[from..].find(command) {
        let at = from + i;
        let next = source.as_bytes().get(at + command.len());
        if command.ends_with('}') || !next.is_some_and(|b| b.is_ascii_alphabetic()) {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn given(sources: &[&str]) -> Vec<Given> {
        sources
            .iter()
            .map(|s| Given {
                source: (*s).into(),
                id: None,
            })
            .collect()
    }

    #[test]
    fn ids_come_from_the_source() {
        assert_eq!(id_of("a^2"), "t-a_5e2");
        let p = parts(&given(&["a^2", "+", "a^2"]), Syntax::LatexMath, &[]).unwrap();
        assert_eq!(
            p.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            ["t-a_5e2", "t-_2b", "t-a_5e2.2"]
        );
    }

    #[test]
    fn a_fragment_joins_the_part_before_it() {
        let p = parts(&given(&["a", "^2", "+", "b"]), Syntax::LatexMath, &[]).unwrap();
        assert_eq!(
            p.iter().map(|p| p.source.as_str()).collect::<Vec<_>>(),
            ["a^2", "+", "b"]
        );
    }

    #[test]
    fn parts_that_split_a_term_are_apart() {
        let e = parts(&given(&["x", "e^{i", "\\pi}"]), Syntax::LatexMath, &[])
            .unwrap_err()
            .unwrap();
        assert_eq!(
            e.0,
            json!({"code": "typeset.parts_apart", "parts": ["e^{i", "\\pi}"]})
        );
        let e = parts(
            &given(&["\\left(", "x", "\\right)"]),
            Syntax::LatexMath,
            &[],
        )
        .unwrap_err()
        .unwrap();
        assert_eq!(e.0["parts"], json!(["\\left(", "x", "\\right)"]));
        assert!(parts(&given(&["\\{", "x", "\\}"]), Syntax::LatexMath, &[]).is_ok());
    }

    #[test]
    fn an_unknown_command_is_named_with_its_bytes_in_the_job_source() {
        let e = parts(&given(&["\\ce{H2O}"]), Syntax::LatexMath, &[])
            .unwrap_err()
            .unwrap();
        assert_eq!(
            e.0,
            json!({"code": "typeset.unknown_command", "command": "\\ce", "at": [0, 3]})
        );
        let e = parts(&given(&["x", "+", "\\ce{H2O}"]), Syntax::LatexMath, &[])
            .unwrap_err()
            .unwrap();
        assert_eq!(e.0["at"], json!([4, 7]));
    }
}
