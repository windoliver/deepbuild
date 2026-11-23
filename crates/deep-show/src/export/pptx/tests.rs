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
