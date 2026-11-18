//! Issue #402: terminals, streams and the session page's terminal tab, on the virtual display
//! clock (technical design: Blocks for plug-ins that host something live; Panels and devices:
//! Stream and raw input, Cell grid; canvas primitives: Cell grid `cells@1`).
//!
//! - A terminal is fed its program's output as recorded chunks; each chunk is one update of its
//!   cell grid, a patch of the rows it changed against the revision before. A terminal's stream
//!   applies backpressure, so no chunk is ever dropped: each update becomes current once the
//!   checker has taken it, and is presented at the first vsync of the display that paces its
//!   panel whose latch reads it. Two updates the same latch reads share a frame, and the earlier
//!   is merged into the later.
//! - A sound or video stream drops what it can't show on time and counts it: a frame whose time
//!   falls while its panel is paused is dropped, never shown late.
//! - A session's page has its line, asks and checks tabs and a terminal tab. For a terminal the
//!   hub hosts, the tab draws it through the cell grid alone; for one it doesn't host, the tab
//!   shows only the line naming where the session runs, with Open, never a captured screen.
//!
//! Wherever status can show, as on a session's page, a cell color inside the look's status
//! distance becomes the nearest allowed color; in a plug-in's panel it draws as asked.

use std::collections::BTreeMap;

use deep_canvas_cells::emulator::{Cell, Terminal, ATTRS};
use deep_canvas_cells::palette::{off_status, resolve, resolve_in};
use deep_canvas_marks::look::{self, Look};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::optional;
use crate::shared::FLICKS;

/// The default history a terminal keeps, in rows.
const HISTORY: usize = 10_000;
/// The palette's default foreground and background, for a look that gives a terminal no colors.
const FG: [u8; 3] = [0xe8, 0xe8, 0xe8];
const BG: [u8; 3] = [0x10, 0x10, 0x10];

/// What a terminal draws with (#1003): the look's 16 colors, its background and default text, in
/// the theme the hub draws (light); xterm's 16 on the palette's defaults for a look with none.
pub struct Colors {
    ansi: Option<[[u8; 3]; 16]>,
    fg: [u8; 3],
    bg: [u8; 3],
}

impl Colors {
    pub fn of(look: &Look) -> Colors {
        match look::terminal_colors(&look.light) {
            Some((ansi, bg, fg)) => Colors {
                ansi: Some(ansi),
                fg,
                bg,
            },
            None => Colors {
                ansi: None,
                fg: FG,
                bg: BG,
            },
        }
    }

    /// A color the program asked for; its own true color or cube color as it sent it.
    fn resolve(&self, c: deep_canvas_cells::emulator::Color, default: [u8; 3]) -> [u8; 3] {
        match &self.ansi {
            Some(ansi) => resolve_in(c, default, ansi),
            None => resolve(c, default),
        }
    }

    /// The default text and background an empty cell is drawn with, which OSC 10 and 11 answer.
    pub fn defaults(&self) -> [[u8; 3]; 2] {
        [self.fg, self.bg]
    }
}
/// The three tabs R1 ships on a session's page, before the terminal tab.
const TABS: [&str; 3] = ["line", "asks", "checks"];

/// A chunk of a terminal's recorded output: when it arrives and its bytes.
struct Chunk {
    at: i64,
    bytes: Vec<u8>,
}

/// One update the terminal made: its revision, the chunk's time and the rows its patch holds.
struct Update {
    revision: u64,
    at: i64,
    rows: usize,
}

/// Where a terminal draws: a plug-in's panel, or a session's page.
pub enum Home {
    Panel(String),
    Session(String),
}

pub struct Term {
    home: Home,
    term: Terminal,
    feed: Vec<Chunk>,
    /// The chunks fed so far.
    fed: usize,
    updates: Vec<Update>,
}

/// A sound or video stream to one panel, drop-and-count.
#[derive(Clone)]
pub struct Media {
    kind: String,
    panel: String,
    rate: i64,
    from: i64,
    until: i64,
    pauses: Vec<(i64, i64)>,
}

/// What these calls keep while a scenario runs.
#[derive(Default)]
pub struct Terms {
    terms: BTreeMap<String, Term>,
    media: BTreeMap<String, Media>,
    /// The session pages opened, by session: the panel each opened in.
    pages: BTreeMap<String, String>,
}

/// This issue's `deep-show run` calls.
pub enum TermCall {
    Open {
        terminal: String,
        home: Option<Home>,
        cols: u16,
        rows: u16,
        history: usize,
        feed: Vec<(i64, String)>,
    },
    Cells(Target),
    Cell(Target, u16, u16),
    Updates(Target),
    StreamOpen(String, Media),
    Stream(String),
    StreamRead(String, String),
    SessionPage(String, String),
    Tab(String, String),
    Module(String),
}

/// A terminal named by its ID, or a session's tab.
pub enum Target {
    Terminal(String),
    Tab(String, String),
}

fn target(c: &Map<String, Value>) -> Option<Target> {
    match (c.get("terminal"), c.get("session"), c.get("tab")) {
        (Some(t), None, None) => Some(Target::Terminal(t.as_str()?.to_string())),
        (None, Some(s), Some(t)) => Some(Target::Tab(
            s.as_str()?.to_string(),
            t.as_str()?.to_string(),
        )),
        _ => None,
    }
}

fn u16_of(v: Option<&Value>) -> Option<u16> {
    v?.as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .filter(|n| *n > 0)
}

/// One of this issue's calls, or `None` for a line that lacks a field it needs.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<TermCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        "terminal_open" => TermCall::Open {
            terminal: s("terminal")?,
            home: match (c.get("panel"), c.get("session")) {
                (Some(p), None) => Some(Home::Panel(p.as_str()?.to_string())),
                (None, Some(s)) => Some(Home::Session(s.as_str()?.to_string())),
                _ => return None,
            },
            cols: u16_of(c.get("cols"))?,
            rows: u16_of(c.get("rows"))?,
            history: optional(c.get("history"), |h| usize::try_from(h.as_u64()?).ok())?
                .unwrap_or(HISTORY),
            feed: match c.get("feed") {
                None => Vec::new(),
                Some(f) => f
                    .as_array()?
                    .iter()
                    .map(|x| Some((x.get("at")?.as_i64()?, x.get("text")?.as_str()?.to_string())))
                    .collect::<Option<_>>()?,
            },
        },
        "cells" => TermCall::Cells(target(c)?),
        "cell" => TermCall::Cell(
            target(c)?,
            u16::try_from(c.get("x")?.as_u64()?).ok()?,
            u16::try_from(c.get("y")?.as_u64()?).ok()?,
        ),
        "updates" => TermCall::Updates(target(c)?),
        "stream_open" => {
            let src = c.get("source")?;
            let rate = src
                .get("fps")
                .or_else(|| src.get("packets_per_second"))?
                .as_i64()
                .filter(|r| *r > 0)?;
            TermCall::StreamOpen(
                s("stream")?,
                Media {
                    kind: s("kind").filter(|k| k == "video" || k == "sound")?,
                    panel: s("panel")?,
                    rate,
                    from: src.get("from")?.as_i64()?,
                    until: src.get("until")?.as_i64()?,
                    pauses: match c.get("pauses") {
                        None => Vec::new(),
                        Some(p) => p
                            .as_array()?
                            .iter()
                            .map(|x| Some((x.get("from")?.as_i64()?, x.get("until")?.as_i64()?)))
                            .collect::<Option<_>>()?,
                    },
                },
            )
        }
        "stream" => TermCall::Stream(s("stream")?),
        "stream_read" => TermCall::StreamRead(s("stream")?, s("panel")?),
        "session_page" => TermCall::SessionPage(s("session")?, s("panel")?),
        "tab" => TermCall::Tab(s("session")?, s("tab")?),
        "module" => TermCall::Module(s("name")?),
        _ => return None,
    })
}

/// A cell's colors as `#rrggbb`.
fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// A terminal's grid as the cell grid shows it (README: `cells`), without its presentation.
pub fn grid_json(t: &Terminal, revision: u64) -> Value {
    let (x, y) = t.cursor();
    let rows: Vec<String> = (0..t.rows()).map(|r| Terminal::text_of(t.row(r))).collect();
    let links: Map<String, Value> = t
        .links
        .iter()
        .map(|(id, url)| (id.to_string(), json!(url)))
        .collect();
    json!({
        "revision": revision,
        "cols": t.cols(),
        "rows": t.rows(),
        "text": rows,
        "cursor": {"x": x, "y": y, "shape": t.shape.name(), "visible": t.visible, "blink": t.blink},
        "scroll": {"history": t.history_len(), "offset": 0},
        "title": t.title,
        "cwd": t.cwd,
        "progress": t.progress,
        "bell": t.bell,
        "modes": {
            "alt_screen": t.modes.alt_screen,
            "bracketed_paste": t.modes.bracketed_paste,
            "app_cursor": t.modes.app_cursor,
            "focus_events": t.modes.focus_events,
            "mouse": t.modes.mouse_name(),
        },
        "links": links,
        "clipboard": {"writes": t.clipboard.writes, "reads_refused": t.clipboard.reads_refused},
        "drawn_by": "cells@1",
    })
}

/// #1967: each document cell grid as its session shows it, by item: its size, each row's text
/// right-trimmed, its cursor and every cell row-major, each as a live terminal's `cell` answers.
pub(crate) fn grid_blocks(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &deep_canvas::schedule::Session,
) -> Map<String, Value> {
    use deep_canvas_cells::module::Grid;
    let mut out = Map::new();
    for (id, v) in session.values(sched, "cells.grid") {
        let (Some(id), Some(g)) = (id, v.as_typed::<Grid>()) else {
            continue;
        };
        let text: Vec<&str> = g
            .rows
            .iter()
            .map(|r| r.text.trim_end_matches(' '))
            .collect();
        let cells: Vec<Value> = g
            .cells
            .iter()
            .map(|c| {
                let attrs: Vec<&str> = ATTRS
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| c.attrs & (1 << i) != 0)
                    .map(|(_, n)| *n)
                    .collect();
                json!({"g": c.g, "fg": hex(c.fg), "bg": hex(c.bg), "attrs": attrs,
                       "link": (c.link != 0).then(|| c.link.to_string())})
            })
            .collect();
        let k = &g.cursor;
        out.insert(
            id.to_string(),
            json!({"cols": g.cols, "rows": g.rows.len(), "text": text, "cells": cells,
                   "cursor": {"x": k.x, "y": k.y, "shape": k.shape, "visible": k.visible, "blink": k.blink}}),
        );
    }
    out
}

/// One cell as drawn in `colors`: its colors after the status rule when `status` is `Some`.
pub fn cell_json(cell: &Cell, colors: &Colors, status: Option<(&[[u8; 3]], f64)>) -> Value {
    let mut fg = colors.resolve(cell.fg, colors.fg);
    let mut bg = colors.resolve(cell.bg, colors.bg);
    if let Some((colors, min)) = status {
        fg = off_status(fg, colors, min);
        bg = off_status(bg, colors, min);
    }
    let attrs: Vec<&str> = ATTRS
        .iter()
        .enumerate()
        .filter(|(i, _)| cell.attrs & (1 << i) != 0)
        .map(|(_, n)| *n)
        .collect();
    json!({
        "g": cell.g.text(),
        "fg": hex(fg),
        "bg": hex(bg),
        "attrs": attrs,
        "link": (cell.link != 0).then(|| cell.link.to_string()),
    })
}

impl<'a> Hub<'a> {
    /// The look's status colors and distance, which a session's page keeps cells off.
    fn status_colors(&self) -> (Vec<[u8; 3]>, f64) {
        match &self.look.status {
            Some(s) => (s.colors.values().copied().collect(), s.min_distance),
            None => (Vec::new(), 0.0),
        }
    }

    /// Feeds every chunk that arrived by `to`, each one update.
    pub fn advance_terms(&mut self, to: i64) {
        for t in self.terms.terms.values_mut() {
            while let Some(chunk) = t.feed.get(t.fed).filter(|c| c.at <= to) {
                t.term.feed(&chunk.bytes);
                // A recorded chunk has no program to answer, nor a session to read its status.
                t.term.replies.clear();
                t.term.statuses.clear();
                let rows = t.term.take_dirty();
                let revision = t.updates.len() as u64 + 1;
                t.updates.push(Update {
                    revision,
                    at: chunk.at,
                    rows,
                });
                t.fed += 1;
            }
        }
    }

    /// The panel a terminal draws in, as its window's display paces it.
    fn panel_of(&self, t: &Term) -> Option<String> {
        match &t.home {
            Home::Panel(p) => Some(p.clone()),
            Home::Session(s) => self.terms.pages.get(s).cloned(),
        }
    }

    fn term_of(&self, target: &Target) -> Result<&Term, Value> {
        let id = match target {
            Target::Terminal(id) => id.clone(),
            Target::Tab(session, tab) => {
                if tab != "terminal" {
                    return Err(json!({"code": "unknown_tab"}));
                }
                match self.hosted_terminal(session) {
                    Some(id) => id,
                    None => return Err(json!({"code": "not_hosted"})),
                }
            }
        };
        self.terms
            .terms
            .get(&id)
            .ok_or_else(|| json!({"code": "unknown_terminal"}))
    }

    /// The terminal the hub hosts for `session`: the one opened for it.
    fn hosted_terminal(&self, session: &str) -> Option<String> {
        self.terms
            .terms
            .iter()
            .find(|(_, t)| matches!(&t.home, Home::Session(s) if s == session))
            .map(|(id, _)| id.clone())
    }

    /// Each update's presentation: the first vsync of the panel's pacing display whose latch is
    /// at or after the update was checked, one update a frame (the earlier of two that one latch
    /// reads is merged); `None` before its panel shows.
    fn presentations(&self, t: &Term) -> Vec<(Option<i64>, bool)> {
        let lead = self.scenario.clock.map_or(0, |c| c.lead);
        let check = self.scenario.clock.map_or(0, |c| c.check);
        let grid = self
            .panel_of(t)
            .and_then(|p| self.placement.pacing(&p).map(|(_, d)| d.grid()));
        let Some(grid) = grid else {
            return t.updates.iter().map(|_| (None, false)).collect();
        };
        let late = match self.planted(Planted::CellsAFrameLate) {
            true => grid.period,
            false => 0,
        };
        // The planted terminal applies at most 30 updates a second, merging the rest; the
        // planted tab redraws at most 30 times a second.
        let capped = self.planted(Planted::Terminal30PerSecond)
            || (self.planted(Planted::TabRedrawsAt30hz) && matches!(t.home, Home::Session(_)));
        let mut out: Vec<(Option<i64>, bool)> = t
            .updates
            .iter()
            .map(|u| (Some(grid.vsync_from(u.at + check + lead) + late), false))
            .collect();
        if capped {
            // Each applied update holds the grid for 1/30 s; what lands meanwhile is merged
            // into the next one applied.
            let mut last: Option<i64> = None;
            for (o, u) in out.iter_mut().zip(&t.updates) {
                match last {
                    Some(l) if u.at - l < FLICKS / 30 => *o = (None, true),
                    _ => last = Some(u.at),
                }
            }
        }
        // One update a frame: an update whose frame the next one also reaches is merged.
        for i in 0..out.len().saturating_sub(1) {
            let next = out[i + 1..].iter().find_map(|o| o.0);
            if out[i].0.is_some() && out[i].0 == next {
                out[i] = (None, true);
            }
        }
        out
    }

    fn updates_reply(&self, t: &Term) -> Value {
        let shown = self.presentations(t);
        let list: Vec<Value> = t
            .updates
            .iter()
            .zip(shown)
            .map(|(u, (presented, dropped))| {
                json!({
                    "revision": u.revision,
                    "base": u.revision.checked_sub(1).filter(|r| *r > 0),
                    "at": u.at,
                    "presented": presented,
                    "dropped": dropped,
                    "rows": u.rows,
                })
            })
            .collect();
        json!({"updates": list})
    }

    fn cells_reply(&self, t: &Term) -> Value {
        let revision = t.updates.len() as u64;
        let mut out = grid_json(&t.term, revision);
        let vsync = self
            .presentations(t)
            .into_iter()
            .filter_map(|(p, _)| p)
            .filter(|p| *p <= self.now)
            .max();
        out["vsync"] = json!(vsync);
        // #1172: what the app's grid paints: its ground and ink, and each row's runs of one foreground and background.
        // They are the look's (#1003).
        let colors = Colors::of(&self.look);
        let [fg, bg] = colors.defaults();
        out["bg"] = json!(hex(bg));
        out["fg"] = json!(hex(fg));
        let rows = (0..t.term.rows())
            .map(|y| self.color_runs(t, &colors, y))
            .collect();
        out["runs"] = Value::Array(rows);
        out
    }

    /// A cell as drawn: status can show on a session's page; a plug-in's panel draws the cell as asked.
    fn cell_drawn(&self, t: &Term, drawn: &Colors, cell: &Cell) -> Value {
        match t.home {
            Home::Session(_) => {
                let (colors, min) = self.status_colors();
                cell_json(cell, drawn, Some((&colors, min)))
            }
            Home::Panel(_) => cell_json(cell, drawn, None),
        }
    }

    /// A row's cells as `[from, to, fg, bg]` runs of one pair of colors.
    fn color_runs(&self, t: &Term, colors: &Colors, y: u16) -> Value {
        let mut runs: Vec<(usize, usize, Value, Value)> = Vec::new();
        for (x, cell) in t.term.row(y).iter().enumerate() {
            let drawn = self.cell_drawn(t, colors, cell);
            let (fg, bg) = (drawn["fg"].clone(), drawn["bg"].clone());
            match runs.last_mut() {
                Some(run) if run.2 == fg && run.3 == bg => run.1 = x + 1,
                _ => runs.push((x, x + 1, fg, bg)),
            }
        }
        json!(runs)
    }

    fn cell_reply(&self, target: &Target, x: u16, y: u16) -> Value {
        let t = match self.term_of(target) {
            Ok(t) => t,
            Err(e) => return e,
        };
        if x >= t.term.cols() || y >= t.term.rows() {
            return json!({"code": "out_of_range"});
        }
        self.cell_drawn(t, &Colors::of(&self.look), &t.term.row(y)[usize::from(x)])
    }

    fn open(
        &mut self,
        terminal: &str,
        home: &Option<Home>,
        size: (u16, u16, usize),
        feed: &[(i64, String)],
    ) -> Value {
        let home = match home {
            Some(Home::Panel(p)) => {
                if !self.ring.terminal_panel(p, terminal) {
                    return json!({"code": "unknown_panel"});
                }
                Home::Panel(p.clone())
            }
            Some(Home::Session(s)) => {
                if !self.scenario.sessions.contains_key(s) {
                    return json!({"code": "unknown_session"});
                }
                Home::Session(s.clone())
            }
            None => return json!({"code": "bad_input"}),
        };
        if self.terms.terms.contains_key(terminal) {
            return json!({"code": "terminal_taken"});
        }
        let mut chunks: Vec<Chunk> = feed
            .iter()
            .map(|(at, text)| Chunk {
                at: *at,
                bytes: text.as_bytes().to_vec(),
            })
            .collect();
        chunks.sort_by_key(|c| c.at);
        let (cols, rows, history) = size;
        self.terms.terms.insert(
            terminal.to_string(),
            Term {
                home,
                term: Terminal::new(cols, rows, history),
                feed: chunks,
                fed: 0,
                updates: Vec::new(),
            },
        );
        json!({"opened": true, "terminal": terminal, "host": null, "program": null, "stream": format!("stream:{terminal}")})
    }

    /// A drop-and-count stream at `now`: what it sent, showed and dropped.
    fn media_reply(&self, m: &Media) -> Value {
        let lead = self.scenario.clock.map_or(0, |c| c.lead);
        let check = self.scenario.clock.map_or(0, |c| c.check);
        let grid = self.placement.pacing(&m.panel).map(|(_, d)| d.grid());
        let late = self.planted(Planted::VideoShowsLate);
        let uncounted = self.planted(Planted::VideoDropsUncounted);
        let (mut shown, mut seqs) = (Vec::new(), Vec::new());
        let mut emitted = 0u64;
        for seq in 1.. {
            let pts = m.from + (seq - 1) * FLICKS / m.rate;
            if pts > m.until || pts > self.now {
                break;
            }
            emitted += 1;
            let paused = m.pauses.iter().find(|(f, u)| pts >= *f && pts < *u);
            let at = match (paused, late) {
                // The planted stream queues what the pause held and shows it on resume.
                (Some((_, until)), true) => *until,
                (Some(_), false) => {
                    seqs.push(seq);
                    continue;
                }
                (None, _) => pts,
            };
            let presented = grid.map_or(at, |g| g.vsync_from(at + check + lead));
            shown.push(json!({"seq": seq, "pts": pts, "presented": presented}));
        }
        let count = if uncounted { 0 } else { seqs.len() };
        json!({"kind": m.kind, "emitted": emitted, "shown": shown, "dropped": {"count": count, "seqs": seqs}})
    }

    /// The session's page: its tabs, the terminal tab after the three R1 ships.
    fn session_page(&mut self, session: &str, panel: &str) -> Value {
        if !self.scenario.sessions.contains_key(session) {
            return json!({"code": "unknown_session"});
        }
        if !self.scenario.panels.contains_key(panel) {
            return json!({"code": "unknown_panel"});
        }
        self.terms
            .pages
            .insert(session.to_string(), panel.to_string());
        let tabs: Vec<Value> = TABS
            .iter()
            .chain(std::iter::once(&"terminal"))
            .map(|t| json!({"tab": t}))
            .collect();
        json!({"session": session, "tabs": tabs})
    }

    /// What a session's tab draws now: every item with its kind and text, and its controls.
    fn tab_reply(&self, session: &str, tab: &str) -> Value {
        let Some(s) = self.scenario.sessions.get(session) else {
            return json!({"code": "unknown_session"});
        };
        if !self.terms.pages.contains_key(session) {
            return json!({"code": "page_closed"});
        }
        if tab != "terminal" {
            return match TABS.contains(&tab) {
                true => json!({"tab": tab, "hosted": false, "drawn": [], "controls": []}),
                false => json!({"code": "unknown_tab"}),
            };
        }
        if let Some(id) = self.hosted_terminal(session) {
            let t = &self.terms.terms[&id];
            let text: Vec<String> = (0..t.term.rows())
                .map(|r| Terminal::text_of(t.term.row(r)))
                .collect();
            let joined = text.join("\n");
            // The planted tab draws the terminal's text as text items, outside the grid.
            let drawn = match self.planted(Planted::TabDrawsText) {
                true => text
                    .iter()
                    .enumerate()
                    .map(|(i, l)| json!({"id": format!("row{i}"), "kind": "text@1", "text": l}))
                    .collect::<Vec<_>>(),
                false => vec![json!({"id": "screen", "kind": "cells@1", "text": joined})],
            };
            return json!({"tab": "terminal", "hosted": true, "drawn": drawn, "controls": []});
        }
        // A terminal the hub doesn't host: only the line naming where it runs, with Open.
        let Some(runs_in) = &s.runs_in else {
            return json!({"tab": "terminal", "hosted": false, "drawn": [], "controls": []});
        };
        let mut drawn =
            vec![json!({"id": "where", "kind": "text@1", "text": format!("Runs in {runs_in}")})];
        if let (true, Some(lines)) = (self.planted(Planted::TabDrawsCapture), &s.capture) {
            drawn.push(json!({"id": "capture", "kind": "cells@1", "text": lines.join("\n")}));
        }
        json!({"tab": "terminal", "hosted": false, "drawn": drawn, "controls": [{"label": "Open"}]})
    }

    /// A sealed canvas module: its name, version, dependencies and the kinds it registers.
    fn module_reply(&self, name: &str) -> Value {
        let sealed = &self.startup.sealed;
        let Some(m) = sealed.modules.iter().find(|m| m.name == name) else {
            return json!({"code": "module_missing", "module": name});
        };
        let deps = depends_on(name);
        let kinds: Vec<String> = m
            .shapes
            .kinds
            .iter()
            .map(|k| format!("{}@{}", k.entry.full_name(), k.entry.current().major))
            .collect();
        json!({"module": {"name": m.name, "version": m.version.to_string(), "depends_on": deps,
                          "registers": {"kinds": kinds}}})
    }

    pub fn term_call(&mut self, call: &TermCall) -> Value {
        match call {
            TermCall::Open {
                terminal,
                home,
                cols,
                rows,
                history,
                feed,
            } => self.open(terminal, home, (*cols, *rows, *history), feed),
            TermCall::Cells(target) => match self.term_of(target) {
                Ok(t) => self.cells_reply(t),
                Err(e) => e,
            },
            TermCall::Cell(target, x, y) => self.cell_reply(target, *x, *y),
            TermCall::Updates(target) => match self.term_of(target) {
                Ok(t) => self.updates_reply(t),
                Err(e) => e,
            },
            TermCall::StreamOpen(stream, media) => {
                if !self.scenario.panels.contains_key(&media.panel) {
                    return json!({"code": "unknown_panel"});
                }
                self.terms.media.insert(stream.clone(), media.clone());
                json!({"opened": true, "stream": stream})
            }
            TermCall::Stream(id) => match self.terms.media.get(id) {
                Some(m) => self.media_reply(m),
                None => json!({"code": "unknown_stream"}),
            },
            // Only the panels a stream was opened for read it.
            TermCall::StreamRead(id, panel) => match self.terms.media.get(id) {
                Some(m) if m.panel == *panel => {
                    let frames = self.media_reply(m)["shown"].as_array().map_or(0, Vec::len);
                    json!({"frames": frames})
                }
                Some(_) => json!({"code": "not_opened_for_panel", "panel": panel}),
                None => json!({"code": "unknown_stream"}),
            },
            TermCall::SessionPage(session, panel) => self.session_page(session, panel),
            TermCall::Tab(session, tab) => self.tab_reply(session, tab),
            TermCall::Module(name) => self.module_reply(name),
        }
    }
}

/// A module's dependencies as its manifest names them.
fn depends_on(name: &str) -> Value {
    let all = crate::shipped_manifests();
    let Some(m) = all.iter().find(|m| m.name == name) else {
        return json!({});
    };
    Value::Object(
        m.depends_on
            .iter()
            .map(|(k, d)| {
                (
                    k.clone(),
                    json!({"range": d.range.to_string(), "optional": d.optional}),
                )
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_terminal_draws_the_looks_sixteen_colors_and_a_programs_own_as_sent() {
        let look = crate::hub::shipped_look();
        let colors = Colors::of(&look);
        let mut term = Terminal::new(4, 1, 0);
        // Bright black (ANSI 8), then the program's own true color at 1.5:1 on its own background.
        term.feed(b"\x1b[90ma\x1b[0m\x1b[38;2;44;44;44;48;2;0;0;0mb");
        let row = term.row(0);
        let first = cell_json(&row[0], &colors, None);
        assert_eq!(first["fg"], hex(look.light["term_bright_black"]));
        assert_eq!(first["bg"], hex(look.light["ground"]));
        let own = cell_json(&row[1], &colors, None);
        assert_eq!(
            (own["fg"].clone(), own["bg"].clone()),
            (json!("#2c2c2c"), json!("#000000"))
        );
    }
}
