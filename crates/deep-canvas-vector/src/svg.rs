//! The SVG import (canvas primitives: Vector and formula `vector@1`): bytes read once into static
//! paths in the SVG's own space, each with its fill and stroke colors still the SVG's, and its
//! parts. It reads a closed list of elements: script, event handlers, `javascript:` links,
//! outside references and text refuse the whole SVG; any other element outside the list is
//! returned as one it didn't read, naming it, and never dropped silently. Internal `<use>` and
//! `<defs>` resolve here, so each use is its own copy of the geometry it names. A `<style>`
//! block's rules cascade into each element's properties; `<clipPath>`, `<mask>`, pattern tiles
//! and marker viewports become clip regions the paths inside draw in (#1175).

use std::collections::BTreeMap;

use deep_canvas::ops;
use deep_canvas::outline::FillRule;
use deep_canvas_marks::path::{self, Verb};
use roxmltree::{Document, Node, ParsingOptions};

/// The largest SVG the import reads (`src: sha256` (SVG, ≤ 512 KB)).
pub const MAX_BYTES: usize = 512 * 1024;

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";
/// The namespace of the typeset job's record in an SVG's `<metadata>` (#220).
const TYPESET_NS: &str = "urn:deepbuild:typeset";

/// How deep `<use>` may nest, so a use that reaches itself refuses instead of spinning.
const USE_DEPTH: usize = 16;

/// How deep elements may nest, in the text and through `<use>`s. The XML reader and the import
/// recurse once per level, so the text is counted before it is parsed and the import counts as it
/// goes. A thread with a 2 MiB stack reads about twice this.
const MAX_NESTING: usize = 64;

/// The elements the import reads: containers, shapes, `<use>`, those that hold no drawing, and
/// those drawn only where something refers to them.
const READ: &[&str] = &[
    "svg", "g", "a", "defs", "use", "path", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "title", "desc", "metadata", "style", "clipPath", "mask", "pattern", "marker",
];

/// The elements that draw only where referenced, never where they stand.
const REFERENCED: &[&str] = &["defs", "style", "clipPath", "mask", "pattern", "marker"];

/// The elements a `url(#id)` paint names: the pattern the import draws, and the gradients and
/// hatches it names.
const SERVERS: &[&str] = &[
    "pattern",
    "linearGradient",
    "radialGradient",
    "meshgradient",
    "hatch",
];

/// The most clip regions one path may draw inside (Mask `mask@1`: masks nest at most 4 deep).
const CLIP_DEPTH: usize = 4;

/// The most pattern tiles one fill draws.
const MAX_TILES: f64 = 4096.0;

/// The most paths and clip regions one SVG draws, so `<use>`s, patterns and markers that hold
/// one another refuse instead of multiplying past memory.
const MAX_DRAWN: usize = 65_536;

/// Why an SVG is refused, naming what it found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    Malformed(String),
    Script(String),
    Text(String),
    External(String),
    TooLarge(usize),
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::Malformed(_) => "svg_malformed",
            Refusal::Script(_) => "svg_script",
            Refusal::Text(_) => "svg_text",
            Refusal::External(_) => "svg_external",
            Refusal::TooLarge(_) => "svg_too_large",
        }
    }

    /// What it found: the element, attribute or reference, or the size.
    pub fn found(&self) -> String {
        match self {
            Refusal::Malformed(s)
            | Refusal::Script(s)
            | Refusal::Text(s)
            | Refusal::External(s) => s.clone(),
            Refusal::TooLarge(n) => n.to_string(),
        }
    }

    pub fn what(&self) -> &'static str {
        match self {
            Refusal::Malformed(_) => "The SVG isn't well-formed XML with an <svg> root.",
            Refusal::Script(_) => {
                "The SVG carries script: a script element, an event handler or a javascript: link."
            }
            Refusal::Text(_) => "The SVG holds text, which the import never sets in a font.",
            Refusal::External(_) => "The SVG refers outside itself.",
            Refusal::TooLarge(_) => "The SVG is over 512 KB.",
        }
    }

    pub fn fix(&self) -> &'static str {
        match self {
            Refusal::Malformed(_) => {
                "Export the SVG again as a well-formed document whose root is <svg>."
            }
            Refusal::Script(_) => "Remove the script; a vector is static paths.",
            Refusal::Text(_) => "Convert the text to outlines (paths) before importing it.",
            Refusal::External(_) => "Inline what it refers to, or remove the reference.",
            Refusal::TooLarge(_) => "Simplify the SVG, or split it into several vectors.",
        }
    }
}

/// An SVG color as the import found it: one sRGB color, or `currentColor` where nothing sets
/// `color`. `colors` maps each to a role.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Color {
    Rgb([u8; 3]),
    Current,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Paint {
    pub color: Color,
    pub opacity: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stroke {
    pub paint: Paint,
    /// In the SVG's viewBox units.
    pub width: f64,
}

/// One drawn element: its outline in the SVG's viewBox space, its paints, its innermost part and
/// the innermost clip region it draws in.
#[derive(Clone, Debug, PartialEq)]
pub struct Painted {
    pub verbs: Vec<Verb>,
    pub fill: Option<Paint>,
    pub stroke: Option<Stroke>,
    pub part: Option<usize>,
    pub clip: Option<usize>,
    /// Its `fill-rule` (#443): how its contours resolve to the area its fill covers.
    pub fill_rule: FillRule,
}

/// A region what draws in it is clipped to, in the SVG's viewBox space, and the opacity it draws
/// at as one group: a `<clipPath>`'s shapes, one of a `<mask>`'s solid shapes at its luminance or
/// the mask's region, a fill's outline holding its pattern's tiles, a tile, or a marker's
/// viewport; inside the region `parent`.
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub verbs: Vec<Verb>,
    pub alpha: f64,
    pub parent: Option<usize>,
}

/// A part: an element with an id, or a class `parts` names, that draws; the part it sits in; and
/// its source where the SVG gives one, as the typeset job's `data-source` does (#220).
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub id: String,
    pub parent: Option<usize>,
    pub source: Option<String>,
}

/// What the import read, in paint order.
#[derive(Clone, Debug, PartialEq)]
pub struct Svg {
    pub view_box: [f64; 4],
    pub parts: Vec<Part>,
    pub paths: Vec<Painted>,
    pub clips: Vec<Clip>,
    /// Each element or attribute the import didn't read, by name, once, in document order.
    pub unread: Vec<String>,
    /// The typeset job's record when the job wrote the SVG (#220): its `<metadata>`'s
    /// `deep:typeset` text, `{made_by, license}` as JSON.
    pub typeset: Option<String>,
}

/// Which importer reads an SVG: the honest one, or a planted wrong program.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Twin {
    Honest,
    /// #398 AC6's: ignores every `<clipPath>` and `clip-path`, naming none.
    SkipsClipPath,
    /// #1175 AC2's: draws no `<marker>`, naming `marker` only in a warning.
    DropsMarker,
}

/// Reads `bytes`. `classes` are the classes whose elements become parts; `twin` the importer.
pub fn import(bytes: &[u8], classes: &[String], twin: Twin) -> Result<Svg, Refusal> {
    if bytes.len() > MAX_BYTES {
        return Err(Refusal::TooLarge(bytes.len()));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Refusal::Malformed("not UTF-8".into()))?;
    if nests_over(text, MAX_NESTING) {
        return Err(Refusal::Malformed(format!(
            "elements nest over {MAX_NESTING} deep"
        )));
    }
    let options = ParsingOptions {
        allow_dtd: false,
        nodes_limit: 1_000_000,
        ..ParsingOptions::default()
    };
    let doc = Document::parse_with_options(text, options)
        .map_err(|e| Refusal::Malformed(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace() != Some(SVG_NS) {
        return Err(Refusal::Malformed(format!("<{}>", root.tag_name().name())));
    }
    let mut unread = Vec::new();
    let mut ids = BTreeMap::new();
    scan(root, &mut unread, &mut ids)?;
    let view_box = view_box(root);
    let typeset = root
        .children()
        .filter(|n| n.has_tag_name((SVG_NS, "metadata")))
        .flat_map(|m| m.children())
        .find(|n| n.has_tag_name((TYPESET_NS, "typeset")))
        .and_then(|n| n.text())
        .map(str::to_string);
    let sheet = Sheet::read(root, &mut unread);
    let mut import = Import {
        ids,
        classes,
        sheet,
        twin,
        view_box,
        unread,
        parts: Vec::new(),
        paths: Vec::new(),
        clips: Vec::new(),
        decorated: 0,
        levels: 0,
    };
    let style = import.style(&Style::default(), root);
    for child in root.children().filter(Node::is_element) {
        import.walk(child, IDENTITY, &style, None, None, 0)?;
    }
    Ok(Svg {
        view_box,
        parts: import.parts,
        paths: import.paths,
        clips: import.clips,
        unread: import.unread,
        typeset,
    })
}

/// Whether elements in `text` nest over `max` deep, counted without parsing it. Comments, CDATA
/// sections, instructions, declarations and quoted attribute values hold no tags. On text that
/// isn't XML it may count over, never under: the reader stops at the first thing it can't read.
fn nests_over(text: &str, max: usize) -> bool {
    let bytes = text.as_bytes();
    // Just past the next `end` at or after `from`, or the text's end when there is none.
    let past = |from: usize, end: &str| {
        let found = text[from..].find(end);
        found.map_or(bytes.len(), |at| from + at + end.len())
    };
    let (mut i, mut depth) = (0, 0usize);
    while let Some(at) = text[i..].find('<') {
        i += at;
        let rest = &text[i..];
        if rest.starts_with("<!--") {
            i = past(i + 4, "-->");
        } else if rest.starts_with("<![CDATA[") {
            i = past(i + 9, "]]>");
        } else if rest.starts_with("<?") {
            i = past(i + 2, "?>");
        } else {
            // A tag ends at its first `>` outside a quoted value.
            let (mut quote, mut end) = (None, bytes.len());
            for (k, &c) in bytes.iter().enumerate().skip(i + 1) {
                match quote {
                    Some(q) if c == q => quote = None,
                    Some(_) => {}
                    None if c == b'"' || c == b'\'' => quote = Some(c),
                    None if c == b'>' => {
                        end = k;
                        break;
                    }
                    None => {}
                }
            }
            if rest.starts_with("</") {
                depth = depth.saturating_sub(1);
            } else if !rest.starts_with("<!") {
                depth += 1;
                if depth > max {
                    return true;
                }
                // `/>` closes the element it opens.
                if bytes[end - 1] == b'/' {
                    depth -= 1;
                }
            }
            i = (end + 1).min(bytes.len());
        }
    }
    false
}

fn unread_once(unread: &mut Vec<String>, name: &str) {
    if !unread.iter().any(|u| u == name) {
        unread.push(name.to_string());
    }
}

fn href<'a>(node: Node<'a, '_>) -> Option<&'a str> {
    node.attribute((XLINK_NS, "href"))
        .or(node.attribute("href"))
}

/// The whole tree before anything draws: what refuses the SVG, the elements outside the list,
/// and every element's id.
fn scan<'a, 'i>(
    root: Node<'a, 'i>,
    unread: &mut Vec<String>,
    ids: &mut BTreeMap<String, Node<'a, 'i>>,
) -> Result<(), Refusal> {
    for node in root.descendants().filter(Node::is_element) {
        let name = node.tag_name().name();
        if name == "script" {
            return Err(Refusal::Script(name.into()));
        }
        if matches!(name, "text" | "tspan" | "textPath") {
            return Err(Refusal::Text(name.into()));
        }
        for a in node.attributes() {
            let attr = a.name();
            if attr.len() > 2 && attr[..2].eq_ignore_ascii_case("on") {
                return Err(Refusal::Script(format!("{name} {attr}")));
            }
            let value = a.value().trim();
            if attr == "href" {
                if value
                    .get(..11)
                    .is_some_and(|v| v.eq_ignore_ascii_case("javascript:"))
                {
                    return Err(Refusal::Script(format!("{name} href")));
                }
                // A link only navigates; anything else that refers outside would load it.
                if name != "a" && !value.starts_with('#') {
                    return Err(Refusal::External(value.into()));
                }
            }
            if outside(value) {
                return Err(Refusal::External(value.into()));
            }
        }
        if name == "style" {
            let css: String = node.children().filter_map(|c| c.text()).collect();
            if outside(&css) {
                return Err(Refusal::External(css.trim().into()));
            }
        }
        if let Some(id) = node.attribute("id") {
            ids.entry(id.to_string()).or_insert(node);
        }
        let inside_unread = node.ancestors().skip(1).any(|a| {
            a.is_element() && {
                let n = a.tag_name().name();
                matches!(n, "title" | "desc" | "metadata") || !READ.contains(&n)
            }
        });
        if !READ.contains(&name) && !inside_unread {
            unread_once(unread, name);
        }
    }
    Ok(())
}

/// Whether any `url(…)` in `value` names something outside the SVG.
fn outside(value: &str) -> bool {
    value.match_indices("url(").any(|(at, _)| {
        let inner = value[at + 4..].trim_start().trim_start_matches(['"', '\'']);
        !inner.starts_with('#')
    })
}

fn view_box(root: Node<'_, '_>) -> [f64; 4] {
    if let Some(v) = root.attribute("viewBox").map(numbers) {
        if let [x, y, w, h] = v[..] {
            if w > 0.0 && h > 0.0 {
                return [x, y, w, h];
            }
        }
    }
    let side = |k: &str| root.attribute(k).and_then(length).filter(|v| *v > 0.0);
    [
        0.0,
        0.0,
        side("width").unwrap_or(100.0),
        side("height").unwrap_or(100.0),
    ]
}

/// A paint as written: a color, `none`, or a paint server by its id.
#[derive(Clone, Debug, PartialEq)]
enum Spec {
    Color(Color),
    None,
    /// A paint server's id, and the color drawn where it names none.
    Server(String, Option<Color>),
}

/// The properties an element inherits, with the opacity of its ancestors folded in.
#[derive(Clone, Debug)]
struct Style {
    fill: Spec,
    stroke: Spec,
    stroke_width: f64,
    color: Option<[u8; 3]>,
    fill_opacity: f64,
    stroke_opacity: f64,
    opacity: f64,
    /// `marker-start`, `marker-mid` and `marker-end`, by the id each names.
    markers: [Option<String>; 3],
    fill_rule: FillRule,
}

impl Default for Style {
    fn default() -> Style {
        Style {
            fill: Spec::Color(Color::Rgb([0, 0, 0])),
            stroke: Spec::None,
            stroke_width: 1.0,
            color: None,
            fill_opacity: 1.0,
            stroke_opacity: 1.0,
            opacity: 1.0,
            markers: [None, None, None],
            fill_rule: FillRule::NonZero,
        }
    }
}

impl Style {
    /// This style under an element whose declarations, lowest precedence first, are `declared`.
    fn with(&self, declared: &[(String, String)], unread: &mut Vec<String>) -> Style {
        let mut s = self.clone();
        let mut declared: Vec<(&str, &str)> = declared
            .iter()
            .map(|(k, v)| (k.as_str(), v.trim()))
            .collect();
        // `color` first, so a currentColor beside it reads it.
        declared.sort_by_key(|(k, _)| *k != "color");
        // The element's own opacity is its last declaration's, folded in once.
        let mut opacity = 1.0;
        for (k, v) in declared {
            if v == "inherit" {
                continue;
            }
            match k {
                "color" => {
                    if let Some(Spec::Color(Color::Rgb(c))) = spec(v) {
                        s.color = Some(c);
                    }
                }
                "fill" => s.fill = spec(v).unwrap_or(s.fill),
                "stroke" => s.stroke = spec(v).unwrap_or(s.stroke),
                "stroke-width" => s.stroke_width = length(v).unwrap_or(s.stroke_width),
                "fill-opacity" => s.fill_opacity = unit(v).unwrap_or(s.fill_opacity),
                "stroke-opacity" => s.stroke_opacity = unit(v).unwrap_or(s.stroke_opacity),
                "opacity" => opacity = unit(v).unwrap_or(1.0),
                "marker" => s.markers = std::array::from_fn(|_| local_url(v)),
                "marker-start" => s.markers[0] = local_url(v),
                "marker-mid" => s.markers[1] = local_url(v),
                "marker-end" => s.markers[2] = local_url(v),
                "fill-rule" if v == "evenodd" => s.fill_rule = FillRule::EvenOdd,
                "fill-rule" if v == "nonzero" => s.fill_rule = FillRule::NonZero,
                "clip-rule" if v == "evenodd" => unread_once(unread, k),
                "stroke-linecap" if v != "butt" => unread_once(unread, k),
                "stroke-linejoin" if v != "miter" => unread_once(unread, k),
                "stroke-dasharray" if v != "none" => unread_once(unread, k),
                // clip-path, mask and filter apply to the element alone; the walk reads them.
                _ => {}
            }
        }
        s.opacity *= opacity;
        // currentColor is resolved where `color` is set, as SVG resolves it.
        for paint in [&mut s.fill, &mut s.stroke] {
            if let (Spec::Color(Color::Current), Some(c)) = (&*paint, s.color) {
                *paint = Spec::Color(Color::Rgb(c));
            }
        }
        s
    }

    fn paint(&self, spec: &Spec, opacity: f64) -> Option<Paint> {
        match spec {
            Spec::Color(color) => Some(Paint {
                color: *color,
                opacity: opacity * self.opacity,
            }),
            Spec::None | Spec::Server(..) => None,
        }
    }
}

/// The id a `url(#id)` names, whatever follows it; `None` for `none` or anything else.
fn local_url(v: &str) -> Option<String> {
    let (inner, _) = v.trim().strip_prefix("url(")?.split_once(')')?;
    let inner = inner.trim().trim_matches(['"', '\'']);
    Some(inner.strip_prefix('#')?.to_string())
}

/// One simple selector of a `<style>` rule: an optional type (or `*`), then classes and ids.
#[derive(Clone, Debug, Default, PartialEq)]
struct Selector {
    tag: Option<String>,
    classes: Vec<String>,
    ids: Vec<String>,
}

impl Selector {
    /// A type, class or id selector, or one compound of them; `None` for any other.
    fn read(text: &str) -> Option<Selector> {
        let t = text.trim();
        let name_char = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
        let mut sel = Selector::default();
        let head = t.find(['.', '#']).unwrap_or(t.len());
        match &t[..head] {
            "" if head == t.len() => return None,
            "" | "*" => {}
            tag if tag.chars().all(name_char) => sel.tag = Some(tag.to_string()),
            _ => return None,
        }
        let mut rest = &t[head..];
        while let Some(kind) = rest.chars().next() {
            let end = rest[1..].find(['.', '#']).map_or(rest.len(), |e| e + 1);
            let name = &rest[1..end];
            if name.is_empty() || !name.chars().all(name_char) {
                return None;
            }
            match kind {
                '.' => sel.classes.push(name.to_string()),
                _ => sel.ids.push(name.to_string()),
            }
            rest = &rest[end..];
        }
        Some(sel)
    }

    fn matches(&self, node: Node<'_, '_>) -> bool {
        let classes: Vec<&str> = node
            .attribute("class")
            .map(|c| c.split_whitespace().collect())
            .unwrap_or_default();
        self.tag
            .as_deref()
            .is_none_or(|t| node.tag_name().name() == t)
            && self.classes.iter().all(|c| classes.contains(&c.as_str()))
            && self
                .ids
                .iter()
                .all(|i| node.attribute("id") == Some(i.as_str()))
    }

    /// CSS specificity: ids, classes, types.
    fn specificity(&self) -> (usize, usize, usize) {
        (
            self.ids.len(),
            self.classes.len(),
            usize::from(self.tag.is_some()),
        )
    }
}

/// A rule for one selector: the selector, whether it is `!important`, and its declarations.
type Rule = (Selector, bool, Vec<(String, String)>);

/// The rules of every `<style>` block, in document order: a selector, whether it is
/// `!important`, and its declarations.
#[derive(Clone, Debug, Default)]
struct Sheet {
    rules: Vec<Rule>,
}

impl Sheet {
    /// Every CSS `<style>` block's rules; a block, rule or selector it can't read names `style`.
    fn read(root: Node<'_, '_>, unread: &mut Vec<String>) -> Sheet {
        let mut sheet = Sheet::default();
        let blocks = root
            .descendants()
            .filter(|n| n.is_element() && n.tag_name().name() == "style");
        for block in blocks {
            if block.attribute("type").is_some_and(|t| t != "text/css") {
                unread_once(unread, "style");
                continue;
            }
            let text: String = block.children().filter_map(|c| c.text()).collect();
            let mut css = String::new();
            let mut rest = text.as_str();
            while let Some(at) = rest.find("/*") {
                css.push_str(&rest[..at]);
                rest = rest[at + 2..].split_once("*/").map_or("", |(_, r)| r);
            }
            css.push_str(rest);
            for rule in css.split('}') {
                let Some((selectors, body)) = rule.split_once('{') else {
                    if !rule.trim().is_empty() {
                        unread_once(unread, "style");
                    }
                    continue;
                };
                let (mut normal, mut important) = (Vec::new(), Vec::new());
                for d in body.split(';') {
                    let Some((k, v)) = d.split_once(':') else {
                        continue;
                    };
                    let v = v.trim();
                    match v.strip_suffix("!important") {
                        Some(v) => important.push((k.trim().to_string(), v.trim().to_string())),
                        None => normal.push((k.trim().to_string(), v.to_string())),
                    }
                }
                for selector in selectors.split(',') {
                    let Some(sel) = Selector::read(selector).filter(|_| !selectors.contains('@'))
                    else {
                        unread_once(unread, "style");
                        continue;
                    };
                    sheet.rules.push((sel.clone(), false, normal.clone()));
                    sheet.rules.push((sel, true, important.clone()));
                }
            }
        }
        sheet
    }

    /// `node`'s declarations, lowest precedence first: its presentation attributes, the rules
    /// that match it by specificity then order, its `style` attribute, then `!important` rules.
    fn declarations(&self, node: Node<'_, '_>) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = node
            .attributes()
            .filter(|a| a.namespace().is_none() && a.name() != "style")
            .map(|a| (a.name().to_string(), a.value().to_string()))
            .collect();
        let mut matched: Vec<(bool, (usize, usize, usize), usize)> = self
            .rules
            .iter()
            .enumerate()
            .filter(|(_, (sel, _, decls))| !decls.is_empty() && sel.matches(node))
            .map(|(i, (sel, important, _))| (*important, sel.specificity(), i))
            .collect();
        matched.sort();
        let rules = |important: bool| {
            matched
                .iter()
                .filter(move |m| m.0 == important)
                .flat_map(|m| self.rules[m.2].2.clone())
        };
        out.extend(rules(false));
        if let Some(style) = node.attribute("style") {
            out.extend(style.split(';').filter_map(|d| {
                let (k, v) = d.split_once(':')?;
                Some((k.trim().to_string(), v.trim().to_string()))
            }));
        }
        out.extend(rules(true));
        out
    }
}

struct Import<'a, 'i, 'c> {
    ids: BTreeMap<String, Node<'a, 'i>>,
    classes: &'c [String],
    sheet: Sheet,
    twin: Twin,
    view_box: [f64; 4],
    unread: Vec<String>,
    parts: Vec<Part>,
    paths: Vec<Painted>,
    clips: Vec<Clip>,
    /// How many pattern fills and markers have drawn, whose tiles and marks sit outside the
    /// geometry an object bounding box measures.
    decorated: usize,
    /// How many elements deep the import stands, through groups, `<use>`s and what they refer to.
    levels: usize,
}

impl<'a, 'i> Import<'a, 'i, '_> {
    /// `parent`'s style under `node`, its declarations cascaded.
    fn style(&mut self, parent: &Style, node: Node<'_, '_>) -> Style {
        let declared = self.sheet.declarations(node);
        parent.with(&declared, &mut self.unread)
    }

    /// A property that applies to `node` alone (`clip-path`, `mask`, `overflow`), cascaded.
    fn own(&self, node: Node<'_, '_>, name: &str) -> Option<String> {
        let declared = self.sheet.declarations(node);
        declared
            .into_iter()
            .rev()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.trim().to_string())
    }

    /// Whether `node` is `display: none`, by its attribute or a rule.
    fn hidden(&self, node: Node<'_, '_>) -> bool {
        self.own(node, "display").as_deref() == Some("none")
    }

    /// `node`'s `transform` attribute; one a rule or `style` sets instead (CSS transforms,
    /// with units the attribute doesn't take) is named.
    fn transform_of(&mut self, node: Node<'_, '_>) -> Affine {
        let attr = node.attribute("transform");
        if self.own(node, "transform").as_deref() != attr.map(str::trim) {
            unread_once(&mut self.unread, "transform");
        }
        transform(attr.unwrap_or(""))
    }

    /// An inherited property at `node`: its own, else its nearest ancestor's.
    fn inherited(&self, node: Node<'_, '_>, name: &str) -> Option<String> {
        node.ancestors()
            .filter(Node::is_element)
            .find_map(|n| self.own(n, name))
    }

    /// The style a referenced element (a mask, pattern or marker) draws its content in: what
    /// its ancestors pass down where it stands, but not their opacity, which it isn't drawn in.
    fn referenced_style(&mut self, node: Node<'_, '_>) -> Style {
        let above: Vec<Node> = node.ancestors().skip(1).filter(Node::is_element).collect();
        let mut s = Style::default();
        for a in above.into_iter().rev() {
            s = self.style(&s, a);
        }
        s.opacity = 1.0;
        self.style(&s, node)
    }

    /// Draws `node` as `draw` does, and refuses one that stands past `MAX_NESTING`: a `<use>`
    /// nests what its target holds, which the count over the text can't see.
    fn walk(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        parent: &Style,
        part: Option<usize>,
        clip: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        if self.levels >= MAX_NESTING {
            return Err(Refusal::Malformed(format!(
                "elements nest over {MAX_NESTING} deep through <use>s"
            )));
        }
        self.levels += 1;
        let drawn = self.draw(node, ctm, parent, part, clip, uses);
        self.levels -= 1;
        drawn
    }

    /// Draws `node` under `ctm`, inside the clip region `clip`; `uses` counts the `<use>`s,
    /// pattern tiles and markers it is inside, whose copies hold no parts of their own.
    fn draw(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        parent: &Style,
        part: Option<usize>,
        clip: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        let name = node.tag_name().name();
        if node.tag_name().namespace() != Some(SVG_NS)
            || !READ.contains(&name)
            || REFERENCED.contains(&name)
            || matches!(name, "title" | "desc" | "metadata")
            || self.hidden(node)
        {
            return Ok(());
        }
        if self.paths.len() + self.clips.len() > MAX_DRAWN {
            return Err(Refusal::Malformed(format!(
                "over {MAX_DRAWN} paths and clips: <use>s, patterns or markers that multiply"
            )));
        }
        let style = self.style(parent, node);
        let ctm = ctm.then(&self.transform_of(node));
        let class_part = node.attribute("class").and_then(|c| {
            c.split_whitespace()
                .find(|c| self.classes.iter().any(|k| k == c))
                .map(str::to_string)
        });
        let named = node
            .attribute("id")
            .map(str::to_string)
            .or(class_part.map(|c| {
                let n = self.parts.iter().filter(|p| p.id.starts_with(&c)).count();
                format!("{c}-{n}")
            }));
        let own = match named {
            Some(id) if uses == 0 => {
                let source = node.attribute("data-source").map(str::to_string);
                self.parts.push(Part {
                    id,
                    parent: part,
                    source,
                });
                Some(self.parts.len() - 1)
            }
            _ => None,
        };
        let (first, first_clip) = (self.paths.len(), self.clips.len());
        let decorated = self.decorated;
        let inner = own.or(part);
        match name {
            "svg" | "g" | "a" => {
                let ctm = if name == "svg" {
                    let at = |k: &str| node.attribute(k).and_then(length).unwrap_or(0.0);
                    ctm.then(&translate(at("x"), at("y")))
                } else {
                    ctm
                };
                for child in node.children().filter(Node::is_element) {
                    self.walk(child, ctm, &style, inner, clip, uses)?;
                }
            }
            "use" => {
                if uses >= USE_DEPTH {
                    return Err(Refusal::Malformed("a <use> that reaches itself".into()));
                }
                let target = href(node)
                    .and_then(|h| h.strip_prefix('#'))
                    .and_then(|id| self.ids.get(id).copied());
                let Some(target) = target else {
                    unread_once(&mut self.unread, "use");
                    return Ok(());
                };
                let at = |k: &str| node.attribute(k).and_then(length).unwrap_or(0.0);
                let ctm = ctm.then(&translate(at("x"), at("y")));
                if target.tag_name().name() == "symbol" {
                    unread_once(&mut self.unread, "symbol");
                } else {
                    self.walk(target, ctm, &style, inner, clip, uses + 1)?;
                }
            }
            _ => self.shape(node, ctm, &style, inner, clip, uses)?,
        }
        // What the element drew goes into its clip path's region, then its mask's.
        if self.paths.len() > first {
            let decorated = self.decorated != decorated;
            let clip_path = self.own(node, "clip-path").and_then(|v| local_url(&v));
            if let Some(id) = clip_path.filter(|_| self.twin != Twin::SkipsClipPath) {
                self.clip_path(&id, ctm, first, first_clip, clip, decorated);
            }
            if let Some(id) = self.own(node, "mask").and_then(|v| local_url(&v)) {
                self.mask(&id, ctm, first, first_clip, clip, decorated);
            }
        }
        // A part that draws nothing isn't one, nor is anything inside it.
        if let Some(own) = own {
            if self.paths.len() == first {
                self.parts.truncate(own);
            }
        }
        Ok(())
    }

    /// A shape element: its fill (a color, or a pattern's tiles inside its outline), its stroke,
    /// then its markers.
    fn shape(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        style: &Style,
        part: Option<usize>,
        clip: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        let Some((verbs, ends)) = outline_of(node, &mut self.unread) else {
            return Ok(());
        };
        // A paint server's id that names no paint server draws its fallback color.
        let mut style = style.clone();
        for paint in [&mut style.fill, &mut style.stroke] {
            if let Spec::Server(id, fallback) = &*paint {
                let server = self.ids.get(id).map(|n| n.tag_name().name());
                if !server.is_some_and(|s| SERVERS.contains(&s)) {
                    *paint = fallback.map_or(Spec::None, Spec::Color);
                }
            }
        }
        let style = &style;
        if let Spec::Server(id, _) = &style.fill {
            self.pattern(id, &verbs, ctm, style, part, clip, uses)?;
        }
        if let Spec::Server(id, _) = &style.stroke {
            // A stroke paint server isn't read; a gradient is already named where it stands.
            if let Some(server) = self.ids.get(id).map(|n| n.tag_name().name()) {
                if READ.contains(&server) {
                    unread_once(&mut self.unread, server);
                }
            }
        }
        let fill = style.paint(&style.fill, style.fill_opacity);
        let stroke = style
            .paint(&style.stroke, style.stroke_opacity)
            .filter(|_| style.stroke_width > 0.0)
            .map(|paint| Stroke {
                paint,
                width: style.stroke_width * ctm.scale(),
            });
        if fill.is_some() || stroke.is_some() {
            self.paths.push(Painted {
                verbs: verbs.iter().map(|v| ctm.verb(*v)).collect(),
                fill,
                stroke,
                part,
                clip,
                fill_rule: style.fill_rule,
            });
        }
        if matches!(
            node.tag_name().name(),
            "path" | "line" | "polyline" | "polygon"
        ) {
            let vertices = vertices(&verbs, &ends);
            let last = vertices.len().saturating_sub(1);
            for (k, &(at, angles)) in vertices.iter().enumerate() {
                let which = [(k == 0, 0), (k != 0 && k != last, 1), (k == last, 2)];
                for (_, w) in which.into_iter().filter(|(on, _)| *on) {
                    if let Some(id) = style.markers[w].clone() {
                        if self.twin == Twin::DropsMarker {
                            unread_once(&mut self.unread, "marker");
                            continue;
                        }
                        let start = w == 0;
                        self.marker(&id, at, angles, start, ctm, style, part, clip, uses)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// How many clip regions `clip` sits in, itself included.
    fn depth(&self, mut clip: Option<usize>) -> usize {
        let mut n = 0;
        while let Some(c) = clip {
            n += 1;
            clip = self.clips[c].parent;
        }
        n
    }

    /// The deepest clip region any path drawn since `first` sits in.
    fn deepest(&self, first: usize) -> usize {
        self.paths[first..]
            .iter()
            .map(|p| self.depth(p.clip))
            .max()
            .unwrap_or(0)
    }

    /// The tight bounds, in the user space `ctm` maps from, of what was drawn since `first`.
    fn user_bounds(&self, first: usize, ctm: Affine) -> Option<[f64; 4]> {
        let back = ctm.inverse()?;
        let verbs: Vec<Verb> = self.paths[first..]
            .iter()
            .flat_map(|p| p.verbs.iter().map(|v| back.verb(*v)))
            .collect();
        bounds(&verbs)
    }

    /// Puts what was drawn since `first` (whose own regions start at `first_clip`) into a new
    /// region inside `under`.
    fn wrap(&mut self, first: usize, first_clip: usize, under: Option<usize>, clip: Clip) {
        let n = self.clips.len();
        self.clips.push(clip);
        for c in &mut self.clips[first_clip..n] {
            if c.parent == under {
                c.parent = Some(n);
            }
        }
        for p in &mut self.paths[first..] {
            if p.clip == under {
                p.clip = Some(n);
            }
        }
    }

    /// An element's `<clipPath>`: what it drew, clipped to the union of the clip path's shapes.
    fn clip_path(
        &mut self,
        id: &str,
        ctm: Affine,
        first: usize,
        first_clip: usize,
        under: Option<usize>,
        decorated: bool,
    ) {
        let Some(&target) = self
            .ids
            .get(id)
            .filter(|n| n.tag_name().name() == "clipPath")
        else {
            return;
        };
        let mut t = ctm.then(&self.transform_of(target));
        let obb = target.attribute("clipPathUnits") == Some("objectBoundingBox");
        if obb && decorated {
            // Its box would count the tiles and marks drawn past the element's geometry.
            unread_once(&mut self.unread, "clipPath");
            return;
        }
        if obb {
            let Some([x, y, w, h]) = self.user_bounds(first, ctm) else {
                return;
            };
            t = t.then(&Affine([w, 0.0, 0.0, h, x, y]));
        }
        let mut verbs = Vec::new();
        let mut readable =
            self.own(target, "clip-path").is_none() && self.deepest(first) < CLIP_DEPTH;
        for child in target.children().filter(Node::is_element) {
            if self.inherited(child, "clip-rule").as_deref() == Some("evenodd")
                || self.own(child, "clip-path").is_some()
            {
                readable = false;
            }
            if let Some(v) = self.clip_outline(child, t, 0) {
                verbs.extend(positive(v));
            }
        }
        if !readable {
            unread_once(&mut self.unread, "clipPath");
            return;
        }
        if verbs.is_empty() {
            // A clip path with nothing in it clips everything away.
            self.paths.truncate(first);
            self.clips.truncate(first_clip);
            return;
        }
        let clip = Clip {
            verbs,
            alpha: 1.0,
            parent: under,
        };
        self.wrap(first, first_clip, under, clip);
    }

    /// A clip path child's outline under `ctm`: a shape, or a `<use>` of one.
    fn clip_outline(&mut self, node: Node<'a, 'i>, ctm: Affine, uses: usize) -> Option<Vec<Verb>> {
        if self.hidden(node) || uses >= USE_DEPTH {
            return None;
        }
        let ctm = ctm.then(&self.transform_of(node));
        if node.tag_name().name() == "use" {
            let target = href(node)
                .and_then(|h| h.strip_prefix('#'))
                .and_then(|id| self.ids.get(id).copied())?;
            let at = |k: &str| node.attribute(k).and_then(length).unwrap_or(0.0);
            return self.clip_outline(target, ctm.then(&translate(at("x"), at("y"))), uses + 1);
        }
        let (verbs, _) = outline_of(node, &mut self.unread)?;
        Some(verbs.iter().map(|v| ctm.verb(*v)).collect())
    }

    /// An element's `<mask>` of solid shapes that don't overlap: what it drew, once inside each
    /// shape at the shape's luminance (sRGB-encoded, as SVG takes it; its alpha alone for
    /// `mask-type: alpha`) times its opacity, all inside the mask's region. Any other mask is
    /// named, and what it masks draws unmasked.
    fn mask(
        &mut self,
        id: &str,
        ctm: Affine,
        first: usize,
        first_clip: usize,
        under: Option<usize>,
        decorated: bool,
    ) {
        let Some(&target) = self.ids.get(id).filter(|n| n.tag_name().name() == "mask") else {
            return;
        };
        let content_obb = target.attribute("maskContentUnits") == Some("objectBoundingBox");
        if decorated && (target.attribute("maskUnits") != Some("userSpaceOnUse") || content_obb) {
            // Its box would count the tiles and marks drawn past the element's geometry.
            unread_once(&mut self.unread, "mask");
            return;
        }
        let Some(bbox) = self.user_bounds(first, ctm) else {
            return;
        };
        let [bx, by, bw, bh] = bbox;
        let obb = target.attribute("maskUnits") != Some("userSpaceOnUse");
        // Each side as a fraction of the box (object bounding box) or in user units, where a
        // percentage, and the -10% / 120% default, read against the viewport.
        let [.., vw, vh] = self.view_box;
        let side = |k: &str, of: f64, d: f64| match target.attribute(k) {
            None if obb => Some(d),
            None => Some(d * of),
            Some(v) if obb => fraction(v),
            Some(v) if v.trim().ends_with('%') => fraction(v).map(|f| f * of),
            Some(v) => length(v),
        };
        let region = [
            side("x", vw, -0.1),
            side("y", vh, -0.1),
            side("width", vw, 1.2),
            side("height", vh, 1.2),
        ];
        let content = if content_obb {
            ctm.then(&Affine([bw, 0.0, 0.0, bh, bx, by]))
        } else {
            ctm
        };
        let style = self.referenced_style(target);
        let alpha = self.own(target, "mask-type").as_deref() == Some("alpha");
        let mut shapes = Vec::new();
        let readable = self.own(target, "mask").is_none()
            && self.own(target, "clip-path").is_none()
            && self.deepest(first) + 2 <= CLIP_DEPTH
            && self.mask_shapes(target, content, &style, 0, alpha, &mut shapes)
            && !overlap(&shapes);
        let (true, [Some(x), Some(y), Some(w), Some(h)]) = (readable, region) else {
            unread_once(&mut self.unread, "mask");
            return;
        };
        let region = if obb {
            [bx + x * bw, by + y * bh, w * bw, h * bh]
        } else {
            [x, y, w, h]
        };
        let paths: Vec<Painted> = self.paths.drain(first..).collect();
        let inner: Vec<Clip> = self.clips.drain(first_clip..).collect();
        let r = self.clips.len();
        let corners = rect(region, 0.0, 0.0);
        self.clips.push(Clip {
            verbs: corners.iter().map(|v| ctm.verb(*v)).collect(),
            alpha: 1.0,
            parent: under,
        });
        for (verbs, alpha) in shapes.into_iter().filter(|(_, a)| *a > 0.0) {
            let k = self.clips.len();
            self.clips.push(Clip {
                verbs,
                alpha,
                parent: Some(r),
            });
            let base = self.clips.len();
            let remap = |c: Option<usize>| match c {
                Some(i) if i >= first_clip => Some(base + i - first_clip),
                c if c == under => Some(k),
                c => c,
            };
            for c in &inner {
                self.clips.push(Clip {
                    parent: remap(c.parent),
                    ..c.clone()
                });
            }
            for p in &paths {
                self.paths.push(Painted {
                    clip: remap(p.clip),
                    ..p.clone()
                });
            }
        }
    }

    /// A mask's solid shapes under `ctm`, each with its alpha (its coverage alone where `alpha`);
    /// false when it holds anything else (a stroke, a paint server, a marker, an even-odd fill, a
    /// clip or mask of its own), or nests past `MAX_NESTING`.
    fn mask_shapes(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        parent: &Style,
        uses: usize,
        alpha: bool,
        out: &mut Vec<(Vec<Verb>, f64)>,
    ) -> bool {
        if self.levels >= MAX_NESTING {
            return false;
        }
        self.levels += 1;
        let solid = self.mask_group(node, ctm, parent, uses, alpha, out);
        self.levels -= 1;
        solid
    }

    /// `mask_shapes` over the children of `node`.
    fn mask_group(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        parent: &Style,
        uses: usize,
        alpha: bool,
        out: &mut Vec<(Vec<Verb>, f64)>,
    ) -> bool {
        for child in node.children().filter(Node::is_element) {
            let name = child.tag_name().name();
            if matches!(name, "title" | "desc" | "metadata") || self.hidden(child) {
                continue;
            }
            if uses >= USE_DEPTH
                || self.own(child, "clip-path").is_some()
                || self.own(child, "mask").is_some()
            {
                return false;
            }
            let style = self.style(parent, child);
            let ctm = ctm.then(&self.transform_of(child));
            let ok = match name {
                "g" | "a" => self.mask_shapes(child, ctm, &style, uses, alpha, out),
                "use" => {
                    let target = href(child)
                        .and_then(|h| h.strip_prefix('#'))
                        .and_then(|id| self.ids.get(id).copied());
                    let at = |k: &str| child.attribute(k).and_then(length).unwrap_or(0.0);
                    let ctm = ctm.then(&translate(at("x"), at("y")));
                    // The use stands in for its target, as a group holding it would.
                    target.is_some_and(|t| {
                        let inner = self.style(&style, t);
                        let ctm = ctm.then(&self.transform_of(t));
                        self.mask_target(t, ctm, &inner, uses + 1, alpha, out)
                    })
                }
                _ => self.mask_target(child, ctm, &style, uses, alpha, out),
            };
            if !ok {
                return false;
            }
        }
        true
    }

    /// One mask child that draws, under its own `style` and `ctm`: a solid-filled shape with no
    /// stroke and no markers, or a group of them.
    fn mask_target(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        style: &Style,
        uses: usize,
        alpha: bool,
        out: &mut Vec<(Vec<Verb>, f64)>,
    ) -> bool {
        if matches!(node.tag_name().name(), "g" | "a") {
            return self.mask_shapes(node, ctm, style, uses, alpha, out);
        }
        let Some((verbs, _)) = outline_of(node, &mut self.unread) else {
            return !matches!(node.tag_name().name(), "text" | "image" | "use" | "svg");
        };
        if style.stroke != Spec::None
            || style.markers.iter().any(Option::is_some)
            || style.fill_rule == FillRule::EvenOdd
        {
            return false;
        }
        let rgb = match &style.fill {
            Spec::None => return true,
            Spec::Server(..) => return false,
            Spec::Color(Color::Rgb(c)) => *c,
            // currentColor where nothing sets color is the initial color, black.
            Spec::Color(Color::Current) => [0, 0, 0],
        };
        let coverage = if alpha {
            1.0
        } else {
            (0.2125 * rgb[0] as f64 + 0.7154 * rgb[1] as f64 + 0.0721 * rgb[2] as f64) / 255.0
        };
        out.push((
            verbs.iter().map(|v| ctm.verb(*v)).collect(),
            coverage * style.fill_opacity * style.opacity,
        ));
        true
    }

    /// A fill by `<pattern>`: its tiles, each clipped to its cell, inside the fill's outline at
    /// the fill's opacity. A pattern the import can't place is named.
    #[allow(clippy::too_many_arguments)]
    fn pattern(
        &mut self,
        id: &str,
        verbs: &[Verb],
        ctm: Affine,
        style: &Style,
        part: Option<usize>,
        clip: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        let Some(&target) = self
            .ids
            .get(id)
            .filter(|n| n.tag_name().name() == "pattern")
        else {
            return Ok(());
        };
        // A pattern takes what it doesn't set, and its tiles when it has none, from the one its
        // href names.
        let mut chain = vec![target];
        while let Some(next) = href(chain[chain.len() - 1])
            .and_then(|h| h.strip_prefix('#'))
            .and_then(|id| self.ids.get(id).copied())
            .filter(|n| n.tag_name().name() == "pattern" && chain.len() < USE_DEPTH)
        {
            chain.push(next);
        }
        let attr = |k: &str| chain.iter().find_map(|n| n.attribute(k));
        let content = chain
            .iter()
            .copied()
            .find(|n| n.children().any(|c| c.is_element()));
        let obb = attr("patternUnits") != Some("userSpaceOnUse");
        let side = |k: &str| match attr(k) {
            None => Some(0.0),
            Some(v) if obb => fraction(v),
            Some(v) => length(v),
        };
        let aspect = attr("preserveAspectRatio")
            .is_none_or(|a| a.trim() == "xMidYMid meet" || a.trim() == "xMidYMid");
        let found = (
            bounds(verbs),
            [side("x"), side("y"), side("width"), side("height")],
        );
        let (Some([bx, by, bw, bh]), [Some(x), Some(y), Some(w), Some(h)]) = found else {
            unread_once(&mut self.unread, "pattern");
            return Ok(());
        };
        let [x, y, w, h] = if obb {
            [bx + x * bw, by + y * bh, w * bw, h * bh]
        } else {
            [x, y, w, h]
        };
        if w <= 0.0 || h <= 0.0 {
            return Ok(());
        }
        let content_t = match attr("viewBox").map(numbers).as_deref() {
            Some(&[vx, vy, vw, vh]) if vw > 0.0 && vh > 0.0 => meet([vx, vy, vw, vh], w, h),
            Some(_) => return Ok(()),
            None if attr("patternContentUnits") == Some("objectBoundingBox") => {
                Affine([bw, 0.0, 0.0, bh, 0.0, 0.0])
            }
            None => IDENTITY,
        };
        let pt = transform(attr("patternTransform").unwrap_or(""));
        let Some(back) = pt.inverse() else {
            return Ok(());
        };
        let corners =
            [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(|p| back.at(p));
        let lo = |i: usize| corners.iter().map(|c| c[i]).fold(f64::INFINITY, f64::min);
        let hi = |i: usize| {
            corners
                .iter()
                .map(|c| c[i])
                .fold(f64::NEG_INFINITY, f64::max)
        };
        let (i0, i1) = (((lo(0) - x) / w).floor(), ((hi(0) - x) / w).ceil());
        let (j0, j1) = (((lo(1) - y) / h).floor(), ((hi(1) - y) / h).ceil());
        let shows = chain
            .iter()
            .find_map(|n| self.own(*n, "overflow"))
            .is_some_and(|o| o == "visible" || o == "auto");
        if !aspect
            || shows
            || uses >= USE_DEPTH
            || (i1 - i0) * (j1 - j0) > MAX_TILES
            || self.depth(clip) + 2 > CLIP_DEPTH
        {
            unread_once(&mut self.unread, "pattern");
            return Ok(());
        }
        let Some(content) = content else {
            return Ok(());
        };
        if style.fill_rule == FillRule::EvenOdd {
            // The fill's outline holds the tiles as a clip region, which fills non-zero.
            unread_once(&mut self.unread, "fill-rule");
            return Ok(());
        }
        self.decorated += 1;
        let holder = self.clips.len();
        self.clips.push(Clip {
            verbs: verbs.iter().map(|v| ctm.verb(*v)).collect(),
            alpha: style.fill_opacity * style.opacity,
            parent: clip,
        });
        let inside = self.referenced_style(target);
        let cell = rect([0.0, 0.0, w, h], 0.0, 0.0);
        for j in j0 as i64..j1 as i64 {
            for i in i0 as i64..i1 as i64 {
                let tile = ctm
                    .then(&pt)
                    .then(&translate(x + i as f64 * w, y + j as f64 * h));
                let at = self.clips.len();
                self.clips.push(Clip {
                    verbs: cell.iter().map(|v| tile.verb(*v)).collect(),
                    alpha: 1.0,
                    parent: Some(holder),
                });
                let first = self.paths.len();
                for child in content.children().filter(Node::is_element) {
                    self.walk(
                        child,
                        tile.then(&content_t),
                        &inside,
                        part,
                        Some(at),
                        uses + 1,
                    )?;
                }
                // A tile whose content stays in its cell needs no clip, whose antialiased edges
                // would show a seam where two cells meet.
                let fits = self
                    .user_bounds(first, tile)
                    .is_some_and(|[cx, cy, cw, ch]| {
                        let e = 1e-9 * (w + h);
                        cx >= -e && cy >= -e && cx + cw <= w + e && cy + ch <= h + e
                    });
                if fits && self.clips.len() == at + 1 {
                    self.clips.pop();
                    for p in &mut self.paths[first..] {
                        p.clip = Some(holder);
                    }
                }
            }
        }
        Ok(())
    }

    /// A marker at a vertex `at` whose incoming and outgoing directions are `angles`: its
    /// content placed by its ref point, orient, units and viewBox, clipped to its viewport unless
    /// its overflow shows. A marker the import can't place is named.
    #[allow(clippy::too_many_arguments)]
    fn marker(
        &mut self,
        id: &str,
        at: [f64; 2],
        angles: (Option<f64>, Option<f64>),
        start: bool,
        ctm: Affine,
        style: &Style,
        part: Option<usize>,
        clip: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        let Some(&m) = self.ids.get(id).filter(|n| n.tag_name().name() == "marker") else {
            return Ok(());
        };
        let n = |k: &str, d: f64| m.attribute(k).map_or(Some(d), length);
        let found = [
            n("markerWidth", 3.0),
            n("markerHeight", 3.0),
            n("refX", 0.0),
            n("refY", 0.0),
        ];
        let along = match angles {
            (Some(a), Some(b)) => ops::atan2(ops::sin(a) + ops::sin(b), ops::cos(a) + ops::cos(b)),
            (Some(a), None) | (None, Some(a)) => a,
            (None, None) => 0.0,
        };
        let orient = match m.attribute("orient").map(str::trim) {
            None => Some(0.0),
            Some("auto") => Some(along),
            Some("auto-start-reverse") if start => Some(along + std::f64::consts::PI),
            Some("auto-start-reverse") => Some(along),
            Some(deg) => deg
                .strip_suffix("deg")
                .unwrap_or(deg)
                .trim()
                .parse::<f64>()
                .ok()
                .map(ops::rad),
        };
        let aspect = m
            .attribute("preserveAspectRatio")
            .is_none_or(|a| a.trim() == "xMidYMid meet" || a.trim() == "xMidYMid");
        let ([Some(mw), Some(mh), Some(rx), Some(ry)], Some(angle), true) = (found, orient, aspect)
        else {
            unread_once(&mut self.unread, "marker");
            return Ok(());
        };
        let shows = matches!(self.own(m, "overflow").as_deref(), Some("visible" | "auto"));
        if mw <= 0.0 || mh <= 0.0 {
            return Ok(());
        }
        if uses >= USE_DEPTH || self.depth(clip) + usize::from(!shows) > CLIP_DEPTH {
            unread_once(&mut self.unread, "marker");
            return Ok(());
        }
        let view = match m.attribute("viewBox").map(numbers).as_deref() {
            Some(&[vx, vy, vw, vh]) if vw > 0.0 && vh > 0.0 => meet([vx, vy, vw, vh], mw, mh),
            Some(_) => return Ok(()),
            None => IDENTITY,
        };
        let width = if m.attribute("markerUnits") == Some("userSpaceOnUse") {
            1.0
        } else {
            style.stroke_width
        };
        self.decorated += 1;
        let r = view.at([rx, ry]);
        let (s, c) = (ops::sin(angle), ops::cos(angle));
        let place = ctm
            .then(&translate(at[0], at[1]))
            .then(&Affine([c, s, -s, c, 0.0, 0.0]))
            .then(&Affine([width, 0.0, 0.0, width, 0.0, 0.0]))
            .then(&translate(-r[0], -r[1]));
        let inside = if shows {
            clip
        } else {
            self.clips.push(Clip {
                verbs: rect([0.0, 0.0, mw, mh], 0.0, 0.0)
                    .iter()
                    .map(|v| place.verb(*v))
                    .collect(),
                alpha: 1.0,
                parent: clip,
            });
            Some(self.clips.len() - 1)
        };
        // The marker's own properties, drawn at the opacity of the element it marks.
        let mut own = self.referenced_style(m);
        own.opacity *= style.opacity;
        for child in m.children().filter(Node::is_element) {
            self.walk(child, place.then(&view), &own, part, inside, uses + 1)?;
        }
        Ok(())
    }
}

fn translate(x: f64, y: f64) -> Affine {
    Affine([1.0, 0.0, 0.0, 1.0, x, y])
}

/// A viewBox drawn into a `w` × `h` viewport, scaled uniformly and centred (`xMidYMid meet`).
fn meet([vx, vy, vw, vh]: [f64; 4], w: f64, h: f64) -> Affine {
    let s = (w / vw).min(h / vh);
    Affine([
        s,
        0.0,
        0.0,
        s,
        (w - vw * s) / 2.0 - vx * s,
        (h - vh * s) / 2.0 - vy * s,
    ])
}

/// A fraction of a box: a number, or a percentage.
fn fraction(text: &str) -> Option<f64> {
    let t = text.trim();
    match t.strip_suffix('%') {
        Some(p) => p.trim().parse::<f64>().ok().map(|v| v / 100.0),
        None => t.parse::<f64>().ok(),
    }
    .filter(|v| v.is_finite())
}

/// Whether any two of a mask's shapes overlap, by their bounds.
fn overlap(shapes: &[(Vec<Verb>, f64)]) -> bool {
    let boxes: Vec<[f64; 4]> = shapes.iter().filter_map(|(v, _)| bounds(v)).collect();
    boxes.iter().enumerate().any(|(i, a)| {
        boxes[i + 1..].iter().any(|b| {
            a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
        })
    })
}

/// An outline turned so it winds positively (clockwise on screen) as a whole, so outlines laid
/// together fill their union under the non-zero rule.
fn positive(verbs: Vec<Verb>) -> Vec<Verb> {
    let area: f64 = path::flatten(&verbs, 0.01)
        .iter()
        .map(|l| {
            let n = l.points.len();
            (0..n)
                .map(|i| {
                    let (a, b) = (l.points[i], l.points[(i + 1) % n]);
                    a[0] * b[1] - b[0] * a[1]
                })
                .sum::<f64>()
        })
        .sum();
    if area < 0.0 {
        deep_canvas_marks::pathops::reversed(&verbs)
    } else {
        verbs
    }
}

/// A marker vertex: its point, and the directions the path arrives and leaves by.
type Vertex = ([f64; 2], (Option<f64>, Option<f64>));

/// The vertices markers sit on, as SVG's path vertices are: each command's end point, a
/// sub-path's start among them, with the directions (radians) the path arrives and leaves by.
fn vertices(verbs: &[Verb], ends: &[usize]) -> Vec<Vertex> {
    let dir = |a: [f64; 2], b: [f64; 2]| (a != b).then(|| ops::atan2(b[1] - a[1], b[0] - a[0]));
    let mut out: Vec<Vertex> = Vec::new();
    let (mut cur, mut start, mut start_at) = ([0.0, 0.0], [0.0, 0.0], 0);
    let mut from = 0;
    for &end in ends {
        let command = &verbs[from..end];
        from = end;
        let Some(first) = command.first() else {
            continue;
        };
        if let Verb::Move(p) = first {
            cur = *p;
            start = *p;
            start_at = out.len();
            out.push((*p, (None, None)));
            continue;
        }
        let mut leaves = None;
        let mut arrives = None;
        let mut at = cur;
        for v in command {
            let (lv, ar, to) = match *v {
                Verb::Line(p) => (dir(at, p), dir(at, p), p),
                Verb::Quad(c, p) => (dir(at, c).or(dir(at, p)), dir(c, p).or(dir(at, p)), p),
                Verb::Cubic(c1, c2, p) => (
                    dir(at, c1).or(dir(at, c2)).or(dir(at, p)),
                    dir(c2, p).or(dir(c1, p)).or(dir(at, p)),
                    p,
                ),
                Verb::Close => (dir(at, start), dir(at, start), start),
                Verb::Move(_) => continue,
            };
            leaves = leaves.or(lv);
            arrives = ar.or(arrives);
            at = to;
        }
        if let Some(last) = out.last_mut() {
            last.1 .1 = last.1 .1.or(leaves);
        }
        out.push((at, (arrives, None)));
        if matches!(command.last(), Some(Verb::Close)) {
            // A closed sub-path's start arrives by its closing segment, and its end leaves as
            // its start does.
            out[start_at].1 .0 = arrives;
            let leaves_start = out[start_at].1 .1;
            if let Some(last) = out.last_mut() {
                last.1 .1 = leaves_start;
            }
        }
        cur = at;
    }
    out
}

/// A shape element's outline in its own user space, and where each of its commands ends (a
/// marker vertex), as verb counts.
fn outline_of(node: Node<'_, '_>, unread: &mut Vec<String>) -> Option<(Vec<Verb>, Vec<usize>)> {
    if node.tag_name().name() == "path" {
        let (outline, complete) = path_data(node.attribute("d").unwrap_or(""));
        if !complete {
            // SVG draws a path up to its first error; the rest is named, not dropped.
            unread_once(unread, "path");
        }
        return Some(outline);
    }
    let verbs = shape(node)?;
    let ends = (1..=verbs.len()).collect();
    Some((verbs, ends))
}

/// Any other shape element's outline in its own user space.
fn shape(node: Node<'_, '_>) -> Option<Vec<Verb>> {
    let n = |k: &str| node.attribute(k).and_then(length);
    let v = |k: &str| n(k).unwrap_or(0.0);
    match node.tag_name().name() {
        "rect" => {
            let (w, h) = (v("width"), v("height"));
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            let (rx, ry) = match (n("rx").filter(|r| *r >= 0.0), n("ry").filter(|r| *r >= 0.0)) {
                (None, None) => (0.0, 0.0),
                (Some(r), None) | (None, Some(r)) => (r, r),
                (Some(x), Some(y)) => (x, y),
            };
            Some(rect(
                [v("x"), v("y"), w, h],
                rx.min(w / 2.0),
                ry.min(h / 2.0),
            ))
        }
        "circle" => {
            let r = v("r");
            (r > 0.0).then(|| ellipse([v("cx"), v("cy")], r, r))
        }
        "ellipse" => {
            let (rx, ry) = (v("rx"), v("ry"));
            (rx > 0.0 && ry > 0.0).then(|| ellipse([v("cx"), v("cy")], rx, ry))
        }
        "line" => Some(vec![
            Verb::Move([v("x1"), v("y1")]),
            Verb::Line([v("x2"), v("y2")]),
        ]),
        name @ ("polyline" | "polygon") => {
            let p = numbers(node.attribute("points").unwrap_or(""));
            let mut verbs: Vec<Verb> = p
                .as_chunks::<2>()
                .0
                .iter()
                .enumerate()
                .map(|(i, &xy)| {
                    if i == 0 {
                        Verb::Move(xy)
                    } else {
                        Verb::Line(xy)
                    }
                })
                .collect();
            if verbs.len() < 2 {
                return None;
            }
            if name == "polygon" {
                verbs.push(Verb::Close);
            }
            Some(verbs)
        }
        _ => None,
    }
}

/// The cubic handle length for a quarter of a unit circle.
const KAPPA: f64 = 0.552_284_749_830_793_4;

/// An ellipse from its rightmost point, clockwise on screen, as four cubics.
fn ellipse([cx, cy]: [f64; 2], rx: f64, ry: f64) -> Vec<Verb> {
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    vec![
        Verb::Move([cx + rx, cy]),
        Verb::Cubic([cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]),
        Verb::Cubic([cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]),
        Verb::Cubic([cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]),
        Verb::Cubic([cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]),
        Verb::Close,
    ]
}

/// A rect from its top left corner, clockwise on screen, its corners elliptical arcs.
fn rect([x, y, w, h]: [f64; 4], rx: f64, ry: f64) -> Vec<Verb> {
    if rx <= 0.0 || ry <= 0.0 {
        return vec![
            Verb::Move([x, y]),
            Verb::Line([x + w, y]),
            Verb::Line([x + w, y + h]),
            Verb::Line([x, y + h]),
            Verb::Close,
        ];
    }
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    let (r, b) = (x + w, y + h);
    vec![
        Verb::Move([x + rx, y]),
        Verb::Line([r - rx, y]),
        Verb::Cubic([r - rx + kx, y], [r, y + ry - ky], [r, y + ry]),
        Verb::Line([r, b - ry]),
        Verb::Cubic([r, b - ry + ky], [r - rx + kx, b], [r - rx, b]),
        Verb::Line([x + rx, b]),
        Verb::Cubic([x + rx - kx, b], [x, b - ry + ky], [x, b - ry]),
        Verb::Line([x, y + ry]),
        Verb::Cubic([x, y + ry - ky], [x + rx - kx, y], [x + rx, y]),
        Verb::Close,
    ]
}

/// A 2×3 affine `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine(pub [f64; 6]);

pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

impl Affine {
    /// This transform after `inner` is applied: a point goes through `inner` first.
    pub fn then(&self, inner: &Affine) -> Affine {
        let [a, b, c, d, e, f] = self.0;
        let [a2, b2, c2, d2, e2, f2] = inner.0;
        Affine([
            a * a2 + c * b2,
            b * a2 + d * b2,
            a * c2 + c * d2,
            b * c2 + d * d2,
            a * e2 + c * f2 + e,
            b * e2 + d * f2 + f,
        ])
    }

    /// The transform that undoes this one; `None` when it flattens the plane.
    pub(crate) fn inverse(&self) -> Option<Affine> {
        let [a, b, c, d, e, f] = self.0;
        let det = a * d - b * c;
        if det.abs() < 1e-12 {
            return None;
        }
        let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
        Some(Affine([
            ia,
            ib,
            ic,
            id,
            -(ia * e + ic * f),
            -(ib * e + id * f),
        ]))
    }

    pub fn at(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        [a * x + c * y + e, b * x + d * y + f]
    }

    pub fn verb(&self, v: Verb) -> Verb {
        match v {
            Verb::Move(p) => Verb::Move(self.at(p)),
            Verb::Line(p) => Verb::Line(self.at(p)),
            Verb::Quad(p, q) => Verb::Quad(self.at(p), self.at(q)),
            Verb::Cubic(p, q, r) => Verb::Cubic(self.at(p), self.at(q), self.at(r)),
            Verb::Close => Verb::Close,
        }
    }

    /// How it scales a stroke's width: the square root of its area scale.
    pub fn scale(&self) -> f64 {
        let [a, b, c, d, ..] = self.0;
        ops::sqrt((a * d - b * c).abs())
    }
}

/// A `transform` list; a malformed one is the identity, as SVG reads it.
fn transform(text: &str) -> Affine {
    let mut out = IDENTITY;
    for item in text.split(')') {
        let Some((name, args)) = item.split_once('(') else {
            continue;
        };
        let a = numbers(args);
        let get = |i: usize| a.get(i).copied();
        let name = name.trim().trim_start_matches(',').trim();
        let m = match (name, a.len()) {
            ("matrix", 6) => [a[0], a[1], a[2], a[3], a[4], a[5]],
            ("translate", 1 | 2) => [1.0, 0.0, 0.0, 1.0, a[0], get(1).unwrap_or(0.0)],
            ("scale", 1 | 2) => [a[0], 0.0, 0.0, get(1).unwrap_or(a[0]), 0.0, 0.0],
            ("rotate", 1 | 3) => {
                let (s, c) = (ops::sin(ops::rad(a[0])), ops::cos(ops::rad(a[0])));
                let (x, y) = (get(1).unwrap_or(0.0), get(2).unwrap_or(0.0));
                [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]
            }
            ("skewX", 1) => [1.0, 0.0, ops::tan(ops::rad(a[0])), 1.0, 0.0, 0.0],
            ("skewY", 1) => [1.0, ops::tan(ops::rad(a[0])), 0.0, 1.0, 0.0, 0.0],
            _ => return IDENTITY,
        };
        out = out.then(&Affine(m));
    }
    out
}

/// Numbers separated by spaces or commas.
fn numbers(text: &str) -> Vec<f64> {
    let mut c = Cursor::new(text);
    let mut out = Vec::new();
    while let Some(n) = c.number() {
        out.push(n);
    }
    out
}

/// A length in user units: a number, or one in `px`.
fn length(text: &str) -> Option<f64> {
    let t = text.trim();
    t.strip_suffix("px")
        .unwrap_or(t)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}

/// An opacity: a number or a percentage, clamped to 0..1.
fn unit(text: &str) -> Option<f64> {
    let t = text.trim();
    let v = match t.strip_suffix('%') {
        Some(p) => p.trim().parse::<f64>().ok()? / 100.0,
        None => t.parse::<f64>().ok()?,
    };
    v.is_finite().then(|| v.clamp(0.0, 1.0))
}

fn spec(text: &str) -> Option<Spec> {
    let t = text.trim();
    if t == "none" || t == "transparent" {
        return Some(Spec::None);
    }
    if t.starts_with("url(") {
        // A reference outside the SVG refuses it at the scan; one to nothing paints its
        // fallback color, or nothing.
        let fallback = t.split_once(')').and_then(|(_, f)| color(f));
        return Some(local_url(t).map_or(Spec::None, |id| Spec::Server(id, fallback)));
    }
    color(t).map(Spec::Color)
}

/// A CSS color: `currentColor`, `#rgb`, `#rrggbb`, `rgb(…)` or a named color.
pub fn color(text: &str) -> Option<Color> {
    let t = text.trim();
    if t.eq_ignore_ascii_case("currentcolor") {
        return Some(Color::Current);
    }
    if let Some(hex) = t.strip_prefix('#') {
        let digit = |i: usize| u8::from_str_radix(hex.get(i..i + 1)?, 16).ok();
        return match hex.len() {
            3 => Some(Color::Rgb([digit(0)? * 17, digit(1)? * 17, digit(2)? * 17])),
            6 => {
                let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
                Some(Color::Rgb([byte(0)?, byte(2)?, byte(4)?]))
            }
            _ => None,
        };
    }
    let lower = t.to_ascii_lowercase();
    if let Some(args) = lower.strip_prefix("rgb(").and_then(|a| a.strip_suffix(')')) {
        let parts: Vec<&str> = args.split(',').map(str::trim).collect();
        let channel = |p: &str| -> Option<u8> {
            let v = match p.strip_suffix('%') {
                Some(pc) => pc.trim().parse::<f64>().ok()? * 2.55,
                None => p.parse::<f64>().ok()?,
            };
            Some(v.round().clamp(0.0, 255.0) as u8)
        };
        return match parts[..] {
            [r, g, b] => Some(Color::Rgb([channel(r)?, channel(g)?, channel(b)?])),
            _ => None,
        };
    }
    NAMED
        .split(',')
        .find_map(|e| {
            let (name, hex) = e.trim().split_once(' ')?;
            (name == lower).then(|| u32::from_str_radix(hex, 16).ok())?
        })
        .map(|v| Color::Rgb([(v >> 16) as u8, (v >> 8) as u8, v as u8]))
}

/// CSS's named colors (CSS Color Module Level 4).
const NAMED: &str =
    "aliceblue f0f8ff,antiquewhite faebd7,aqua 00ffff,aquamarine 7fffd4,azure f0ffff,\
beige f5f5dc,bisque ffe4c4,black 000000,blanchedalmond ffebcd,blue 0000ff,blueviolet 8a2be2,\
brown a52a2a,burlywood deb887,cadetblue 5f9ea0,chartreuse 7fff00,chocolate d2691e,coral ff7f50,\
cornflowerblue 6495ed,cornsilk fff8dc,crimson dc143c,cyan 00ffff,darkblue 00008b,darkcyan 008b8b,\
darkgoldenrod b8860b,darkgray a9a9a9,darkgreen 006400,darkgrey a9a9a9,darkkhaki bdb76b,\
darkmagenta 8b008b,darkolivegreen 556b2f,darkorange ff8c00,darkorchid 9932cc,darkred 8b0000,\
darksalmon e9967a,darkseagreen 8fbc8f,darkslateblue 483d8b,darkslategray 2f4f4f,\
darkslategrey 2f4f4f,darkturquoise 00ced1,darkviolet 9400d3,deeppink ff1493,deepskyblue 00bfff,\
dimgray 696969,dimgrey 696969,dodgerblue 1e90ff,firebrick b22222,floralwhite fffaf0,\
forestgreen 228b22,fuchsia ff00ff,gainsboro dcdcdc,ghostwhite f8f8ff,gold ffd700,goldenrod daa520,\
gray 808080,green 008000,greenyellow adff2f,grey 808080,honeydew f0fff0,hotpink ff69b4,\
indianred cd5c5c,indigo 4b0082,ivory fffff0,khaki f0e68c,lavender e6e6fa,lavenderblush fff0f5,\
lawngreen 7cfc00,lemonchiffon fffacd,lightblue add8e6,lightcoral f08080,lightcyan e0ffff,\
lightgoldenrodyellow fafad2,lightgray d3d3d3,lightgreen 90ee90,lightgrey d3d3d3,lightpink ffb6c1,\
lightsalmon ffa07a,lightseagreen 20b2aa,lightskyblue 87cefa,lightslategray 778899,\
lightslategrey 778899,lightsteelblue b0c4de,lightyellow ffffe0,lime 00ff00,limegreen 32cd32,\
linen faf0e6,magenta ff00ff,maroon 800000,mediumaquamarine 66cdaa,mediumblue 0000cd,\
mediumorchid ba55d3,mediumpurple 9370db,mediumseagreen 3cb371,mediumslateblue 7b68ee,\
mediumspringgreen 00fa9a,mediumturquoise 48d1cc,mediumvioletred c71585,midnightblue 191970,\
mintcream f5fffa,mistyrose ffe4e1,moccasin ffe4b5,navajowhite ffdead,navy 000080,oldlace fdf5e6,\
olive 808000,olivedrab 6b8e23,orange ffa500,orangered ff4500,orchid da70d6,palegoldenrod eee8aa,\
palegreen 98fb98,paleturquoise afeeee,palevioletred db7093,papayawhip ffefd5,peachpuff ffdab9,\
peru cd853f,pink ffc0cb,plum dda0dd,powderblue b0e0e6,purple 800080,rebeccapurple 663399,\
red ff0000,rosybrown bc8f8f,royalblue 4169e1,saddlebrown 8b4513,salmon fa8072,sandybrown f4a460,\
seagreen 2e8b57,seashell fff5ee,sienna a0522d,silver c0c0c0,skyblue 87ceeb,slateblue 6a5acd,\
slategray 708090,slategrey 708090,snow fffafa,springgreen 00ff7f,steelblue 4682b4,tan d2b48c,\
teal 008080,thistle d8bfd8,tomato ff6347,turquoise 40e0d0,violet ee82ee,wheat f5deb3,\
white ffffff,whitesmoke f5f5f5,yellow ffff00,yellowgreen 9acd32";

/// Path data and number lists: numbers, flags and commands, with spaces and commas between.
struct Cursor<'a> {
    s: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn new(text: &'a str) -> Cursor<'a> {
        Cursor {
            s: text.as_bytes(),
            at: 0,
        }
    }

    fn skip(&mut self) {
        while self.at < self.s.len()
            && (self.s[self.at].is_ascii_whitespace() || self.s[self.at] == b',')
        {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.skip();
        self.s.get(self.at).copied()
    }

    fn number(&mut self) -> Option<f64> {
        self.skip();
        let start = self.at;
        let digits = |c: &mut Cursor<'_>| {
            let from = c.at;
            while c.at < c.s.len() && c.s[c.at].is_ascii_digit() {
                c.at += 1;
            }
            c.at > from
        };
        if matches!(self.s.get(self.at), Some(b'+' | b'-')) {
            self.at += 1;
        }
        let whole = digits(self);
        let mut fraction = false;
        if self.s.get(self.at) == Some(&b'.') {
            self.at += 1;
            fraction = digits(self);
        }
        if !whole && !fraction {
            self.at = start;
            return None;
        }
        if matches!(self.s.get(self.at), Some(b'e' | b'E')) {
            let mark = self.at;
            self.at += 1;
            if matches!(self.s.get(self.at), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if !digits(self) {
                self.at = mark;
            }
        }
        let v = std::str::from_utf8(&self.s[start..self.at])
            .ok()?
            .parse::<f64>()
            .ok()?;
        v.is_finite().then_some(v)
    }

    fn flag(&mut self) -> Option<bool> {
        match self.peek()? {
            b'0' => {
                self.at += 1;
                Some(false)
            }
            b'1' => {
                self.at += 1;
                Some(true)
            }
            _ => None,
        }
    }

    fn point(&mut self) -> Option<[f64; 2]> {
        Some([self.number()?, self.number()?])
    }
}

/// Path data read into absolute verbs, with S, T and A turned into cubics, and where each
/// command ends as a verb count; and whether it read to the end (SVG draws a path up to its
/// first error).
fn path_data(d: &str) -> ((Vec<Verb>, Vec<usize>), bool) {
    let mut c = Cursor::new(d);
    let mut verbs = Vec::new();
    let mut ends = Vec::new();
    let (mut cur, mut start) = ([0.0, 0.0], [0.0, 0.0]);
    // The last curve's second control point, for S and T's reflection.
    let mut last_cubic: Option<[f64; 2]> = None;
    let mut last_quad: Option<[f64; 2]> = None;
    let mut command: Option<u8> = None;
    loop {
        let Some(next) = c.peek() else {
            return ((verbs, ends), true);
        };
        let cmd = if next.is_ascii_alphabetic() {
            c.at += 1;
            next
        } else {
            match command {
                Some(b'M') => b'L',
                Some(b'm') => b'l',
                Some(cmd) if !matches!(cmd, b'Z' | b'z') => cmd,
                _ => return ((verbs, ends), false),
            }
        };
        if command.is_none() && !matches!(cmd, b'M' | b'm') {
            return ((verbs, ends), false);
        }
        command = Some(cmd);
        let rel = cmd.is_ascii_lowercase();
        let base = if rel { cur } else { [0.0, 0.0] };
        let abs = |p: [f64; 2]| [base[0] + p[0], base[1] + p[1]];
        let reflect = |p: Option<[f64; 2]>, cur: [f64; 2]| {
            p.map_or(cur, |p| [2.0 * cur[0] - p[0], 2.0 * cur[1] - p[1]])
        };
        let (mut cubic, mut quad) = (None, None);
        let ok = (|| -> Option<()> {
            match cmd.to_ascii_uppercase() {
                b'M' => {
                    cur = abs(c.point()?);
                    start = cur;
                    verbs.push(Verb::Move(cur));
                }
                b'L' => {
                    cur = abs(c.point()?);
                    verbs.push(Verb::Line(cur));
                }
                b'H' => {
                    let x = c.number()?;
                    cur = [if rel { cur[0] + x } else { x }, cur[1]];
                    verbs.push(Verb::Line(cur));
                }
                b'V' => {
                    let y = c.number()?;
                    cur = [cur[0], if rel { cur[1] + y } else { y }];
                    verbs.push(Verb::Line(cur));
                }
                b'C' => {
                    let (p1, p2, p) = (abs(c.point()?), abs(c.point()?), abs(c.point()?));
                    verbs.push(Verb::Cubic(p1, p2, p));
                    cubic = Some(p2);
                    cur = p;
                }
                b'S' => {
                    let p1 = reflect(last_cubic, cur);
                    let (p2, p) = (abs(c.point()?), abs(c.point()?));
                    verbs.push(Verb::Cubic(p1, p2, p));
                    cubic = Some(p2);
                    cur = p;
                }
                b'Q' => {
                    let (p1, p) = (abs(c.point()?), abs(c.point()?));
                    verbs.push(Verb::Quad(p1, p));
                    quad = Some(p1);
                    cur = p;
                }
                b'T' => {
                    let p1 = reflect(last_quad, cur);
                    let p = abs(c.point()?);
                    verbs.push(Verb::Quad(p1, p));
                    quad = Some(p1);
                    cur = p;
                }
                b'A' => {
                    let (rx, ry, rot) = (c.number()?, c.number()?, c.number()?);
                    let (large, sweep) = (c.flag()?, c.flag()?);
                    let p = abs(c.point()?);
                    arc(cur, [rx, ry], rot, large, sweep, p, &mut verbs);
                    cur = p;
                }
                b'Z' => {
                    verbs.push(Verb::Close);
                    cur = start;
                }
                _ => return None,
            }
            Some(())
        })();
        if ok.is_none() {
            return ((verbs, ends), false);
        }
        if ends.last() != Some(&verbs.len()) {
            ends.push(verbs.len());
        }
        last_cubic = cubic;
        last_quad = quad;
    }
}

/// An SVG arc from `from` to `to` as cubics of at most a quarter turn each (SVG 1.1, F.6.5).
fn arc(
    from: [f64; 2],
    radii: [f64; 2],
    rotation: f64,
    large: bool,
    sweep: bool,
    to: [f64; 2],
    verbs: &mut Vec<Verb>,
) {
    let (mut rx, mut ry) = (radii[0].abs(), radii[1].abs());
    if from == to {
        return;
    }
    if rx == 0.0 || ry == 0.0 {
        verbs.push(Verb::Line(to));
        return;
    }
    let (s, c) = (ops::sin(ops::rad(rotation)), ops::cos(ops::rad(rotation)));
    let (dx, dy) = ((from[0] - to[0]) / 2.0, (from[1] - to[1]) / 2.0);
    let (x1, y1) = (c * dx + s * dy, -s * dx + c * dy);
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lambda > 1.0 {
        let k = ops::sqrt(lambda);
        rx *= k;
        ry *= k;
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let mut k = ops::sqrt((num / den).max(0.0));
    if large == sweep {
        k = -k;
    }
    let (cx1, cy1) = (k * rx * y1 / ry, -k * ry * x1 / rx);
    let center = [
        c * cx1 - s * cy1 + (from[0] + to[0]) / 2.0,
        s * cx1 + c * cy1 + (from[1] + to[1]) / 2.0,
    ];
    let angle = |ux: f64, uy: f64| ops::atan2(uy, ux);
    let theta = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
    let mut delta = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - theta;
    let turn = 2.0 * std::f64::consts::PI;
    if sweep && delta < 0.0 {
        delta += turn;
    } else if !sweep && delta > 0.0 {
        delta -= turn;
    }
    let n = (delta.abs() / (turn / 4.0) - 1e-9).ceil().max(1.0);
    let step = delta / n;
    let handle = 4.0 / 3.0 * ops::tan(step / 4.0);
    let on = |a: f64| {
        let (sa, ca) = (ops::sin(a), ops::cos(a));
        let (x, y) = (rx * ca, ry * sa);
        let (tx, ty) = (-rx * sa, ry * ca);
        (
            [c * x - s * y + center[0], s * x + c * y + center[1]],
            [c * tx - s * ty, s * tx + c * ty],
        )
    };
    let mut a = theta;
    for i in 0..n as usize {
        let b = theta + step * (i + 1) as f64;
        let (p0, t0) = on(a);
        let (p1, t1) = on(b);
        let end = if i + 1 == n as usize { to } else { p1 };
        verbs.push(Verb::Cubic(
            [p0[0] + handle * t0[0], p0[1] + handle * t0[1]],
            [p1[0] - handle * t1[0], p1[1] - handle * t1[1]],
            end,
        ));
        a = b;
    }
}

/// The tight bounds `[x, y, w, h]` of verbs, its curves flattened within 0.001.
pub fn bounds(verbs: &[Verb]) -> Option<[f64; 4]> {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    let moves = verbs.iter().filter_map(|v| match v {
        Verb::Move(p) => Some(*p),
        _ => None,
    });
    let flat = path::flatten(verbs, 0.001);
    for p in moves.chain(flat.iter().flat_map(|l| l.points.iter().copied())) {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    lo[0]
        .is_finite()
        .then(|| [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_half_circle_arc_ends_where_it_says_and_bulges_by_its_radius() {
        let ((verbs, _), complete) = path_data("M 0 0 A 10 10 0 0 1 20 0");
        assert!(complete);
        assert!(matches!(verbs.last(), Some(Verb::Cubic(_, _, [20.0, 0.0]))));
        let b = bounds(&verbs).unwrap();
        assert!(
            (b[0] - 0.0).abs() < 1e-6 && (b[2] - 20.0).abs() < 1e-6,
            "{b:?}"
        );
        assert!(
            (b[1] + 10.0).abs() < 0.01 && (b[3] - 10.0).abs() < 0.01,
            "{b:?}"
        );
    }

    fn read(svg: &str) -> Svg {
        import(svg.as_bytes(), &[], Twin::Honest).unwrap()
    }

    #[test]
    fn a_user_space_mask_with_no_region_covers_the_viewport() {
        let svg = read(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <mask id="m" maskUnits="userSpaceOnUse"><rect width="100" height="100" fill="white"/></mask>
            <rect x="10" y="10" width="50" height="50" mask="url(#m)"/></svg>"#,
        );
        let region = &svg.clips[svg.clips[svg.paths[0].clip.unwrap()].parent.unwrap()];
        assert_eq!(bounds(&region.verbs), Some([-10.0, -10.0, 120.0, 120.0]));
    }

    #[test]
    fn a_style_rule_and_an_attribute_set_one_opacity_the_last_winning() {
        let svg = read(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
            <style>rect { opacity: 0.5 }</style><rect width="5" height="5" opacity="0.5"/></svg>"#,
        );
        assert_eq!(svg.paths[0].fill.unwrap().opacity, 0.5);
    }

    #[test]
    fn a_marker_draws_at_the_opacity_of_the_element_it_marks() {
        let svg = read(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <marker id="k" markerUnits="userSpaceOnUse" markerWidth="4" markerHeight="4">
            <rect width="4" height="4"/></marker>
            <path d="M 10 10 L 50 10" stroke="black" opacity="0.5" marker-end="url(#k)"/></svg>"#,
        );
        assert_eq!(svg.paths[1].fill.unwrap().opacity, 0.5);
    }

    fn doc(body: &str) -> String {
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{body}</svg>"#)
    }

    #[test]
    fn a_marker_that_marks_itself_refuses_instead_of_doubling_each_level() {
        let svg = doc(
            r#"<marker id="m" overflow="visible" markerUnits="userSpaceOnUse">
            <path d="M0 0 L1 0" marker-start="url(#m)" marker-end="url(#m)"/></marker>
            <path d="M0 0 L1 0" marker-start="url(#m)" marker-end="url(#m)"/>"#,
        );
        let found = import(svg.as_bytes(), &[], Twin::Honest);
        assert!(
            matches!(found, Err(Refusal::Malformed(_))),
            "{:?}",
            found.map(|s| s.paths.len())
        );
    }

    #[test]
    fn a_pattern_inside_its_own_tiles_refuses_instead_of_multiplying_them() {
        let svg = doc(
            r#"<pattern id="p" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="1" height="1"/><rect width="64" height="64" fill="url(#p)"/></pattern>
            <rect width="64" height="64" fill="url(#p)"/>"#,
        );
        let found = import(svg.as_bytes(), &[], Twin::Honest);
        assert!(
            matches!(found, Err(Refusal::Malformed(_))),
            "{:?}",
            found.map(|s| s.paths.len())
        );
    }

    #[test]
    fn an_alpha_mask_takes_its_shapes_alpha_not_their_luminance() {
        let svg = read(&doc(
            r##"<mask id="k" style="mask-type:alpha"><rect width="64" height="64" fill="#D9D9D9"/></mask>
            <rect width="64" height="64" fill="red" mask="url(#k)"/>"##,
        ));
        assert_eq!(svg.clips[svg.paths[0].clip.unwrap()].alpha, 1.0);
    }

    #[test]
    fn a_style_rule_hiding_an_element_hides_it() {
        let svg = read(&doc(
            r#"<style>.st0{display:none}</style><rect class="st0" width="64" height="64"/>"#,
        ));
        assert!(svg.paths.is_empty(), "{:?}", svg.paths);
    }

    #[test]
    fn a_css_transform_is_named_not_dropped() {
        let svg = read(&doc(
            r#"<style>rect{transform:translate(10px,0)}</style><rect width="4" height="4"/>"#,
        ));
        assert!(
            svg.unread.contains(&"transform".to_string()),
            "{:?}",
            svg.unread
        );
    }

    #[test]
    fn a_style_reference_outside_the_svg_refuses_it() {
        for body in [
            r#"<style>rect{fill:url(https://x.test/a.svg#p)}</style><rect width="4" height="4"/>"#,
            r#"<rect width="4" height="4" style="fill:url(#a);stroke:url(https://x.test/b.svg#q)"/>"#,
        ] {
            let found = import(doc(body).as_bytes(), &[], Twin::Honest);
            assert!(
                matches!(found, Err(Refusal::External(_))),
                "{body}: {found:?}"
            );
        }
    }

    #[test]
    fn a_paint_server_with_a_fallback_color_draws_the_server_or_the_color() {
        let tiles = read(&doc(
            r#"<pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="4" height="4" fill="blue"/></pattern>
            <rect width="64" height="64" fill="url(#p) red"/>"#,
        ));
        assert_eq!(tiles.paths.len(), 64);
        let fallback = read(&doc(
            r#"<rect width="4" height="4" fill="url(#none) red"/>"#,
        ));
        assert_eq!(
            fallback.paths[0].fill.unwrap().color,
            Color::Rgb([255, 0, 0])
        );
    }

    #[test]
    fn an_even_odd_rule_the_clips_cannot_carry_is_named() {
        let pattern = read(&doc(
            r#"<pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="blue"/></pattern>
            <path fill-rule="evenodd" d="M0 0H64V64H0Z M16 16H48V48H16Z" fill="url(#p)"/>"#,
        ));
        assert!(
            pattern.unread.contains(&"fill-rule".to_string()),
            "{:?}",
            pattern.unread
        );
        let clip = read(&doc(
            r#"<g clip-rule="evenodd"><clipPath id="c"><path d="M0 0H64V64H0Z M16 16H48V48H16Z"/>
            </clipPath></g><rect width="64" height="64" clip-path="url(#c)"/>"#,
        ));
        assert!(
            clip.unread.contains(&"clipPath".to_string()),
            "{:?}",
            clip.unread
        );
    }

    #[test]
    fn a_bounding_box_clip_on_an_element_with_tiles_or_markers_is_named() {
        let svg = read(&doc(
            r#"<pattern id="p" patternUnits="userSpaceOnUse" width="7" height="7">
            <rect width="7" height="7" fill="blue"/></pattern>
            <clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath>
            <rect width="10" height="10" fill="url(#p)" clip-path="url(#c)"/>"#,
        ));
        assert!(
            svg.unread.contains(&"clipPath".to_string()),
            "{:?}",
            svg.unread
        );
    }

    #[test]
    fn a_pattern_inherits_what_its_ancestors_set() {
        let svg = read(&doc(
            r#"<g fill="blue"><pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="4" height="4"/></pattern></g>
            <rect width="8" height="8" fill="url(#p)"/>"#,
        ));
        assert_eq!(svg.paths[0].fill.unwrap().color, Color::Rgb([0, 0, 255]));
    }

    #[test]
    fn numbers_run_together_as_svg_writes_them() {
        assert_eq!(numbers("1-2.5.5e1,3"), vec![1.0, -2.5, 5.0, 3.0]);
        let ((verbs, _), _) = path_data("m1 1l2 0h1v1z");
        assert_eq!(verbs[3], Verb::Line([4.0, 2.0]));
    }

    /// A rect inside `n` groups, each opened by `open`.
    fn nested(open: &str, n: usize) -> String {
        let (opens, closes) = (open.repeat(n), "</g>".repeat(n));
        doc(&format!(r#"{opens}<rect width="4" height="4"/>{closes}"#))
    }

    #[test]
    fn groups_nested_past_the_limit_are_refused() {
        for open in ["<g>", r#"<g a="/>">"#, "<g a='>'\n>"] {
            let found = import(nested(open, 300).as_bytes(), &[], Twin::Honest);
            assert!(
                matches!(&found, Err(Refusal::Malformed(what)) if what.contains("nest")),
                "{open}: {:?}",
                found.map(|s| s.paths.len())
            );
        }
    }

    /// `chain` groups that each hold the next through a `<use>`, `deep` groups down; the last
    /// holds a rect, and `first` names the first.
    fn chained(deep: usize, chain: usize, first: &str) -> String {
        let (opens, closes) = ("<g>".repeat(deep), "</g>".repeat(deep));
        let groups: String = (0..chain)
            .map(|k| {
                let held = if k + 1 < chain {
                    format!(r##"<use href="#u{}"/>"##, k + 1)
                } else {
                    r#"<rect width="4" height="4" fill="white"/>"#.to_string()
                };
                format!(r#"<g id="u{k}">{opens}{held}{closes}</g>"#)
            })
            .collect();
        doc(&format!("<defs>{groups}</defs>{first}"))
    }

    #[test]
    fn groups_nested_past_the_limit_through_uses_are_refused() {
        let svg = chained(50, 16, r##"<use href="#u0"/>"##);
        let found = import(svg.as_bytes(), &[], Twin::Honest);
        assert!(
            matches!(&found, Err(Refusal::Malformed(what)) if what.contains("nest")),
            "{:?}",
            found.map(|s| s.paths.len())
        );
        assert_eq!(
            read(&chained(1, 16, r##"<use href="#u0"/>"##)).paths.len(),
            1
        );
    }

    #[test]
    fn a_mask_nested_past_the_limit_through_uses_is_left_unread() {
        let masked =
            r##"<mask id="m"><use href="#u0"/></mask><rect width="9" height="9" mask="url(#m)"/>"##;
        let svg = read(&chained(60, 15, masked));
        assert!(svg.unread.iter().any(|u| u == "mask"), "{:?}", svg.unread);
        let svg = read(&chained(1, 15, masked));
        assert!(!svg.unread.iter().any(|u| u == "mask"), "{:?}", svg.unread);
    }

    #[test]
    fn nesting_inside_the_limit_still_imports() {
        // The `<svg>`, 62 groups and the rect stand 64 deep; one group more is over.
        assert_eq!(read(&nested("<g>", 62)).paths.len(), 1);
        assert!(import(nested("<g>", 63).as_bytes(), &[], Twin::Honest).is_err());
        // Tags inside a comment, a CDATA section or an instruction open nothing.
        let opens = "<g>".repeat(300);
        for held in [
            format!("<!-- {opens} -->"),
            format!("<desc><![CDATA[{opens}]]></desc>"),
            format!("<?note {opens}?>"),
        ] {
            let svg = read(&doc(&format!(r#"{held}<rect width="4" height="4"/>"#)));
            assert_eq!(svg.paths.len(), 1, "{}", &held[..12]);
        }
        // Siblings that close, with and without a tag of their own, never add up.
        let flat = r#"<g><rect width="4" height="4"/></g><g/>"#.repeat(300);
        assert_eq!(read(&doc(&flat)).paths.len(), 300);
    }
}
