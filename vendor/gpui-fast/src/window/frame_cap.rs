//! DeepBuild patch (windoliver/deepbuild#3441): a window's rate cap is a whole number of its
//! display's refreshes. Upstream holds a tick while less than a fixed time has passed since the
//! last one it let through: 16,667 µs under thermal pressure and 33,333 µs for an inactive
//! window, each a third of a microsecond past a whole number of 60 Hz refreshes, so a 60 Hz
//! display under the 60 Hz cap drew every second tick. Here a cap of r Hz on a display of d Hz
//! lets through every ⌈d ÷ r⌉th tick, counted from the last tick it let through, and reads no
//! clock. A tick that forces a render or requires presentation is never held.

use std::time::Duration;

#[derive(Default)]
pub struct FrameCap {
    ticks_since_passed: Option<u32>,
}

impl FrameCap {
    pub fn holds(
        &mut self,
        cap: Option<Duration>,
        refresh: Option<Duration>,
        urgent: bool,
    ) -> bool {
        let ticks = self
            .ticks_since_passed
            .map_or(u32::MAX, |ticks| ticks.saturating_add(1));
        let every = cap
            .zip(refresh)
            .map_or(1, |(cap, refresh)| hertz(refresh).div_ceil(hertz(cap)));
        let held = !urgent && ticks < every;
        self.ticks_since_passed = Some(if held { ticks } else { 0 });
        held
    }
}

fn hertz(interval: Duration) -> u32 {
    ((1.0 / interval.as_secs_f64()).round() as u32).max(1)
}
