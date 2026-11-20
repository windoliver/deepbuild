//! The pptx export's fidelity reader (issue #732; canvas primitives: Export): an Office Open XML
//! reader that shares no code or library with the writer, and the pinned LibreOffice, run
//! headless, that draws each slide to a PNG.
//!
//! The writer (deep-show's `export/pptx.rs`) packs its zip and writes its XML by hand. This reads
//! the package back with its own walk of the zip's central directory, zune-inflate for deflated
//! entries and roxmltree for the parts, and follows the package's relationships from
//! `presentation.xml` as any reader does, so a part the writer misnames or leaves out shows here.

use std::collections::BTreeMap;

pub mod render;

const P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT: &str = "http://schemas.openxmlformats.org/package/2006/content-types";

/// A deck as read: its slide size in EMU, its slides in order, the fonts it embeds, and every part
/// of the package with its content type.
#[derive(Clone, Debug, Default)]
pub struct Deck {
    pub size: [i64; 2],
    pub slides: Vec<Slide>,
    pub fonts: Vec<EmbeddedFont>,
    pub parts: BTreeMap<String, String>,
}

/// One slide: its shapes in draw order, bottom first, its background's color when it has a solid
/// one, its speaker notes' text, and whether it carries a transition or timing (an animation).
#[derive(Clone, Debug, Default)]
pub struct Slide {
    pub part: String,
    pub shapes: Vec<Shape>,
    pub background: Option<String>,
    pub notes: Option<String>,
    pub animated: bool,
}

/// What a shape on a slide is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A shape whose text body is its content (`txBox="1"`).
    TextBox,
    /// Any other `p:sp`: a native shape, with or without text.
    Shape,
    /// A `p:pic`.
    Picture,
    /// Anything else in the shape tree, by its element name (a group, a graphic frame, a
    /// connector, an embedded object).
    Other(String),
}

/// One shape as read: its kind, its name and description, its box in EMU, its geometry (a preset's
/// name, or `custom`), its fill and outline, its text and, for a picture, its image's bytes.
#[derive(Clone, Debug)]
pub struct Shape {
    pub kind: Kind,
    pub name: String,
    pub descr: String,
    pub off: [i64; 2],
    pub ext: [i64; 2],
    pub geometry: Option<String>,
    pub fill: Fill,
    pub line: Option<Line>,
    pub paragraphs: Vec<Paragraph>,
    pub image: Option<Vec<u8>>,
}

/// A fill as read.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Fill {
    /// No fill element at all.
    #[default]
    Unset,
    None,
    /// An sRGB color, `RRGGBB`, and its alpha in thousandths of a percent when given.
    Solid(String, Option<u32>),
    /// A gradient's stops (position in thousandths of a percent, color, alpha) and its linear
    /// angle in 60,000ths of a degree, `None` for a path gradient.
    Gradient(Vec<(u32, String, Option<u32>)>, Option<i64>),
    /// A picture or pattern fill, by its element name.
    Other(String),
}

/// An outline: its width in EMU and its fill.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub width: Option<i64>,
    pub fill: Fill,
}

/// A paragraph: its runs.
#[derive(Clone, Debug, Default)]
pub struct Paragraph {
    pub runs: Vec<Run>,
}

/// A run of text with the properties it sets itself.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Run {
    pub text: String,
    pub typeface: Option<String>,
    /// Hundredths of a point.
    pub size: Option<u32>,
    pub bold: bool,
    pub italic: bool,
    pub color: Option<String>,
}

/// An embedded font: its typeface and each style's part and bytes.
#[derive(Clone, Debug)]
pub struct EmbeddedFont {
    pub typeface: String,
    pub styles: Vec<(String, String, Vec<u8>)>,
}

impl Shape {
    /// The shape's whole text: its paragraphs' runs joined, paragraphs by `\n`.
    pub fn text(&self) -> String {
        self.paragraphs
            .iter()
            .map(|p| p.runs.iter().map(|r| r.text.as_str()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// The package's entries by name: each one's bytes, inflated when stored deflated.
pub fn entries(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let u16_at = |at: usize| -> Result<u16, String> {
        bytes
            .get(at..at + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .ok_or_else(|| "the zip ends inside a record".to_string())
    };
    let u32_at = |at: usize| -> Result<u32, String> {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or_else(|| "the zip ends inside a record".to_string())
    };
    // The end of central directory record: its signature, searched from the end past a comment.
    let floor = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (floor..=bytes.len().saturating_sub(22))
        .rev()
        .find(|&at| bytes[at..at + 4] == [0x50, 0x4b, 0x05, 0x06])
        .ok_or("no end of central directory: not a zip")?;
    let count = usize::from(u16_at(eocd + 10)?);
    let mut at = u32_at(eocd + 16)? as usize;
    let mut out = BTreeMap::new();
    for _ in 0..count {
        if u32_at(at)? != 0x0201_4b50 {
            return Err(format!("no central directory entry at byte {at}"));
        }
        let method = u16_at(at + 10)?;
        let packed = u32_at(at + 20)? as usize;
        let size = u32_at(at + 24)? as usize;
        let (name_len, extra_len, comment_len) = (
            usize::from(u16_at(at + 28)?),
            usize::from(u16_at(at + 30)?),
            usize::from(u16_at(at + 32)?),
        );
        let local = u32_at(at + 42)? as usize;
        let name = bytes
            .get(at + 46..at + 46 + name_len)
            .ok_or("an entry's name runs past the zip")?;
        let name = String::from_utf8(name.to_vec()).map_err(|_| "an entry's name isn't UTF-8")?;
        at += 46 + name_len + extra_len + comment_len;
        if u32_at(local)? != 0x0403_4b50 {
            return Err(format!("{name}: no local header"));
        }
        let start =
            local + 30 + usize::from(u16_at(local + 26)?) + usize::from(u16_at(local + 28)?);
        let data = bytes
            .get(start..start + packed)
            .ok_or_else(|| format!("{name}: its data runs past the zip"))?;
        let data = match method {
            0 => data.to_vec(),
            8 => zune_inflate::DeflateDecoder::new(data)
                .decode_deflate()
                .map_err(|e| format!("{name}: doesn't inflate: {e:?}"))?,
            m => return Err(format!("{name}: compression method {m}")),
        };
        if data.len() != size {
            return Err(format!(
                "{name}: {} bytes, its header says {size}",
                data.len()
            ));
        }
        out.insert(name, data);
    }
    Ok(out)
}

/// Reads a pptx package: its slides in the presentation's order, each with its shapes, notes and
/// pictures, and the fonts it embeds.
pub fn read(bytes: &[u8]) -> Result<Deck, String> {
    let parts = entries(bytes)?;
    let text = |name: &str| -> Result<String, String> {
        let b = parts.get(name).ok_or_else(|| format!("no part {name}"))?;
        String::from_utf8(b.clone()).map_err(|_| format!("{name} isn't UTF-8"))
    };
    let mut deck = Deck::default();
    // Content types: each part's, from its override or its extension's default.
    let types = text("[Content_Types].xml")?;
    let types =
        roxmltree::Document::parse(&types).map_err(|e| format!("[Content_Types].xml: {e}"))?;
    let mut defaults = BTreeMap::new();
    let mut overrides = BTreeMap::new();
    for n in types
        .descendants()
        .filter(|n| n.tag_name().namespace() == Some(CT))
    {
        match n.tag_name().name() {
            "Default" => {
                defaults.insert(
                    n.attribute("Extension").unwrap_or("").to_ascii_lowercase(),
                    n.attribute("ContentType").unwrap_or("").to_string(),
                );
            }
            "Override" => {
                overrides.insert(
                    n.attribute("PartName")
                        .unwrap_or("")
                        .trim_start_matches('/')
                        .to_string(),
                    n.attribute("ContentType").unwrap_or("").to_string(),
                );
            }
            _ => {}
        }
    }
    for name in parts.keys() {
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let ct = overrides
            .get(name)
            .or_else(|| defaults.get(&ext))
            .cloned()
            .unwrap_or_default();
        deck.parts.insert(name.clone(), ct);
    }
    // The package's root relationship names the presentation part.
    let root = rels(&parts, "")?;
    let pres = root
        .values()
        .find(|(t, _)| t.ends_with("/officeDocument"))
        .map(|(_, target)| target.clone())
        .ok_or("the package names no office document")?;
    let pres_xml = text(&pres)?;
    let doc = roxmltree::Document::parse(&pres_xml).map_err(|e| format!("{pres}: {e}"))?;
    let pres_rels = rels(&parts, &pres)?;
    if let Some(sz) = doc.descendants().find(|n| is(n, P, "sldSz")) {
        deck.size = [num(sz.attribute("cx")), num(sz.attribute("cy"))];
    }
    for id in doc.descendants().filter(|n| is(n, P, "sldId")) {
        let rid = id
            .attribute((R, "id"))
            .ok_or("a slide id with no relationship")?;
        let (_, part) = pres_rels
            .get(rid)
            .ok_or_else(|| format!("{pres}: no relationship {rid}"))?;
        deck.slides.push(slide(&parts, part)?);
    }
    for font in doc.descendants().filter(|n| is(n, P, "embeddedFont")) {
        let typeface = font
            .children()
            .find(|n| is(n, P, "font"))
            .and_then(|n| n.attribute("typeface"))
            .unwrap_or("")
            .to_string();
        let mut styles = Vec::new();
        for style in font
            .children()
            .filter(|n| n.is_element() && n.tag_name().name() != "font")
        {
            let Some(rid) = style.attribute((R, "id")) else {
                continue;
            };
            let (_, part) = pres_rels
                .get(rid)
                .ok_or_else(|| format!("{pres}: no relationship {rid} for {typeface}"))?;
            let data = parts
                .get(part)
                .ok_or_else(|| format!("no font part {part} for {typeface}"))?;
            styles.push((
                style.tag_name().name().to_string(),
                part.clone(),
                data.clone(),
            ));
        }
        deck.fonts.push(EmbeddedFont { typeface, styles });
    }
    Ok(deck)
}

fn is(n: &roxmltree::Node<'_, '_>, ns: &str, name: &str) -> bool {
    n.is_element() && n.tag_name().namespace() == Some(ns) && n.tag_name().name() == name
}

fn num(v: Option<&str>) -> i64 {
    v.and_then(|s| s.parse().ok()).unwrap_or(0)
}

/// A part's relationships by ID: each one's type and its target resolved to a part name (an
/// external target kept as written). `part` is "" for the package's own.
fn rels(
    parts: &BTreeMap<String, Vec<u8>>,
    part: &str,
) -> Result<BTreeMap<String, (String, String)>, String> {
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    let name = if part.is_empty() {
        "_rels/.rels".to_string()
    } else if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    };
    let Some(bytes) = parts.get(&name) else {
        return Ok(BTreeMap::new());
    };
    let xml = String::from_utf8(bytes.clone()).map_err(|_| format!("{name} isn't UTF-8"))?;
    let doc = roxmltree::Document::parse(&xml).map_err(|e| format!("{name}: {e}"))?;
    let mut out = BTreeMap::new();
    for r in doc.descendants().filter(|n| is(n, PR, "Relationship")) {
        let target = r.attribute("Target").unwrap_or("");
        let external = r.attribute("TargetMode") == Some("External");
        let resolved = if external {
            target.to_string()
        } else {
            resolve(dir, target)
        };
        out.insert(
            r.attribute("Id").unwrap_or("").to_string(),
            (r.attribute("Type").unwrap_or("").to_string(), resolved),
        );
    }
    Ok(out)
}

/// `target` relative to the folder `dir`, as a part name.
fn resolve(dir: &str, target: &str) -> String {
    let mut path: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        dir.split('/').filter(|s| !s.is_empty()).collect()
    };
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                path.pop();
            }
            s => path.push(s),
        }
    }
    path.join("/")
}

fn slide(parts: &BTreeMap<String, Vec<u8>>, part: &str) -> Result<Slide, String> {
    let xml = String::from_utf8(
        parts
            .get(part)
            .ok_or_else(|| format!("no part {part}"))?
            .clone(),
    )
    .map_err(|_| format!("{part} isn't UTF-8"))?;
    let doc = roxmltree::Document::parse(&xml).map_err(|e| format!("{part}: {e}"))?;
    let rel = rels(parts, part)?;
    let mut out = Slide {
        part: part.to_string(),
        animated: doc
            .descendants()
            .any(|n| is(&n, P, "timing") || is(&n, P, "transition")),
        ..Slide::default()
    };
    if let Some(bg) = doc.descendants().find(|n| is(n, P, "bgPr")) {
        if let Fill::Solid(c, _) = fill_of(&bg) {
            out.background = Some(c);
        }
    }
    let tree = doc
        .descendants()
        .find(|n| is(n, P, "spTree"))
        .ok_or_else(|| format!("{part}: no shape tree"))?;
    for n in tree.children().filter(roxmltree::Node::is_element) {
        let name = n.tag_name().name();
        if matches!(name, "nvGrpSpPr" | "grpSpPr" | "extLst") {
            continue;
        }
        out.shapes.push(shape(parts, &rel, &n, part)?);
    }
    // Speaker notes: the notes slide's body placeholder.
    if let Some((_, notes)) = rel.values().find(|(t, _)| t.ends_with("/notesSlide")) {
        let xml = String::from_utf8(
            parts
                .get(notes)
                .ok_or_else(|| format!("no notes part {notes}"))?
                .clone(),
        )
        .map_err(|_| format!("{notes} isn't UTF-8"))?;
        let nd = roxmltree::Document::parse(&xml).map_err(|e| format!("{notes}: {e}"))?;
        let body = nd.descendants().filter(|n| is(n, P, "sp")).find(|sp| {
            sp.descendants()
                .find(|n| is(n, P, "ph"))
                .is_some_and(|ph| ph.attribute("type") == Some("body"))
        });
        out.notes = body.map(|sp| {
            paragraphs(&sp)
                .iter()
                .map(|p| p.runs.iter().map(|r| r.text.as_str()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n")
        });
    }
    Ok(out)
}

fn shape(
    parts: &BTreeMap<String, Vec<u8>>,
    rel: &BTreeMap<String, (String, String)>,
    n: &roxmltree::Node<'_, '_>,
    part: &str,
) -> Result<Shape, String> {
    let el = n.tag_name().name();
    let c_nv = n.descendants().find(|d| is(d, P, "cNvPr"));
    let text_box = n
        .descendants()
        .find(|d| is(d, P, "cNvSpPr"))
        .is_some_and(|d| matches!(d.attribute("txBox"), Some("1" | "true")));
    let kind = match (n.tag_name().namespace() == Some(P), el) {
        (true, "sp") if text_box => Kind::TextBox,
        (true, "sp") => Kind::Shape,
        (true, "pic") => Kind::Picture,
        _ => Kind::Other(el.to_string()),
    };
    let sp_pr = n.children().find(|d| is(d, P, "spPr"));
    let xfrm = sp_pr.and_then(|s| s.children().find(|d| is(d, A, "xfrm")));
    let (off, ext) = match xfrm {
        Some(x) => {
            let off = x.children().find(|d| is(d, A, "off"));
            let ext = x.children().find(|d| is(d, A, "ext"));
            (
                [
                    num(off.and_then(|o| o.attribute("x"))),
                    num(off.and_then(|o| o.attribute("y"))),
                ],
                [
                    num(ext.and_then(|o| o.attribute("cx"))),
                    num(ext.and_then(|o| o.attribute("cy"))),
                ],
            )
        }
        None => ([0, 0], [0, 0]),
    };
    let geometry = sp_pr.and_then(|sp| {
        let preset = sp.children().find(|d| is(d, A, "prstGeom"));
        match preset {
            Some(g) => g.attribute("prst").map(str::to_string),
            None => sp
                .children()
                .any(|d| is(&d, A, "custGeom"))
                .then(|| "custom".to_string()),
        }
    });
    let fill = sp_pr.map(|s| fill_of(&s)).unwrap_or_default();
    let line = sp_pr
        .and_then(|s| s.children().find(|d| is(d, A, "ln")))
        .map(|ln| Line {
            width: ln.attribute("w").and_then(|w| w.parse().ok()),
            fill: fill_of(&ln),
        });
    let mut image = None;
    if kind == Kind::Picture {
        let rid = n
            .descendants()
            .find(|d| is(d, A, "blip"))
            .and_then(|b| b.attribute((R, "embed")))
            .ok_or_else(|| format!("{part}: a picture with no image"))?;
        let (_, target) = rel
            .get(rid)
            .ok_or_else(|| format!("{part}: no relationship {rid}"))?;
        image = Some(
            parts
                .get(target)
                .ok_or_else(|| format!("{part}: no image part {target}"))?
                .clone(),
        );
    }
    Ok(Shape {
        kind,
        name: c_nv
            .and_then(|c| c.attribute("name"))
            .unwrap_or("")
            .to_string(),
        descr: c_nv
            .and_then(|c| c.attribute("descr"))
            .unwrap_or("")
            .to_string(),
        off,
        ext,
        geometry,
        fill,
        line,
        paragraphs: n
            .children()
            .find(|d| is(d, P, "txBody"))
            .map(|b| paragraphs(&b))
            .unwrap_or_default(),
        image,
    })
}

/// The fill an element's properties set: its first fill child.
fn fill_of(n: &roxmltree::Node<'_, '_>) -> Fill {
    for c in n.children().filter(roxmltree::Node::is_element) {
        if c.tag_name().namespace() != Some(A) {
            continue;
        }
        match c.tag_name().name() {
            "noFill" => return Fill::None,
            "solidFill" => {
                return match color_of(&c) {
                    Some((rgb, alpha)) => Fill::Solid(rgb, alpha),
                    None => Fill::Other("solidFill".into()),
                }
            }
            "gradFill" => {
                let stops = c
                    .descendants()
                    .filter(|d| is(d, A, "gs"))
                    .map(|gs| {
                        let (rgb, alpha) = color_of(&gs).unwrap_or_default();
                        (num(gs.attribute("pos")) as u32, rgb, alpha)
                    })
                    .collect();
                let angle = c
                    .children()
                    .find(|d| is(d, A, "lin"))
                    .map(|l| num(l.attribute("ang")));
                return Fill::Gradient(stops, angle);
            }
            name @ ("blipFill" | "pattFill" | "grpFill") => return Fill::Other(name.into()),
            _ => {}
        }
    }
    Fill::Unset
}

/// An element's sRGB color child, `RRGGBB` upper-case, with its alpha when it sets one.
fn color_of(n: &roxmltree::Node<'_, '_>) -> Option<(String, Option<u32>)> {
    let c = n.children().find(|d| is(d, A, "srgbClr"))?;
    let alpha = c
        .children()
        .find(|d| is(d, A, "alpha"))
        .and_then(|a| a.attribute("val"))
        .and_then(|v| v.parse().ok());
    Some((c.attribute("val")?.to_ascii_uppercase(), alpha))
}

fn paragraphs(body: &roxmltree::Node<'_, '_>) -> Vec<Paragraph> {
    body.descendants()
        .filter(|n| is(n, A, "p"))
        .map(|p| Paragraph {
            runs: p
                .children()
                .filter(|d| is(d, A, "r") || is(d, A, "fld"))
                .map(|r| {
                    let pr = r.children().find(|d| is(d, A, "rPr"));
                    let flag = |k: &str| {
                        pr.and_then(|p| p.attribute(k))
                            .is_some_and(|v| v == "1" || v == "true")
                    };
                    let color = pr
                        .and_then(|p| p.children().find(|d| is(d, A, "solidFill")))
                        .and_then(|f| color_of(&f))
                        .map(|(c, _)| c);
                    Run {
                        text: r
                            .children()
                            .find(|d| is(d, A, "t"))
                            .and_then(|t| t.text())
                            .unwrap_or("")
                            .to_string(),
                        typeface: pr
                            .and_then(|p| p.children().find(|d| is(d, A, "latin")))
                            .and_then(|l| l.attribute("typeface"))
                            .map(str::to_string),
                        size: pr
                            .and_then(|p| p.attribute("sz"))
                            .and_then(|v| v.parse().ok()),
                        bold: flag("b"),
                        italic: flag("i"),
                        color,
                    }
                })
                .collect(),
        })
        .collect()
}
