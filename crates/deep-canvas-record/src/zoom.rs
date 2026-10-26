//! Issue #383: zoom into a part of the Map. The level a part opens shows its own rows (what a map
//! layer returns: a kind, a parent, the level it shows at and what it holds), ranked by salience
//! over their record facts, and folds the rest into one count. Files are never the level's
//! items: a file shows only as evidence, beside a check that points at it. A layer whose rows at
//! a part's own level list files breaks the level rule, named by the part.

use crate::{level, Fold, Item, Options, Shown};

/// A part of the Map and the repo files it is made of.
pub struct Part {
    pub id: String,
    pub files: Vec<String>,
}

/// A row a map layer returns.
pub struct Row {
    pub kind: String,
    /// The ID of the level it shows at.
    pub level: String,
    pub name: String,
    pub holds: String,
    /// Its ID and record facts, as salience ranks them.
    pub item: Item,
}

/// A check on a part and the files it points at.
pub struct Check {
    pub id: String,
    pub part: String,
    pub points_at: Vec<String>,
}

/// The wrong programs the #383 suite proves its tests fail on.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Planted {
    /// The level also shows the part's files as items.
    FilesAsItems,
    /// A check adds every file of the folder it points into.
    EvidenceByFolder,
    /// The level rule isn't checked.
    LevelRuleOff,
}

/// One item the level shows: its row's kind, name and what it holds, and its place in the
/// ranking.
pub struct Placed {
    pub kind: String,
    pub name: String,
    pub holds: String,
    pub shown: Shown,
}

/// The level a part opens, as drawn.
pub struct Zoom<'a> {
    pub shown: Vec<Placed>,
    pub fold: Option<Fold>,
    /// Each check on the part that points at a file, with the files it adds beside it.
    pub evidence: Vec<(&'a str, Vec<String>)>,
}

/// The level rule's refusal: the part whose level lists its files.
pub struct ListsFiles<'a> {
    pub part: &'a str,
}

/// Zooms into `open`: its rows ranked, `show` of them lowered to what `fits`, the rest folded,
/// and the files its checks point at as evidence.
pub fn zoom<'a>(
    parts: &'a [Part],
    rows: &'a [Row],
    checks: &'a [Check],
    open: &'a str,
    options: &Options,
    planted: Option<Planted>,
) -> Result<Zoom<'a>, ListsFiles<'a>> {
    let part = parts.iter().find(|p| p.id == open);
    let files: &[String] = part.map_or(&[], |p| &p.files);
    let at_level: Vec<&Row> = rows.iter().filter(|r| r.level == open).collect();
    let lists_files = |r: &&Row| r.kind == "file" || files.contains(&r.name);
    if planted != Some(Planted::LevelRuleOff) && at_level.iter().any(lists_files) {
        return Err(ListsFiles { part: open });
    }
    let planted_files: Vec<Row> = match planted {
        Some(Planted::FilesAsItems) => files
            .iter()
            .map(|f| Row {
                kind: "file".into(),
                level: open.into(),
                name: f.clone(),
                holds: f.clone(),
                item: Item {
                    id: f.clone(),
                    facts: [false; 6],
                    priority: 0,
                    file: false,
                },
            })
            .collect(),
        _ => Vec::new(),
    };
    let mut items: Vec<Item> = at_level.iter().map(|r| r.item.clone()).collect();
    items.extend(planted_files.iter().map(|r| r.item.clone()));
    let ranked = level(&items, options, None);
    let shown = ranked
        .shown
        .into_iter()
        .filter_map(|s| {
            let row = at_level
                .iter()
                .copied()
                .chain(&planted_files)
                .find(|r| r.item.id == s.id)?;
            Some(Placed {
                kind: row.kind.clone(),
                name: row.name.clone(),
                holds: row.holds.clone(),
                shown: s,
            })
        })
        .collect();
    let evidence = checks
        .iter()
        .filter(|c| c.part == open && !c.points_at.is_empty())
        .map(|c| {
            let added = match planted {
                Some(Planted::EvidenceByFolder) => {
                    let folder = |f: &str| f.rsplit_once('/').map_or("", |(d, _)| d).to_string();
                    let dirs: Vec<String> = c.points_at.iter().map(|f| folder(f)).collect();
                    files
                        .iter()
                        .filter(|f| dirs.contains(&folder(f)))
                        .cloned()
                        .collect()
                }
                _ => c.points_at.clone(),
            };
            (c.id.as_str(), added)
        })
        .collect();
    Ok(Zoom {
        shown,
        fold: ranked.fold,
        evidence,
    })
}
