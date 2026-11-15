//! The params a driver and a constraint read resolve at check, as a channel's target does
//! (canvas primitives: Driver, Path and handle; #1960): a driver's path var and a
//! `follow_path`'s `fraction: {path}` that name a param reaching nothing are `ref_unresolved`,
//! each naming its place and the path. So a path a migration's rename didn't carry is refused,
//! never read as 0.

use serde_json::{json, Value};

use super::check::resolve;
use super::{member, Issue};
use crate::grammar::Path;
use crate::kinds::Registry;

pub(super) fn check(doc: &Value, kinds: &Registry, issues: &mut Vec<Issue>) {
    let entries = |section: &str| {
        member(doc, section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
    };
    // A param's path, `items/<id>/params/…`, that reaches nothing: a driver's other reads are
    // the motion module's to resolve.
    let mut read = |id: &str, at: &str, read: &Value| {
        let Some(text) = read.as_str().filter(|text| {
            let mut steps = text.split('/');
            steps.next() == Some("items") && steps.nth(1) == Some("params")
        }) else {
            return;
        };
        let reached = Path::parse(text).map(|path| resolve(doc, &path, kinds));
        if let Ok(Err(what)) = reached {
            issues.push(Issue::error(
                "ref_unresolved",
                id,
                at.into(),
                json!(text),
                &what,
            ));
        }
    };
    for (id, driver) in entries("drivers") {
        let vars = member(driver, "vars").and_then(Value::as_object);
        for (name, var) in vars.into_iter().flatten() {
            read(id, &format!("drivers/{id}/vars/{name}"), var);
        }
    }
    for (id, constraint) in entries("constraints") {
        if let Some(path) = constraint.pointer("/fraction/path") {
            read(id, &format!("constraints/{id}/fraction/path"), path);
        }
    }
}
