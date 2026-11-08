//! Issue #495: a driver's time offsets (canvas primitives: Driver: time offsets). `lag(var, dt)`
//! is the var's value at t − dt and `smooth(var, width, samples)` the mean of lag at evenly spaced
//! samples across a window of `width` centred on t. Both take literal times, so the rewrite here
//! reads each as plain vars, `_lag<k>`, that the core's expressions then see as inputs.

use deep_canvas::grammar::{Time, TimeContext, FLICKS_PER_SECOND};

/// Furthest a lag reaches either way (Driver: time offsets).
const REACH: i64 = 10 * FLICKS_PER_SECOND;
/// Most samples `smooth` takes.
const SAMPLES: usize = 16;

pub struct Refusal {
    pub code: &'static str,
    pub why: String,
}

fn refuse<T>(code: &'static str, why: impl Into<String>) -> Result<T, Refusal> {
    Err(Refusal {
        code,
        why: why.into(),
    })
}

/// One lagged read the rewrite found: the var it stands for, the var read and `dt` in flicks.
#[derive(Clone, Debug, PartialEq)]
pub struct Lagged {
    pub name: String,
    pub var: String,
    pub dt: i64,
}

fn literal(arg: &str, what: &str, ctx: &TimeContext) -> Result<i64, Refusal> {
    let Some(text) = arg
        .trim()
        .strip_prefix('"')
        .and_then(|a| a.strip_suffix('"'))
    else {
        return refuse(
            "lag_dt_runtime",
            format!(
                "{what}: `{}` is not a literal time; a dt is never computed at run time",
                arg.trim()
            ),
        );
    };
    let (sign, unsigned) = text.strip_prefix('-').map_or((1, text), |t| (-1, t));
    let flicks = Time::parse(unsigned)
        .and_then(|t| t.resolve(ctx))
        .or_else(|_| refuse("bad_time", format!("{what}: `{text}` is not a time")))?;
    Ok(sign * flicks)
}

fn reach(dt: i64, text: &str, what: &str) -> Result<i64, Refusal> {
    if dt.abs() > REACH {
        return refuse(
            "lag_out_of_reach",
            format!("{what}: {} reaches past ±10 s", text.trim()),
        );
    }
    Ok(dt)
}

/// Rewrites each `lag(var, "dt")` and `smooth(var, "width", n)` in `text`, and returns the new
/// text with what each new var stands for.
pub fn rewrite(text: &str, ctx: &TimeContext) -> Result<(String, Vec<Lagged>), Refusal> {
    let mut out = String::new();
    let mut found: Vec<Lagged> = Vec::new();
    let mut var_for = |var: &str, dt: i64| -> String {
        if let Some(l) = found.iter().find(|l| l.var == var && l.dt == dt) {
            return l.name.clone();
        }
        let name = format!("_lag{}", found.len());
        found.push(Lagged {
            name: name.clone(),
            var: var.to_string(),
            dt,
        });
        name
    };
    let mut rest = text;
    while !rest.is_empty() {
        let start = ["lag", "smooth"]
            .iter()
            .filter_map(|f| {
                let mut from = 0;
                while let Some(i) = rest[from..].find(f) {
                    let at = from + i;
                    let before = rest[..at].chars().next_back();
                    let after = rest[at + f.len()..].trim_start();
                    if !before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
                        && after.starts_with('(')
                    {
                        return Some((at, *f));
                    }
                    from = at + f.len();
                }
                None
            })
            .min_by_key(|(at, _)| *at);
        let Some((at, name)) = start else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..at]);
        let after = &rest[at + name.len()..];
        let open = after.find('(').unwrap_or(0) + 1;
        let Some(close) = after[open..].find(')') else {
            return refuse("bad_doc", format!("{name}( is never closed"));
        };
        let args: Vec<&str> = after[open..open + close].split(',').collect();
        let want = if name == "lag" { 2 } else { 3 };
        if args.len() != want {
            return refuse("bad_doc", format!("{name} takes {want} arguments"));
        }
        let var = args[0].trim();
        if var.is_empty() || !var.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return refuse("bad_doc", format!("{name}: `{var}` is not a var"));
        }
        if name == "lag" {
            let dt = reach(
                literal(args[1], "lag", ctx)?,
                args[1].trim_matches([' ', '"']),
                "lag",
            )?;
            out.push_str(&var_for(var, dt));
        } else {
            let width = literal(args[1], "smooth", ctx)?;
            reach(width / 2, args[1].trim_matches([' ', '"']), "smooth")?;
            let n = args[2]
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|n| (1..=SAMPLES).contains(n));
            let Some(n) = n else {
                return refuse(
                    "lag_samples",
                    format!(
                        "smooth: `{}` samples is not an integer from 1 to {SAMPLES}",
                        args[2].trim()
                    ),
                );
            };
            // Samples at t + w/2 down to t − w/2, each a lag of the negated offset.
            let names: Vec<String> = (0..n)
                .map(|k| {
                    let offset = if n == 1 {
                        0.0
                    } else {
                        width as f64 / 2.0 - k as f64 * width as f64 / (n - 1) as f64
                    };
                    var_for(var, -(offset.round() as i64))
                })
                .collect();
            out.push_str(&format!("(({}) / {n})", names.join(" + ")));
        }
        rest = &after[open + close + 1..];
    }
    Ok((out, found))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TimeContext {
        TimeContext {
            frame_rate: (60, 1),
            ..TimeContext::default()
        }
    }

    #[test]
    fn lag_and_smooth_become_vars() {
        let (text, found) = rewrite("lag(x, \"0.5s\") + smooth(x, \"0.4s\", 5)", &ctx())
            .ok()
            .unwrap();
        assert_eq!(found.len(), 6);
        assert!(text.starts_with("_lag0 + (("));
        let dts: Vec<i64> = found[1..].iter().map(|l| l.dt).collect();
        assert_eq!(
            dts,
            [-0.2, -0.1, 0.0, 0.1, 0.2].map(|s| (s * FLICKS_PER_SECOND as f64).round() as i64)
        );
    }

    #[test]
    fn a_run_time_dt_and_a_far_reach_are_refused() {
        assert_eq!(
            rewrite("lag(x, k)", &ctx()).err().map(|r| r.code),
            Some("lag_dt_runtime")
        );
        assert_eq!(
            rewrite("lag(x, \"10.5s\")", &ctx()).err().map(|r| r.code),
            Some("lag_out_of_reach")
        );
        assert!(rewrite("lag(x, \"-10s\")", &ctx()).is_ok());
        assert_eq!(
            rewrite("smooth(x, \"1s\", 17)", &ctx())
                .err()
                .map(|r| r.code),
            Some("lag_samples")
        );
    }
}
