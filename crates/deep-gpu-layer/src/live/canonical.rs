use super::*;

/// The `canonical` call: the same render a `canonical` event makes, in a process with no live
/// session.
pub fn canonical(app: &mut App, out: &str, call: &Value) -> Value {
    let bad = |what: &str| refused("bad_input", what);
    let (Some(writer), Some(doc), Some(size), Some(frame), Some(purpose)) = (
        call["writer"].as_str().map(str::to_string),
        call["doc"].as_str().map(PathBuf::from),
        pair(&call["size"]),
        call["frame"].as_u64(),
        call["purpose"].as_str().and_then(Purpose::parse),
    ) else {
        return bad("canonical is {look, writer, doc, size, frame, purpose}");
    };
    let look = match Look3::read(&call["look"]) {
        Ok(l) => l,
        Err(e) => return bad(&format!("look: {e}")),
    };
    let looks = match crate::regions::looks_of(call, None) {
        Ok(l) => l,
        Err(e) => return e,
    };
    let fps = call["fps"].as_u64().unwrap_or(60).max(1) as i64;
    let plants = Plants::of(app.planted);
    let wants = |name: &str| {
        call["targets"]
            .as_array()
            .is_some_and(|t| t.iter().any(|t| t == name))
    };
    let (final_, linear) = (wants("final"), wants("linear"));
    let out = (final_ || linear).then(|| out.to_string());
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let mut labels = Labels::new();
        let admitted = read_payload(&doc).and_then(|payload| {
            admit(
                payload,
                &writer,
                "01jb3790000000000000000000",
                Some(size),
                &look,
                0,
                Path::Copy,
                &mut labels,
                None,
                None,
                None,
            )
        });
        let doc = match admitted {
            Ok(a) => a.doc,
            Err(issues) => return json!({"code": "refused", "issues": issues}),
        };
        let kit = Kit::new(&device);
        let t = (frame as i64 - 1) * FLICKS_PER_SECOND / fps;
        let mut c = render_canonical(
            &device,
            &kit,
            &look,
            &looks,
            &doc,
            size,
            t,
            purpose,
            None,
            None,
            &BTreeMap::new(),
            &mut labels,
            &plants,
            &[],
            out.as_deref().map(|o| (o, final_, linear)),
        );
        if let Some(o) = c.as_object_mut() {
            o.insert("frame".into(), json!(frame));
        }
        c
    })
}
