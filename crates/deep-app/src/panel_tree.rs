//! Issue #358: the element tree a panel host sends, per invalidation, as gpui-shell's published text of a snapshot
//! (`RenderSnapshot::debug_tree`, the only public form it has). The host's panel is untrusted, so parsing is total:
//! anything this can't read is an error, never a guess.

use serde_json::{json, Value};

/// One recorded call on a node: `.w[Number(90.0)]` has the name `w` and the argument text `Number(90.0)`.
#[derive(Clone, Debug, PartialEq)]
pub struct Op {
    /// Written `.name`: it styles the node. A `:name` call is behavior, such as a click's callback, which stays in the host.
    pub style: bool,
    pub name: String,
    pub args: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Node {
    pub kind: String,
    /// A text node's text, or a button's id.
    pub label: Option<String>,
    pub ops: Vec<Op>,
    pub children: Vec<Node>,
}

impl Node {
    /// Every node, parents first: the order a layout's bounds are recorded in.
    pub fn count(&self) -> usize {
        1 + self.children.iter().map(Node::count).sum::<usize>()
    }

    /// The node as JSON, with the bounds `bounds` holds for it in that order, if any.
    pub fn to_json(&self, bounds: &[Option<[f64; 4]>]) -> Value {
        self.json_at(bounds, &mut 0)
    }

    fn json_at(&self, bounds: &[Option<[f64; 4]>], at: &mut usize) -> Value {
        let mine = bounds.get(*at).copied().flatten();
        *at += 1;
        let children: Vec<Value> = self
            .children
            .iter()
            .map(|child| child.json_at(bounds, at))
            .collect();
        let mut node = json!({ "kind": self.kind, "children": children });
        if self.kind == "text" {
            node["text"] = json!(self.label.clone().unwrap_or_default());
        }
        if let Some(rect) = mine {
            node["bounds"] = json!(rect);
        }
        node
    }
}

/// How deep and how large a tree may be: what walks it recurses, in the app, so a hostile tree mustn't take it down.
const MAX_DEPTH: usize = 128;
const MAX_NODES: usize = 1 << 16;

/// Parses a snapshot's text: one node a line, two spaces of indent a level.
pub fn parse(text: &str) -> Result<Node, String> {
    let mut stack: Vec<(usize, Node)> = Vec::new();
    for (at, line) in text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
    {
        if at >= MAX_NODES {
            return Err(format!("a tree of over {MAX_NODES} nodes"));
        }
        let body = line.trim_start_matches(' ');
        let indent = line.len() - body.len();
        if indent % 2 != 0 {
            return Err(format!("odd indent: {line:?}"));
        }
        let depth = indent / 2;
        if depth > MAX_DEPTH {
            return Err(format!("a tree over {MAX_DEPTH} levels deep"));
        }
        let node = parse_line(body)?;
        if depth > stack.len() || (depth == 0 && !stack.is_empty()) {
            return Err(format!("a node out of place: {line:?}"));
        }
        while stack.len() > depth {
            fold(&mut stack);
        }
        stack.push((depth, node));
    }
    while stack.len() > 1 {
        fold(&mut stack);
    }
    stack
        .pop()
        .map(|(_, root)| root)
        .ok_or_else(|| "an empty tree".into())
}

fn fold(stack: &mut Vec<(usize, Node)>) {
    let (_, child) = stack.pop().expect("fold has a node to fold");
    stack
        .last_mut()
        .expect("depth 0 is never folded")
        .1
        .children
        .push(child);
}

fn parse_line(line: &str) -> Result<Node, String> {
    let (kind, mut rest) = line.split_once(' ').unwrap_or((line, ""));
    let mut node = Node {
        kind: kind.to_owned(),
        ..Node::default()
    };
    loop {
        rest = rest.trim_start();
        let Some(first) = rest.chars().next() else {
            return Ok(node);
        };
        match first {
            '"' => {
                let (label, after) = string(rest)?;
                node.label = Some(label);
                rest = after;
            }
            // Which script handle an input is: the host's, and nothing this draws.
            '#' => {
                let digits = rest[1..].find(|c: char| !c.is_ascii_digit());
                rest = digits.map_or("", |at| &rest[at + 1..]);
            }
            '.' | ':' => {
                let name_end = rest[1..]
                    .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .map_or(rest.len(), |at| at + 1);
                let name = rest[1..name_end].to_owned();
                let (args, after) = arguments(&rest[name_end..])?;
                node.ops.push(Op {
                    style: first == '.',
                    name,
                    args,
                });
                rest = after;
            }
            _ => return Err(format!("can't read {rest:?}")),
        }
    }
}

/// A Rust-debug string at the start of `text`, and what follows it.
fn string(text: &str) -> Result<(String, &str), String> {
    let mut out = String::new();
    let mut chars = text.char_indices().skip(1);
    while let Some((at, c)) = chars.next() {
        match c {
            '"' => return Ok((out, &text[at + 1..])),
            '\\' => match chars.next().map(|(_, escaped)| escaped) {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('0') => out.push('\0'),
                Some('u') => {
                    let mut digits = String::new();
                    for (_, digit) in chars.by_ref() {
                        match digit {
                            '{' => {}
                            '}' => break,
                            other => digits.push(other),
                        }
                    }
                    let code = u32::from_str_radix(&digits, 16)
                        .map_err(|_| format!("a bad escape in {text:?}"))?;
                    out.push(
                        char::from_u32(code).ok_or_else(|| format!("a bad escape in {text:?}"))?,
                    );
                }
                Some(other) => out.push(other),
                None => break,
            },
            other => out.push(other),
        }
    }
    Err(format!("an unclosed string: {text:?}"))
}

/// A call's bracketed arguments at the start of `text`, if any, and what follows them.
fn arguments(text: &str) -> Result<(String, &str), String> {
    if !text.starts_with(['[', '(']) {
        return Ok((String::new(), text));
    }
    let mut depth = 0usize;
    let mut quoted = false;
    let mut escaped = false;
    for (at, c) in text.char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            '[' | '(' | '{' if !quoted => depth += 1,
            ']' | ')' | '}' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    return Ok((text[1..at].to_owned(), &text[at + 1..]));
                }
            }
            _ => {}
        }
    }
    Err(format!("unclosed arguments: {text:?}"))
}

/// The first number in a call's arguments, as `Number(90.0)` writes it.
pub fn number(args: &str) -> Option<f32> {
    args.strip_prefix("Number(")?
        .split(')')
        .next()?
        .parse()
        .ok()
        .filter(|value: &f32| value.is_finite())
}

/// A `#rrggbb` color as a number, and nothing else.
pub fn color(args: &str) -> Option<u32> {
    let hex = text_arg(args)?;
    let digits = hex.strip_prefix('#').filter(|digits| digits.len() == 6)?;
    u32::from_str_radix(digits, 16).ok()
}

/// The first string in a call's arguments, as `Str("#f8f8f8")` writes it.
pub fn text_arg(args: &str) -> Option<String> {
    string(args.strip_prefix("Str(")?)
        .ok()
        .map(|(value, _)| value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tree_reads_back_with_its_calls_text_and_nesting() {
        let tree = parse(
            "v_flex .size_full .w[Number(90.0)] .bg[Str(\"#f8f8f8\")] :on_click(fn)\n  text \"a \\\"b\\\" .w[1]\\n\"\n  button \"go\" .px[Number(1.0)]\n    text \"x\"\n  div\n",
        )
        .unwrap();
        assert_eq!(tree.kind, "v_flex");
        assert_eq!(tree.count(), 5);
        assert_eq!(number(&tree.ops[1].args), Some(90.));
        assert_eq!(text_arg(&tree.ops[2].args).as_deref(), Some("#f8f8f8"));
        assert_eq!(tree.ops[3].name, "on_click");
        assert!(tree.ops[0].style && !tree.ops[3].style);
        assert_eq!(color(&tree.ops[2].args), Some(0xf8f8f8));
        for bad in ["Str(\"red\")", "Str(\"#ffffff80\")", "Number(1.0)", ""] {
            assert_eq!(color(bad), None, "{bad}");
        }
        assert_eq!(tree.children[0].label.as_deref(), Some("a \"b\" .w[1]\n"));
        assert_eq!(tree.children[1].children[0].label.as_deref(), Some("x"));
    }

    #[test]
    fn what_it_cant_read_is_an_error() {
        let deep = |levels: usize| {
            (0..levels)
                .map(|level| format!("{}div\n", "  ".repeat(level)))
                .collect::<String>()
        };
        assert!(parse(&deep(MAX_DEPTH + 1)).is_ok());
        assert!(parse(&deep(MAX_DEPTH + 2)).is_err());
        let wide = format!("div\n{}", "  div\n".repeat(MAX_NODES));
        assert!(parse(&wide).is_err());
        for bad in ["Number(NaN)", "Number(inf)"] {
            assert_eq!(number(bad), None, "{bad}");
        }
        for bad in [
            "",
            "div\ndiv",
            "div\n    text \"x\"",
            "div ?",
            "text \"open",
            "div .w[Number(1",
        ] {
            assert!(parse(bad).is_err(), "{bad:?} parsed");
        }
    }
}
