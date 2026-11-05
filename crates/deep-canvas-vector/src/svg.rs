//! The SVG import (canvas primitives: Vector and formula `vector@1`): bytes read once into static
//! paths in the SVG's own space, each with its fill and stroke colors still the SVG's, and its
//! parts. It reads a closed list of elements: script, event handlers, `javascript:` links,
//! outside references and text refuse the whole SVG; any other element outside the list is
//! returned as one it didn't read, naming it, and never dropped silently. Internal `<use>` and
//! `<defs>` resolve here, so each use is its own copy of the geometry it names.

use std::collections::BTreeMap;

use deep_canvas::ops;
use deep_canvas::outline::FillRule;
use deep_canvas_marks::path::{self, Verb};
use roxmltree::{Document, Node, ParsingOptions};

/// The largest SVG the import reads (`src: sha256` (SVG, ≤ 512 KB)).
pub const MAX_BYTES: usize = 512 * 1024;

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

/// How deep `<use>` may nest, so a use that reaches itself refuses instead of spinning.
const USE_DEPTH: usize = 16;

/// The elements the import reads: containers, shapes, `<use>`, and those that hold no drawing.
const READ: &[&str] = &[
    "svg", "g", "a", "defs", "use", "path", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "title", "desc", "metadata",
];

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

/// One drawn element: its outline in the SVG's viewBox space, its paints and its innermost part.
#[derive(Clone, Debug, PartialEq)]
pub struct Painted {
    pub verbs: Vec<Verb>,
    pub fill: Option<Paint>,
    pub stroke: Option<Stroke>,
    pub part: Option<usize>,
    /// Its `fill-rule` (#443): how its contours resolve to the area its fill covers.
    pub fill_rule: FillRule,
}

/// A part: an element with an id, or a class `parts` names, that draws; and the part it sits in.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub id: String,
    pub parent: Option<usize>,
}

/// What the import read, in paint order.
#[derive(Clone, Debug, PartialEq)]
pub struct Svg {
    pub view_box: [f64; 4],
    pub parts: Vec<Part>,
    pub paths: Vec<Painted>,
    /// Each element or attribute the import didn't read, by name, once, in document order.
    pub unread: Vec<String>,
}

/// Reads `bytes`. `classes` are the classes whose elements become parts; `skips_clip_path` is
/// #398's planted importer, which leaves `<clipPath>` out of what it didn't read.
pub fn import(bytes: &[u8], classes: &[String], skips_clip_path: bool) -> Result<Svg, Refusal> {
    if bytes.len() > MAX_BYTES {
        return Err(Refusal::TooLarge(bytes.len()));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Refusal::Malformed("not UTF-8".into()))?;
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
    scan(root, skips_clip_path, &mut unread, &mut ids)?;
    let view_box = view_box(root);
    let mut import = Import {
        ids,
        classes,
        unread,
        parts: Vec::new(),
        paths: Vec::new(),
    };
    let style = Style::default().with(root, &mut import.unread);
    for child in root.children().filter(Node::is_element) {
        import.walk(child, IDENTITY, &style, None, 0)?;
    }
    Ok(Svg {
        view_box,
        parts: import.parts,
        paths: import.paths,
        unread: import.unread,
    })
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
    skips_clip_path: bool,
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
            if let Some(at) = value.find("url(") {
                let inner = value[at + 4..].trim_start().trim_start_matches(['"', '\'']);
                if !inner.starts_with('#') {
                    return Err(Refusal::External(value.into()));
                }
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
        if !READ.contains(&name) && !inside_unread && !(skips_clip_path && name == "clipPath") {
            unread_once(unread, name);
        }
    }
    Ok(())
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

/// A paint as written: a color, `none`, or a paint server, which the import doesn't read.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Spec {
    Color(Color),
    None,
    Server,
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
            fill_rule: FillRule::NonZero,
        }
    }
}

impl Style {
    /// This style under `node`: its presentation attributes, then its `style` declarations.
    fn with(&self, node: Node<'_, '_>, unread: &mut Vec<String>) -> Style {
        let mut s = self.clone();
        let mut declared: Vec<(&str, &str)> = node
            .attributes()
            .filter(|a| a.namespace().is_none())
            .map(|a| (a.name(), a.value()))
            .collect();
        if let Some(style) = node.attribute("style") {
            declared.extend(style.split(';').filter_map(|d| {
                let (k, v) = d.split_once(':')?;
                Some((k.trim(), v.trim()))
            }));
        }
        // `color` first, so a currentColor beside it reads it.
        declared.sort_by_key(|(k, _)| *k != "color");
        for (k, v) in declared {
            let v = v.trim();
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
                "opacity" => s.opacity *= unit(v).unwrap_or(1.0),
                "fill-rule" if v == "evenodd" => s.fill_rule = FillRule::EvenOdd,
                "fill-rule" if v == "nonzero" => s.fill_rule = FillRule::NonZero,
                "clip-rule" if v == "evenodd" => unread_once(unread, k),
                "stroke-linecap" if v != "butt" => unread_once(unread, k),
                "stroke-linejoin" if v != "miter" => unread_once(unread, k),
                "stroke-dasharray" if v != "none" => unread_once(unread, k),
                // clip-path, mask, filter and the markers name elements the scan returned.
                _ => {}
            }
        }
        // currentColor is resolved where `color` is set, as SVG resolves it.
        for paint in [&mut s.fill, &mut s.stroke] {
            if let (Spec::Color(Color::Current), Some(c)) = (*paint, s.color) {
                *paint = Spec::Color(Color::Rgb(c));
            }
        }
        s
    }

    fn paint(&self, spec: Spec, opacity: f64) -> Option<Paint> {
        match spec {
            Spec::Color(color) => Some(Paint {
                color,
                opacity: opacity * self.opacity,
            }),
            Spec::None | Spec::Server => None,
        }
    }
}

struct Import<'a, 'i, 'c> {
    ids: BTreeMap<String, Node<'a, 'i>>,
    classes: &'c [String],
    unread: Vec<String>,
    parts: Vec<Part>,
    paths: Vec<Painted>,
}

impl<'a, 'i> Import<'a, 'i, '_> {
    /// Draws `node` under `ctm`; `uses` counts the `<use>`s it is inside, whose copies hold no
    /// parts of their own.
    fn walk(
        &mut self,
        node: Node<'a, 'i>,
        ctm: Affine,
        parent: &Style,
        part: Option<usize>,
        uses: usize,
    ) -> Result<(), Refusal> {
        let name = node.tag_name().name();
        if node.tag_name().namespace() != Some(SVG_NS)
            || !READ.contains(&name)
            || matches!(name, "defs" | "title" | "desc" | "metadata")
            || node.attribute("display") == Some("none")
        {
            return Ok(());
        }
        let style = parent.with(node, &mut self.unread);
        let ctm = ctm.then(&transform(node.attribute("transform").unwrap_or("")));
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
                self.parts.push(Part { id, parent: part });
                Some(self.parts.len() - 1)
            }
            _ => None,
        };
        let first = self.paths.len();
        let inner = own.or(part);
        match name {
            "svg" | "g" | "a" => {
                let ctm = if name == "svg" {
                    let at = |k: &str| node.attribute(k).and_then(length).unwrap_or(0.0);
                    ctm.then(&Affine([1.0, 0.0, 0.0, 1.0, at("x"), at("y")]))
                } else {
                    ctm
                };
                for child in node.children().filter(Node::is_element) {
                    self.walk(child, ctm, &style, inner, uses)?;
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
                let ctm = ctm.then(&Affine([1.0, 0.0, 0.0, 1.0, at("x"), at("y")]));
                if target.tag_name().name() == "symbol" {
                    unread_once(&mut self.unread, "symbol");
                } else {
                    self.walk(target, ctm, &style, inner, uses + 1)?;
                }
            }
            _ => {
                if let Some(verbs) = shape(node, &mut self.unread) {
                    let fill = style.paint(style.fill, style.fill_opacity);
                    let stroke = style
                        .paint(style.stroke, style.stroke_opacity)
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
                            part: inner,
                            fill_rule: style.fill_rule,
                        });
                    }
                }
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
}

/// A shape element's outline in its own user space.
fn shape(node: Node<'_, '_>, unread: &mut Vec<String>) -> Option<Vec<Verb>> {
    let n = |k: &str| node.attribute(k).and_then(length);
    let v = |k: &str| n(k).unwrap_or(0.0);
    match node.tag_name().name() {
        "path" => {
            let (verbs, complete) = path_data(node.attribute("d").unwrap_or(""));
            if !complete {
                // SVG draws a path up to its first error; the rest is named, not dropped.
                unread_once(unread, "path");
            }
            Some(verbs)
        }
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
        return Some(Spec::Server);
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

/// Path data read into absolute verbs, with S, T and A turned into cubics; and whether it read
/// to the end (SVG draws a path up to its first error).
fn path_data(d: &str) -> (Vec<Verb>, bool) {
    let mut c = Cursor::new(d);
    let mut verbs = Vec::new();
    let (mut cur, mut start) = ([0.0, 0.0], [0.0, 0.0]);
    // The last curve's second control point, for S and T's reflection.
    let mut last_cubic: Option<[f64; 2]> = None;
    let mut last_quad: Option<[f64; 2]> = None;
    let mut command: Option<u8> = None;
    loop {
        let Some(next) = c.peek() else {
            return (verbs, true);
        };
        let cmd = if next.is_ascii_alphabetic() {
            c.at += 1;
            next
        } else {
            match command {
                Some(b'M') => b'L',
                Some(b'm') => b'l',
                Some(cmd) if !matches!(cmd, b'Z' | b'z') => cmd,
                _ => return (verbs, false),
            }
        };
        if command.is_none() && !matches!(cmd, b'M' | b'm') {
            return (verbs, false);
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
            return (verbs, false);
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
        let (verbs, complete) = path_data("M 0 0 A 10 10 0 0 1 20 0");
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

    #[test]
    fn numbers_run_together_as_svg_writes_them() {
        assert_eq!(numbers("1-2.5.5e1,3"), vec![1.0, -2.5, 5.0, 3.0]);
        let (verbs, _) = path_data("m1 1l2 0h1v1z");
        assert_eq!(verbs[3], Verb::Line([4.0, 2.0]));
    }
}
