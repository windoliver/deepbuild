//! #732 (Export: `pptx`): a staged piece as an editable deck, one slide per stage at its settled
//! frame. The export module's plan (`deep_canvas_export::pptx`) says what each slide holds: every
//! text item a text box with its styled runs, every rect, rounded rect, ellipse, line and path
//! with a flat or linear-gradient fill and a plain stroke a native shape, and each unbroken run of
//! everything else in draw order one picture. Each picture is drawn from the stage's own frames:
//! the frame with its marks up to the run's end against the frame up to its start, so it holds
//! exactly the pixels its run changes. The package is written by hand here (a stored zip at the
//! format's first date, its parts in one order), so the same revision gives the same bytes, under
//! a temporary name; the fidelity reader, which shares nothing with this writer, reads it back
//! (`deep-pptx-reader`), and the pinned LibreOffice draws each slide, held to the settled frame
//! outside the text boxes. Only then does the file take its name.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas::time as clock;
use deep_canvas_export::pptx::{self as plan, Beside, Geometry, Paint, Part, Run, Shape, TextBox};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{Align, Frame, Layer, MarkList};
use serde_json::{json, Value};

use super::{temp_of, Guard, Job};
use crate::frames::{drawing_of, Painted};
use crate::hub::Hub;

/// EMU per px: the default 1920 × 1080 px slide is the 16:9 deck's 13.333 × 7.5 in, half a
/// point per px.
pub(crate) const EMU_PER_PX: f64 = 6_350.0;

/// The pptx target's options (`pptx: {slide, notes, fonts}`).
pub(crate) struct Options {
    pub slide: [u16; 2],
    pub notes: bool,
    pub embed: bool,
}

impl Options {
    /// The options a request gives, or the refusal naming the field it can't take.
    pub(crate) fn of(v: &Value) -> Result<Options, Value> {
        let bad = |field: &str| json!({"code": "bad_input", "field": format!("pptx/{field}")});
        let mut o = Options {
            slide: [1920, 1080],
            notes: true,
            embed: true,
        };
        let Some(map) = v.as_object() else {
            return if v.is_null() { Ok(o) } else { Err(bad("")) };
        };
        if let Some(s) = map.get("slide") {
            let pair = s
                .as_array()
                .filter(|a| a.len() == 2)
                .and_then(|a| Some([a[0].as_u64()?, a[1].as_u64()?]))
                .filter(|p| p.iter().all(|&n| (1..=8192).contains(&n)))
                .ok_or_else(|| bad("slide"))?;
            o.slide = pair.map(|n| n as u16);
        }
        if let Some(n) = map.get("notes") {
            o.notes = n.as_bool().ok_or_else(|| bad("notes"))?;
        }
        match map.get("fonts").map(Value::as_str) {
            None | Some(Some("embed_allowed")) => {}
            Some(Some("name_only")) => o.embed = false,
            Some(_) => return Err(bad("fonts")),
        }
        Ok(o)
    }
}

/// One slide as written: its ground's color, its elements bottom first, and its notes.
pub(crate) struct SlideOut {
    pub ground: Option<[u8; 3]>,
    pub elements: Vec<Element>,
    pub notes: Option<String>,
}

/// An element of a slide, in px.
pub(crate) enum Element {
    Text(TextBox),
    Shape(Shape),
    Picture(PictureOut),
}

/// A picture: the items it holds with why, its place in px and its PNG.
pub(crate) struct PictureOut {
    pub items: Vec<(String, String)>,
    pub rect: [u32; 4],
    pub png: Vec<u8>,
}

/// A font file the deck embeds: the typeface runs name, its style slot and the face's bytes.
pub(crate) struct FontOut {
    pub typeface: String,
    pub style: &'static str,
    pub data: Vec<u8>,
}

/// Text escaped for XML, with the characters XML 1.0 can't hold dropped.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

fn emu(px: f64) -> i64 {
    (px * EMU_PER_PX).round() as i64
}

fn hex(c: [u8; 3]) -> String {
    format!("{:02X}{:02X}{:02X}", c[0], c[1], c[2])
}

/// A color element, with its alpha when below 1.
fn srgb(c: [u8; 3], alpha: f64) -> String {
    if alpha < 1.0 {
        let a = (alpha.clamp(0.0, 1.0) * 100_000.0).round() as i64;
        format!(
            r#"<a:srgbClr val="{}"><a:alpha val="{a}"/></a:srgbClr>"#,
            hex(c)
        )
    } else {
        format!(r#"<a:srgbClr val="{}"/>"#, hex(c))
    }
}

const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const DECL: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TREE: &str = r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#;

/// The typeface a run names and whether it sets bold: the family, bold from 600 up.
pub(crate) fn typeface(run: &Run) -> (String, bool) {
    (run.family.clone(), run.weight >= 600)
}

fn xfrm(r: [f64; 4]) -> String {
    format!(
        r#"<a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm>"#,
        emu(r[0]),
        emu(r[1]),
        emu(r[2]).max(1),
        emu(r[3]).max(1)
    )
}

fn run_xml(r: &Run, s: f64) -> String {
    let (face, bold) = typeface(r);
    let sz = ((r.size * s * 0.5 * 100.0).round() as i64).clamp(100, 400_000);
    let mut attrs = format!(
        r#"lang="en-US" sz="{sz}" b="{}" i="{}""#,
        u8::from(bold),
        u8::from(r.italic)
    );
    if r.underline {
        attrs.push_str(r#" u="sng""#);
    }
    if r.strike {
        attrs.push_str(r#" strike="sngStrike""#);
    }
    if r.baseline != 0.0 {
        attrs.push_str(&format!(
            r#" baseline="{}""#,
            (r.baseline * 100_000.0).round() as i64
        ));
    }
    let face = esc(&face);
    format!(
        r#"<a:r><a:rPr {attrs} dirty="0"><a:solidFill>{}</a:solidFill><a:latin typeface="{face}"/><a:ea typeface="{face}"/><a:cs typeface="{face}"/></a:rPr><a:t>{}</a:t></a:r>"#,
        srgb(r.color, r.alpha),
        esc(&r.text)
    )
}

fn text_xml(id: usize, tb: &TextBox, s: [f64; 2]) -> String {
    let rect = [
        tb.rect[0] * s[0],
        tb.rect[1] * s[1],
        tb.rect[2] * s[0],
        tb.rect[3] * s[1],
    ];
    let algn = match tb.align {
        Align::Start => "l",
        Align::Center => "ctr",
        Align::End => "r",
    };
    let size = tb
        .paragraphs
        .iter()
        .flatten()
        .map(|r| r.size)
        .next()
        .unwrap_or(16.0);
    let end = ((size * s[1] * 0.5 * 100.0).round() as i64).clamp(100, 400_000);
    let mut body = String::new();
    for p in &tb.paragraphs {
        body.push_str(&format!(r#"<a:p><a:pPr algn="{algn}"/>"#));
        for r in p {
            body.push_str(&run_xml(r, s[1]));
        }
        body.push_str(&format!(
            r#"<a:endParaRPr lang="en-US" sz="{end}" dirty="0"/></a:p>"#
        ));
    }
    let wrap = if tb.wrap { "square" } else { "none" };
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>{}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="{wrap}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>"#,
        esc(&tb.item),
        xfrm(rect)
    )
}

fn paint_xml(p: Option<&Paint>) -> String {
    match p {
        None => "<a:noFill/>".into(),
        Some(Paint::Solid(c, a)) => format!("<a:solidFill>{}</a:solidFill>", srgb(*c, *a)),
        Some(Paint::Linear { stops, angle }) => {
            let gs: String = stops
                .iter()
                .map(|(t, c, a)| {
                    format!(
                        r#"<a:gs pos="{}">{}</a:gs>"#,
                        (t.clamp(0.0, 1.0) * 100_000.0).round() as i64,
                        srgb(*c, *a)
                    )
                })
                .collect();
            format!(
                r#"<a:gradFill rotWithShape="1"><a:gsLst>{gs}</a:gsLst><a:lin ang="{}" scaled="0"/></a:gradFill>"#,
                (angle.rem_euclid(360.0) * 60_000.0).round() as i64 % 21_600_000
            )
        }
    }
}

fn shape_xml(id: usize, sh: &Shape, s: [f64; 2]) -> String {
    let scale = |b: [f64; 4]| [b[0] * s[0], b[1] * s[1], b[2] * s[0], b[3] * s[1]];
    let b = scale(sh.geometry.bounds());
    let geom = match &sh.geometry {
        Geometry::Rect(_) => r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#.to_string(),
        Geometry::Ellipse(_) => r#"<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>"#.to_string(),
        Geometry::Round(_, r) => {
            let short = b[2].min(b[3]).max(1e-9);
            let adj = ((r * s[0] / short) * 100_000.0)
                .round()
                .clamp(0.0, 50_000.0) as i64;
            format!(
                r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>"#
            )
        }
        Geometry::Path(verbs) => {
            let (w, h) = (emu(b[2]).max(1), emu(b[3]).max(1));
            let pt = |p: &[f64; 2]| {
                format!(
                    r#"<a:pt x="{}" y="{}"/>"#,
                    emu(p[0] * s[0] - b[0]),
                    emu(p[1] * s[1] - b[1])
                )
            };
            let mut d = String::new();
            for v in verbs {
                match v {
                    Verb::Move(p) => d.push_str(&format!("<a:moveTo>{}</a:moveTo>", pt(p))),
                    Verb::Line(p) => d.push_str(&format!("<a:lnTo>{}</a:lnTo>", pt(p))),
                    Verb::Quad(a, p) => {
                        d.push_str(&format!("<a:quadBezTo>{}{}</a:quadBezTo>", pt(a), pt(p)))
                    }
                    Verb::Cubic(a, c, p) => d.push_str(&format!(
                        "<a:cubicBezTo>{}{}{}</a:cubicBezTo>",
                        pt(a),
                        pt(c),
                        pt(p)
                    )),
                    Verb::Close => d.push_str("<a:close/>"),
                }
            }
            let fill = if sh.fill.is_some() {
                ""
            } else {
                r#" fill="none""#
            };
            let stroke = if sh.stroke.is_some() {
                ""
            } else {
                r#" stroke="0""#
            };
            format!(
                r#"<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="{w}" h="{h}"{fill}{stroke}>{d}</a:path></a:pathLst></a:custGeom>"#
            )
        }
    };
    let ln = match &sh.stroke {
        Some(st) => format!(
            r#"<a:ln w="{}" cap="flat"><a:solidFill>{}</a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>"#,
            emu(st.width * s[0]).max(1),
            srgb(st.color, st.alpha)
        ),
        None => "<a:ln><a:noFill/></a:ln>".into(),
    };
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>{}{geom}{}{ln}</p:spPr></p:sp>"#,
        esc(&sh.item),
        xfrm(b),
        paint_xml(sh.fill.as_ref())
    )
}

fn picture_xml(id: usize, n: usize, p: &PictureOut, rid: &str) -> String {
    let items: Vec<&str> = p.items.iter().map(|(i, _)| i.as_str()).collect();
    let r = p.rect.map(f64::from);
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{id}" name="Picture {n}" descr="{}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#,
        esc(&items.join(", ")),
        xfrm(r)
    )
}

fn rels(list: &[(String, &str, String)]) -> String {
    let mut out = format!(
        "{DECL}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
    );
    for (id, kind, target) in list {
        let ty = if kind.starts_with("http") {
            (*kind).to_string()
        } else {
            format!("{REL}/{kind}")
        };
        out.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{ty}" Target="{}"/>"#,
            esc(target)
        ));
    }
    out.push_str("</Relationships>");
    out
}

fn notes_xml(text: &str) -> String {
    let paras: String = text
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                r#"<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>"#.to_string()
            } else {
                format!(
                    r#"<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{}</a:t></a:r></a:p>"#,
                    esc(line)
                )
            }
        })
        .collect();
    format!(
        r#"{DECL}<p:notes {NS}><p:cSld><p:spTree>{TREE}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
    )
}

const THEME: &str = r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DeepBuild"><a:themeElements><a:clrScheme name="DeepBuild"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="DeepBuild"><a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="DeepBuild"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"#;
const CLR_MAP: &str = r#"<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>"#;
const CT: &str = "application/vnd.openxmlformats-officedocument.presentationml";

/// The deck's package: every part in one order, stored at the zip format's first date, so the
/// same slides give the same bytes.
pub(crate) fn package(
    title: &str,
    size: [u16; 2],
    slides: &[SlideOut],
    fonts: &[FontOut],
    scale: [f64; 2],
) -> Vec<u8> {
    let [cx, cy] = size.map(|v| emu(f64::from(v)));
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
    let mut put = |name: String, body: String| parts.push((name, body.into_bytes()));
    let mut types = format!(
        r#"{DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="fntdata" ContentType="application/x-fontdata"/><Override PartName="/ppt/presentation.xml" ContentType="{CT}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{CT}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{CT}.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="{CT}.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="{CT}.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="{CT}.viewProps+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>"#
    );
    for k in 1..=slides.len() {
        types.push_str(&format!(r#"<Override PartName="/ppt/slides/slide{k}.xml" ContentType="{CT}.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide{k}.xml" ContentType="{CT}.notesSlide+xml"/>"#));
    }
    types.push_str("</Types>");
    put("[Content_Types].xml".into(), types);
    put(
        "_rels/.rels".into(),
        rels(&[
            ("rId1".into(), "officeDocument", "ppt/presentation.xml".into()),
            ("rId2".into(), "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml".into()),
            ("rId3".into(), "extended-properties", "docProps/app.xml".into()),
        ]),
    );
    put(
        "docProps/core.xml".into(),
        format!(
            r#"{DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>DeepBuild</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>"#,
            esc(title)
        ),
    );
    put(
        "docProps/app.xml".into(),
        format!(
            r#"{DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>DeepBuild</Application><Slides>{n}</Slides><Notes>{n}</Notes></Properties>"#,
            n = slides.len()
        ),
    );
    // The presentation: its master, notes master, slides, size and embedded fonts.
    let mut pres_rels = vec![
        (
            "rId1".to_string(),
            "slideMaster",
            "slideMasters/slideMaster1.xml".to_string(),
        ),
        (
            "rId2".into(),
            "notesMaster",
            "notesMasters/notesMaster1.xml".into(),
        ),
        ("rId3".into(), "theme", "theme/theme1.xml".into()),
        ("rId4".into(), "presProps", "presProps.xml".into()),
        ("rId5".into(), "viewProps", "viewProps.xml".into()),
    ];
    let mut ids = String::new();
    for k in 1..=slides.len() {
        let rid = format!("rId{}", 5 + k);
        ids.push_str(&format!(r#"<p:sldId id="{}" r:id="{rid}"/>"#, 255 + k));
        pres_rels.push((rid, "slide", format!("slides/slide{k}.xml")));
    }
    let mut embedded = String::new();
    let mut by_face: BTreeMap<&str, Vec<(&str, String)>> = BTreeMap::new();
    for (k, f) in fonts.iter().enumerate() {
        let rid = format!("rId{}", 6 + slides.len() + k);
        pres_rels.push((rid.clone(), "font", format!("fonts/font{}.fntdata", k + 1)));
        by_face
            .entry(f.typeface.as_str())
            .or_default()
            .push((f.style, rid));
        parts.push((format!("ppt/fonts/font{}.fntdata", k + 1), f.data.clone()));
    }
    for (face, styles) in &by_face {
        embedded.push_str(&format!(
            r#"<p:embeddedFont><p:font typeface="{}"/>"#,
            esc(face)
        ));
        for slot in ["regular", "bold", "italic", "boldItalic"] {
            if let Some((_, rid)) = styles.iter().find(|(s, _)| *s == slot) {
                embedded.push_str(&format!(r#"<p:{slot} r:id="{rid}"/>"#));
            }
        }
        embedded.push_str("</p:embeddedFont>");
    }
    let embedded = if embedded.is_empty() {
        String::new()
    } else {
        format!("<p:embeddedFontLst>{embedded}</p:embeddedFontLst>")
    };
    let embed_attr = if fonts.is_empty() {
        ""
    } else {
        r#" embedTrueTypeFonts="1""#
    };
    let mut parts_tail: Vec<(String, Vec<u8>)> = std::mem::take(&mut parts);
    let mut put = |name: String, body: String| parts.push((name, body.into_bytes()));
    put(
        "ppt/presentation.xml".into(),
        format!(
            r#"{DECL}<p:presentation {NS}{embed_attr}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="{cx}" cy="{cy}"/><p:notesSz cx="6858000" cy="9144000"/>{embedded}</p:presentation>"#
        ),
    );
    put("ppt/_rels/presentation.xml.rels".into(), rels(&pres_rels));
    put(
        "ppt/presProps.xml".into(),
        format!(r#"{DECL}<p:presentationPr {NS}/>"#),
    );
    put(
        "ppt/viewProps.xml".into(),
        format!(r#"{DECL}<p:viewPr {NS}><p:normalViewPr/></p:viewPr>"#),
    );
    put("ppt/theme/theme1.xml".into(), format!("{DECL}{THEME}"));
    put("ppt/theme/theme2.xml".into(), format!("{DECL}{THEME}"));
    put(
        "ppt/slideMasters/slideMaster1.xml".into(),
        format!(
            r#"{DECL}<p:sldMaster {NS}><p:cSld><p:spTree>{TREE}</p:spTree></p:cSld>{CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>"#
        ),
    );
    put(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels".into(),
        rels(&[
            (
                "rId1".into(),
                "slideLayout",
                "../slideLayouts/slideLayout1.xml".into(),
            ),
            ("rId2".into(), "theme", "../theme/theme1.xml".into()),
        ]),
    );
    put(
        "ppt/slideLayouts/slideLayout1.xml".into(),
        format!(
            r#"{DECL}<p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>{TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#
        ),
    );
    put(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels".into(),
        rels(&[(
            "rId1".into(),
            "slideMaster",
            "../slideMasters/slideMaster1.xml".into(),
        )]),
    );
    put(
        "ppt/notesMasters/notesMaster1.xml".into(),
        format!(
            r#"{DECL}<p:notesMaster {NS}><p:cSld><p:spTree>{TREE}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>{CLR_MAP}</p:notesMaster>"#
        ),
    );
    put(
        "ppt/notesMasters/_rels/notesMaster1.xml.rels".into(),
        rels(&[("rId1".into(), "theme", "../theme/theme2.xml".into())]),
    );
    let mut image = 0;
    for (k, slide) in slides.iter().enumerate() {
        let k = k + 1;
        let mut srels = vec![
            (
                "rId1".to_string(),
                "slideLayout",
                "../slideLayouts/slideLayout1.xml".to_string(),
            ),
            (
                "rId2".into(),
                "notesSlide",
                format!("../notesSlides/notesSlide{k}.xml"),
            ),
        ];
        let mut tree = String::new();
        let mut pictures = 0;
        for (j, e) in slide.elements.iter().enumerate() {
            let id = j + 2;
            match e {
                Element::Text(tb) => tree.push_str(&text_xml(id, tb, scale)),
                Element::Shape(sh) => tree.push_str(&shape_xml(id, sh, scale)),
                Element::Picture(p) => {
                    image += 1;
                    pictures += 1;
                    let rid = format!("rId{}", srels.len() + 1);
                    srels.push((rid.clone(), "image", format!("../media/image{image}.png")));
                    tree.push_str(&picture_xml(id, pictures, p, &rid));
                    parts_tail.push((format!("ppt/media/image{image}.png"), p.png.clone()));
                }
            }
        }
        let bg = slide.ground.map_or(String::new(), |g| {
            format!(
                r#"<p:bg><p:bgPr><a:solidFill>{}</a:solidFill><a:effectLst/></p:bgPr></p:bg>"#,
                srgb(g, 1.0)
            )
        });
        put(
            format!("ppt/slides/slide{k}.xml"),
            format!(
                r#"{DECL}<p:sld {NS}><p:cSld>{bg}<p:spTree>{TREE}{tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
            ),
        );
        put(format!("ppt/slides/_rels/slide{k}.xml.rels"), rels(&srels));
        put(
            format!("ppt/notesSlides/notesSlide{k}.xml"),
            notes_xml(slide.notes.as_deref().unwrap_or("")),
        );
        put(
            format!("ppt/notesSlides/_rels/notesSlide{k}.xml.rels"),
            rels(&[
                (
                    "rId1".into(),
                    "notesMaster",
                    "../notesMasters/notesMaster1.xml".into(),
                ),
                ("rId2".into(), "slide", format!("../slides/slide{k}.xml")),
            ]),
        );
    }
    // The content types first, then every other part in the order written.
    let (head, rest) = parts_tail.split_at(1.min(parts_tail.len()));
    let mut all: Vec<(String, Vec<u8>)> = head.to_vec();
    all.extend(rest.iter().cloned());
    all.extend(parts);
    let files: Vec<(&str, &[u8])> = all
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    super::lottie::zip(&files)
}

/// A TrueType face wrapped as an uncompressed Embedded OpenType, as a deck embeds a font: its
/// header read from the face's own OS/2, head and name tables. `None` for a face with CFF
/// outlines or tables it can't read, which a deck can't embed.
pub(crate) fn eot(ttf: &[u8]) -> Option<Vec<u8>> {
    let be16 = |at: usize| {
        ttf.get(at..at + 2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]))
    };
    let be32 = |at: usize| {
        ttf.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    if be32(0)? != 0x0001_0000 {
        return None;
    }
    let n = usize::from(be16(4)?);
    let table = |tag: &[u8; 4]| {
        (0..n).find_map(|i| {
            let at = 12 + 16 * i;
            (ttf.get(at..at + 4)? == tag).then(|| be32(at + 8).map(|o| o as usize))?
        })
    };
    let os2 = table(b"OS/2")?;
    let head = table(b"head")?;
    let name = table(b"name")?;
    // The name table's Windows Unicode strings (UTF-16BE), by name ID.
    let names = |id: u16| -> Vec<u8> {
        let (Some(count), Some(base)) = (be16(name + 2), be16(name + 4)) else {
            return Vec::new();
        };
        (0..usize::from(count))
            .find_map(|i| {
                let r = name + 6 + 12 * i;
                let ok = be16(r)? == 3 && be16(r + 2)? == 1 && be16(r + 6)? == id;
                let (len, off) = (usize::from(be16(r + 8)?), usize::from(be16(r + 10)?));
                let s = name + usize::from(base) + off;
                ok.then(|| ttf.get(s..s + len))?.map(|b| {
                    b.chunks(2)
                        .flat_map(|c| [c.get(1).copied().unwrap_or(0), c[0]])
                        .collect()
                })
            })
            .unwrap_or_default()
    };
    let mut out = Vec::new();
    let le32 = |v: u32, out: &mut Vec<u8>| out.extend(v.to_le_bytes());
    let le16 = |v: u16, out: &mut Vec<u8>| out.extend(v.to_le_bytes());
    le32(0, &mut out); // EOTSize, set below
    le32(ttf.len() as u32, &mut out);
    le32(0x0002_0001, &mut out);
    le32(0, &mut out); // Flags: not compressed, not obfuscated
    out.extend(ttf.get(os2 + 32..os2 + 42)?); // PANOSE
    out.push(1); // Charset: default
    out.push(u8::from(be16(os2 + 62)? & 1 == 1)); // Italic, from fsSelection
    le32(u32::from(be16(os2 + 4)?), &mut out); // Weight
    le16(be16(os2 + 8)?, &mut out); // fsType
    le16(0x504C, &mut out); // MagicNumber
    for k in 0..4 {
        le32(be32(os2 + 42 + 4 * k)?, &mut out); // ulUnicodeRange1..4
    }
    let version = be16(os2)?;
    for k in 0..2 {
        le32(
            if version >= 1 {
                be32(os2 + 78 + 4 * k)?
            } else {
                0
            },
            &mut out,
        ); // ulCodePageRange1..2
    }
    le32(be32(head + 8)?, &mut out); // CheckSumAdjustment
    for _ in 0..4 {
        le32(0, &mut out); // Reserved1..4
    }
    for id in [1u16, 2, 5, 4] {
        le16(0, &mut out); // Padding
        let s = names(id);
        le16(s.len() as u16, &mut out);
        out.extend(s);
    }
    le16(0, &mut out); // Padding5
    le16(0, &mut out); // RootStringSize
    out.extend(ttf);
    let size = out.len() as u32;
    out[..4].copy_from_slice(&size.to_le_bytes());
    Some(out)
}

/// Whether a face's own embedding bits let a deck carry it for editing: installable (0), or
/// editable (8), and never restricted (2) or bitmap only (0x200).
pub(crate) fn editable(ttf: &[u8]) -> bool {
    let be16 = |at: usize| {
        ttf.get(at..at + 2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]))
    };
    let n = be16(4).map_or(0, usize::from);
    let os2 = (0..n).find_map(|i| {
        let at = 12 + 16 * i;
        (ttf.get(at..at + 4)? == b"OS/2").then(|| ttf.get(at + 8..at + 12))?
    });
    let Some(os2) = os2.map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize) else {
        return false;
    };
    match be16(os2 + 8) {
        Some(fs) => fs & 0x0202 == 0 && matches!(fs & 0x000E, 0 | 0x0008),
        None => false,
    }
}

/// The marks of `frame` whose places in its draw list `keep` takes, in their layers.
fn kept(frame: &Frame, keep: &dyn Fn(usize) -> bool) -> Frame {
    let mut at = 0;
    let mut layers = Vec::with_capacity(frame.layers.len());
    for l in &frame.layers {
        let mut marks = Vec::new();
        for m in l.marks.iter() {
            if keep(at) {
                marks.push(m.clone());
            }
            at += 1;
        }
        layers.push(Layer {
            id: l.id.clone(),
            marks: marks.into_iter().collect::<MarkList>(),
            key: l.key,
        });
    }
    Frame {
        size: frame.size,
        ground: frame.ground,
        layers,
    }
}

/// A frame of one color, straight RGBA.
fn flat(c: [u8; 3], size: [u16; 2]) -> Vec<u8> {
    let n = usize::from(size[0]) * usize::from(size[1]);
    let mut out = Vec::with_capacity(n * 4);
    for _ in 0..n {
        out.extend([c[0], c[1], c[2], 255]);
    }
    out
}

/// The pixels of `end` that differ from `start`, as straight RGBA with every other pixel clear,
/// cropped to the box that holds them: the picture's place and its pixels. `None` when nothing
/// differs.
pub(crate) fn delta(end: &[u8], start: &[u8], size: [u16; 2]) -> Option<([u32; 4], Vec<u8>)> {
    let (w, h) = (usize::from(size[0]), usize::from(size[1]));
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            if end[i..i + 4] != start[i..i + 4] {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
    }
    if x1 <= x0 {
        return None;
    }
    let mut out = Vec::with_capacity((x1 - x0) * (y1 - y0) * 4);
    for y in y0..y1 {
        for x in x0..x1 {
            let i = (y * w + x) * 4;
            if end[i..i + 4] == start[i..i + 4] {
                out.extend([0, 0, 0, 0]);
            } else {
                out.extend([end[i], end[i + 1], end[i + 2], 255]);
            }
        }
    }
    Some((
        [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32],
        out,
    ))
}

fn png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut out),
        rgba,
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| e.to_string())?;
    Ok(out)
}

/// The wrong pptx writers, each only to prove the fidelity check fails on it.
const PLANTS: [Guard; 5] = [
    Guard::PptxTitleAsPicture,
    Guard::PptxDropsPicture,
    Guard::PptxFlattens,
    Guard::PptxChipAsShape,
    Guard::PptxReceiptFewer,
];

/// One stage as written: its number, marker and name, its settled frame, the plan it must hold
/// (bottom first, in u), the slide written, and the doc-to-px scale.
struct Staged {
    number: usize,
    marker: String,
    name: String,
    frame: Vec<u8>,
    honest: Vec<Part>,
    slide: SlideOut,
    scale: [f64; 2],
}

impl Staged {
    /// Each family a text box sets, with its weights and slants.
    fn families(&self) -> BTreeSet<(String, u16, bool)> {
        self.honest
            .iter()
            .filter_map(|p| match p {
                Part::Text(tb) => Some(tb),
                _ => None,
            })
            .flat_map(|tb| tb.paragraphs.iter().flatten())
            .map(|r| (r.family.clone(), r.weight, r.italic))
            .collect()
    }

    /// The items the plan draws natively, and each picture's items with why.
    fn listed(&self) -> (Vec<String>, Vec<Vec<(String, String)>>) {
        let mut native = Vec::new();
        let mut pictures = Vec::new();
        for p in &self.honest {
            match p {
                Part::Text(tb) => native.push(tb.item.clone()),
                Part::Shape(sh) => native.push(sh.item.clone()),
                Part::Picture(pic) => pictures.push(pic.items.clone()),
            }
        }
        (native, pictures)
    }
}

impl Hub<'_> {
    /// The frame of `doc` at `t` drawn from the marks of `painted` that `keep` takes, over the 3D
    /// layers when `under`, with the status marks when `status`, and no caption: as the export
    /// draws a frame, from the cut draw list.
    #[allow(clippy::too_many_arguments)]
    fn cut_frame(
        &mut self,
        sched: &Scheduler<'_>,
        session: &DocSession,
        doc: &Value,
        t: i64,
        painted: &Painted,
        keep: &dyn Fn(usize) -> bool,
        (under, status): (bool, bool),
        size: [u16; 2],
    ) -> Result<Vec<u8>, Value> {
        let unfit = |u: crate::snapshot::Unfit| json!({"code": u.code, "path": u.path});
        let cut = Painted {
            drawing: painted.drawing.as_ref().map(|d| {
                Arc::new(deep_canvas_marks::modules::Drawing {
                    frame: kept(&d.frame, keep),
                    runs: d.runs.clone(),
                    animated: d.animated.clone(),
                    built: 0,
                    damage: Vec::new(),
                    basis: None,
                })
            }),
            boxes: painted
                .boxes
                .iter()
                .filter(|_| under)
                .map(|b| deep_play::drawing::CoreBox {
                    rect: b.rect,
                    color: b.color,
                })
                .collect(),
            status: painted.status.clone().filter(|_| status),
            size: painted.size,
        };
        let caption = self.renderer.caption.take();
        let drawn = if under && deep_canvas_scene3d::scene::has_3d(doc) {
            self.rgba3d(doc, t, &cut, Some(size)).map(|(rgba, _)| rgba)
        } else {
            let sides = crate::film::program_of(sched, session)
                .and_then(|p| crate::film::sides(&p, doc, t, false));
            match sides {
                Some(sides) => self
                    .film_rgba(&cut, Some(size), &sides, doc, (true, Some(t)))
                    .map(|(rgba, _, _)| rgba),
                None => self
                    .printed_frame(doc, t, &cut, Some(size))
                    .map(|(rgba, _, _)| rgba),
            }
        };
        self.renderer.caption = caption;
        drawn.map_err(unfit)
    }

    /// One stage's slide: its settled frame, the plan its draw list makes, and the slide the
    /// writer (or a planted wrong one) writes from it.
    #[allow(clippy::too_many_arguments)]
    fn pptx_stage(
        &mut self,
        sched: &mut Scheduler<'_>,
        session: &mut DocSession,
        doc: &Value,
        stop: &deep_canvas_motion::present::Stop,
        t: i64,
        o: &Options,
        plant: Option<Guard>,
    ) -> Result<Staged, Value> {
        let size = o.slide;
        let at = |v: Value| {
            let mut v = v;
            v["marker"] = json!(stop.marker);
            v
        };
        let (settled, _) = self
            .export_frame(sched, session, doc, t, Some(size), true)
            .map_err(|u| at(json!({"code": u.code, "path": u.path})))?;
        let sched: &Scheduler<'_> = sched;
        let session: &DocSession = session;
        let shown = crate::played::at(doc, t);
        let shown = shown.as_ref();
        let painted =
            drawing_of(sched, session).ok_or_else(|| at(json!({"code": "no_drawing"})))?;
        let painted = self.boiled(shown, t, false, painted);
        let drawing = painted
            .drawing
            .clone()
            .ok_or_else(|| at(json!({"code": "no_drawing"})))?;
        let frame = &drawing.frame;
        let n = frame.layers.iter().map(|l| l.marks.len()).sum::<usize>();
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        // The items that are pictures whatever they draw: a status-bound item, so an edit can't
        // recolor a status without its glyph, and a noise fill, which no native fill holds.
        let mut pictured: BTreeMap<String, String> = BTreeMap::new();
        for (id, item) in shown
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if item.pointer("/params/paint/fill/noise").is_some() {
                pictured.insert(id.clone(), "noise fill".into());
            }
        }
        let bound: Vec<String> = shown
            .get("status_bindings")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(_, b)| {
                let target = b.get("target")?.as_str()?;
                Some(
                    target
                        .strip_prefix("items/")?
                        .split('/')
                        .next()?
                        .to_string(),
                )
            })
            .collect();
        let unbound = pictured.clone();
        for id in &bound {
            pictured.insert(id.clone(), "status".into());
        }
        // What draws beside the marks: a ground that isn't one color, the 3D layers under them,
        // the caption and the status marks over them.
        let mut beside = Beside::default();
        let bare = self.cut_frame(
            sched,
            session,
            shown,
            t,
            &painted,
            &|_| false,
            (false, false),
            size,
        )?;
        if bare != flat(ground, size) {
            beside.under.push(("ground".into(), "drawn look".into()));
        }
        // Each item that draws in 3D: the scene's layers draw under every 2D mark.
        for (id, item) in shown
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if deep_canvas_scene3d::scene::has_3d(&json!({"items": {id.as_str(): item}})) {
                beside.under.push((id.clone(), "3D".into()));
            }
        }
        if self.renderer.caption.is_some() {
            beside.over.push(("captions".into(), "caption".into()));
        }
        let status_over: Vec<(String, String)> = painted
            .status
            .iter()
            .flat_map(|st| {
                st.marks
                    .iter()
                    .map(|m| (m.mark.item.clone(), "status".to_string()))
            })
            .collect();
        // A text item's evaluated box: its position and its box's size at the stage's time.
        let boxes = |id: &str| {
            let read = |field: &str| {
                crate::query::item_value(sched, session, id, field).and_then(|(v, _)| v.as_f64())
            };
            Some([
                read("at/pos/0")?,
                read("at/pos/1")?,
                read("params/box/w")?,
                read("params/box/h")?,
            ])
        };
        let mut honest_beside = beside.clone();
        honest_beside.over.extend(status_over.iter().cloned());
        let honest = plan::plan(frame, &pictured, &boxes, &honest_beside);
        // What the writer writes: the plan, or a planted wrong writer's.
        let mut parts = match plant {
            Some(Guard::PptxChipAsShape) => {
                let mut parts = plan::plan(frame, &unbound, &boxes, &beside);
                for st in painted.status.iter().flat_map(|st| st.marks.iter()) {
                    let m = &st.mark;
                    parts.push(Part::Shape(Shape {
                        item: m.item.clone(),
                        mark: n,
                        geometry: Geometry::Round(m.bounds, m.radius),
                        fill: Some(Paint::Solid(m.color, 1.0)),
                        stroke: None,
                    }));
                }
                parts
            }
            _ => honest.clone(),
        };
        if plant == Some(Guard::PptxTitleAsPicture) {
            if let Some(k) = parts.iter().position(|p| matches!(p, Part::Text(_))) {
                if let Part::Text(tb) = &parts[k] {
                    parts[k] = Part::Picture(plan::Picture {
                        marks: tb.mark..tb.mark + 1,
                        under: false,
                        over: false,
                        items: vec![(tb.item.clone(), "planted".into())],
                    });
                }
            }
        }
        if plant == Some(Guard::PptxFlattens) {
            // Every picture's marks drawn as one, under every native part.
            let pics: Vec<plan::Picture> = parts
                .iter()
                .filter_map(|p| match p {
                    Part::Picture(pic) => Some(pic.clone()),
                    _ => None,
                })
                .collect();
            let mut rest: Vec<Part> = parts
                .into_iter()
                .filter(|p| !matches!(p, Part::Picture(_)))
                .collect();
            if !pics.is_empty() {
                let items = pics.iter().flat_map(|p| p.items.clone()).collect();
                let under = pics.iter().any(|p| p.under);
                let over = pics.iter().any(|p| p.over);
                let ranges: Vec<std::ops::Range<usize>> =
                    pics.iter().map(|p| p.marks.clone()).collect();
                let keep = move |k: usize| ranges.iter().any(|r| r.contains(&k));
                let all = self.cut_frame(
                    sched,
                    session,
                    shown,
                    t,
                    &painted,
                    &keep,
                    (under, over),
                    size,
                )?;
                let (rect, rgba) =
                    delta(&all, &flat(ground, size), size).unwrap_or(([0, 0, 1, 1], vec![0; 4]));
                let png = png(&rgba, rect[2], rect[3])
                    .map_err(|why| json!({"code": "export_unwritable", "why": why}))?;
                rest.insert(
                    0,
                    Part::Picture(plan::Picture {
                        marks: 0..n,
                        under,
                        over,
                        items,
                    }),
                );
                let mut elements = vec![Element::Picture(PictureOut {
                    items: pics.iter().flat_map(|p| p.items.clone()).collect(),
                    rect,
                    png,
                })];
                for p in rest.into_iter().skip(1) {
                    match p {
                        Part::Text(tb) => elements.push(Element::Text(tb)),
                        Part::Shape(sh) => elements.push(Element::Shape(sh)),
                        Part::Picture(_) => {}
                    }
                }
                return self.staged(stop, settled, honest, elements, o, shown, frame, size);
            }
            parts = rest;
        }
        // Each picture: the frame up to its run's end against the frame up to its start.
        let mut cache: BTreeMap<(usize, bool), Vec<u8>> = BTreeMap::new();
        let mut elements = Vec::with_capacity(parts.len());
        for part in parts {
            match part {
                Part::Text(tb) => elements.push(Element::Text(tb)),
                Part::Shape(sh) => elements.push(Element::Shape(sh)),
                Part::Picture(pic) => {
                    let mut image = |k: usize, me: &mut Self| -> Result<Vec<u8>, Value> {
                        if let Some(i) = cache.get(&(k, true)) {
                            return Ok(i.clone());
                        }
                        let i = me.cut_frame(
                            sched,
                            session,
                            shown,
                            t,
                            &painted,
                            &|j| j < k,
                            (true, false),
                            size,
                        )?;
                        cache.insert((k, true), i.clone());
                        Ok(i)
                    };
                    let start = if pic.under {
                        flat(ground, size)
                    } else {
                        image(pic.marks.start, self)?
                    };
                    let end = if pic.over {
                        settled.clone()
                    } else {
                        image(pic.marks.end, self)?
                    };
                    let (rect, rgba) =
                        delta(&end, &start, size).unwrap_or(([0, 0, 1, 1], vec![0; 4]));
                    let png = png(&rgba, rect[2], rect[3])
                        .map_err(|why| json!({"code": "export_unwritable", "why": why}))?;
                    elements.push(Element::Picture(PictureOut {
                        items: pic.items,
                        rect,
                        png,
                    }));
                }
            }
        }
        self.staged(stop, settled, honest, elements, o, shown, frame, size)
    }

    /// A stage's [`Staged`] from its written elements, with its notes: the stage's own, then each
    /// bound value it shows with its source and as-of time.
    #[allow(clippy::too_many_arguments)]
    fn staged(
        &self,
        stop: &deep_canvas_motion::present::Stop,
        settled: Vec<u8>,
        honest: Vec<Part>,
        elements: Vec<Element>,
        o: &Options,
        shown: &Value,
        frame: &Frame,
        size: [u16; 2],
    ) -> Result<Staged, Value> {
        let mut notes = Vec::new();
        if o.notes {
            if !stop.notes.is_empty() {
                notes.push(stop.notes.clone());
            }
            let record = &self.scenario.record;
            notes.extend(bound_notes(shown, frame, &|source| {
                record.get(source)?.as_of
            }));
        }
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        Ok(Staged {
            number: stop.stage.unwrap_or(0),
            marker: stop.marker.clone(),
            name: stop.name.clone(),
            frame: settled,
            honest,
            slide: SlideOut {
                ground: Some(ground),
                elements,
                notes: (!notes.is_empty()).then(|| notes.join("\n")),
            },
            scale: [
                f64::from(size[0]) / frame.size[0].max(1.0),
                f64::from(size[1]) / frame.size[1].max(1.0),
            ],
        })
    }

    /// #732: the `pptx` deck of `doc`: one slide per stage marker, in stage order, each the
    /// stage's settled frame at the slide's size, written by hand, read back by the reader apart
    /// from the writer and drawn by the pinned LibreOffice before it takes its name.
    pub(super) fn export_pptx(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let started = std::time::Instant::now();
        let o = Options::of(&job.pptx)?;
        let path = crate::present::path_of(&crate::present::with_track_only(doc, &[]));
        let stops: Vec<_> = path
            .stops
            .iter()
            .filter(|s| s.stage.is_some())
            .cloned()
            .collect();
        if stops.is_empty() {
            return Err(
                json!({"code": "no_stages", "why": "a pptx deck has a slide per stage marker, and this document has none"}),
            );
        }
        let plant = PLANTS.into_iter().find(|g| self.guard_planted(*g));
        let (p, q) = job
            .frame_rate
            .or_else(|| doc.get("transport").and_then(frame_rate_of))
            .unwrap_or((60, 1));
        let frame = clock::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "frame_rate": [p, q], "why": why}))?;
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let mut staged = Vec::with_capacity(stops.len());
        for s in &stops {
            let k = clock::index(clock::film_time(s.at, 0, frame), frame);
            // #157's test module loses the device at a frame: the export stops there, leaving nothing.
            #[cfg(feature = "test-export-guards")]
            if super::test_guards::loses_device_at(doc, k) {
                return Err(super::stopped(
                    k,
                    "device_lost",
                    &format!("the GPU device was lost at frame {k}, stage {}'s", s.marker),
                ));
            }
            staged.push(self.pptx_stage(&mut sched, &mut session, doc, s, k * frame, &o, plant)?);
        }
        if plant == Some(Guard::PptxDropsPicture) {
            // Every picture that holds a noise fill, left out.
            for st in &mut staged {
                st.slide.elements.retain(|e| !matches!(e, Element::Picture(p) if p.items.iter().any(|(_, w)| w == "noise fill")));
            }
        }
        // Fonts: each face a text box sets, embedded where the look's entry for it and the face's
        // own embedding bits allow and the options do, else named.
        let mut fonts: Vec<FontOut> = Vec::new();
        let mut embedded: BTreeMap<String, bool> = BTreeMap::new();
        for st in &staged {
            for (family, weight, italic) in st.families() {
                let face = deep_text::FACES
                    .iter()
                    .filter(|f| f.family == family.as_str())
                    .min_by_key(|f| f.weight.abs_diff(weight));
                let slot = match (weight >= 600, italic) {
                    (false, false) => "regular",
                    (true, false) => "bold",
                    (false, true) => "italic",
                    (true, true) => "boldItalic",
                };
                let data = face
                    .filter(|f| o.embed && self.font_embeddable(doc, f))
                    .and_then(|f| eot(f.bytes()));
                let is = data.is_some();
                if let Some(data) = data {
                    if !fonts
                        .iter()
                        .any(|f| f.typeface == family && f.style == slot)
                    {
                        fonts.push(FontOut {
                            typeface: family.clone(),
                            style: slot,
                            data,
                        });
                    }
                }
                *embedded.entry(family).or_insert(true) &= is;
            }
        }
        let scale = staged.first().map_or([1.0, 1.0], |s| s.scale);
        let slides: Vec<SlideOut> = staged
            .iter_mut()
            .map(|s| {
                std::mem::replace(
                    &mut s.slide,
                    SlideOut {
                        ground: None,
                        elements: Vec::new(),
                        notes: None,
                    },
                )
            })
            .collect();
        // The receipt: each slide's native items, its pictures' items with why, its fonts.
        let mut rows: Vec<Value> = staged
            .iter()
            .map(|st| {
                let (native, pictures) = st.listed();
                let fonts: Vec<Value> = st
                    .families()
                    .into_iter()
                    .map(|(f, _, _)| f)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .map(|f| json!({"family": f, "embedded": embedded.get(&f).copied().unwrap_or(false)}))
                    .collect();
                json!({"stage": st.marker, "number": st.number, "name": st.name, "native": native,
                       "pictures": pictures.iter().map(|items| json!({"items": items.iter().map(|(i, _)| i.clone()).collect::<Vec<_>>(), "why": why_of(items)})).collect::<Vec<_>>(),
                       "fonts": fonts})
            })
            .collect();
        if plant == Some(Guard::PptxReceiptFewer) {
            // Each slide's entry leaves out the last item of its last picture.
            for row in &mut rows {
                if let Some(items) = row["pictures"]
                    .as_array_mut()
                    .and_then(|p| p.last_mut())
                    .and_then(|p| p["items"].as_array_mut())
                {
                    items.pop();
                }
            }
        }
        let title = doc.get("title").and_then(Value::as_str).unwrap_or("");
        let bytes = package(title, o.slide, &slides, &fonts, scale);
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        std::fs::write(&temp, &bytes).map_err(|_| json!({"code": "export_unwritable"}))?;
        let work = out.with_file_name(format!(
            ".{}.pptx-read-{}",
            out.file_name()
                .map_or(String::new(), |n| n.to_string_lossy().into_owned()),
            std::process::id()
        ));
        let held = self.pptx_fidelity(job, &o, (&temp, &work), &staged, &slides, &rows);
        let _ = std::fs::remove_dir_all(&work);
        let fidelity = held?;
        std::fs::rename(&temp, &out).map_err(|_| json!({"code": "export_unwritable"}))?;
        Ok(
            json!({"target": "pptx", "slide": o.slide, "notes": o.notes, "fonts": if o.embed { "embed_allowed" } else { "name_only" },
                  "slides": rows, "bytes": bytes.len(), "fidelity": fidelity,
                  "timing": {"wall": started.elapsed().as_secs_f64()}}),
        )
    }

    /// Whether the document's look lets `face` be embedded: every font entry of the look that
    /// sets its family allows embedding under a license (a family no entry sets is a fallback
    /// face, under its own license), and the face's own embedding bits allow editing.
    fn font_embeddable(&self, doc: &Value, face: &deep_text::Face) -> bool {
        let def = self
            .look_def_of(doc)
            .or_else(|| deep_canvas_marks::look::shipped("clean"));
        let entries: Vec<&Value> = def
            .as_ref()
            .and_then(|d| d.get("fonts"))
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|fonts| fonts.values())
            .filter(|f| f.get("family").and_then(Value::as_str) == Some(face.family))
            .collect();
        let licensed = if entries.is_empty() {
            !face.license.is_empty()
        } else {
            entries.iter().all(|e| {
                e.get("embed").and_then(Value::as_bool) == Some(true)
                    && e.get("license")
                        .and_then(Value::as_str)
                        .is_some_and(|l| !l.is_empty())
            })
        };
        licensed && editable(face.bytes())
    }

    /// export.fidelity for the deck at `temp`: read back by the reader apart from the writer, each
    /// slide held to its stage's plan and the receipt to the pictures it holds, then drawn by the
    /// pinned LibreOffice and held to its stage's settled frame outside the text boxes, under the
    /// quality's floor. Each failure names the slide, the stage and the item.
    #[allow(clippy::too_many_arguments)]
    fn pptx_fidelity(
        &mut self,
        job: &Job,
        o: &Options,
        (temp, work): (&Path, &Path),
        staged: &[Staged],
        slides: &[SlideOut],
        rows: &[Value],
    ) -> Result<Value, Value> {
        let fail = |issues: Vec<Value>| json!({"outcome": "failed", "code": "export.fidelity", "issues": issues});
        let bytes = std::fs::read(temp).map_err(|_| json!({"code": "export_unwritable"}))?;
        let deck = deep_pptx_reader::read(&bytes)
            .map_err(|why| fail(vec![json!({"code": "export.fidelity", "what": why})]))?;
        let status: BTreeSet<String> = self
            .look
            .status
            .as_ref()
            .into_iter()
            .flat_map(|s| s.colors.values().map(|c| hex(*c)))
            .collect();
        let mut issues = Vec::new();
        if deck.slides.len() != staged.len() {
            issues.push(json!({"code": "export.fidelity", "what": format!("the deck has {} slides for {} stages", deck.slides.len(), staged.len())}));
        }
        for (name, ct) in &deck.parts {
            if ["vbaProject", "oleObject", "activeX", "macroEnabled"]
                .iter()
                .any(|k| ct.contains(k) || name.contains(k))
            {
                issues.push(json!({"code": "export.fidelity", "what": format!("the deck holds {name} ({ct}), which runs")}));
            }
        }
        for (k, (st, read)) in staged.iter().zip(&deck.slides).enumerate() {
            let n = k + 1;
            let mut at = |item: &str, what: String| {
                issues.push(json!({"code": "export.fidelity", "slide": n, "stage": st.marker, "item": item, "what": what}));
            };
            if read.animated {
                at("", format!("slide {n} animates"));
            }
            let pictures_read: Vec<(usize, BTreeSet<String>)> = read
                .shapes
                .iter()
                .enumerate()
                .filter(|(_, s)| s.kind == deep_pptx_reader::Kind::Picture)
                .map(|(i, s)| {
                    (
                        i,
                        s.descr
                            .split(", ")
                            .filter(|x| !x.is_empty())
                            .map(str::to_string)
                            .collect(),
                    )
                })
                .collect();
            let mut under: BTreeSet<String> = BTreeSet::new();
            for part in &st.honest {
                let (item, kind) = match part {
                    Part::Picture(pic) => {
                        let items: BTreeSet<String> =
                            pic.items.iter().map(|(i, _)| i.clone()).collect();
                        if !pictures_read.iter().any(|(_, got)| items.is_subset(got)) {
                            let names: Vec<&str> =
                                pic.items.iter().map(|(i, _)| i.as_str()).collect();
                            at(
                                names.first().copied().unwrap_or(""),
                                format!(
                                    "slide {n} (stage {}) shows no picture of {}",
                                    st.marker,
                                    names.join(", ")
                                ),
                            );
                        }
                        under.extend(items);
                        continue;
                    }
                    Part::Text(tb) => (tb.item.as_str(), deep_pptx_reader::Kind::TextBox),
                    Part::Shape(sh) => (sh.item.as_str(), deep_pptx_reader::Kind::Shape),
                };
                let Some((i, shape)) = read
                    .shapes
                    .iter()
                    .enumerate()
                    .find(|(_, s)| s.name == item && s.kind == kind)
                else {
                    let as_what = if kind == deep_pptx_reader::Kind::TextBox {
                        "text box"
                    } else {
                        "native shape"
                    };
                    at(
                        item,
                        format!(
                            "{item} isn't a {as_what} on slide {n} (stage {})",
                            st.marker
                        ),
                    );
                    continue;
                };
                let got: BTreeSet<String> = pictures_read
                    .iter()
                    .filter(|(j, _)| *j < i)
                    .flat_map(|(_, s)| s.iter().cloned())
                    .collect();
                if let Some(x) = got.difference(&under).next() {
                    at(
                        item,
                        format!(
                            "{item} on slide {n} is drawn over {x}, which the stage draws over it"
                        ),
                    );
                } else if let Some(x) = under.difference(&got).next() {
                    at(item, format!("{item} on slide {n} is drawn under {x}, which the stage draws under it"));
                }
                if let Part::Text(tb) = part {
                    let s = st.scale;
                    let want = [
                        tb.rect[0] * s[0],
                        tb.rect[1] * s[1],
                        tb.rect[2] * s[0],
                        tb.rect[3] * s[1],
                    ]
                    .map(emu);
                    let got = [shape.off[0], shape.off[1], shape.ext[0], shape.ext[1]];
                    if want.iter().zip(&got).any(|(a, b)| (a - b).abs() > 6_350) {
                        at(item, format!("{item}'s text box on slide {n} sits at {got:?} EMU, not its box {want:?}"));
                    }
                    let want_text: String = tb
                        .paragraphs
                        .iter()
                        .map(|p| p.iter().map(|r| r.text.as_str()).collect::<String>())
                        .collect::<Vec<_>>()
                        .join("\n");
                    if shape.text() != want_text {
                        at(
                            item,
                            format!(
                                "{item}'s text box on slide {n} reads {:?}, not {want_text:?}",
                                shape.text()
                            ),
                        );
                    }
                    let runs: Vec<&deep_pptx_reader::Run> = shape
                        .paragraphs
                        .iter()
                        .flat_map(|p| p.runs.iter())
                        .collect();
                    let wanted: Vec<&Run> = tb.paragraphs.iter().flatten().collect();
                    for (w, g) in wanted.iter().zip(&runs) {
                        let (face, bold) = typeface(w);
                        let sz = ((w.size * s[1] * 0.5 * 100.0).round() as u32).clamp(100, 400_000);
                        if g.typeface.as_deref() != Some(face.as_str())
                            || g.size != Some(sz)
                            || g.bold != bold
                            || g.italic != w.italic
                            || g.color.as_deref() != Some(hex(w.color).as_str())
                        {
                            at(
                                item,
                                format!("{item}'s run {:?} on slide {n} reads {:?}", w.text, g),
                            );
                            break;
                        }
                    }
                }
            }
            for s in read
                .shapes
                .iter()
                .filter(|s| s.kind != deep_pptx_reader::Kind::Picture)
            {
                let mut colors: Vec<&str> = Vec::new();
                match &s.fill {
                    deep_pptx_reader::Fill::Solid(c, _) => colors.push(c),
                    deep_pptx_reader::Fill::Gradient(stops, _) => {
                        colors.extend(stops.iter().map(|(_, c, _)| c.as_str()))
                    }
                    _ => {}
                }
                if let Some(deep_pptx_reader::Line {
                    fill: deep_pptx_reader::Fill::Solid(c, _),
                    ..
                }) = &s.line
                {
                    colors.push(c);
                }
                colors.extend(
                    s.paragraphs
                        .iter()
                        .flat_map(|p| p.runs.iter().filter_map(|r| r.color.as_deref())),
                );
                if let Some(c) = colors.into_iter().find(|c| status.contains(*c)) {
                    at(
                        &s.name,
                        format!(
                            "{} on slide {n} is an editable shape in a status color (#{c})",
                            s.name
                        ),
                    );
                }
            }
            if o.notes
                && read.notes.clone().unwrap_or_default()
                    != slides[k].notes.clone().unwrap_or_default()
            {
                at(
                    "",
                    format!("slide {n}'s speaker notes aren't stage {}'s", st.marker),
                );
            }
            // The receipt lists every item each picture holds.
            let listed: BTreeSet<String> = rows
                .get(k)
                .and_then(|r| r["pictures"].as_array())
                .into_iter()
                .flatten()
                .flat_map(|p| p["items"].as_array().into_iter().flatten())
                .filter_map(|i| i.as_str().map(str::to_string))
                .collect();
            let held: BTreeSet<String> = pictures_read
                .iter()
                .flat_map(|(_, s)| s.iter().cloned())
                .collect();
            if let Some(x) = held.difference(&listed).next() {
                at(x, format!("the receipt lists {} items for slide {n}, and its pictures hold {}: it leaves out {x}", listed.len(), held.len()));
            }
        }
        if !issues.is_empty() {
            return Err(fail(issues));
        }
        // The pinned LibreOffice draws each slide; each is held to its settled frame outside the
        // text boxes. Without it the check can't run, and nothing is delivered: BLOCKED.
        let office = deep_pptx_reader::render::find().map_err(|m| {
            json!({"outcome": "blocked", "code": "export.fidelity", "reader": "libreoffice", "pinned": deep_pptx_reader::render::PINNED, "why": m.why()})
        })?;
        let office = &office;
        std::fs::create_dir_all(work).map_err(|_| json!({"code": "export_unwritable"}))?;
        let rendered = deep_pptx_reader::render::render(office, temp, [u32::from(o.slide[0]), u32::from(o.slide[1])], work)
            .map_err(|why| json!({"outcome": "blocked", "code": "export.fidelity", "reader": "libreoffice", "why": why}))?;
        if rendered.len() != staged.len() {
            return Err(fail(vec![
                json!({"code": "export.fidelity", "what": format!("LibreOffice drew {} slides of {}", rendered.len(), staged.len())}),
            ]));
        }
        let floor = deep_canvas_media::export_checks::quality_floor(&job.quality).unwrap_or(40.0);
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let mut rows_read = Vec::new();
        let mut worst = f64::INFINITY;
        for (k, (st, png)) in staged.iter().zip(&rendered).enumerate() {
            let n = k + 1;
            let img = image::load_from_memory(png)
                .map_err(|e| fail(vec![json!({"code": "export.fidelity", "slide": n, "stage": st.marker, "what": format!("slide {n}'s render doesn't decode: {e}")})]))?
                .to_rgba8();
            if img.dimensions() != (u32::from(o.slide[0]), u32::from(o.slide[1])) {
                issues.push(json!({"code": "export.fidelity", "slide": n, "stage": st.marker, "what": format!("LibreOffice drew slide {n} at {:?}", img.dimensions())}));
                continue;
            }
            let s = st.scale;
            let skip: Vec<[f64; 4]> = st
                .honest
                .iter()
                .filter_map(|p| match p {
                    Part::Text(tb) => Some([
                        tb.rect[0] * s[0],
                        tb.rect[1] * s[1],
                        tb.rect[2] * s[0],
                        tb.rect[3] * s[1],
                    ]),
                    _ => None,
                })
                .collect();
            let (p, ssim, compared) =
                super::lottie::compare(&st.frame, img.as_raw(), o.slide, ground, &skip);
            worst = worst.min(p);
            rows_read.push(json!({"slide": n, "stage": st.marker, "psnr_y": if p.is_finite() { json!(p) } else { Value::Null }, "ssim": ssim, "pixels": compared}));
            let meets = p >= floor || (floor <= 40.0 && ssim >= 0.98);
            if !meets && issues.is_empty() {
                issues.push(json!({"code": "export.fidelity", "slide": n, "stage": st.marker,
                    "what": format!("slide {n} (stage {}), drawn by LibreOffice, reads {p:.2} dB luma PSNR and SSIM {ssim:.4} against the stage's settled frame outside its text boxes, under the {floor} dB floor (or SSIM 0.98)", st.marker)}));
            }
        }
        if !issues.is_empty() {
            return Err(fail(issues));
        }
        Ok(
            json!({"check": "export.fidelity", "reader": {"ooxml": "deep-pptx-reader (roxmltree 0.21.1, zune-inflate 0.2.54)", "render": office.version},
                  "slides": rows_read, "floor": {"psnr_y": floor}, "psnr_y": if worst.is_finite() { json!(worst) } else { Value::Null }}),
        )
    }
}

/// A picture's why: each reason its items carry, in the order first met.
fn why_of(items: &[(String, String)]) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for (_, w) in items {
        if !seen.contains(&w.as_str()) {
            seen.push(w);
        }
    }
    seen.join(", ")
}

/// A time in ms since the epoch as UTC, `YYYY-MM-DDTHH:MM:SSZ`.
fn utc(ms: i64) -> String {
    let s = ms.div_euclid(1000);
    let (y, m, d) = deep_canvas_marks::ticks::civil(s.div_euclid(86_400));
    let t = s.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        t / 3600,
        t / 60 % 60,
        t % 60
    )
}

/// Each bound value the frame shows: its text, its source and its as-of time (the record's), a
/// line each, for the slide's notes.
fn bound_notes(doc: &Value, frame: &Frame, as_of: &dyn Fn(&str) -> Option<i64>) -> Vec<String> {
    let mut out = Vec::new();
    for b in doc
        .get("bound_values")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
    {
        let (Some(target), Some(source)) = (
            b.get("target").and_then(Value::as_str),
            b.get("source").and_then(Value::as_str),
        ) else {
            continue;
        };
        let Some(id) = target
            .strip_prefix("items/")
            .and_then(|t| t.split('/').next())
        else {
            continue;
        };
        let text = frame
            .layers
            .iter()
            .flat_map(|l| l.marks.iter())
            .find_map(|d| match &d.mark {
                deep_canvas_marks::scene::Mark::Text { item, spec, .. }
                    if item == id && !plan::unseen(d) =>
                {
                    Some(spec.text.clone())
                }
                _ => None,
            });
        let Some(text) = text else {
            continue;
        };
        let when = as_of(source).map_or_else(|| "an unknown time".to_string(), utc);
        out.push(format!("{text}: {source}, as of {when}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str, weight: u16) -> Run {
        Run {
            text: text.into(),
            family: "Inter".into(),
            size: 48.0,
            weight,
            italic: false,
            role: Some("ink".into()),
            color: [17, 34, 51],
            alpha: 1.0,
            underline: false,
            strike: false,
            baseline: 0.0,
        }
    }

    #[test]
    fn the_reader_apart_from_the_writer_reads_each_slide_as_written() {
        let face = deep_text::FACES
            .iter()
            .find(|f| f.file == "Inter-Regular.ttf")
            .expect("Inter");
        let slide = SlideOut {
            ground: Some([250, 250, 250]),
            elements: vec![
                Element::Picture(PictureOut {
                    items: vec![("inset".into(), "3D".into())],
                    rect: [10, 20, 2, 1],
                    png: png(&[1, 2, 3, 255, 4, 5, 6, 255], 2, 1).expect("png"),
                }),
                Element::Text(TextBox {
                    item: "title".into(),
                    mark: 1,
                    rect: [100.0, 50.0, 800.0, 64.0],
                    paragraphs: vec![vec![run("Quarterly ", 400), run("<results> & more", 600)]],
                    align: Align::Start,
                    wrap: true,
                }),
                Element::Shape(Shape {
                    item: "card".into(),
                    mark: 2,
                    geometry: Geometry::Round([40.0, 300.0, 400.0, 200.0], 16.0),
                    fill: Some(Paint::Linear {
                        stops: vec![(0.0, [255, 0, 0], 1.0), (1.0, [0, 0, 255], 0.5)],
                        angle: 90.0,
                    }),
                    stroke: Some(plan::Stroke {
                        width: 2.0,
                        color: [0, 0, 0],
                        alpha: 1.0,
                    }),
                }),
            ],
            notes: Some("Say why it holds\nsource: verdict, as of 12:00".into()),
        };
        let fonts = vec![FontOut {
            typeface: "Inter".into(),
            style: "regular",
            data: eot(face.bytes()).expect("Inter is TrueType"),
        }];
        let bytes = package(
            "Deck",
            [1920, 1080],
            std::slice::from_ref(&slide),
            &fonts,
            [1.0, 1.0],
        );
        assert_eq!(
            package("Deck", [1920, 1080], &[slide], &fonts, [1.0, 1.0]),
            bytes,
            "the same slides give the same bytes"
        );
        let deck = deep_pptx_reader::read(&bytes).expect("the reader reads the deck");
        assert_eq!(deck.size, [12_192_000, 6_858_000]);
        assert_eq!(deck.slides.len(), 1);
        let s = &deck.slides[0];
        let kinds: Vec<_> = s
            .shapes
            .iter()
            .map(|x| (x.kind.clone(), x.name.clone()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (deep_pptx_reader::Kind::Picture, "Picture 1".to_string()),
                (deep_pptx_reader::Kind::TextBox, "title".to_string()),
                (deep_pptx_reader::Kind::Shape, "card".to_string()),
            ]
        );
        assert_eq!(s.shapes[0].descr, "inset");
        assert_eq!(
            s.shapes[0].image.as_deref().map(<[u8]>::len),
            Some(png(&[1, 2, 3, 255, 4, 5, 6, 255], 2, 1).unwrap().len())
        );
        let title = &s.shapes[1];
        assert_eq!(title.text(), "Quarterly <results> & more");
        assert_eq!(title.off, [635_000, 317_500]);
        assert_eq!(title.paragraphs[0].runs[1].size, Some(2400));
        assert!(title.paragraphs[0].runs[1].bold && !title.paragraphs[0].runs[0].bold);
        assert_eq!(title.paragraphs[0].runs[0].color.as_deref(), Some("112233"));
        assert_eq!(
            title.paragraphs[0].runs[0].typeface.as_deref(),
            Some("Inter")
        );
        assert_eq!(s.shapes[2].geometry.as_deref(), Some("roundRect"));
        assert!(
            matches!(&s.shapes[2].fill, deep_pptx_reader::Fill::Gradient(stops, Some(5_400_000)) if stops.len() == 2)
        );
        assert_eq!(
            s.notes.as_deref(),
            Some("Say why it holds\nsource: verdict, as of 12:00")
        );
        assert_eq!(s.background.as_deref(), Some("FAFAFA"));
        assert!(!s.animated);
        assert_eq!(deck.fonts.len(), 1);
        assert_eq!(deck.fonts[0].typeface, "Inter");
        let data = &deck.fonts[0].styles[0].2;
        assert_eq!(
            u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize,
            data.len()
        );
        assert!(
            data.ends_with(face.bytes()),
            "the embedded font carries the face whole"
        );
        assert!(deck
            .parts
            .values()
            .all(|ct| !ct.contains("vbaProject") && !ct.contains("macroEnabled")));
    }
}
