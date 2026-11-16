//! A look's operator finish (#463; canvas primitives: Pack: art@1 painterly looks, "a look asset
//! whose finish is a GPU operator composed from the closed step list"): a `finish` entry that
//! names a pass operator, `{"<op>@<major>": {params}}`, runs that pass over the look's finished
//! frame. The check here admits a composed pass that reads only this frame's color and its own
//! params, then the whole operator check (shader text, status colors, limits, its cost within
//! 25% of the estimate).

use serde_json::Value;

use crate::check::{self, Checked};
use crate::graph::{self, From, Issue, Kind};

/// A finish entry's operator name: its one key, when that key names an operator by major
/// version (`fx.mosaic@1`), or `None` for a shipped finish (`grain`, `vignette`, …).
pub fn op_name(entry: &Value) -> Option<(&str, &Value)> {
    let o = entry.as_object().filter(|o| o.len() == 1)?;
    let (name, params) = o.iter().next()?;
    let (_, major) = name.rsplit_once('@')?;
    (!major.is_empty() && major.bytes().all(|b| b.is_ascii_digit()))
        .then_some((name.as_str(), params))
}

/// Checks `graph` as a look's finish pass, and names the texture input that takes the frame.
pub fn check(graph: &Value) -> Result<(Checked, String), Vec<Issue>> {
    let op = graph::read(graph)?;
    let mut issues = Vec::new();
    if op.kind != Kind::Pass {
        issues.push(Issue::at_path(
            "operator_kind_rule",
            "kind",
            "a look's finish operator is a pass",
        ));
    }
    let mut frame = None;
    for (name, input) in &op.inputs {
        let path = format!("inputs/{name}");
        match &input.from {
            From::Target { op: from, output } if from == "core" && output == "color" => {
                if frame.replace(name.clone()).is_some() {
                    issues.push(Issue::at_path(
                        "operator_kind_rule",
                        &path,
                        "a look's finish reads the frame's color once",
                    ));
                }
            }
            From::Target { op: from, output } => issues.push(Issue::at_path(
                "operator_kind_rule",
                &path,
                format!(
                    "{name} reads {from}.{output}: a look's finish reads only the frame's color"
                ),
            )),
            From::Texture3d { .. }
            | From::Storage { .. }
            | From::Column { .. }
            | From::Attribute { .. }
            | From::Asset(_) => issues.push(Issue::at_path(
                "operator_kind_rule",
                &path,
                format!("{name} reads data a look's finish can't"),
            )),
            _ => {}
        }
    }
    let Some(frame) = frame else {
        issues.push(Issue::at_path(
            "operator_kind_rule",
            "inputs",
            "a look's finish reads the frame's color",
        ));
        return Err(issues);
    };
    if !issues.is_empty() {
        return Err(issues);
    }
    let mut checked = check::check(&op)?;
    checked.op.outputs.remove("coverage");
    Ok((checked, frame))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn named(name: &str) -> Value {
        crate::fx::library()
            .into_iter()
            .find(|n| n.name == name)
            .map(|n| n.graph)
            .expect("an fx@1 operator")
    }

    #[test]
    fn an_entry_names_an_operator_by_major() {
        assert_eq!(
            op_name(&json!({"fx.mosaic@1": {"cells": 40}})).map(|(n, _)| n),
            Some("fx.mosaic@1")
        );
        assert!(op_name(&json!({"grain": {"amount": 0.1}})).is_none());
        assert!(op_name(&json!({"a@": {}})).is_none());
    }

    #[test]
    fn a_pass_over_the_frame_passes_and_one_over_depth_is_refused() {
        let (_, frame) = check(&named("fx.mosaic@1")).expect("mosaic reads the frame");
        assert_eq!(frame, "src");
        let mut depth = named("fx.mosaic@1");
        depth["inputs"]["src"]["from"]["texture"]["target"]["output"] = json!("depth");
        let issues = check(&depth).expect_err("a finish reads only color");
        assert_eq!(issues[0].path.as_deref(), Some("inputs/src"));
    }
}
