use super::*;

/// `envelope_opens`, the fresh process's half of the first frame wait: the scene checked and
/// opened, closed, then checked and opened again, each timed from the start of its check to its
/// first presented frame.
pub fn opens(app: &mut App, call: &Value) -> Value {
    let (Some(writer), Some(doc), Some(size)) = (
        call["writer"].as_str().map(str::to_string),
        call["doc"].as_str().map(PathBuf::from),
        pair(&call["pixels"]),
    ) else {
        return bad("envelope_opens is {look, writer, doc, pixels}");
    };
    let look = match Look3::read(&call["look"]) {
        Ok(l) => l,
        Err(e) => return bad(&format!("look: {e}")),
    };
    let looks = match crate::regions::looks_of(call, None) {
        Ok(l) => l,
        Err(e) => return e,
    };
    let delay = match test_only(call, "stub_pipeline_delay_ms") {
        Ok(d) => d.and_then(Value::as_u64),
        Err(e) => return e,
    };
    let planted = app.planted;
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let plants = Plants::of(planted);
        let mut labels = Labels::new();
        if let Some(ms) = delay {
            device.device.delay_next_pipeline(ms);
        }
        let mut opens = Vec::new();
        for open in ["fresh", "same_process"] {
            let mut start = (Instant::now(), device.device.counts().read());
            let result = (|| {
                let (_, a) = checked(
                    &doc,
                    &look,
                    &writer,
                    Some(size),
                    &mut labels,
                    &plants,
                    planted,
                )?;
                let mut kit = Kit::new(&device);
                let mut view = opened(
                    &device,
                    &mut kit,
                    &look,
                    &looks,
                    a,
                    &mut labels,
                    &plants,
                    planted,
                )?;
                // The planted meter starts its clock once the check's warm-up is done.
                if planted == Some(Planted::WaitClockAfterWarmup) {
                    start = (Instant::now(), device.device.counts().read());
                }
                let mut timer = Timer::new(&device);
                draw(&device, &kit, &look, &mut view, 0, &mut labels, &mut timer)
            })();
            if let Err(e) = result {
                return e;
            }
            let made: Reading = device.device.counts().read().since(start.1);
            opens.push(
                json!({"open": open, "ms": start.0.elapsed().as_secs_f64() * 1e3,
                              "pipelines": made.pipelines}),
            );
        }
        json!({"opens": opens})
    })
}
