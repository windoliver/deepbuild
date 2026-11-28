//! Issue #1498: the replica's copy of the hub's canvas core, as a session's page reads it (design: Replica; canvas
//! primitives: Selection, Cell grid `cells@1`, Input router, focus and gesture serial). A session's `deep_show` is made
//! current as a revision whose hash is its canonical bytes', checked by being drawn, and presented on the session's
//! page through render-back's raster. Your input over it goes through the core's interaction scope: a drag pans, a
//! click selects, a double press flies in and ⌥-drag selects text, and each view it leaves is presented again. A
//! session's terminal is the cells module's emulator, fed what its program writes: a press reaches the program while it
//! asks for the mouse, and selects cells while it doesn't. The router gives a gesture serial only to input the app
//! says is your hardware's, and ⌘C answers a selection's text only with one. Nothing here writes a selection into a
//! document, a revision or the record.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use deep_canvas::scope::{Event, Planted, Scope, Texts};
use deep_canvas::show::{stamp, Writer, WriterKind};
use deep_canvas_cells::emulator::{mouse_report, Terminal};
use deep_canvas_cells::palette::resolve;
use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::scene::Record;
use deep_canvas_marks::select::{self, TextBox};
use deep_marks_raster::Renderer;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use vello_cpu::kurbo::Affine;

mod sourced;

/// The history a hosted terminal keeps, in rows.
const HISTORY: usize = 10_000;
/// A terminal's palette defaults, as the hub's terminals draw them.
const FG: [u8; 3] = [0xe8, 0xe8, 0xe8];
const BG: [u8; 3] = [0x10, 0x10, 0x10];

/// One revision of a document: its number, hash, canonical bytes and the document.
struct Revision {
    rev: u64,
    hash: String,
    canonical: String,
    doc: Value,
}

/// A document a session's `deep_show` presents on its page.
struct Shown {
    doc: String,
    session: String,
    revisions: Vec<Revision>,
}

/// A session's page: its document's view, through the core's scope, and the text and boxes the view draws.
struct Page {
    doc: String,
    scope: Scope,
    /// The panel's rect, in its own px.
    rect: [f64; 4],
    /// The page region the view shows, in the document's units.
    region: [f64; 4],
    texts: Vec<TextBox>,
}

impl Page {
    /// Page units to the panel's px.
    fn to_px(&self, b: [f64; 4]) -> [f64; 4] {
        let k = self.rect[2] / self.region[2];
        [
            self.rect[0] + (b[0] - self.region[0]) * k,
            self.rect[1] + (b[1] - self.region[1]) * k,
            b[2] * k,
            b[3] * k,
        ]
    }
}

/// A terminal the core hosts for a session, and your cell selection on it.
struct Term {
    term: Terminal,
    /// Every byte sent to the program since it opened.
    input: Vec<u8>,
    revision: u64,
    selection: Option<((u16, u16), (u16, u16))>,
    pressing: bool,
}

/// The text a page draws, as the scope reads it.
struct PageTexts<'a>(&'a [TextBox]);

impl Texts for PageTexts<'_> {
    fn at(&self, c: [f64; 2], within: Option<f64>) -> Option<(String, usize)> {
        select::at(self.0, c, within)
    }

    fn len(&self, item: &str) -> Option<usize> {
        self.0.iter().find(|t| t.item == item).map(TextBox::len)
    }
}

pub struct Core {
    evidence: PathBuf,
    shown: Vec<Shown>,
    pages: BTreeMap<String, Page>,
    terms: BTreeMap<String, Term>,
    serial: u64,
    look: Look,
    planted: select::Planted,
    /// The replica's clock, flicks since launch.
    clock: Arc<AtomicU64>,
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn refused(code: &str, message: impl Into<String>) -> Value {
    json!({"code": code, "message": message.into()})
}

/// One event of an `input` call, as the canvas core reads it: a press, a move, a release or a key.
fn event(v: &Value) -> Option<Event> {
    let pos = || {
        let p = v["pos"].as_array()?;
        Some([p.first()?.as_f64()?, p.get(1)?.as_f64()?])
    };
    let mods: Vec<&str> = v["mods"]
        .as_array()
        .map(|m| m.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    Some(match v["type"].as_str()? {
        "down" => Event::Down {
            pos: pos()?,
            toggle: mods.contains(&"shift"),
            alt: mods.contains(&"alt"),
        },
        "move" => Event::Move(pos()?),
        "up" => Event::Up(pos()?),
        "key" => Event::Key {
            key: v["key"].as_str()?.to_owned(),
            cmd: mods.contains(&"cmd"),
            alt: mods.contains(&"alt"),
        },
        _ => return None,
    })
}

/// An RGBA raster as a PNG.
fn png(rgba: Vec<u8>, size: [u16; 2]) -> Result<Vec<u8>, Value> {
    let image = image::RgbaImage::from_raw(u32::from(size[0]), u32::from(size[1]), rgba)
        .ok_or_else(|| refused("not_drawn", "a raster is width × height × 4 bytes"))?;
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| refused("not_drawn", e.to_string()))?;
    Ok(out)
}

/// `#rrggbb`.
fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

impl Core {
    pub fn new(evidence: PathBuf, planted: select::Planted, clock: Arc<AtomicU64>) -> Core {
        let def = look::shipped("clean").expect("the clean look ships");
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        Core {
            evidence,
            shown: Vec::new(),
            pages: BTreeMap::new(),
            terms: BTreeMap::new(),
            serial: 0,
            look: look::resolve(&def, &bundled).expect("the clean look resolves"),
            planted,
            clock,
        }
    }

    /// The router: a gesture serial for your hardware's input, none for anything else.
    fn route(&mut self, hid: bool) -> Option<u64> {
        hid.then(|| {
            self.serial += 1;
            self.serial
        })
    }

    fn current(&self, doc: &str) -> Option<&Revision> {
        self.shown
            .iter()
            .find(|s| s.doc == doc)
            .and_then(|s| s.revisions.last())
    }

    /// `show`: `document` as `session`'s `deep_show`, a whole revision from its agent, checked by being drawn, made
    /// current and presented on the session's page. The reply, and the presentation for the app's panel.
    pub fn show(&mut self, session: &str, payload: Value) -> Result<(Value, Value), Value> {
        // The agent's own writer layer, from its session, as the hub stamps a whole revision; the document's ID in the
        // ID grammar's lower case.
        let doc = format!("doc-{}", session.to_ascii_lowercase());
        let writer = Writer {
            kind: WriterKind::Agent,
            id: session.to_owned(),
        };
        let document = stamp(payload, &doc, &writer, session).map_err(|issues| {
            json!({"code": "bad_doc", "message": "the document names a layer or a writer",
                "issues": issues.iter().map(|i| format!("{i:?}")).collect::<Vec<_>>()})
        })?;
        let canonical = deep_canvas::document::canonical(&document)
            .map_err(|e| refused("bad_doc", format!("{e:?}")))?;
        let size = |i: usize| document["size"][i].as_f64().filter(|v| *v > 0.0);
        let (Some(w), Some(h)) = (size(0), size(1)) else {
            return Err(refused("bad_doc", "a document shown on a page has a size"));
        };
        let rect = [0.0, 0.0, w, h];
        let scope = Scope::new(&document, rect, [w, h], Planted::default())
            .map_err(|r| refused(r.code, r.path))?;
        let at = match self.shown.iter().position(|s| s.doc == doc) {
            Some(at) => at,
            None => {
                self.shown.push(Shown {
                    doc: doc.clone(),
                    session: session.to_owned(),
                    revisions: Vec::new(),
                });
                self.shown.len() - 1
            }
        };
        let rev = self.shown[at].revisions.len() as u64 + 1;
        let revision = Revision {
            rev,
            hash: canonical.sha256.clone(),
            canonical: canonical.bytes,
            doc: document,
        };
        // A new document's page opens on its own camera; a new revision keeps the page's view.
        let page = self.pages.remove(session).filter(|p| p.doc == doc);
        let page = page.unwrap_or(Page {
            doc: doc.clone(),
            scope,
            rect,
            region: rect,
            texts: Vec::new(),
        });
        self.shown[at].revisions.push(revision);
        self.pages.insert(session.to_owned(), page);
        match self.present(session) {
            Ok(presented) => Ok((
                json!({"doc": doc, "rev": rev, "hash": canonical.sha256}),
                presented,
            )),
            Err(e) => {
                self.shown[at].revisions.pop();
                Err(e)
            }
        }
    }

    /// The session page's view drawn at its scope's camera, as one presented revision: its picture in the evidence
    /// folder, and each drawn item's value and box in the panel's px.
    fn present(&mut self, session: &str) -> Result<Value, Value> {
        let doc = self
            .pages
            .get(session)
            .map(|p| p.doc.clone())
            .ok_or_else(|| refused("not_presented", "no document on this page"))?;
        let revision = self
            .current(&doc)
            .ok_or_else(|| refused("not_presented", "no revision"))?;
        let (rev, mut document) = (revision.rev, revision.doc.clone());
        let read = document.as_object_mut().expect("a document is an object");
        deep_marks_vello::tables::tables(read, Some(&self.evidence))
            .map_err(|r| json!({"code": r.code, "path": r.path}))?;
        let read = document.as_object().expect("a document is an object");
        let mut renderer = Renderer::new();
        let drawn = renderer
            .prepare(
                read,
                0,
                &self.look.light,
                self.look.status.as_ref(),
                &Record::default(),
                &self.evidence,
            )
            .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let mut shaper = deep_text::Shaper::new();
        let texts = select::texts(&drawn.frame, &mut shaper);
        let lines = sourced::source_lines(read, &drawn.frame, &mut shaper);
        let boxes = drawn.boxes();
        let page = self.pages.get_mut(session).expect("looked up above");
        let pose = page.scope.pose();
        let rect = page.rect;
        let (w, h) = (pose.view_width, pose.view_width * rect[3] / rect[2]);
        page.region = [pose.target[0] - w / 2.0, pose.target[1] - h / 2.0, w, h];
        page.texts = texts;
        let size = [rect[2].round() as u16, rect[3].round() as u16];
        let k = rect[2] / page.region[2];
        let view = Affine::scale(k / drawn.scale(size))
            * Affine::translate((-page.region[0], -page.region[1]));
        let rgba = renderer.raster(
            &drawn.part(Some(view), true, false),
            size,
            Some(drawn.frame.ground),
        );
        let png = png(rgba, size)?;
        let sha = sha256(&png);
        let dir = self.evidence.join(&sha[..2]);
        std::fs::create_dir_all(&dir)
            .and_then(|()| std::fs::write(dir.join(&sha[2..]), &png))
            .map_err(|e| refused("not_written", e.to_string()))?;
        let page = &self.pages[session];
        let items: Vec<Value> = boxes
            .iter()
            .map(|(id, b)| {
                let kind = &document["items"][id]["kind"];
                // A text's box holds every line it draws.
                let (value, b) = match page.texts.iter().find(|t| &t.item == id) {
                    Some(t) => {
                        let r = t.rect;
                        let (x0, y0) = (b[0].min(r[0]), b[1].min(r[1]));
                        let (x1, y1) = (
                            (b[0] + b[2]).max(r[0] + r[2]),
                            (b[1] + b[3]).max(r[1] + r[3]),
                        );
                        (
                            json!({"kind": kind, "text": t.source}),
                            [x0, y0, x1 - x0, y1 - y0],
                        )
                    }
                    None => (json!({"kind": kind}), *b),
                };
                let placed = |(text, b): &sourced::Placed| json!({"text": text, "box": page.to_px(*b)});
                let rows = sourced::rows(read, id, &page.texts);
                let rows: Vec<Value> = rows.iter().map(placed).collect();
                let lines = lines.iter().filter(|(of, _)| of == id).map(|(_, line)| placed(line));
                let lines: Vec<Value> = lines.collect();
                json!({"id": id, "value": value, "box": page.to_px(b), "rows": rows, "source_lines": lines})
            })
            .collect();
        Ok(json!({
            "doc": doc, "rev": rev, "rect": rect, "session": session,
            "layers": [{"layer": "agent", "owner": {"session": session}, "band": "agent", "outline": false,
                        "name": null, "items": boxes.iter().map(|(id, _)| id).collect::<Vec<_>>(), "picture": sha}],
            "items": items,
        }))
    }

    /// Where the session page's text selection is drawn, in the panel's px.
    fn outline(&self, session: &str) -> Vec<[f64; 4]> {
        let Some(page) = self.pages.get(session) else {
            return Vec::new();
        };
        let Some(range) = page.scope.text_selection() else {
            return Vec::new();
        };
        let (a, f) = (&range.anchor, &range.focus);
        select::outline(&page.texts, (&a.0, a.1), (&f.0, f.1))
            .into_iter()
            .map(|b| page.to_px(b))
            .collect()
    }

    /// The session page's text selection's text.
    fn copied(&self, session: &str) -> Option<String> {
        let page = self.pages.get(session)?;
        let range = page.scope.text_selection()?;
        let (a, f) = (&range.anchor, &range.focus);
        Some(select::copy(
            &page.texts,
            (&a.0, a.1),
            (&f.0, f.1),
            self.planted,
        ))
    }

    /// One of your inputs on a session's page: through the scope, presented again when the view moved.
    fn page_input(&mut self, session: &str, e: &Value, hid: bool) -> Value {
        let serial = self.route(hid);
        let Some(event) = event(e) else {
            return refused("bad_input", format!("no event in {e}"));
        };
        let now = self.clock.load(Ordering::Relaxed) as i64;
        let Some(page) = self.pages.get_mut(session) else {
            return json!({"serial": serial});
        };
        let Some(doc) = self
            .shown
            .iter()
            .find(|s| s.doc == page.doc)
            .and_then(|s| s.revisions.last())
            .map(|r| r.doc.clone())
        else {
            return json!({"serial": serial});
        };
        let before = page.scope.pose();
        let texts = PageTexts(&page.texts);
        let done = page
            .scope
            .input_with(&doc, now, serial.unwrap_or(0), &event, Some(&texts));
        let moved = page.scope.pose() != before;
        let mut reply = json!({"serial": serial});
        if done.copy && serial.is_some() {
            reply["copy"] = json!(self.copied(session));
        }
        if moved {
            match self.present(session) {
                Ok(presented) => reply["presented"] = presented,
                Err(e) => return e,
            }
        }
        reply["outline"] = json!(self.outline(session));
        reply
    }

    /// One of your inputs on a session's terminal grid: to the program while it asks for the mouse, else a cell
    /// selection, which ⌘C with a serial copies.
    fn grid_input(&mut self, session: &str, e: &Value, hid: bool) -> Value {
        let serial = self.route(hid);
        let Some(t) = self.terms.get_mut(session) else {
            return json!({"serial": serial});
        };
        let cell = e["cell"].as_array().and_then(|c| {
            let at = |i: usize| c.get(i)?.as_u64().and_then(|v| u16::try_from(v).ok());
            Some((at(0)?, at(1)?))
        });
        let mut reply = json!({"serial": serial});
        match (e["type"].as_str(), cell) {
            (Some(kind @ ("down" | "up")), Some(cell)) if t.term.modes.mouse => {
                t.input.extend(mouse_report(
                    t.term.modes.mouse_name(),
                    cell,
                    kind == "down",
                ));
            }
            (Some("down"), Some(cell)) => {
                t.pressing = true;
                t.selection = Some(match e["count"].as_u64() {
                    Some(2) => t.term.word(cell),
                    Some(n) if n >= 3 => t.term.line(cell.1),
                    _ => (cell, cell),
                });
            }
            (Some("move" | "up"), Some(cell)) if t.pressing => {
                if let Some((_, focus)) = t.selection.as_mut() {
                    *focus = cell;
                }
                t.pressing = e["type"] == "move";
            }
            (Some("key"), _) => {
                let cmd = e["mods"]
                    .as_array()
                    .is_some_and(|m| m.iter().any(|k| k == "cmd"));
                if let (true, "c", Some(_), Some((a, f))) =
                    (cmd, e["key"].as_str().unwrap_or(""), serial, t.selection)
                {
                    reply["copy"] = json!(t.term.copy(a, f));
                }
            }
            _ => {}
        }
        reply["outline"] = json!(Self::cells_outline(t));
        reply
    }

    /// The selected cells as the grid outlines them: each row's `[from, row, to]`, both columns included.
    fn cells_outline(t: &Term) -> Vec<[u16; 3]> {
        let Some((a, f)) = t.selection else {
            return Vec::new();
        };
        let key = |(x, y): (u16, u16)| (y, x);
        let (from, to) = if key(a) <= key(f) { (a, f) } else { (f, a) };
        (from.1..=to.1)
            .map(|y| {
                let x0 = if y == from.1 { from.0 } else { 0 };
                let x1 = if y == to.1 { to.0 } else { t.term.cols() - 1 };
                [x0, y, x1]
            })
            .collect()
    }

    /// `terminal`: session `session`'s terminal, opened at `size` on the first call, fed what its program writes;
    /// what it has sent its program since it opened.
    pub fn terminal(
        &mut self,
        session: &str,
        size: Option<[u16; 2]>,
        output: &str,
    ) -> Result<Value, Value> {
        if !self.terms.contains_key(session) {
            let Some([cols, rows]) = size.filter(|[c, r]| *c > 0 && *r > 0) else {
                return Err(refused(
                    "refused",
                    "a terminal opens at a size: [cols, rows]",
                ));
            };
            self.terms.insert(
                session.to_owned(),
                Term {
                    term: Terminal::new(cols, rows, HISTORY),
                    input: Vec::new(),
                    revision: 0,
                    selection: None,
                    pressing: false,
                },
            );
        }
        let t = self.terms.get_mut(session).expect("opened above");
        if !output.is_empty() {
            t.term.feed(output.as_bytes());
            t.revision += 1;
        }
        Ok(
            json!({"terminal": {"session": session, "size": [t.term.cols(), t.term.rows()],
            "input": String::from_utf8_lossy(&t.input)}}),
        )
    }

    /// A terminal's grid as the session page's tab reads it: each row's text and its runs of `[from, to, fg, bg]`.
    fn cells(&self, session: &str) -> Option<Value> {
        let t = self.terms.get(session)?;
        let (x, y) = t.term.cursor();
        let rows = 0..t.term.rows();
        let text: Vec<String> = rows
            .clone()
            .map(|r| Terminal::text_of(t.term.row(r)))
            .collect();
        let runs: Vec<Value> = rows
            .map(|r| {
                let mut out: Vec<(usize, usize, [u8; 3], [u8; 3])> = Vec::new();
                for (i, c) in t.term.row(r).iter().enumerate() {
                    let (f, b) = (resolve(c.fg, FG), resolve(c.bg, BG));
                    match out.last_mut() {
                        Some(run) if run.2 == f && run.3 == b && run.1 == i => run.1 = i + 1,
                        _ => out.push((i, i + 1, f, b)),
                    }
                }
                Value::Array(
                    out.into_iter()
                        .map(|(a, b, f, g)| json!([a, b, hex(f), hex(g)]))
                        .collect(),
                )
            })
            .collect();
        Some(
            json!({"revision": t.revision, "cols": t.term.cols(), "rows": t.term.rows(), "text": text,
            "runs": runs, "cursor": {"x": x, "y": y}, "bg": hex(BG), "fg": hex(FG)}),
        )
    }

    /// `stored`: each presented document with its current revision and every revision it holds.
    pub fn stored(&self) -> Vec<Value> {
        self.shown
            .iter()
            .filter_map(|s| {
                let current = s.revisions.last()?;
                Some(json!({
                    "doc": s.doc, "session": s.session, "rev": current.rev, "hash": current.hash,
                    "canonical": current.canonical,
                    "revisions": s.revisions.iter().map(|r| json!({"rev": r.rev, "hash": r.hash})).collect::<Vec<_>>(),
                }))
            })
            .collect()
    }

    /// Each text item on a session's page with its carets, the one before each grapheme of its source and the one
    /// after its last, as `[x, top, height]` in the panel's px.
    pub fn carets(&self, session: &str) -> Vec<(String, Vec<[f64; 3]>)> {
        let Some(page) = self.pages.get(session) else {
            return Vec::new();
        };
        page.texts
            .iter()
            .map(|t| {
                let carets = (0..=t.len())
                    .map(|offset| {
                        let [x, top, h] = t.caret(offset);
                        let b = page.to_px([x, top, 0.0, h]);
                        [b[0], b[1], b[3]]
                    })
                    .collect();
                (t.item.clone(), carets)
            })
            .collect()
    }

    /// One `canvas.user` call of the app's: a session's page, its tabs and its terminal's grid, and your input.
    pub fn user(&mut self, call: &Value) -> Result<Value, Value> {
        let session = call["session"].as_str().unwrap_or_default();
        match call["call"].as_str() {
            Some("session_page") => Ok(json!({"session": session, "panel": call["panel"]})),
            Some("tab") if self.terms.contains_key(session) => {
                Ok(json!({"tab": call["tab"], "drawn": [{"kind": "cells@1", "text": "Terminal"}]}))
            }
            Some("cells") => self
                .cells(session)
                .ok_or_else(|| refused("not_found", "no terminal in this session")),
            Some("input") => {
                let hid = call["hid"].as_bool().unwrap_or(false);
                Ok(match (call["panel"].as_str(), call["tab"].as_str()) {
                    (Some(_), _) => self.page_input(session, &call["event"], hid),
                    (_, Some("terminal")) => self.grid_input(session, &call["event"], hid),
                    _ => json!({"serial": self.route(hid)}),
                })
            }
            _ => Err(refused(
                "not_found",
                format!("the canvas core has no call {}", call["call"]),
            )),
        }
    }
}
