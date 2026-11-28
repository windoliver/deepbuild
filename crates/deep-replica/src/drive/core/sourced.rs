use deep_canvas_marks::scene::{Frame, Mark};
use deep_canvas_marks::select::TextBox;
use deep_canvas_marks::sources;
use serde_json::{Map, Value};

pub type Placed = (String, [f64; 4]);

pub fn rows(document: &Map<String, Value>, id: &str, texts: &[TextBox]) -> Vec<Placed> {
    let item = &document["items"][id];
    let drawn = texts.iter().find(|text| text.item == id);
    let (true, Some(drawn)) = (item["kind"] == sources::KIND, drawn) else {
        return Vec::new();
    };
    let listed = sources::listing(document, item);
    let rows = listed.iter().enumerate().filter(|(_, line)| !line.heading);
    rows.filter_map(|(at, line)| {
        let [top, height] = *drawn.lines.get(at)?;
        let across = drawn.places.iter().filter(|place| place.line == at);
        let (left, right) = across.fold((f64::INFINITY, f64::NEG_INFINITY), |(l, r), place| {
            (l.min(place.x[0]), r.max(place.x[1]))
        });
        (left < right).then(|| (line.text.clone(), [left, top, right - left, height]))
    })
    .collect()
}

pub fn source_lines(
    document: &Map<String, Value>,
    frame: &Frame,
    shaper: &mut deep_text::Shaper,
) -> Vec<(String, Placed)> {
    let lines = sources::hover_lines(document);
    let marks = frame.layers.iter().flat_map(|layer| &layer.marks);
    marks
        .filter_map(|drawn| {
            let Mark::Text {
                item, spec, origin, ..
            } = &drawn.mark
            else {
                return None;
            };
            let (_, line) = lines.iter().find(|(mark, _)| mark == item)?;
            let shaped = shaper.shape(&spec.shaper_spec()?);
            let rect = TextBox::new(item, &spec.text, *origin, &shaped, spec.width).rect;
            let of = item.split('#').next().unwrap_or_default().to_string();
            Some((of, (line.clone(), rect)))
        })
        .collect()
}
