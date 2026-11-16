use super::*;
use crate::analysis::loudness::measure;

/// #157: the true peak (8×) of 2 s of a 997 Hz stereo tone at 0 dBFS through a bare master,
/// with the export's ceiling set or not.
fn master_true_peak(ceiling: Option<f64>) -> f64 {
    let rate = 48_000;
    let n = 2 * rate as usize;
    let samples: Vec<f32> = (0..n)
        .flat_map(|i| {
            let v = ops::sin(ops::TAU * 997.0 * i as f64 / rate as f64) as f32;
            [v, v]
        })
        .collect();
    let source = Arc::new(Source {
        rate,
        channels: 2,
        samples,
        loop_region: None,
    });
    let span = source.duration();
    let strip = Strip {
        id: "tone".into(),
        source,
        start: 0,
        r#in: 0,
        out: span,
        rate: (1, 1),
        gain: Gain::Db(0.0),
        pan: 0.0,
        fade_in: None,
        fade_out: None,
        looped: false,
        span,
        bus: 0,
        disabled: Vec::new(),
        emitter: None,
        synth: None,
    };
    let master = Bus {
        id: "master".into(),
        gain_db: 0.0,
        pan: 0.0,
        mute: false,
        processors: Vec::new(),
        out: None,
        sends: Vec::new(),
        duck: None,
    };
    let mut player = Player::new(
        Arc::new(Mix::new(rate, vec![strip], vec![master]).unwrap()),
        Planted::default(),
    );
    if let Some(c) = ceiling {
        player.set_ceiling(c);
    }
    player.seek(0);
    let mut out = vec![0f32; 2 * n];
    player.read(&mut out);
    measure(&out, &[1.0, 1.0], rate, 8).true_peak
}

#[test]
fn an_exports_ceiling_holds_the_masters_true_peak_under_it() {
    let set = master_true_peak(Some(-1.67));
    assert!(
        set <= -1.67 + 0.05,
        "with the export's ceiling of −1.67 dBTP the master reads {set} dBTP"
    );
    let default = master_true_peak(None);
    assert!(
        default <= -1.0 + 0.05 && default > -1.67 + 0.05,
        "without it the master reads {default} dBTP"
    );
}
