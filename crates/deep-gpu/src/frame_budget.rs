//! The frame-budget check's verdict (issue #1899; canvas primitives: Frame budget). Five runs
//! after warm-up, each one's 95th percentile against the class's limit: PASS when all five are
//! within, FAIL when all five are over by more than the margin (the larger of 5% and the five
//! runs' spread), otherwise INCONCLUSIVE with all five attached. A frame's GPU reading comes only
//! from its own resolved pass timestamps; one that is unresolved, zero, reversed or from work
//! submitted before a device loss is invalid and is never filled from another frame. A run holds
//! only if its percentile holds with every invalid frame counted as over budget, and is over only
//! if it is over with them counted as within; a run its invalid frames decide makes the check
//! BLOCKED, naming them.

/// Why a frame's GPU reading is invalid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Invalid {
    Unresolved,
    Zero,
    Reversed,
    DeviceLost,
}

impl Invalid {
    pub fn name(self) -> &'static str {
        match self {
            Invalid::Unresolved => "unresolved",
            Invalid::Zero => "zero",
            Invalid::Reversed => "reversed",
            Invalid::DeviceLost => "device_lost",
        }
    }
}

/// A frame's GPU reading from its own pass timestamps: the time they cover, or why it is invalid.
pub fn reading(
    lost: bool,
    resolved: bool,
    reversed: bool,
    covered_ms: f64,
) -> Result<f64, Invalid> {
    if lost {
        Err(Invalid::DeviceLost)
    } else if !resolved {
        Err(Invalid::Unresolved)
    } else if reversed {
        Err(Invalid::Reversed)
    } else if covered_ms <= 0.0 {
        Err(Invalid::Zero)
    } else {
        Ok(covered_ms)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Fail,
    Inconclusive,
    Blocked,
}

impl Verdict {
    pub fn name(self) -> &'static str {
        match self {
            Verdict::Pass => "PASS",
            Verdict::Fail => "FAIL",
            Verdict::Inconclusive => "INCONCLUSIVE",
            Verdict::Blocked => "BLOCKED",
        }
    }
}

/// One run's 95th percentile (nearest rank) with its invalid frames counted as over budget,
/// above every reading (+inf when the rank falls on one), and as within, below every reading.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunP95 {
    pub over: f64,
    pub within: f64,
}

pub fn run_p95(frames: &[Result<f64, Invalid>]) -> RunP95 {
    let at = |fill: f64| {
        let mut v: Vec<f64> = frames
            .iter()
            .map(|r| *r.as_ref().unwrap_or(&fill))
            .collect();
        v.sort_by(f64::total_cmp);
        let rank = (0.95 * v.len() as f64).ceil() as usize;
        v.get(rank.saturating_sub(1))
            .copied()
            .unwrap_or(f64::INFINITY)
    };
    RunP95 {
        over: at(f64::INFINITY),
        within: at(f64::NEG_INFINITY),
    }
}

/// The five runs against `limit`: the verdict and the margin, the larger of 5% and the runs'
/// spread (invalid frames counted as within) over the limit.
pub fn judge(limit: f64, runs: &[RunP95]) -> (Verdict, f64) {
    let (lo, hi) = runs
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), r| {
            (lo.min(r.within), hi.max(r.within))
        });
    let margin = 0.05f64.max((hi - lo) / limit);
    let holds = |r: &RunP95| r.over <= limit;
    let over = |r: &RunP95| r.within > limit;
    let verdict = if runs.iter().all(holds) {
        Verdict::Pass
    } else if runs.iter().all(|r| r.within > limit * (1.0 + margin)) {
        Verdict::Fail
    } else if runs.iter().any(|r| !holds(r) && !over(r)) {
        Verdict::Blocked
    } else {
        Verdict::Inconclusive
    };
    (verdict, margin)
}
