use serde_json::{json, Map, Value};

use crate::hub::{Hub, Show};

pub(crate) const SKIPS_COUNT: &str = "settle_skips_count";
pub(crate) const LAST_WRITER: &str = "nonfinite_last_writer";
pub(crate) const PLANTED: &[&str] = &[SKIPS_COUNT, LAST_WRITER];

pub(crate) enum Settled {
    Counted(Value),
    Refused(Value),
    Uncounted,
}

pub(crate) fn ledgered(doc: &Value) -> Vec<String> {
    #[allow(unused_mut)]
    let mut rows: Vec<String> = deep_canvas_effects::values::ledger()
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| r["operator"].as_str().map(str::to_string))
        .collect();
    #[cfg(feature = "test-export-guards")]
    rows.extend(
        crate::export::test_guards::LEDGERED
            .iter()
            .map(|s| s.to_string()),
    );
    let mut drawn: Vec<String> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, i)| i["kind"].as_str())
        .filter(|k| rows.iter().any(|r| r == k))
        .map(str::to_string)
        .collect();
    drawn.sort();
    drawn.dedup();
    drawn
}

fn run_offset() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos().wrapping_mul(2_654_435_761))
}

impl Hub<'_> {
    pub(crate) fn settle_count(&mut self, doc: &Value) -> Settled {
        let planted = self.scenario.module_planted.clone();
        if planted.as_deref() == Some(SKIPS_COUNT) {
            return Settled::Uncounted;
        }
        let last_writer = (planted.as_deref() == Some(LAST_WRITER)).then(run_offset);
        let Some(gpu) = self.gpu3() else {
            return Settled::Uncounted;
        };
        #[cfg(feature = "test-export-guards")]
        gpu.plant_nan(&crate::export::test_guards::divided(doc));
        let Some(found) = gpu.finite(last_writer) else {
            return Settled::Uncounted;
        };
        if found.count == 0 {
            return Settled::Counted(json!({"count": 0, "gpu_ms": found.gpu_ms}));
        }
        let item = found.pick.and_then(|p| gpu.picks().get(&p).cloned());
        let operators = ledgered(doc);
        let what = format!(
            "the frame's pre-tone image holds {} non-finite values{}; the ledgered operators drawn into it: {}",
            found.count,
            item.as_deref()
                .map(|i| format!(", the smallest item among them `{i}`"))
                .unwrap_or_default(),
            if operators.is_empty() {
                "none".to_string()
            } else {
                operators.join(", ")
            }
        );
        Settled::Refused(json!({
            "check": "frames.finite", "code": "frames.finite", "severity": "error",
            "target": "pre_tone", "count": found.count, "item": item, "operators": operators,
            "what": what,
        }))
    }

    pub(crate) fn keep_settled(&mut self, doc: &Value) {
        let settled = match self.settle_count(doc) {
            Settled::Counted(f) => Some(Ok(f)),
            Settled::Refused(issue) => Some(Err(issue)),
            Settled::Uncounted => None,
        };
        if let Some(gpu) = self.gpu3() {
            gpu.settled = settled;
        }
    }

    pub(crate) fn take_settled(&mut self) -> Option<Result<Value, Value>> {
        self.gpu3
            .as_mut()
            .and_then(Option::as_mut)
            .and_then(|g| g.settled.take())
    }

    pub(crate) fn refused_frame(
        &self,
        issue: &Value,
        show: &Show,
        mut reply: Map<String, Value>,
    ) -> Value {
        reply.insert("outcome".into(), json!("refused"));
        reply.insert("snapshots".into(), json!([]));
        reply.insert("nonfinite".into(), json!([issue]));
        if show.check {
            reply.insert("result".into(), json!(self.verdict(show, false)));
        }
        Value::Object(reply)
    }
}
