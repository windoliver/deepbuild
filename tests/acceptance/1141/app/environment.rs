//! Where a budget counts (technical-design.md, Numbers version 0 has to hold: the reference Macs). A memory or timing
//! reading taken anywhere else is a reading only: INCONCLUSIVE, never a pass. As in tests/acceptance/397, a timing is
//! also only a reading with Low Power Mode on or unknown, a thermal warning, or a 1-minute load average above half the
//! cores; mains power never gates (the owner's rule).
#![allow(dead_code)]

use std::process::Command;

fn sh(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .unwrap_or_default()
}

/// None on a reference Mac (Mac15,7 with an M3 Pro and 36 GiB, or Mac15,12 with an M3 and 16 GiB), else why not.
pub fn not_a_reference_mac() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return Some(format!("platform {}", std::env::consts::OS));
    }
    let model = sh("sysctl", &["-n", "hw.model"]);
    let chip = sh("sysctl", &["-n", "machdep.cpu.brand_string"]);
    let gib = sh("sysctl", &["-n", "hw.memsize"])
        .parse::<u64>()
        .unwrap_or(0)
        >> 30;
    let reference = [
        ("Mac15,7", "Apple M3 Pro", 36),
        ("Mac15,12", "Apple M3", 16),
    ];
    (!reference.contains(&(model.as_str(), chip.as_str(), gib)))
        .then(|| format!("not a reference Mac: {model} / {chip} / {gib} GiB"))
}

/// None where a timing counts, else why it is a reading only.
pub fn timing_problem() -> Option<String> {
    if let Some(problem) = not_a_reference_mac() {
        return Some(problem);
    }
    let pmset = sh("pmset", &["-g"]);
    let low_power = pmset
        .lines()
        .find_map(|line| line.trim().strip_prefix("lowpowermode"))
        .map(str::trim);
    match low_power {
        None => {
            return Some("Low Power Mode state unknown (no lowpowermode line in pmset -g)".into())
        }
        Some("0") => {}
        Some(_) => return Some("Low Power Mode is on".into()),
    }
    let therm = sh("pmset", &["-g", "therm"]);
    let limited = therm.lines().any(|line| {
        line.split_once("_Limit")
            .and_then(|(_, rest)| {
                rest.trim_start_matches([' ', '='])
                    .trim()
                    .parse::<u32>()
                    .ok()
            })
            .is_some_and(|limit| limit < 100)
    });
    if limited || !therm.contains("No thermal warning level") {
        return Some(format!(
            "thermal state not nominal: {}",
            therm.replace('\n', " ")
        ));
    }
    let load: f64 = sh("sysctl", &["-n", "vm.loadavg"])
        .trim_matches(['{', '}', ' '])
        .split_whitespace()
        .next()
        .and_then(|first| first.parse().ok())
        .unwrap_or(f64::MAX);
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get()) as f64;
    (load > cores / 2.0)
        .then(|| format!("loaded: a 1-minute load average of {load:.1} on {cores} cores"))
}

/// `n` with thousands separators, as the issue writes counts: 200,000.
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}
