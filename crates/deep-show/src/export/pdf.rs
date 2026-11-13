//! #507 (Export: `pdf {notes}`): the handout, one page per stage's settled still, with the
//! stage's notes under it only when asked, and the reader its fidelity check reads it back with.
//! The writer stores each still losslessly as a Flate image with PNG row predictors; the same
//! stills give the same bytes, since nothing in the file is a time, a path or an ID. The reader is
//! separate code: it parses the file's objects itself, walks the page tree in order and decodes
//! each page's image through a PNG decoder, so a page the writer drops or alters shows.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas::time as clock;
use serde_json::{json, Value};

use super::{temp_of, Guard, Job};
use crate::hub::Hub;

/// One page: a still's RGB rows top-down, its size, and the notes printed under it.
pub(crate) struct Page {
    pub rgb: Vec<u8>,
    pub size: [u32; 2],
    pub notes: Option<String>,
}

/// One page as the reader found it: its image's RGB rows and size, and the text it shows.
pub(crate) struct ReadPage {
    pub rgb: Vec<u8>,
    pub size: [u32; 2],
    pub text: String,
}

/// The notes' type size and leading, in points, and the most characters on one line.
const TEXT: f64 = 11.0;
const LEADING: f64 = 14.0;
const MARGIN: f64 = 24.0;

/// `rgb` as the zlib stream of a PNG's IDAT chunks: rows with PNG filters, as PDF's Flate
/// filter with predictor 15 reads them.
fn idat(rgb: &[u8], [w, h]: [u32; 2]) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut png),
        rgb,
        w,
        h,
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut at = 8;
    while at + 8 <= png.len() {
        let len = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
        if &png[at + 4..at + 8] == b"IDAT" {
            out.extend_from_slice(&png[at + 8..at + 8 + len]);
        }
        at += 12 + len;
    }
    Ok(out)
}

/// A PDF string: Latin-1 with its delimiters escaped, other characters as `?`.
fn string(text: &str) -> String {
    let mut out = String::from("(");
    for c in text.chars() {
        match c {
            '(' | ')' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            ' '..='~' => out.push(c),
            _ => out.push('?'),
        }
    }
    out.push(')');
    out
}

/// `notes` broken into lines of at most `width` characters at spaces.
fn lines(notes: &str, width: usize) -> Vec<String> {
    let mut out = Vec::new();
    for para in notes.lines() {
        let mut line = String::new();
        for word in para.split(' ') {
            if !line.is_empty() && line.chars().count() + 1 + word.chars().count() > width {
                out.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        out.push(line);
    }
    out
}

/// The handout: one page per still, each the still's size in points with a band for its notes.
#[cfg(test)]
pub(crate) fn write(pages: &[Page]) -> Result<Vec<u8>, String> {
    write_pages(&pages.iter().collect::<Vec<_>>())
}

fn write_pages(pages: &[&Page]) -> Result<Vec<u8>, String> {
    // Objects: 1 catalog, 2 pages, then per page its page, content and image.
    let mut objects: Vec<Vec<u8>> = Vec::new();
    let kids: Vec<String> = (0..pages.len())
        .map(|i| format!("{} 0 R", 4 + 3 * i))
        .collect();
    objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    objects.push(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            pages.len()
        )
        .into_bytes(),
    );
    objects.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    for (i, page) in pages.iter().enumerate() {
        let [w, h] = page.size;
        let (wf, hf) = (f64::from(w), f64::from(h));
        let text = page
            .notes
            .as_deref()
            .map(|n| lines(n, ((wf - 2.0 * MARGIN) / (TEXT * 0.5)).max(16.0) as usize))
            .unwrap_or_default();
        let band = if text.is_empty() {
            0.0
        } else {
            2.0 * MARGIN + LEADING * text.len() as f64
        };
        let mut content = format!("q {wf} 0 0 {hf} 0 {band} cm /Im0 Do Q\n");
        if !text.is_empty() {
            content.push_str(&format!(
                "BT /F1 {TEXT} Tf {LEADING} TL {MARGIN} {} Td\n",
                band - MARGIN - TEXT
            ));
            for line in &text {
                content.push_str(&format!("{} Tj T*\n", string(line)));
            }
            content.push_str("ET\n");
        }
        let (n, content_id, image_id) = (4 + 3 * i, 5 + 3 * i, 6 + 3 * i);
        debug_assert_eq!(n, objects.len() + 1);
        objects.push(
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {wf} {}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 {image_id} 0 R >> >> /Contents {content_id} 0 R >>", hf + band)
                .into_bytes(),
        );
        let mut c = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
        c.extend_from_slice(content.as_bytes());
        c.extend_from_slice(b"\nendstream");
        objects.push(c);
        let data = idat(&page.rgb, page.size)?;
        let mut im = format!(
            "<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns {w} >> /Length {} >>\nstream\n",
            data.len()
        )
        .into_bytes();
        im.extend_from_slice(&data);
        im.extend_from_slice(b"\nendstream");
        objects.push(im);
    }
    let mut out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (i, o) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for o in offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    Ok(out)
}

/// The reader's view of one indirect object: its dictionary's text and its stream's bytes.
struct Object<'a> {
    dict: String,
    stream: Option<&'a [u8]>,
}

/// Every `n 0 obj … endobj` in `bytes`, by number, found by scanning rather than through the
/// writer's cross-reference table.
fn objects(bytes: &[u8]) -> BTreeMap<u32, Object<'_>> {
    let find = |from: usize, needle: &[u8]| {
        bytes[from..]
            .windows(needle.len())
            .position(|w| w == needle)
            .map(|p| p + from)
    };
    let mut out = BTreeMap::new();
    let mut at = 0;
    while let Some(obj) = find(at, b" 0 obj") {
        let start = bytes[..obj]
            .iter()
            .rposition(|b| !b.is_ascii_digit())
            .map_or(0, |p| p + 1);
        let n: Option<u32> = std::str::from_utf8(&bytes[start..obj])
            .ok()
            .and_then(|s| s.parse().ok());
        let body = obj + 6;
        let Some(end) = find(body, b"endobj") else {
            break;
        };
        let (dict, stream) = match find(body, b"stream\n").filter(|&s| s < end) {
            Some(s) => {
                let dict = String::from_utf8_lossy(&bytes[body..s]).into_owned();
                let len = number_after(&dict, "/Length").unwrap_or(0) as usize;
                let from = s + 7;
                (dict, bytes.get(from..from + len))
            }
            None => (
                String::from_utf8_lossy(&bytes[body..end]).into_owned(),
                None,
            ),
        };
        if let Some(n) = n {
            out.insert(n, Object { dict, stream });
        }
        at = end + 6;
    }
    out
}

/// The number after `key` in a dictionary's text.
fn number_after(dict: &str, key: &str) -> Option<u64> {
    let rest = &dict[dict.find(key)? + key.len()..];
    let digits: String = rest
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// The object number `key` refers to (`/Key n 0 R`).
fn reference(dict: &str, key: &str) -> Option<u32> {
    number_after(dict, key).and_then(|n| u32::try_from(n).ok())
}

/// The strings a content stream shows with `Tj`, one per line.
fn shown_text(content: &[u8]) -> String {
    let text = String::from_utf8_lossy(content);
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '(' {
            continue;
        }
        let mut s = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => s.extend(chars.next()),
                ')' => break,
                c => s.push(c),
            }
        }
        out.push(s);
    }
    out.join("\n")
}

/// Each page of a handout in page order: its image decoded and the text it shows.
pub(crate) fn read(bytes: &[u8]) -> Result<Vec<ReadPage>, String> {
    let objects = objects(bytes);
    let root = bytes
        .windows(5)
        .rposition(|w| w == b"/Root")
        .and_then(|p| reference(&String::from_utf8_lossy(&bytes[p..]), "/Root"))
        .ok_or("no /Root")?;
    let pages = objects
        .get(&root)
        .and_then(|c| reference(&c.dict, "/Pages"))
        .ok_or("no /Pages")?;
    let tree = objects.get(&pages).ok_or("no page tree")?;
    let kids = tree
        .dict
        .split("/Kids")
        .nth(1)
        .and_then(|k| k.split(']').next())
        .ok_or("no /Kids")?;
    let nums: Vec<u32> = kids
        .trim_start()
        .trim_start_matches('[')
        .split(" R")
        .filter_map(|r| r.split_whitespace().next()?.parse().ok())
        .collect();
    let mut out = Vec::new();
    for (i, n) in nums.into_iter().enumerate() {
        let page = objects
            .get(&n)
            .ok_or_else(|| format!("page {} is missing", i + 1))?;
        let image = reference(&page.dict, "/Im0")
            .and_then(|r| objects.get(&r))
            .ok_or_else(|| format!("page {} has no image", i + 1))?;
        let (w, h) = (
            number_after(&image.dict, "/Width"),
            number_after(&image.dict, "/Height"),
        );
        let (Some(w), Some(h), Some(data)) = (w, h, image.stream) else {
            return Err(format!("page {}'s image has no size or data", i + 1));
        };
        let (w, h) = (w as u32, h as u32);
        // The image's Flate data with PNG predictors is a PNG's IDAT: wrapped as one, decoded.
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        for (kind, body) in [(&b"IHDR"[..], &ihdr[..]), (b"IDAT", data), (b"IEND", &[])] {
            png.extend_from_slice(&(body.len() as u32).to_be_bytes());
            let mut crc_in = kind.to_vec();
            crc_in.extend_from_slice(body);
            png.extend_from_slice(&crc_in);
            png.extend_from_slice(&crc32(&crc_in).to_be_bytes());
        }
        let decoded = image::load(Cursor::new(png), image::ImageFormat::Png)
            .map_err(|e| format!("page {}'s image doesn't decode: {e}", i + 1))?;
        let text = reference(&page.dict, "/Contents")
            .and_then(|r| objects.get(&r)?.stream)
            .map(shown_text)
            .unwrap_or_default();
        out.push(ReadPage {
            rgb: decoded.to_rgb8().into_raw(),
            size: [w, h],
            text,
        });
    }
    Ok(out)
}

/// CRC-32 (ISO 3309), as a PNG chunk carries it.
fn crc32(bytes: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in bytes {
        c ^= u32::from(b);
        for _ in 0..8 {
            c = if c & 1 == 1 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
    }
    !c
}

impl Hub<'_> {
    /// #507: the `pdf` handout of `doc`: one page per stage marker, in time order, its image the
    /// stage's settled still (the frame `still {marker}` exports), its notes under it only with
    /// `pdf {notes: true}`. Written under a temporary name, read back by [`read`], each page held
    /// to its stage's still and notes, and renamed only when every page holds: a page missing,
    /// changed or out of place fails the export, naming its stage.
    pub(super) fn export_pdf(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let path = crate::present::path_of(&crate::present::with_track_only(doc, &[]));
        let stages: Vec<_> = path
            .stops
            .iter()
            .filter(|s| s.stage.is_some())
            .cloned()
            .collect();
        if stages.is_empty() {
            return Err(
                json!({"code": "no_stages", "why": "a pdf handout has a page per stage marker, and this document has none"}),
            );
        }
        let (p, q) = job
            .frame_rate
            .or_else(|| doc.get("transport").and_then(frame_rate_of))
            .unwrap_or((60, 1));
        let frame = clock::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "frame_rate": [p, q], "why": why}))?;
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let mut pages = Vec::with_capacity(stages.len());
        for s in &stages {
            let t = clock::index(clock::film_time(s.at, 0, frame), frame) * frame;
            let (rgba, size) = self
                .export_frame(&mut sched, &mut session, doc, t, job.size, true)
                .map_err(|u| json!({"code": u.code, "path": u.path, "marker": s.marker}))?;
            let rgb = rgba
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|px| [px[0], px[1], px[2]])
                .collect();
            let notes = Some(s.notes.clone()).filter(|n| job.notes && !n.is_empty());
            pages.push(Page {
                rgb,
                size: [u32::from(size[0]), u32::from(size[1])],
                notes,
            });
        }
        let written: Vec<&Page> = pages
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                !(*i == 3
                    && self.scenario.planted
                        == Some(crate::hub::Planted::Export(Guard::PdfSkipsStage4)))
            })
            .map(|(_, p)| p)
            .collect();
        let bytes = write_pages(&written)
            .map_err(|why| json!({"code": "export_unwritable", "why": why}))?;
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        std::fs::write(&temp, &bytes).map_err(|_| json!({"code": "export_unwritable"}))?;
        // The fidelity check reads the file back, never the writer's pages.
        let read = std::fs::read(&temp)
            .map_err(|e| e.to_string())
            .and_then(|b| read(&b));
        let read = read.map_err(|why| json!({"outcome": "failed", "code": "export.fidelity", "issues": [{"code": "export.fidelity", "what": why}]}))?;
        let mut issues = Vec::new();
        for (i, (s, page)) in stages.iter().zip(&pages).enumerate() {
            let n = s.stage.unwrap_or(i + 1);
            let what = match read.get(i) {
                None => Some(format!(
                    "the handout has no page for stage {n} (`{}`)",
                    s.marker
                )),
                Some(r) if r.size != page.size || r.rgb != page.rgb => Some(format!(
                    "page {} isn't stage {n}'s still (`{}`)",
                    i + 1,
                    s.marker
                )),
                Some(r)
                    if job.notes
                        && !s.notes.is_empty()
                        && !r.text.replace('\n', " ").contains(&s.notes) =>
                {
                    Some(format!("page {} lacks stage {n}'s notes", i + 1))
                }
                Some(r) if !job.notes && !r.text.is_empty() => {
                    Some(format!("page {} prints text, with notes off", i + 1))
                }
                Some(_) => None,
            };
            if let Some(what) = what {
                issues.push(json!({"code": "export.fidelity", "stage": n, "marker": s.marker, "what": what}));
            }
        }
        if read.len() != stages.len() {
            issues.push(json!({"code": "export.fidelity", "what": format!("the handout has {} pages for {} stages", read.len(), stages.len())}));
        }
        if !issues.is_empty() {
            return Err(json!({"outcome": "failed", "code": "export.fidelity", "issues": issues}));
        }
        std::fs::rename(&temp, &out).map_err(|_| json!({"code": "export_unwritable"}))?;
        let listed: Vec<Value> = stages
            .iter()
            .map(|s| json!({"marker": s.marker, "stage": s.stage, "name": s.name}))
            .collect();
        Ok(
            json!({"target": "pdf", "pages": stages.len(), "stages": listed, "notes": job.notes, "bytes": bytes.len(),
            "fidelity": {"check": "export.fidelity", "reader": "pdf.read", "pages": read.len(), "held": true}}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(seed: u8, notes: Option<&str>) -> Page {
        let size = [5, 3];
        let rgb = (0..45u8).map(|i| i.wrapping_mul(seed)).collect();
        Page {
            rgb,
            size,
            notes: notes.map(str::to_string),
        }
    }

    #[test]
    fn each_page_reads_back_as_written_with_its_notes() {
        let pages = [page(3, Some("Say (why) it holds")), page(7, None)];
        let bytes = write(&pages).expect("written");
        assert_eq!(
            write(&pages).expect("again"),
            bytes,
            "the same stills give the same bytes"
        );
        let read = read(&bytes).expect("read");
        assert_eq!(read.len(), 2);
        for (r, p) in read.iter().zip(&pages) {
            assert_eq!(r.rgb, p.rgb);
            assert_eq!(r.size, p.size);
        }
        assert_eq!(
            read[0].text.replace('\n', " "),
            "Say (why) it holds",
            "notes wrap at the page's width"
        );
        assert_eq!(read[1].text, "");
    }
}
