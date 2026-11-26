//! Issue #3233: what `panel@1` holds from revision 2, read off the tree a panel's script builds, never off its source.
//! An element that takes a press has a name; text whose color the panel set clears the look's ink floor on the
//! nearest fill under it, the panel's or the look's; and every press can take keyboard focus, where Enter or Space
//! run it once. A panel whose installer recorded an earlier revision beside its script still loads, and what this
//! revision would refuse in it is a reading.
//!
//! Two things the kit's rules name are not read here yet. A text field's name: a tree carries a field's handle and
//! not its placeholder, so a named field would read nameless. And text on a fill the panel set whose color it left
//! to the app: which ink that is read in is not settled.

use std::path::Path;
use std::sync::OnceLock;

use gpui_kit::{App, Entity};
use gpui_shell::ScriptView;

use crate::panel_tree::{color, number, parse, text_arg, Node};

/// The kit's revision: what a panel with no record of an earlier install is held to.
pub const REVISION: u64 = 2;

/// The installer's record of the kit revision a panel was installed against, beside its `main.js`.
pub const RECORD: &str = "panel-kit.json";

/// The look's ink floor.
const FLOOR: f64 = 4.5;

/// One thing a rule found: its code, the node by its id, or by its place in the tree when it has none, and the
/// finding in words, the code first.
pub struct Finding {
    pub code: &'static str,
    pub node: String,
    pub text: String,
}

/// The kit revision the panel in `dir` is held to: the one its installer recorded there, else the current one.
pub fn held_to(dir: &Path) -> u64 {
    std::fs::read_to_string(dir.join(RECORD))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .filter(|record| record["slot"] == "panel@1")
        .and_then(|record| record["revision"].as_u64())
        .filter(|revision| *revision >= 1)
        .unwrap_or(REVISION)
}

/// The shipped look's ground and raised, in light and in dark.
fn look() -> &'static [(&'static str, [u32; 2]); 2] {
    static LOOK: OnceLock<[(&'static str, [u32; 2]); 2]> = OnceLock::new();
    LOOK.get_or_init(|| {
        let look = deep_canvas_marks::modules::clean();
        [("light", &look.light), ("dark", &look.dark)].map(|(theme, palette)| {
            let role = |name: &str| {
                let [r, g, b] = palette[name];
                u32::from_be_bytes([0, r, g, b])
            };
            (theme, [role("ground"), role("raised")])
        })
    })
}

fn contrast(ink: u32, fill: u32) -> f64 {
    let rgb = |color: u32| {
        let [_, r, g, b] = color.to_be_bytes();
        [r, g, b]
    };
    deep_canvas_marks::look::contrast(rgb(ink), rgb(fill))
}

/// What the three rules find in `tree`, parents first.
pub fn findings(tree: &Node) -> Vec<Finding> {
    let mut walk = Walk {
        found: Vec::new(),
        path: Vec::new(),
        read: None,
    };
    walk.node(tree, None, None);
    walk.found
}

/// What they find in the tree `view` last built: nothing where it built none, or one this can't read.
pub fn of_view(view: &Entity<ScriptView>, cx: &App) -> Vec<Finding> {
    let tree = view
        .read(cx)
        .snapshot()
        .map(|snapshot| snapshot.debug_tree());
    tree.and_then(|text| parse(&text).ok())
        .map(|tree| findings(&tree))
        .unwrap_or_default()
}

/// All the text a node shows: its own, and the text under it.
fn texts<'a>(node: &'a Node, shown: &mut Vec<&'a str>) {
    if node.kind == "text" {
        shown.extend(node.label.as_deref());
    }
    for child in &node.children {
        texts(child, shown);
    }
}

/// One walk of a tree. Nothing is written for a node no rule faults: a tree is read on every update.
struct Walk {
    found: Vec<Finding>,
    /// Where the node in hand is: each child's place under its parent, from the root's.
    path: Vec<usize>,
    /// The last pair of colors read and its ratio: a panel's rows mostly draw one ink on one fill.
    read: Option<((u32, u32), f64)>,
}

impl Walk {
    fn ratio(&mut self, ink: u32, fill: u32) -> f64 {
        match self.read {
            Some((pair, ratio)) if pair == (ink, fill) => ratio,
            _ => {
                let ratio = contrast(ink, fill);
                self.read = Some(((ink, fill), ratio));
                ratio
            }
        }
    }

    /// The node by its id, or by its place in the tree when it has none, and as a finding's words name it.
    fn place(&self, node: &Node) -> (String, String) {
        // A button's own string is its id; a text node's is its text.
        let id = node
            .ops
            .iter()
            .find(|op| op.name == "id")
            .and_then(|op| text_arg(&op.args))
            .or_else(|| node.label.clone().filter(|_| node.kind != "text"));
        match id {
            // copy-exception: a refusal reason the kit and the loader report, never drawn
            Some(id) => (format!("the {} {id}", node.kind), id),
            None => {
                let path = self
                    .path
                    .iter()
                    .fold("0".to_owned(), |path, at| format!("{path}/{at}"));
                // copy-exception: a refusal reason the kit and the loader report, never drawn
                (format!("the {} at {path}", node.kind), path)
            }
        }
    }

    fn find(&mut self, code: &'static str, node: &Node, what: &str) {
        let (named, place) = self.place(node);
        self.found.push(Finding {
            code,
            node: place,
            text: format!("{code}: {named} {what}"),
        });
    }

    /// `ink` and `fill` are the text color and the fill the panel set at this node or above it, nearest first.
    fn node(&mut self, node: &Node, ink: Option<u32>, fill: Option<u32>) {
        let op = |name: &str| node.ops.iter().find(|op| op.name == name);
        let ink = op("text_color").and_then(|op| color(&op.args)).or(ink);
        let fill = op("bg").and_then(|op| color(&op.args)).or(fill);
        if node.kind == "Button" || op("on_click").is_some() {
            let labels: Vec<String> = ["label", "accessibility_label", "aria_label"]
                .iter()
                .filter_map(|name| op(name).and_then(|op| text_arg(&op.args)))
                .collect();
            let mut names: Vec<&str> = labels.iter().map(String::as_str).collect();
            texts(node, &mut names);
            names.retain(|name| !name.trim().is_empty());
            // A name that is only its kind's word, such as "button", says nothing.
            if names
                .iter()
                .all(|name| name.trim().eq_ignore_ascii_case(&node.kind))
            {
                let why = match names.first() {
                    // copy-exception: a refusal reason the kit and the loader report, never drawn
                    Some(word) => format!("takes a press and is named only {word:?}, its kind's word"),
                    // copy-exception: a refusal reason the kit and the loader report, never drawn
                    None => "takes a press and has no name: no text of its own or under it, and no label".to_owned(),
                };
                self.find("no_name", node, &why);
            }
            // The toolkit's button is a tab stop with a focus handle of its own; anything else takes focus by
            // tracking one, which DeepBuild's module makes a tab stop unless the script then refuses the stop.
            let refused = node.ops.iter().rev().find(|op| op.name == "tab_stop");
            let focus = node.kind == "Button"
                || op("track_focus").is_some_and(|op| number(&op.args).is_some())
                    && !refused.is_some_and(|op| op.args.contains("false"));
            if !focus {
                // copy-exception: a refusal reason the kit and the loader report, never drawn
                let why = "takes a press and can't take keyboard focus, so no key reaches it";
                self.find("pointer_only", node, why);
            }
        }
        let text = node
            .label
            .as_deref()
            .filter(|text| node.kind == "text" && !text.trim().is_empty());
        if let (Some(text), Some(ink)) = (text, ink) {
            // Where the panel set no fill under it, the fill is the look's in each theme; the worst pair decides.
            let worst = match fill {
                Some(fill) => Some((self.ratio(ink, fill), fill, None)),
                None => look()
                    .iter()
                    .flat_map(|(theme, [ground, raised])| {
                        [("ground", *ground), ("raised", *raised)]
                            .map(|(role, fill)| (contrast(ink, fill), fill, Some((role, *theme))))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0)),
            };
            if let Some((ratio, fill, look)) = worst.filter(|(ratio, ..)| *ratio < FLOOR) {
                let shown: String = text.chars().take(40).collect();
                let on = match look {
                    // copy-exception: a refusal reason the kit and the loader report, never drawn
                    Some((role, theme)) => format!(", the look's {role} in {theme},"),
                    None => String::new(),
                };
                let (_, place) = self.place(node);
                self.found.push(Finding {
                    code: "low_contrast",
                    node: place,
                    // copy-exception: a refusal reason the kit and the loader report, never drawn
                    text: format!("low_contrast: the text {shown:?} draws #{ink:06x} on #{fill:06x}{on} at {ratio:.2}:1, under {FLOOR}:1"),
                });
            }
        }
        for (at, child) in node.children.iter().enumerate() {
            self.path.push(at);
            self.node(child, ink, fill);
            self.path.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(tree: &str) -> Vec<(&'static str, String)> {
        findings(&parse(tree).unwrap())
            .into_iter()
            .map(|finding| (finding.code, finding.node))
            .collect()
    }

    #[test]
    fn a_press_needs_a_name_and_a_key_and_text_its_floor() {
        let press = "div :id[Str(\"go\")] :track_focus[Number(1.0)] :on_click(fn)";
        assert_eq!(codes(press), [("no_name", "go".to_owned())]);
        assert!(codes(&format!("{press}\n  text \"Refresh\"")).is_empty());
        assert_eq!(
            codes(&format!("{press}\n  text \"div\"")),
            [("no_name", "go".to_owned())]
        );
        assert_eq!(
            codes("div :id[Str(\"go\")] :on_click(fn)\n  text \"Refresh\""),
            [("pointer_only", "go".to_owned())]
        );
        let unstopped = "div :id[Str(\"go\")] :track_focus[Number(1.0)] :tab_stop[Bool(true)] :tab_stop[Bool(false)] :on_click(fn)\n  text \"Refresh\"";
        assert_eq!(codes(unstopped), [("pointer_only", "go".to_owned())]);
        assert_eq!(
            codes("Button \"button\"\n  text \"button\""),
            [("no_name", "button".to_owned())]
        );
        assert!(codes("Button \"save\" .accessibility_label[Str(\"Save\")]").is_empty());
        // Each color is built here, as a script builds one: no literal of the look's sits in the app's source.
        let hex = |pair: &str| format!("#{}", pair.repeat(3));
        let (white, faint, clear, pale) = (hex("ff"), hex("9a"), hex("59"), hex("cc"));
        let on = |ink: &str| {
            format!("div .bg[Str(\"{white}\")] .text_color[Str(\"{ink}\")]\n  text \"Status\"")
        };
        assert_eq!(codes(&on(&faint)), [("low_contrast", "0/0".to_owned())]);
        assert!(codes(&on(&clear)).is_empty());
        // Only the ink is the panel's: it fails on the look's light fills, whatever it reads on in dark.
        let inked = format!("div .text_color[Str(\"{pale}\")]\n  text \"Status\"");
        let found = findings(&parse(&inked).unwrap());
        assert!(
            found[0].text.contains("in light") && found[0].text.contains(&pale),
            "{}",
            found[0].text
        );
        // Only the fill is the panel's: not read yet.
        let filled = format!("div .bg[Str(\"{white}\")]\n  text \"Status\"");
        assert!(codes(&filled).is_empty());
        assert!(codes("div\n  text \"Status\"").is_empty());
    }
}
