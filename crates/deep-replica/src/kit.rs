//! `needs-you@1`: a Needs you view's rows equal the inbox projection's list, row for row. A failure
//! names the ask at the first row that differs: the one the projection lists there, or, past the
//! projection's end, the one the view listed on its own. A row is read by its element's id, its
//! ask's handle, so a view draws its question and never the handle (#1459).
//!
//! `session.row@1`: a view replacing the sidebar's session rows draws one row per session, in the sidebar's order, keyed
//! by `session:<id>`, each drawing its title and its state's words; a failure names the session (#1459).
//!
//! Issue #326 adds the notifier's kit and States people see's, below.

use deep_app::{notify::NOTIFY_AFTER, states};
use serde_json::{json, Value};

use crate::{Replica, Seen};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub pass: bool,
    pub names: Option<String>,
}

impl Verdict {
    pub fn to_json(&self) -> Value {
        let mut out = json!({ "result": if self.pass { "pass" } else { "fail" } });
        if let Some(names) = &self.names {
            out["names"] = json!(names);
        }
        out
    }
}

pub fn needs_you(rows: &[String], expected: &[String]) -> Verdict {
    if rows == expected {
        return Verdict {
            pass: true,
            names: None,
        };
    }
    let first = (0..rows.len().max(expected.len()))
        .find(|&index| rows.get(index) != expected.get(index))
        .expect("unequal lists differ somewhere");
    let names = expected.get(first).or_else(|| rows.get(first)).cloned();
    Verdict { pass: false, names }
}

/// `needs-you@1` on the view in `dir`, as `deep install` runs it for a view replacing Needs you: the view mounted in
/// the shell's center, in a replica over the kit's fixture record, its rows read by element id in the order drawn,
/// against the inbox projection's list (#1459).
pub fn needs_you_view(dir: &std::path::Path) -> Verdict {
    let state = crate::load_state();
    let expected = state.inbox.rows();
    deep_app::views::set_state(state);
    match view_tree(dir, NEEDS_YOU_PANEL) {
        Ok(tree) => needs_you(&crate::shell::rows_of(&tree), &expected),
        Err(why) => Verdict {
            pass: false,
            names: Some(format!("needs-you@1 refused this view: {why}")),
        },
    }
}

/// `session.row@1` on the view in `dir`, as `deep install` runs it for a view replacing the sidebar's session rows: the
/// view mounted in the shell's center, in a replica over the kit's fixture record, its rows read by element id in the
/// order drawn, with the text drawn in each, against the sessions as the sidebar lists them (#1459).
pub fn session_row_view(dir: &std::path::Path) -> Verdict {
    deep_app::views::set_state(crate::load_state());
    let expected: Vec<(String, String, String)> = deep_app::record::with_view(|view| {
        let table = view.table();
        table
            .every_session()
            .into_iter()
            .map(|(id, title, _)| {
                let (words, _) = table.row(&id, deep_app::views::now());
                (format!("session:{id}"), title, words)
            })
            .collect()
    })
    .unwrap_or_default();
    match view_tree(dir, SESSION_ROWS_PANEL) {
        Ok(tree) => session_rows(&crate::shell::keyed(&tree, "session:"), &expected),
        Err(why) => Verdict {
            pass: false,
            names: Some(format!("session.row@1 refused this view: {why}")),
        },
    }
}

/// Each session's row, by `(id, title, words)`, against the rows drawn, by `(id, text drawn inside)`: the first
/// session whose row is missing, out of place or drawn without its title or its state's words, or a row of no session.
pub fn session_rows(rows: &[(String, String)], expected: &[(String, String, String)]) -> Verdict {
    let fail = |names: String| Verdict {
        pass: false,
        names: Some(names),
    };
    for index in 0..rows.len().max(expected.len()) {
        match (rows.get(index), expected.get(index)) {
            (Some((id, drawn)), Some((session, title, words))) if id == session => {
                if let Some(missing) = [title, words]
                    .into_iter()
                    .find(|word| !drawn.contains(word.as_str()))
                {
                    return fail(format!("{session}: its row draws no {missing:?}"));
                }
            }
            (_, Some((session, ..))) => return fail(format!("{session}: no row in its place")),
            (Some((id, _)), None) => return fail(format!("{id}: a row of no session")),
            (None, None) => unreachable!("index is below one list's length"),
        }
    }
    Verdict {
        pass: true,
        names: None,
    }
}

/// The description of the panel `panel` that the view in `dir` registers, mounted in the shell's center over the
/// state already set, after one frame.
fn view_tree(dir: &std::path::Path, panel: &str) -> Result<String, String> {
    use deep_app::views::{Layout, LINE, SIDEBAR};
    use gpui_kit::test::TestWindowExt as _;

    let mut cx = crate::headless_context();
    let runtime = deep_app::new_runtime()
        .map_err(|error| format!("the panel runtime doesn't start: {error:#}"))?;
    let name = format!("shell:deepbuild-panel/{panel}");
    let layout = Layout {
        sidebar: SIDEBAR.into(),
        center: vec![name.clone()],
        active: 0,
        line: LINE.into(),
    };
    let mut mounted = Ok(());
    let (handle, shell) = cx.update(|cx| {
        crate::shell::open_shell(&layout, cx, |window, cx| {
            mounted = deep_app::mount_panel(&runtime, dir, window, cx)
                .map(std::mem::forget)
                .map_err(|error| format!("it doesn't load: {error:#}"));
        })
    });
    mounted?;
    let tree = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let panel = crate::shell::script_panel(shell.read(cx).dock.read(cx), &name, cx)?;
            Some(crate::shell::script_tree(panel.read(cx).view().read(cx)))
        })
        .ok()
        .flatten();
    std::mem::forget(runtime);
    tree.ok_or_else(|| format!("it registers no panel named {panel:?}"))
}

/// The lint of a stored journey (#1459): a JSON array of `deep_drive` calls, read without running it. A locator that
/// finds its target by a word a person reads, its `name`, `text` or `label`, fails, naming the first such word, since
/// rewording the app would break the journey; `{id}`, `{handle}`, `{item}` and `{role}` pass. Locators are read where
/// a call takes one: its `locator`, an action's `to`, and a screenshot's or recording's `locator`, masks and highlights.
pub fn journey_lint(file: &std::path::Path) -> Verdict {
    let fail = |names: String| Verdict {
        pass: false,
        names: Some(names),
    };
    let calls: Vec<Value> = match std::fs::read_to_string(file)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str(&text).map_err(|error| error.to_string()))
    {
        Ok(Value::Array(calls)) => calls,
        Ok(_) => return fail(format!("{} is not a JSON array of calls", file.display())),
        Err(error) => return fail(format!("{} doesn't read: {error}", file.display())),
    };
    for call in &calls {
        let mut locators = vec![&call["locator"], &call["act"]["to"]];
        for args in [&call["screenshot"], &call["record"]] {
            locators.push(&args["locator"]);
            for list in ["mask", "highlight"] {
                locators.extend(args[list].as_array().into_iter().flatten());
            }
        }
        for locator in locators {
            if let Some(word) = ["name", "text", "label"]
                .iter()
                .find_map(|key| locator[*key].as_str())
            {
                return fail(word.to_owned());
            }
        }
    }
    Verdict {
        pass: true,
        names: None,
    }
}

/// The panel name a view replacing Needs you registers with `DockArea.register_panel`.
const NEEDS_YOU_PANEL: &str = "needs-you";

/// The panel name a view replacing the sidebar's session rows registers.
const SESSION_ROWS_PANEL: &str = "session-rows";

/// The notifier's checks over a replica's run: every notification about an ask came at least `NOTIFY_AFTER` after
/// it showed, while it was still open, never for the session open in that device's focused window, and once per
/// device; and every ask still open `NOTIFY_AFTER` after it showed was notified once on each device not looking at
/// its session. A failure names the ask.
pub fn notifications(replica: &Replica) -> Verdict {
    let after = NOTIFY_AFTER.as_millis() as u64;
    let fail = |ask: &str| Verdict {
        pass: false,
        names: Some(ask.to_owned()),
    };
    let looking_at = |device: usize, at: u64| {
        replica
            .focus
            .iter()
            .rev()
            .find(|(when, of, _)| *of == device && *when <= at)
            .and_then(|(_, _, session)| session.clone())
    };
    let posted = replica.notifications();
    for post in &posted {
        let Some(ask) = &post.ask else { continue };
        let Some((_, session, shown, closed)) =
            replica.asks.iter().find(|(handle, ..)| handle == ask)
        else {
            return fail(ask);
        };
        let twice = posted
            .iter()
            .filter(|other| other.device == post.device && other.ask == post.ask)
            .count()
            > 1;
        if post.at < shown + after
            || closed.is_some_and(|closed| closed <= post.at)
            || looking_at(post.device, post.at).as_deref() == Some(session)
            || twice
        {
            return fail(ask);
        }
    }
    for (ask, session, shown, closed) in &replica.asks {
        let due = shown + after;
        if replica.now() < due || closed.is_some_and(|closed| closed <= due) {
            continue;
        }
        for device in 0..replica.devices() {
            let missing = !posted
                .iter()
                .any(|post| post.device == device && post.ask.as_ref() == Some(ask));
            if missing && looking_at(device, due).as_deref() != Some(session) {
                return fail(ask);
            }
        }
    }
    Verdict {
        pass: true,
        names: None,
    }
}

/// States people see, over a view's surfaces: each shows the row's word with its extra, no word that never names
/// the row, and draws the row's status-map entry with the look's glyph. A failure names the surface and the row.
pub fn states(row: &str, seen: &[Seen]) -> Verdict {
    let Some((word, entry, never)) = states::TABLE.iter().find(|(word, ..)| *word == row) else {
        return Verdict {
            pass: false,
            names: Some(format!("no row {row:?} in States people see")),
        };
    };
    for surface in seen {
        let text = &surface.text;
        let lower = text.to_lowercase();
        let shown = shows(text, word)
            && match *word {
                "sent back" => has_round(text),
                "says done" => has_span(text),
                "quiet" => text
                    .find("last seen")
                    .is_some_and(|at| has_span(&text[at..])),
                _ => true,
            }
            && !never.iter().any(|never| {
                words_at(&lower, never)
                    .into_iter()
                    .any(|at| *never != "done" || !lower[..at].ends_with("says "))
            })
            && surface.entry == *entry
            && surface.glyph == states::glyph(entry);
        if !shown {
            return Verdict {
                pass: false,
                names: Some(format!("{} · {row}", surface.surface)),
            };
        }
    }
    Verdict {
        pass: true,
        names: None,
    }
}

/// Script calls that reach the network, and that run a program.
const NETWORK: [&str; 4] = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource"];
const PROGRAM: [&str; 4] = [
    "process.run",
    "process.spawn",
    "process.exec",
    "child_process",
];

/// The components gpui-shell registers for scripts that can draw outside their parent, by the names a script
/// imports them under, each with what a person calls it.
const OVERLAYS: [(&str, &str); 12] = [
    ("Dialog", "dialog"),
    ("Sheet", "sheet"),
    ("Popover", "popover"),
    ("HoverCard", "hover card"),
    ("Tooltip", "tooltip"),
    ("Popup", "context menu"),
    ("ContextMenu", "context menu"),
    ("DropdownMenu", "dropdown"),
    ("Select", "dropdown"),
    ("Combobox", "dropdown"),
    ("Notification", "notification"),
    ("Command", "command palette"),
];

/// The slot `panel@1` lays a panel out in: the sidebar's, 260 points wide.
const SLOT: (f32, f32) = (260., 862.);

/// `panel@1`, the checks every panel passes at install (#326). A panel is refused when its manifest lists a Git
/// dependency (nothing is fetched); when it imports the toolkit, a name off the panel catalog or a component whose
/// script runs per frame (#1425); when it calls the network or runs a program; when it uses a component that
/// draws outside its parent, which could cover the question card; and, run headless in its slot for half a
/// second, when it moves focus with no gesture from you or paints outside its slot. Each refusal says why in
/// its own words.
pub fn panel(dir: &std::path::Path) -> Verdict {
    let refuse = |why: String| Verdict {
        pass: false,
        names: Some(format!("panel@1 refused this panel: {why}")),
    };
    if let Some(dependency) = deep_app::fetched_dependency(dir) {
        return refuse(deep_app::fetch_refusal(&dependency));
    }
    let source = scripts(dir);
    if let Some(call) = NETWORK.iter().find(|call| source.contains(*call)) {
        return refuse(format!("it reaches the network ({call})"));
    }
    if let Some(call) = PROGRAM.iter().find(|call| source.contains(*call)) {
        return refuse(format!("it runs a program ({call})"));
    }
    let imported = imports(&source);
    if let Some((name, what)) = OVERLAYS
        .iter()
        .find(|(name, _)| imported.iter().any(|i| i == name))
    {
        return refuse(format!(
            "it uses {name}, a {what}, which gpui-shell draws outside its parent, where it could cover the question card"
        ));
    }
    // #1425: a toolkit import, a name off the panel catalog, a component whose script runs per frame.
    if let Err(why) = deep_app::panel_module::check(dir) {
        return refuse(why);
    }
    match watch(dir) {
        Ok(None) => Verdict {
            pass: true,
            names: None,
        },
        Ok(Some(why)) | Err(why) => refuse(why),
    }
}

/// A panel's scripts, comments taken out.
fn scripts(dir: &std::path::Path) -> String {
    let mut text = String::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("js" | "mjs")
        ) {
            text.push_str(&std::fs::read_to_string(&path).unwrap_or_default());
            text.push('\n');
        }
    }
    let mut out = String::new();
    let mut rest = text.as_str();
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("//") {
            rest = after.split_once('\n').map_or("", |(_, next)| next);
            out.push('\n');
        } else if let Some(after) = rest.strip_prefix("/*") {
            rest = after.split_once("*/").map_or("", |(_, next)| next);
        } else {
            let next = rest.chars().next().unwrap();
            out.push(next);
            rest = &rest[next.len_utf8()..];
        }
    }
    out
}

/// The names a script imports: `import { A, B as C } from "…"` gives A and B.
fn imports(source: &str) -> Vec<String> {
    source
        .split("import")
        .skip(1)
        .filter_map(|rest| {
            rest.split_once('{')?
                .1
                .split_once('}')
                .map(|(names, _)| names)
        })
        .flat_map(|names| names.split(','))
        .filter_map(|name| name.split_whitespace().next().map(str::to_owned))
        .collect()
}

/// Runs the panel headless in an unclipped slot: what it did that no panel may, if anything.
fn watch(dir: &std::path::Path) -> Result<Option<String>, String> {
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{prelude::FluentBuilder as _, *};

    struct Probe(Option<AnyView>);
    impl Render for Probe {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().relative().bg(rgb(0xffffff)).child(
                div()
                    .absolute()
                    .left(px(0.))
                    .top(px(0.))
                    .w(px(SLOT.0))
                    .h(px(SLOT.1))
                    .when_some(self.0.clone(), |slot, view| slot.child(view)),
            )
        }
    }

    let mut cx = crate::headless_context();
    let runtime = deep_app::new_runtime().map_err(|error| format!("it doesn't load: {error:#}"))?;
    let mut mounted = Err(String::new());
    let (with, _) = cx.update(|cx| {
        open_window(crate::shell::window_options(), cx, |window, cx| {
            mounted = deep_app::mount_panel(&runtime, dir, window, cx)
                .map(AnyView::from)
                .map_err(|error| format!("it doesn't load: {error:#}"));
            cx.new(|_| Probe(mounted.clone().ok()))
        })
        .expect("a window opens")
    });
    mounted?;
    let (without, _) = cx.update(|cx| {
        open_window(crate::shell::window_options(), cx, |_, cx| {
            cx.new(|_| Probe(None))
        })
        .expect("a window opens")
    });
    let focused = |cx: &mut HeadlessAppContext| {
        cx.update_window(with, |_, window, cx| {
            window.render_frame(cx);
            window.focused(cx)
        })
        .expect("the window draws")
    };
    let before = focused(&mut cx);
    for _ in 0..32 {
        cx.run_until_parked();
        cx.advance_clock(std::time::Duration::from_millis(16));
        cx.run_until_parked();
        focused(&mut cx);
    }
    if focused(&mut cx) != before {
        return Ok(Some("it moves focus without your gesture".into()));
    }
    cx.update_window(without, |_, window, cx| window.render_frame(cx))
        .expect("the window draws");
    let shot = cx
        .capture_screenshot(with)
        .map_err(|error| error.to_string())?;
    let blank = cx
        .capture_screenshot(without)
        .map_err(|error| error.to_string())?;
    let scale = crate::SCALE;
    let (w, h) = ((SLOT.0 * scale) as u32 + 2, (SLOT.1 * scale) as u32 + 2);
    let outside = shot
        .enumerate_pixels()
        .find(|(x, y, pixel)| (*x >= w || *y >= h) && blank.get_pixel(*x, *y) != *pixel);
    Ok(outside.map(|(x, y, _)| format!("it draws outside its panel, at device pixel ({x}, {y})")))
}

/// Where `word` stands in `text` as a whole word.
fn words_at(text: &str, word: &str) -> Vec<usize> {
    let alnum = |c: Option<char>| c.is_some_and(char::is_alphanumeric);
    text.match_indices(word)
        .map(|(at, _)| at)
        .filter(|&at| {
            !alnum(text[..at].chars().next_back()) && !alnum(text[at + word.len()..].chars().next())
        })
        .collect()
}

/// The row's word, as the table writes it or, lower-case, with a capital first letter.
fn shows(text: &str, word: &str) -> bool {
    let mut capital = word.to_owned();
    if let Some(first) = capital.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    !words_at(text, word).is_empty() || !words_at(text, &capital).is_empty()
}

/// "sent back <n> of <m>".
fn has_round(text: &str) -> bool {
    text.match_indices("sent back ").any(|(at, found)| {
        let rest: Vec<&str> = text[at + found.len()..].split_whitespace().take(3).collect();
        matches!(rest.as_slice(), [n, "of", m, ..] if n.parse::<u64>().is_ok() && m.parse::<u64>().is_ok())
    })
}

/// A span of time: a number followed by s, min or h.
fn has_span(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    words.windows(2).any(|pair| {
        pair[0].parse::<u64>().is_ok()
            && ["s", "min", "h"].contains(&pair[1].trim_end_matches(['.', ',']))
    })
}

/// The look's 16 terminal colors as the app's cell grid draws them, on the terminal's background (#1003).
pub struct TerminalColors {
    pub dark: bool,
}

impl gpui_kit::Render for TerminalColors {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{div, InteractiveElement as _, ParentElement as _, Styled as _};
        div()
            .id("terminal-colors")
            .size_full()
            .child(deep_app::cells::look_colors_page(self.dark))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handles(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| format!("ask:{id}")).collect()
    }

    #[test]
    fn equal_rows_pass_and_each_fault_names_a_wrong_ask() {
        let want = handles(&["A", "B", "C"]);
        assert!(needs_you(&want, &want).pass);
        assert_eq!(
            needs_you(&handles(&["A", "B"]), &want).names.as_deref(),
            Some("ask:C")
        );
        assert_eq!(
            needs_you(&handles(&["A", "B", "C", "Z"]), &want)
                .names
                .as_deref(),
            Some("ask:Z")
        );
        assert_eq!(
            needs_you(&handles(&["C", "B", "A"]), &want)
                .names
                .as_deref(),
            Some("ask:A")
        );
    }

    #[test]
    fn a_repeated_row_is_named_too() {
        let want = handles(&["A", "B", "C"]);
        let verdict = needs_you(&handles(&["A", "A", "B", "C"]), &want);
        assert!(!verdict.pass);
        assert_eq!(verdict.names.as_deref(), Some("ask:B"));
    }
}
