//! #555: a play interface's names on a piece, and the playtest plug-in's first-party bots that
//! play its grid (canvas primitives: Play interface `game.play@1`, Check input: playtest). The
//! interface, locked in the brief, names the logic arrays a game publishes; a play that carries it
//! refuses, before any step, a name the piece publishes no array for, or one of the wrong type,
//! with `play.missing`, naming the name. The bots read only those names and act only by choosing
//! a listed row: the legal bot by hash(the run's seed, the step) or by the highest score; the
//! explorer by its own breadth-first search toward the nearest reachable cell it hasn't stood on,
//! opening a locked cell only after standing on its key; the descender the same way toward the
//! nearest exit, then the action the brief names. Each falls back to the legal bot's seeded pick
//! when no listed row moves it along its path, acts at most once every `every` steps, and runs in
//! the replica beside the piece, so its search costs the piece no fuel.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Value};

use crate::piece::{h64, Piece, Ty};
use crate::world::World;

/// A declared name resolved to the item that publishes it and the array's name there.
#[derive(Clone, Debug)]
struct At {
    item: usize,
    array: String,
}

/// An action as the interface declares it, in declaration order.
#[derive(Clone, Debug)]
pub struct Action {
    pub name: String,
    pub control: String,
    pub action: Option<String>,
    pub args: String,
}

/// The classes a cell's value can hold.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Class {
    Open,
    Blocked,
    Door,
    Locked,
    Key,
    Exit,
}

const CLASSES: [(&str, Class); 6] = [
    ("open", Class::Open),
    ("blocked", Class::Blocked),
    ("door", Class::Door),
    ("locked", Class::Locked),
    ("key", Class::Key),
    ("exit", Class::Exit),
];

/// The grid as the interface declares it. With `layers` above 1 (#1048), the cells are indexed
/// layer by layer, a cell's y running on through the layers below (layer × height + row), so a
/// surface and a cave are one grid; `links`, rows of (from cell, to cell, two_way) with a count,
/// join cells a step can't, such as stairs, gates between layers and teleporters.
#[derive(Debug)]
struct Grid {
    cells: At,
    size: [i32; 2],
    layers: i32,
    links: Option<(At, At)>,
    /// `None` on a square grid; on a hex grid, whether it's pointy and whether odd rows (or
    /// columns) are offset.
    hex: Option<(bool, bool)>,
    eight: bool,
    classes: Vec<(Class, Vec<i32>)>,
    locks: BTreeMap<i32, i32>,
    floor: Option<At>,
}

/// A play interface resolved against a piece: what the bots read.
#[derive(Debug)]
pub struct Iface {
    pub actions: Vec<Action>,
    /// `legal.rows` and `legal.count`, which every first-party bot reads.
    legal: Option<(At, At)>,
    score: Option<At>,
    grid: Option<Grid>,
    unit_cell: Option<At>,
    me: usize,
    /// Every name the interface declares, by its label, as resolved (#1048: what a throwaway
    /// copy compares).
    names: Vec<(String, At)>,
}

/// A declared name's array path: the name itself, or an object's `name`, `path` or `at` when the
/// name carries a unit, a range or a step.
pub fn path_of(v: &Value) -> Option<&str> {
    v.as_str().or_else(|| {
        ["name", "path", "at"]
            .iter()
            .find_map(|k| v.get(*k).and_then(Value::as_str))
    })
}

/// What a declared name must be, by where the interface puts it.
#[derive(Clone, Copy)]
enum Want {
    /// One number a step: a bool, an i32 or an f64.
    Number,
    /// i32s, `count` of them when given, a multiple of `every` otherwise.
    I32 { count: Option<u32>, every: u32 },
}

fn missing(name: &str, what: String) -> Value {
    json!({"ok": false, "code": "play.missing", "name": name, "what": format!("{name}: {what}")})
}

/// The array a declared name names, checked for its type.
fn resolve(piece: &Piece, name: &str, v: &Value, want: Want) -> Result<At, Value> {
    let path = path_of(v).ok_or_else(|| missing(name, "it names no array".into()))?;
    let (id, array) = path
        .split_once('.')
        .ok_or_else(|| missing(name, format!("{path} isn't a logic array path")))?;
    let (item, w) = piece
        .items
        .iter()
        .enumerate()
        .find(|(_, i)| i.id == id)
        .and_then(|(n, i)| Some((n, i.writes.iter().find(|w| w.name == array)?)))
        .ok_or_else(|| missing(name, format!("the piece publishes no array {path}")))?;
    let ok = match want {
        Want::Number => matches!(w.ty, Ty::Bool | Ty::I32 | Ty::F64),
        Want::I32 { count, every } => {
            w.ty == Ty::I32 && count.map_or(w.count % every == 0 && w.count > 0, |c| w.count == c)
        }
    };
    if !ok {
        let need = match want {
            Want::Number => "a bool, an i32 or an f64".to_string(),
            Want::I32 { count: Some(c), .. } => format!("{c} i32"),
            Want::I32 { every, .. } => format!("i32 in groups of {every}"),
        };
        return Err(missing(
            name,
            format!("{path} is {} {}, not {need}", w.count, w.ty.name()),
        ));
    }
    Ok(At {
        item,
        array: array.to_string(),
    })
}

impl Iface {
    /// The interface `play` resolved against `piece`, or `play.missing` naming the first declared
    /// name the piece publishes no array of the right type for.
    pub fn of(play: &Value, piece: &Piece) -> Result<Iface, Value> {
        let obj = |k: &str| play.get(k).and_then(Value::as_object);
        // Every name the interface declares, each checked even when no bot reads it.
        let mut named: Vec<(String, &Value, Want)> = Vec::new();
        for k in ["turn", "accepted", "refused"] {
            if let Some(v) = play.get(k) {
                named.push((k.into(), v, Want::Number));
            }
        }
        for group in ["rewards", "values"] {
            for (k, v) in obj(group).into_iter().flatten() {
                named.push((k.clone(), v, Want::Number));
            }
        }
        for k in ["hp", "side", "alive"] {
            if let Some(v) = play.pointer(&format!("/units/{k}")) {
                named.push((format!("units.{k}"), v, Want::Number));
            }
        }
        let mut names = Vec::new();
        for (label, at, _) in &named {
            names.push((label.clone(), resolve(piece, label, at, Want::Number)?));
        }
        let legal = |k: &str| play.pointer(&format!("/legal/{k}"));
        let rows = play
            .get("legal")
            .map(|_| -> Result<(At, At), Value> {
                Ok((
                    resolve(
                        piece,
                        "legal.rows",
                        legal("rows").unwrap_or(&Value::Null),
                        Want::I32 {
                            count: None,
                            every: 3,
                        },
                    )?,
                    resolve(
                        piece,
                        "legal.count",
                        legal("count").unwrap_or(&Value::Null),
                        Want::Number,
                    )?,
                ))
            })
            .transpose()?;
        let score = legal("score")
            .map(|v| resolve(piece, "legal.score", v, Want::Number))
            .transpose()?;
        let unit_cell = play
            .pointer("/units/cell")
            .map(|v| {
                resolve(
                    piece,
                    "units.cell",
                    v,
                    Want::I32 {
                        count: None,
                        every: 2,
                    },
                )
            })
            .transpose()?;
        let grid = match play.get("grid") {
            Some(g) => Some(Grid::of(g, piece)?),
            None => None,
        };
        let pairs = [
            ("legal.rows", rows.as_ref().map(|r| &r.0)),
            ("legal.count", rows.as_ref().map(|r| &r.1)),
            ("legal.score", score.as_ref()),
            ("units.cell", unit_cell.as_ref()),
        ];
        names.extend(
            pairs
                .into_iter()
                .filter_map(|(l, a)| Some((l.to_string(), a?.clone()))),
        );
        if let Some(g) = &grid {
            names.push(("grid.cells".into(), g.cells.clone()));
            names.extend(
                g.floor
                    .iter()
                    .map(|f| ("grid.floor".to_string(), f.clone())),
            );
            if let Some((rows, count)) = &g.links {
                names.push(("grid.links".into(), rows.clone()));
                names.push(("grid.links.count".into(), count.clone()));
            }
        }
        let mut actions = Vec::new();
        for (name, a) in obj("actions").into_iter().flatten() {
            actions.push(Action {
                name: name.clone(),
                control: a
                    .get("control")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                action: a.get("action").and_then(Value::as_str).map(str::to_string),
                args: a
                    .get("args")
                    .and_then(Value::as_str)
                    .unwrap_or("none")
                    .to_string(),
            });
        }
        Ok(Iface {
            actions,
            legal: rows,
            score,
            grid,
            unit_cell,
            me: play
                .pointer("/units/self")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            names,
        })
    }

    /// Each declared name's array now, by its label (#1048).
    pub fn read(&self, world: &World) -> Vec<(String, Vec<Value>)> {
        self.names
            .iter()
            .map(|(l, at)| {
                (
                    l.clone(),
                    world.array(at.item, &at.array).unwrap_or_default(),
                )
            })
            .collect()
    }

    /// The listed rows now (#1048: rules.legal puts each).
    pub fn listed(&self, world: &World) -> Vec<[i32; 3]> {
        self.rows(world)
    }

    /// The rows the piece lists now, `legal.count` of them, each naming a declared action; a row
    /// naming none is no gesture a player could make, so no bot plays it.
    fn rows(&self, world: &World) -> Vec<[i32; 3]> {
        let Some((rows, count)) = &self.legal else {
            return Vec::new();
        };
        let n = number(world, count).max(0.0) as usize;
        let flat = ints(world, rows);
        flat.as_chunks::<3>()
            .0
            .iter()
            .take(n)
            .copied()
            .filter(|r| usize::try_from(r[0]).is_ok_and(|a| a < self.actions.len()))
            .collect()
    }
}

impl Grid {
    fn of(g: &Value, piece: &Piece) -> Result<Grid, Value> {
        let size = match g.get("size").and_then(Value::as_array).map(Vec::as_slice) {
            Some([w, h]) => [
                w.as_i64().unwrap_or(0) as i32,
                h.as_i64().unwrap_or(0) as i32,
            ],
            _ => return Err(missing("grid.size", "it's [width, height]".into())),
        };
        let layers = g.get("layers").and_then(Value::as_i64).unwrap_or(1).max(1) as i32;
        let cells = resolve(
            piece,
            "grid.cells",
            g.get("cells").unwrap_or(&Value::Null),
            Want::I32 {
                count: Some((layers * size[0].max(0) * size[1].max(0)) as u32),
                every: 1,
            },
        )?;
        // `links: name` with `links.count: name` beside it, or `links: {rows, count}`.
        let links = match g.get("links") {
            None | Some(Value::Null) => None,
            Some(l) => {
                let rows = l.get("rows").unwrap_or(l);
                let count = l
                    .get("count")
                    .or_else(|| g.get("links.count"))
                    .unwrap_or(&Value::Null);
                Some((
                    resolve(
                        piece,
                        "grid.links",
                        rows,
                        Want::I32 {
                            count: None,
                            every: 3,
                        },
                    )?,
                    resolve(piece, "grid.links.count", count, Want::Number)?,
                ))
            }
        };
        let floor = g
            .get("floor")
            .map(|v| resolve(piece, "grid.floor", v, Want::Number))
            .transpose()?;
        let hex = (g.get("shape").and_then(Value::as_str) == Some("hex")).then(|| {
            (
                g.pointer("/hex/orient").and_then(Value::as_str) != Some("flat"),
                g.pointer("/hex/offset").and_then(Value::as_str) != Some("even"),
            )
        });
        let classes = CLASSES
            .iter()
            .filter_map(|(name, c)| {
                let values = g.pointer(&format!("/classes/{name}"))?.as_array()?;
                Some((
                    *c,
                    values
                        .iter()
                        .filter_map(|v| Some(v.as_i64()? as i32))
                        .collect(),
                ))
            })
            .collect();
        let locks = g
            .get("locks")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(k, v)| Some((k.parse().ok()?, v.as_i64()? as i32)))
            .collect();
        Ok(Grid {
            cells,
            size,
            layers,
            links,
            hex,
            eight: g.get("moves").and_then(Value::as_u64) == Some(8),
            classes,
            locks,
            floor,
        })
    }

    /// A value's class; a value no class holds counts as blocked.
    fn class(&self, v: i32) -> Class {
        self.classes
            .iter()
            .find(|(_, vs)| vs.contains(&v))
            .map_or(Class::Blocked, |(c, _)| *c)
    }

    /// Whether a cell lies on the grid: x across, y down through every layer.
    fn holds(&self, [x, y]: [i32; 2]) -> bool {
        (0..self.size[0]).contains(&x) && (0..self.layers * self.size[1]).contains(&y)
    }

    /// The links the piece lists now, `links.count` rows of (from, to, two_way), each as the
    /// cells it joins; a row naming a cell off the grid joins nothing (the check names it).
    fn links(&self, world: &World) -> Vec<([i32; 2], [i32; 2], bool)> {
        let Some((rows, count)) = &self.links else {
            return Vec::new();
        };
        let n = number(world, count).max(0.0) as usize;
        let w = self.size[0];
        let cell = |i: i32| [i.rem_euclid(w.max(1)), i.div_euclid(w.max(1))];
        ints(world, rows)
            .as_chunks::<3>()
            .0
            .iter()
            .take(n)
            .filter(|[f, t, _]| {
                let all = self.layers * w * self.size[1];
                (0..all).contains(f) && (0..all).contains(t)
            })
            .map(|[f, t, two]| (cell(*f), cell(*t), *two != 0))
            .collect()
    }

    /// A cell's neighbors in a fixed order: 4 or 8 on a square grid, 6 on a hex grid with its
    /// offset, within its own layer.
    fn neighbors(&self, [x, y]: [i32; 2]) -> Vec<[i32; 2]> {
        // A cell's row within its layer; a step never leaves the layer.
        let h = self.size[1].max(1);
        let (layer, y) = (y.div_euclid(h), y.rem_euclid(h));
        const FOUR: [[i32; 2]; 4] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const EIGHT: [[i32; 2]; 8] = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
        ];
        let steps: Vec<[i32; 2]> = match self.hex {
            None if self.eight => EIGHT.to_vec(),
            None => FOUR.to_vec(),
            Some((pointy, odd)) => {
                // Offset coordinates: the shifted rows (pointy) or columns (flat) have the other
                // diagonal pair.
                let shifted = if pointy { y } else { x }.rem_euclid(2) == i32::from(odd);
                match (pointy, shifted) {
                    (true, false) => vec![[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
                    (true, true) => vec![[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]],
                    (false, false) => vec![[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]],
                    (false, true) => vec![[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]],
                }
            }
        };
        steps
            .into_iter()
            .map(|[dx, dy]| [x + dx, y + dy])
            .filter(|[x, y]| (0..self.size[0]).contains(x) && (0..h).contains(y))
            .map(|[x, y]| [x, layer * h + y])
            .collect()
    }
}

fn number(world: &World, at: &At) -> f64 {
    world
        .array(at.item, &at.array)
        .and_then(|a| a.first().cloned())
        .map_or(0.0, |v| {
            v.as_f64().or(v.as_bool().map(f64::from)).unwrap_or(0.0)
        })
}

fn ints(world: &World, at: &At) -> Vec<i32> {
    world
        .array(at.item, &at.array)
        .unwrap_or_default()
        .iter()
        .map(|v| v.as_i64().unwrap_or(0) as i32)
        .collect()
}

/// Which first-party bot, with what it needs.
#[derive(Debug)]
enum Kind {
    Legal { greedy: bool },
    Explorer,
    Descender { action: usize },
}

/// A first-party bot on one run: its seed, its pace and what it remembers of the floor it's on.
#[derive(Debug)]
pub struct Bot {
    kind: Kind,
    every: i64,
    seed: u64,
    last: Option<i64>,
    /// The cells it has stood on, and the key values it has stood on, on this floor.
    stood: BTreeSet<[i32; 2]>,
    keys: BTreeSet<i32>,
    floor: Option<f64>,
    /// The grid as it last read it, so a key the piece takes up as the unit steps on it counts.
    before: Vec<i32>,
    /// #1048's planted walker: its search leaves the grid's links out.
    pub ignores_links: bool,
}

impl Bot {
    /// The first-party bot `bot` names, if it names one (`legal`, `explorer` or `descender`),
    /// checked against the interface: a bot that walks needs a grid and the self unit's cell, and
    /// a descender's action must be one the interface declares.
    pub fn of(bot: &Value, iface: Option<&Iface>, seed: u64) -> Result<Option<Bot>, Value> {
        let (name, params) = match ["legal", "explorer", "descender"]
            .iter()
            .find_map(|k| Some((*k, bot.get(*k)?)))
        {
            Some(found) => found,
            None => return Ok(None),
        };
        let refuse = |what: String| json!({"ok": false, "code": "bad_input", "what": what});
        let iface = iface.ok_or_else(|| {
            refuse(format!(
                "the {name} bot plays a play interface, and the play gives none"
            ))
        })?;
        if iface.legal.is_none() {
            return Err(missing(
                "legal",
                format!("the {name} bot acts only through listed rows, and the interface declares no legal list"),
            ));
        }
        let kind = match name {
            "legal" => Kind::Legal {
                greedy: match params.get("pick").and_then(Value::as_str).unwrap_or("seeded") {
                    "seeded" => false,
                    "greedy" if iface.score.is_some() => true,
                    "greedy" => {
                        return Err(missing(
                            "legal.score",
                            "a greedy legal bot reads it, and the interface declares none".into(),
                        ))
                    }
                    other => return Err(refuse(format!("a legal bot's pick is seeded or greedy, not {other}"))),
                },
            },
            _ if iface.grid.is_none() || iface.unit_cell.is_none() => {
                return Err(refuse(format!(
                    "the {name} walks the interface's grid from the self unit's cell, and it declares {}",
                    if iface.grid.is_none() { "no grid" } else { "no units.cell" }
                )))
            }
            "explorer" => Kind::Explorer,
            _ => {
                let action = params.get("action").and_then(Value::as_str).unwrap_or("");
                let i = iface
                    .actions
                    .iter()
                    .position(|a| a.name == action)
                    .ok_or_else(|| {
                        json!({"ok": false, "code": "action_undeclared", "action": action,
                               "what": format!("the descender names the action {action}, which the play interface doesn't declare")})
                    })?;
                Kind::Descender { action: i }
            }
        };
        let every = params.get("every").and_then(Value::as_i64).unwrap_or(1);
        if every < 1 {
            return Err(refuse(format!(
                "a {name} bot's every is a count of steps, 1 or more"
            )));
        }
        Ok(Some(Bot {
            kind,
            every,
            seed,
            last: None,
            stood: BTreeSet::new(),
            keys: BTreeSet::new(),
            floor: None,
            before: Vec::new(),
            ignores_links: false,
        }))
    }

    /// hash(the run's seed, the step): the legal bot's draw.
    fn draw(&self, k: i64) -> u64 {
        let mut b = self.seed.to_le_bytes().to_vec();
        b.extend(b"legal\0");
        b.extend(k.to_le_bytes());
        h64(&b)
    }

    fn seeded(&self, k: i64, rows: &[[i32; 3]]) -> [i32; 3] {
        rows[(self.draw(k) % rows.len() as u64) as usize]
    }

    /// The row this bot plays after step `k`, if it acts there: none while the piece lists no row
    /// or before `every` steps have passed since it last acted.
    pub fn act(&mut self, k: i64, world: &World, iface: &Iface) -> Option<[i32; 3]> {
        // What it remembers comes from every step, not only those it acts on.
        let walk = match self.kind {
            Kind::Explorer | Kind::Descender { .. } => self.look(world, iface),
            Kind::Legal { .. } => None,
        };
        if self.last.is_some_and(|l| k - l < self.every) {
            return None;
        }
        let rows = iface.rows(world);
        if rows.is_empty() {
            return None;
        }
        self.last = Some(k);
        let row = match self.kind {
            Kind::Legal { greedy: false } => self.seeded(k, &rows),
            Kind::Legal { greedy: true } => {
                let score = iface.score.as_ref().map(|s| {
                    world
                        .array(s.item, &s.array)
                        .unwrap_or_default()
                        .iter()
                        .map(|v| v.as_f64().unwrap_or(f64::NEG_INFINITY))
                        .collect::<Vec<_>>()
                });
                let score = score.unwrap_or_default();
                let at = |i: usize| score.get(i).copied().unwrap_or(f64::NEG_INFINITY);
                let best = (0..rows.len()).map(at).fold(f64::NEG_INFINITY, f64::max);
                let ties: Vec<[i32; 3]> = (0..rows.len())
                    .filter(|i| at(*i) == best)
                    .map(|i| rows[i])
                    .collect();
                self.seeded(k, &ties)
            }
            Kind::Explorer | Kind::Descender { .. } => {
                let (here, cells) = walk?;
                let grid = iface.grid.as_ref()?;
                let found = match self.kind {
                    Kind::Descender { action }
                        if grid.class(cells[(here[1] * grid.size[0] + here[0]) as usize])
                            == Class::Exit =>
                    {
                        rows.iter().find(|r| r[0] as usize == action).copied()
                    }
                    _ => {
                        let links = if self.ignores_links {
                            Vec::new()
                        } else {
                            grid.links(world)
                        };
                        let next = self.path(grid, &cells, &links, here);
                        next.and_then(|[x, y]| {
                            rows.iter()
                                .find(|r| {
                                    iface
                                        .actions
                                        .get(r[0] as usize)
                                        .is_some_and(|a| a.args == "cell")
                                        && r[1] == x
                                        && r[2] == y
                                })
                                .copied()
                        })
                    }
                };
                // The planted walker that ignores links plays no listed row whose target isn't next
                // to its cell on its layer, its fallback included.
                let rows: Vec<[i32; 3]> = if self.ignores_links {
                    let near = grid.neighbors(here);
                    rows.into_iter()
                        .filter(|r| {
                            iface
                                .actions
                                .get(r[0] as usize)
                                .is_none_or(|a| a.args != "cell")
                                || near.contains(&[r[1], r[2]])
                        })
                        .collect()
                } else {
                    rows
                };
                if rows.is_empty() {
                    return None;
                }
                found.unwrap_or_else(|| self.seeded(k, &rows))
            }
        };
        Some(row)
    }

    /// Reads the grid and the self unit's cell, and remembers the cell as stood on, with its key
    /// when it holds one now or held one at the last read; a new floor forgets both.
    fn look(&mut self, world: &World, iface: &Iface) -> Option<([i32; 2], Vec<i32>)> {
        let grid = iface.grid.as_ref()?;
        let cells = ints(world, &grid.cells);
        let unit = ints(world, iface.unit_cell.as_ref()?);
        let here = [*unit.get(2 * iface.me)?, *unit.get(2 * iface.me + 1)?];
        if let Some(f) = &grid.floor {
            let now = number(world, f);
            if self.floor != Some(now) {
                self.floor = Some(now);
                self.stood.clear();
                self.keys.clear();
                self.before.clear();
            }
        }
        if !grid.holds(here) {
            return None;
        }
        let i = (here[1] * grid.size[0] + here[0]) as usize;
        self.stood.insert(here);
        for v in [cells.get(i), self.before.get(i)].into_iter().flatten() {
            if grid.class(*v) == Class::Key {
                self.keys.insert(*v);
            }
        }
        self.before.clone_from(&cells);
        Some((here, cells))
    }

    /// The first cell of its path from `here` by its own breadth-first search: toward the nearest
    /// cell it hasn't stood on (the explorer) or the nearest exit (the descender), through open,
    /// door, key and exit cells and the locked cells whose key it has stood on.
    fn path(
        &self,
        grid: &Grid,
        cells: &[i32],
        links: &[([i32; 2], [i32; 2], bool)],
        here: [i32; 2],
    ) -> Option<[i32; 2]> {
        let w = grid.size[0];
        let at = |[x, y]: [i32; 2]| (y * w + x) as usize;
        let passes = |c: [i32; 2]| {
            let v = cells[at(c)];
            match grid.class(v) {
                Class::Open | Class::Door | Class::Key | Class::Exit => true,
                Class::Locked => grid
                    .locks
                    .get(&v)
                    .is_some_and(|key| self.keys.contains(key)),
                Class::Blocked => false,
            }
        };
        let goal = |c: [i32; 2]| match self.kind {
            Kind::Descender { .. } => grid.class(cells[at(c)]) == Class::Exit,
            _ => !self.stood.contains(&c),
        };
        let mut from: Vec<Option<[i32; 2]>> = vec![None; cells.len()];
        let mut seen = vec![false; cells.len()];
        seen[at(here)] = true;
        let mut queue = VecDeque::from([here]);
        while let Some(c) = queue.pop_front() {
            if c != here && goal(c) {
                // Back along the search to the cell next to `here`.
                let mut step = c;
                while let Some(p) = from[at(step)] {
                    if p == here {
                        return Some(step);
                    }
                    step = p;
                }
                return None;
            }
            // A link is one move from its from cell (and back, when two-way), after the steps.
            let across = links.iter().filter_map(|&(f, t, two)| {
                if f == c {
                    Some(t)
                } else if two && t == c {
                    Some(f)
                } else {
                    None
                }
            });
            let next: Vec<[i32; 2]> = grid.neighbors(c).into_iter().chain(across).collect();
            for n in next {
                if !seen[at(n)] && passes(n) {
                    seen[at(n)] = true;
                    from[at(n)] = Some(c);
                    queue.push_back(n);
                }
            }
        }
        None
    }
}
