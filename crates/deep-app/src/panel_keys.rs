//! Issue #358, behind the `panel-check` feature: state follows an element by key across a rebuild. `panel-keys` holds
//! one panel in a panel host and materializes each tree it sends. A panel's scroll, focus, field and folds live here,
//! in the app, under an identity for each element. `--match-by-position` is the planted wrong program: the one
//! difference is that an element's identity is its place among its siblings, not its key.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead as _, Write as _};

use serde_json::{json, Value};

use crate::panel_check::{unknown_element, Check, Host};
use crate::panel_tree::{parse, text_arg, Node, Op};

/// The text `fold` crosses as, since a host function can't make a node: key, header and body after this mark.
pub const FOLD_MARK: char = '\u{1}';

const WINDOW: &str = "1512x982";
const AREA: &str = "0,0,1512,982";
const PANEL_HEIGHT: f64 = 982.;

fn fold_parts(node: &Node) -> Option<(&str, &str, &str)> {
    let text = node.label.as_deref().filter(|_| node.kind == "text")?;
    let mut parts = text.strip_prefix(FOLD_MARK)?.split(FOLD_MARK);
    Some((parts.next()?, parts.next()?, parts.next()?))
}

fn key_of(node: &Node) -> Option<String> {
    let id = node.ops.iter().find(|op| op.name == "id");
    id.and_then(|op| text_arg(&op.args))
        .or_else(|| fold_parts(node).map(|(key, ..)| key.to_owned()))
}

/// All the text a drawn node shows.
fn shown(node: &Node) -> String {
    let own = node.label.clone().filter(|_| node.kind == "text");
    let below = node.children.iter().map(shown);
    own.into_iter().chain(below).collect()
}

fn scrolls(node: &Node) -> bool {
    node.ops.iter().any(|op| op.name == "overflow_y_scroll")
}

fn style(name: &str, args: String) -> Op {
    Op {
        style: true,
        name: name.to_owned(),
        args,
    }
}

fn text_node(text: String) -> Node {
    Node {
        kind: "text".to_owned(),
        label: Some(text),
        ..Node::default()
    }
}

#[derive(Default)]
struct Field {
    value: Vec<char>,
    caret: usize,
    composition: Option<String>,
}

#[derive(Clone)]
struct Scroll {
    anchor: String,
    offset: f64,
    /// How far into the anchor the list is scrolled.
    into: f64,
}

/// An element of the tree as this rebuild has it, by the identity state hangs on.
struct Entry {
    key: Option<String>,
    identity: String,
}

struct Keys {
    by_position: bool,
    tree: Node,
    /// Each node's box in the materialized tree, and the list's place and each of its rows' places in that order.
    bounds: Vec<Option<[f64; 4]>>,
    list_at: usize,
    rows_at: Vec<(usize, String)>,
    scroll: HashMap<String, Scroll>,
    focus: Option<String>,
    fields: HashMap<String, Field>,
    open: HashSet<String>,
    rebuilds: u64,
    failures: Vec<Value>,
    /// The kinds of state held across a rebuild: what a pass can speak for.
    held: HashSet<&'static str>,
    /// A command went unanswered, or a rebuild's tree never arrived.
    untold: bool,
    host_failed: bool,
    scrolled: bool,
}

impl Keys {
    /// The one place the two hosts differ.
    fn identity(&self, path: &str, key: Option<&String>) -> String {
        match key {
            Some(key) if !self.by_position => key.clone(),
            _ => path.to_owned(),
        }
    }

    fn entries(&self) -> HashMap<String, Entry> {
        fn walk(keys: &Keys, node: &Node, path: &str, found: &mut HashMap<String, Entry>) {
            let key = key_of(node);
            let identity = keys.identity(path, key.as_ref());
            found.insert(identity.clone(), Entry { key, identity });
            for (at, child) in node.children.iter().enumerate() {
                walk(keys, child, &format!("{path}/{at}"), found);
            }
        }
        let mut found = HashMap::new();
        walk(self, &self.tree, "", &mut found);
        found
    }

    fn identity_of_key(&self, key: &str) -> Option<String> {
        self.entries()
            .into_values()
            .find(|entry| entry.key.as_deref() == Some(key))
            .map(|entry| entry.identity)
    }

    fn key_at(&self, identity: &str) -> Option<String> {
        self.entries().remove(identity).and_then(|entry| entry.key)
    }

    /// The list, its identity and its path.
    fn list(&self) -> Option<(&Node, String, String)> {
        fn find<'a>(node: &'a Node, path: String) -> Option<(&'a Node, String)> {
            if scrolls(node) {
                return Some((node, path));
            }
            node.children
                .iter()
                .enumerate()
                .find_map(|(at, child)| find(child, format!("{path}/{at}")))
        }
        let (node, path) = find(&self.tree, String::new())?;
        Some((node, self.identity(&path, key_of(node).as_ref()), path))
    }

    /// The input's nearest keyed ancestor, by identity and key.
    fn input(&self) -> Option<(String, String)> {
        fn find(
            keys: &Keys,
            node: &Node,
            path: &str,
            wrapper: Option<(String, String)>,
        ) -> Option<(String, String)> {
            let wrapper = match key_of(node) {
                Some(key) => Some((keys.identity(path, Some(&key)), key)),
                None => wrapper,
            };
            if node.kind == "Input" {
                return wrapper;
            }
            node.children
                .iter()
                .enumerate()
                .find_map(|(at, child)| find(keys, child, &format!("{path}/{at}"), wrapper.clone()))
        }
        find(self, &self.tree, "", None)
    }

    /// The tree as it's drawn: a list's rows moved by its scroll, the field's text in its input, a fold as what it shows.
    fn drawn(
        &self,
        node: &Node,
        path: &str,
        places: &mut (usize, Vec<(usize, String)>),
        at: &mut usize,
    ) -> Node {
        let mut drawn = node.clone();
        let mine = *at;
        *at += 1;
        if let Some((key, header, body)) = fold_parts(node) {
            let identity = self.identity(path, Some(&key.to_owned()));
            drawn.kind = "v_flex".to_owned();
            drawn.label = None;
            let open = self.open.contains(&identity);
            drawn.children = std::iter::once(header)
                .chain(open.then_some(body))
                .map(|text| {
                    *at += 1;
                    text_node(text.to_owned())
                })
                .collect();
            return drawn;
        }
        if scrolls(node) {
            let identity = self.identity(path, key_of(node).as_ref());
            let offset = self
                .scroll
                .get(&identity)
                .map_or(0., |scroll| scroll.offset);
            drawn.ops.push(style("relative", String::new()));
            *at += 1;
            places.0 = mine;
            let mut children = Vec::with_capacity(node.children.len());
            for (child, row) in node.children.iter().enumerate() {
                let place = *at;
                let row = self.drawn(row, &format!("{path}/{child}"), places, at);
                places.1.push((place, shown(&row)));
                children.push(row);
            }
            drawn.children = vec![Node {
                kind: "v_flex".to_owned(),
                ops: vec![
                    style("absolute", String::new()),
                    style("left", "Number(0.0)".to_owned()),
                    style("top", format!("Number({:.1})", -offset)),
                ],
                children,
                ..Node::default()
            }];
            return drawn;
        }
        if node.kind == "Input" {
            let field = self
                .input()
                .and_then(|(identity, _)| self.fields.get(&identity));
            let text = field.map_or(String::new(), |field| field.value.iter().collect());
            *at += 1;
            drawn.children = vec![text_node(text)];
            return drawn;
        }
        drawn.children = node
            .children
            .iter()
            .enumerate()
            .map(|(child, node)| self.drawn(node, &format!("{path}/{child}"), places, at))
            .collect();
        drawn
    }

    fn lay_out(&mut self, check: &mut Check) -> Result<(), String> {
        let mut places = (0, Vec::new());
        let drawn = self.drawn(&self.tree, "", &mut places, &mut 0);
        self.bounds = check.lay_out(drawn)?;
        (self.list_at, self.rows_at) = places;
        let unmeasured = |at: &usize| !matches!(self.bounds.get(*at), Some(Some(_)));
        if self.list().is_some()
            && (unmeasured(&self.list_at) || self.rows_at.iter().any(|(at, _)| unmeasured(at)))
        {
            return Err("a row wasn't measured".to_owned());
        }
        Ok(())
    }

    /// Each row of the list: its identity, key, the text it shows, and the box it drew.
    fn rows(&self) -> Vec<(String, Option<String>, String, [f64; 4])> {
        let Some((list, _, path)) = self.list() else {
            return Vec::new();
        };
        let mut rows = Vec::with_capacity(list.children.len());
        for (index, row) in list.children.iter().enumerate() {
            let key = key_of(row);
            let identity = self.identity(&format!("{path}/{index}"), key.as_ref());
            let (at, text) = self.rows_at.get(index).cloned().unwrap_or_default();
            let bounds = self.bounds.get(at).copied().flatten();
            rows.push((identity, key, text, bounds.unwrap_or_default()));
        }
        rows
    }

    /// Where the list's row at `identity` sits below its first row.
    fn top_of(&self, identity: &str) -> Option<f64> {
        let rows = self.rows();
        let first = rows.first()?.3[1];
        let row = rows.iter().find(|row| row.0 == identity)?;
        Some(row.3[1] - first)
    }

    fn scroll_by(&mut self, element: &str, dy: f64, check: &mut Check) -> Result<(), String> {
        let (_, list, _) = self.list().ok_or("no list to scroll")?;
        let mine = self.identity_of_key(element);
        if mine.as_ref() != Some(&list) {
            return Err(format!("{element} isn't the list"));
        }
        let offset = self.scroll.get(&list).map_or(0., |scroll| scroll.offset) + dy;
        let rows = self.rows();
        let first = rows.first().ok_or("an empty list")?.3[1];
        let row = rows
            .iter()
            .rfind(|row| row.3[1] - first <= offset + 0.5)
            .ok_or("a scroll above the list")?;
        let into = offset - (row.3[1] - first);
        let anchor = row.0.clone();
        self.scrolled = true;
        self.scroll.insert(
            list,
            Scroll {
                anchor,
                offset,
                into,
            },
        );
        self.lay_out(check)
    }

    /// The tree a rebuild brought: its state found again by identity, a scroll by its anchor, and drawn. A list follows
    /// its first row until it's scrolled.
    fn take(&mut self, tree: Node, check: &mut Check) -> Result<(), String> {
        self.tree = tree;
        self.settle(check)
    }

    /// Lays the tree out with the anchor where it is now.
    fn settle(&mut self, check: &mut Check) -> Result<(), String> {
        self.lay_out(check)?;
        let Some((_, list, _)) = self.list() else {
            return Ok(());
        };
        let Some(scroll) = self.scroll.get(&list).cloned() else {
            if let Some(first) = self.rows().into_iter().next() {
                let scroll = Scroll {
                    anchor: first.0,
                    offset: 0.,
                    into: 0.,
                };
                self.scroll.insert(list, scroll);
            }
            return Ok(());
        };
        if let Some(top) = self.top_of(&scroll.anchor) {
            let offset = top + scroll.into;
            if (offset - scroll.offset).abs() > 0.5 {
                self.scroll.insert(list, Scroll { offset, ..scroll });
                self.lay_out(check)?;
            }
        }
        Ok(())
    }

    fn anchor_key(&self) -> Option<String> {
        let (_, list, _) = self.list()?;
        self.key_at(&self.scroll.get(&list)?.anchor)
    }

    fn into(&self) -> Option<f64> {
        let (_, list, _) = self.list()?;
        Some(self.scroll.get(&list)?.into)
    }

    fn focus_key(&self) -> Option<String> {
        self.focus.as_deref().and_then(|focus| self.key_at(focus))
    }

    fn open_folds(&self) -> Vec<String> {
        fn walk(keys: &Keys, node: &Node, path: &str, found: &mut Vec<String>) {
            if let Some((key, ..)) = fold_parts(node) {
                let identity = keys.identity(path, Some(&key.to_owned()));
                if keys.open.contains(&identity) {
                    found.push(key.to_owned());
                }
            }
            for (at, child) in node.children.iter().enumerate() {
                walk(keys, child, &format!("{path}/{at}"), found);
            }
        }
        let mut found = Vec::new();
        walk(self, &self.tree, "", &mut found);
        found.sort();
        found
    }

    fn field(&self) -> Option<(String, String, usize, Option<String>)> {
        let (identity, key) = self.input()?;
        let field = self.fields.get(&identity);
        Some((
            key,
            field.map_or(String::new(), |field| field.value.iter().collect()),
            field.map_or(0, |field| field.caret),
            field.and_then(|field| field.composition.clone()),
        ))
    }

    /// What the materialized tree holds now.
    fn state(&self, host_pid: u32) -> Result<Value, String> {
        let rows = self.rows();
        let (list, identity, _) = self.list().ok_or("no list in the tree")?;
        let offset = self
            .scroll
            .get(&identity)
            .map_or(0., |scroll| scroll.offset);
        let height = self
            .bounds
            .get(self.list_at)
            .copied()
            .flatten()
            .map_or(0., |list| list[3].min(PANEL_HEIGHT - list[1]));
        let first = rows.first().map_or(0., |row| row.3[1]);
        let visible: Vec<Value> = rows
            .iter()
            .filter(|row| {
                let top = row.3[1] - first;
                top < offset + height - 0.5 && top + row.3[3] > offset + 0.5
            })
            .map(|row| json!({ "key": row.1, "text": row.2 }))
            .collect();
        let field = self.field();
        Ok(json!({
            "ok": true,
            "host_pid": host_pid,
            "rebuilds": self.rebuilds,
            "row_count": list.children.len(),
            "scroll": { "anchor_key": self.anchor_key(), "offset_px": offset.round() as i64 },
            "visible": visible,
            "focus_key": self.focus_key(),
            "field": field.as_ref().map(|(key, value, caret, _)| json!({ "key": key, "value": value, "caret": caret })),
            "composition": field.as_ref().and_then(|(key, _, _, composition)| {
                composition.as_ref().map(|text| json!({ "key": key, "text": text }))
            }),
            "open_folds": self.open_folds(),
        }))
    }

    /// What must hold across a rebuild, by key: the check's own record of a host that lost it.
    fn snapshot(&self) -> [(&'static str, Option<String>, Value); 5] {
        let field = self.field();
        let element = field.as_ref().map(|(key, ..)| key.clone());
        [
            (
                "scroll",
                self.anchor_key(),
                json!([self.anchor_key(), self.into()]),
            ),
            ("focus", self.focus_key(), json!(self.focus_key())),
            (
                "caret",
                element
                    .clone()
                    .filter(|_| matches!(&field, Some((_, value, ..)) if !value.is_empty())),
                json!(field.as_ref().map(|field| (&field.1, field.2))),
            ),
            (
                "composition",
                element.filter(|_| matches!(&field, Some((.., Some(_))))),
                json!(field.as_ref().map(|field| field.3.clone())),
            ),
            (
                "fold",
                self.open_folds().first().cloned(),
                json!(self.open_folds()),
            ),
        ]
    }

    fn compare(&mut self, before: [(&'static str, Option<String>, Value); 5]) {
        let after = self.snapshot();
        for ((kind, element, expected), (_, _, actual)) in before.into_iter().zip(after) {
            // State that wasn't there can't be lost.
            if element.is_none() || (kind == "scroll" && !self.scrolled) {
                continue;
            }
            self.held.insert(kind);
            if expected != actual {
                self.failures.push(json!({
                    "rebuild": self.rebuilds, "kind": kind, "element": element, "expected": expected, "actual": actual,
                }));
            }
        }
    }

    fn focused_field(&mut self) -> Result<&mut Field, String> {
        let (identity, _) = self.input().ok_or("no field in the tree")?;
        if self.focus.as_ref() != Some(&identity) {
            return Err("the field doesn't have focus".to_owned());
        }
        Ok(self.fields.entry(identity).or_default())
    }

    fn command(
        &mut self,
        command: &Value,
        host: &mut Host,
        check: &mut Check,
    ) -> Result<Value, String> {
        let text = command["text"].as_str().unwrap_or_default();
        let element = command["element"].as_str().unwrap_or_default();
        match command["cmd"].as_str().unwrap_or_default() {
            "scroll" => {
                let dy = command["dy_px"].as_f64().ok_or("no dy_px")?;
                self.scroll_by(element, dy, check)?;
            }
            "focus" => {
                self.focus = Some(self.identity_of_key(element).ok_or("no such element")?);
            }
            "fold" => {
                let identity = self.identity_of_key(element).ok_or("no such element")?;
                if command["open"] == true {
                    self.open.insert(identity);
                } else {
                    self.open.remove(&identity);
                }
                self.settle(check)?;
            }
            "type" => {
                let field = self.focused_field()?;
                let typed: Vec<char> = text.chars().collect();
                let caret = field.caret;
                field.value.splice(caret..caret, typed.iter().copied());
                field.caret += typed.len();
                self.settle(check)?;
            }
            "caret_left" => {
                let count = command["count"].as_u64().ok_or("no count")? as usize;
                let field = self.focused_field()?;
                field.caret = field.caret.saturating_sub(count);
            }
            "compose" => self.focused_field()?.composition = Some(text.to_owned()),
            "commit" => {
                let field = self.focused_field()?;
                field.composition = None;
                let typed: Vec<char> = text.chars().collect();
                let caret = field.caret;
                field.value.splice(caret..caret, typed.iter().copied());
                field.caret += typed.len();
                self.settle(check)?;
            }
            "rebuild" => {
                if self.host_failed {
                    return Err("the host already failed a rebuild".to_owned());
                }
                let before = self.snapshot();
                let tree = host.rebuild().inspect_err(|_| self.host_failed = true)?;
                self.rebuilds += 1;
                self.take(tree, check)?;
                self.compare(before);
            }
            "report" => {
                let verdict = self.verdict(host);
                return Ok(json!({ "ok": true, "verdict": verdict, "failures": self.failures }));
            }
            other => return Err(format!("no command {other}")),
        }
        self.state(host.pid())
    }

    /// A pass speaks only for a host still there and every kind of state held across a rebuild.
    fn verdict(&self, host: &mut Host) -> &'static str {
        if !self.failures.is_empty() {
            "FAIL"
        } else if self.untold || self.held.len() < self.snapshot().len() || host.gone() {
            "INCONCLUSIVE"
        } else {
            "PASS"
        }
    }
}

/// The tree as `panel-check` would refuse it: this check draws what that one can't, keys, a list and an input.
fn without_state(node: &Node) -> Node {
    let mut plain = node.clone();
    plain.ops.retain(|op| match op.name.as_str() {
        "id" => text_arg(&op.args).is_none(),
        "overflow_y_scroll" => !op.args.is_empty(),
        _ => true,
    });
    if plain.kind == "Input" {
        plain.kind = "div".to_owned();
    }
    plain.children = node.children.iter().map(without_state).collect();
    plain
}

/// Whether an element below this one has a key of its own, not counting a fold, which is a part of a row.
fn holds_keys(node: &Node) -> bool {
    let keyed = |child: &Node| child.ops.iter().any(|op| op.name == "id");
    node.children
        .iter()
        .any(|child| keyed(child) || holds_keys(child))
}

/// What the keys of a tree can't speak for: a key twice, a second list or input, a row with no key, or a list laid out in a way
/// its scrolled rows wouldn't keep.
fn unfollowable(
    node: &Node,
    keys: &mut HashSet<String>,
    lists: &mut usize,
    inputs: &mut usize,
) -> Option<String> {
    const LIST: [&str; 5] = ["id", "overflow_y_scroll", "h", "w", "size_full"];
    if let Some(key) = key_of(node) {
        if !keys.insert(key.clone()) {
            return Some(format!("the key {key} twice"));
        }
    }
    if node.kind == "Input" {
        *inputs += 1;
        if *inputs > 1 {
            return Some("a second input".to_owned());
        }
        if !node.children.is_empty() {
            return Some("an input with children".to_owned());
        }
    }
    if scrolls(node) {
        *lists += 1;
        if *lists > 1 {
            return Some("a second list".to_owned());
        }
        if node.kind != "v_flex" {
            return Some(format!("a list that's a {}", node.kind));
        }
        if let Some(op) = node.ops.iter().find(|op| !LIST.contains(&op.name.as_str())) {
            return Some(format!("a list with .{}", op.name));
        }
        if !node
            .ops
            .iter()
            .any(|op| op.name == "h" || op.name == "size_full")
        {
            return Some("a list with no height".to_owned());
        }
        if node.children.iter().any(|row| key_of(row).is_none()) {
            return Some("a row with no key".to_owned());
        }
        if node.children.iter().any(holds_keys) {
            return Some("keyed elements inside a row".to_owned());
        }
        let placed = |op: &Op| ["absolute", "left", "top"].contains(&op.name.as_str());
        if node.children.iter().any(|row| row.ops.iter().any(placed)) {
            return Some("a row placed by hand".to_owned());
        }
    }
    node.children
        .iter()
        .find_map(|child| unfollowable(child, keys, lists, inputs))
}

/// A tree this app can draw and follow, or why it can't.
fn readable(text: &str) -> Result<Node, String> {
    let tree = parse(text)?;
    if let Some(kind) = unknown_element(&without_state(&tree)) {
        return Err(format!("unknown_element {kind}"));
    }
    match unfollowable(&tree, &mut HashSet::new(), &mut 0, &mut 0) {
        Some(why) => Err(why),
        None => Ok(tree),
    }
}

/// `deep-app panel-keys --host PATH --panel DIR [--match-by-position]`: JSON lines until stdin closes. Exits 0 on pass,
/// 1 on a state lost across a rebuild, and 2 when it couldn't tell.
pub fn keys(args: &[String]) -> i32 {
    match run(args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("deep-app panel-keys: {error}");
            2
        }
    }
}

fn run(args: &[String]) -> Result<i32, String> {
    let flag = |name: &str| {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };
    let host_path = flag("--host").ok_or("--host PATH")?;
    let panel = flag("--panel").ok_or("--panel DIR")?;
    let by_position = args.iter().any(|arg| arg == "--match-by-position");
    if let Some(dependency) = crate::fetched_dependency(panel.as_ref()) {
        return Err(crate::fetch_refusal(&dependency));
    }
    let window: Vec<String> = ["--window", WINDOW, "--panel-area", AREA]
        .map(str::to_owned)
        .to_vec();
    let mut check = Check::open(&window)?;
    let mut host = Host::start(host_path.as_ref(), panel.as_ref(), false)?;
    let (text, _) = host.update()?;
    let mut keys = Keys {
        by_position,
        tree: Node::default(),
        bounds: Vec::new(),
        list_at: 0,
        rows_at: Vec::new(),
        scroll: HashMap::new(),
        focus: None,
        fields: HashMap::new(),
        open: HashSet::new(),
        rebuilds: 0,
        failures: Vec::new(),
        held: HashSet::new(),
        untold: false,
        host_failed: false,
        scrolled: false,
    };
    keys.take(readable(&text)?, &mut check)?;
    let say = |value: Value| {
        let mut stdout = std::io::stdout().lock();
        writeln!(stdout, "{value}")
            .and_then(|()| stdout.flush())
            .map_err(|error| error.to_string())
    };
    say(json!({
        "ready": true, "origin": "agent_built", "runtime": "panel_host",
        "matching": if by_position { "by_position" } else { "by_key" },
        "host_pid": host.pid(), "check_pid": std::process::id(),
    }))?;
    for line in std::io::stdin().lock().split(b'\n') {
        let Ok(line) = line else {
            keys.untold = true;
            break;
        };
        let reply = serde_json::from_slice::<Value>(&line)
            .map_err(|error| error.to_string())
            .and_then(|command| keys.command(&command, &mut host, &mut check));
        say(reply.unwrap_or_else(|error| {
            keys.untold = true;
            json!({ "ok": false, "error": error })
        }))?;
    }
    Ok(match keys.verdict(&mut host) {
        "PASS" => 0,
        "FAIL" => 1,
        _ => 2,
    })
}

impl Host {
    /// A rebuild, as a tree this app can draw.
    fn rebuild(&mut self) -> Result<Node, String> {
        self.send(json!({ "cmd": "rebuild" }))?;
        let reply = self.reply()?;
        match reply["tree"].as_str() {
            Some(text) => readable(text),
            None => Err(format!("the panel failed: {}", reply["error"])),
        }
    }
}
