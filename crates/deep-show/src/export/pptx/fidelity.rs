//! Issue #732: export.fidelity, the deck read back apart from its writer and drawn by LibreOffice.

use super::*;

impl Hub<'_> {
    /// export.fidelity for the deck at `temp`: read back by the reader apart from the writer, each
    /// slide held to its stage's plan and the receipt to the pictures it holds, then drawn by the
    /// pinned LibreOffice and held to its stage's settled frame outside the text boxes, under the
    /// quality's floor. Each failure names the slide, the stage and the item.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn pptx_fidelity(
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
