//! The audio clock (canvas primitives: Time and the flick, Which clock leads): it pairs each
//! device callback's sample position with its host time, smoothed, never a raw count, so the
//! time shown is the position of the sample the device plays at a frame's presentation.

use std::collections::VecDeque;

/// How many callbacks the pairing fits a line through.
const WINDOW: usize = 64;

/// A line through the latest callbacks' (stream sample, host flick) pairs, by least squares.
#[derive(Clone, Debug, Default)]
pub struct Pairing {
    points: VecDeque<(i64, i64)>,
    /// Flicks a sample at the nominal rate, for a pairing of one point.
    nominal: f64,
}

impl Pairing {
    pub fn new(rate: i64) -> Pairing {
        Pairing {
            points: VecDeque::new(),
            nominal: crate::FLICKS as f64 / rate.max(1) as f64,
        }
    }

    /// A callback: its buffer's first stream sample and the host time it reported for it.
    pub fn add(&mut self, sample: i64, host: i64) {
        self.points.push_back((sample, host));
        if self.points.len() > WINDOW {
            self.points.pop_front();
        }
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// The fitted line, relative to its first point: (sample₀, host₀, intercept, flicks a sample).
    fn line(&self) -> Option<(i64, i64, f64, f64)> {
        let &(x0, y0) = self.points.front()?;
        let n = self.points.len() as f64;
        if self.points.len() < 2 {
            return Some((x0, y0, 0.0, self.nominal));
        }
        let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
        for &(x, y) in &self.points {
            let (x, y) = ((x - x0) as f64, (y - y0) as f64);
            sx += x;
            sy += y;
            sxx += x * x;
            sxy += x * y;
        }
        let d = n * sxx - sx * sx;
        if d == 0.0 {
            return Some((x0, y0, 0.0, self.nominal));
        }
        let b = (n * sxy - sx * sy) / d;
        let a = (sy - b * sx) / n;
        Some((x0, y0, a, b))
    }

    /// The stream position, in samples, the device plays at host time `host`.
    pub fn position(&self, host: i64) -> Option<f64> {
        let (x0, y0, a, b) = self.line()?;
        Some(x0 as f64 + ((host - y0) as f64 - a) / b)
    }

    /// The host time stream sample `sample` plays at.
    pub fn host_of(&self, sample: i64) -> Option<i64> {
        let (x0, y0, a, b) = self.line()?;
        Some(y0 + (a + b * (sample - x0) as f64).round() as i64)
    }
}
