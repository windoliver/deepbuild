//! Mark set rows from an occurrence list (canvas primitives: Mark set and columns `marks@1`,
//! `rows`): one row per match at or before t, keyed by its index and appearing at its flick, so a
//! chart gains a point as each one lands and a seek draws the same rows. A row is never taken
//! from an occurrence after t, and a control column reads that control at the match's flick.

use deep_canvas::expr::{Expr, Nothing};
use serde_json::{json, Map, Value};

use crate::doc::Refused;
use crate::occurrence::Occurrence;
use crate::program::DRIVER_OPS;

/// Where a column of an occurrence set reads each row from.
#[derive(Clone, Debug, PartialEq)]
enum Source {
    Flick,
    Payload(String),
    /// This control's value at each match's flick, as the input track last set it.
    Control(Vec<(i64, f64)>, f64),
    /// An expression over the match's payload fields.
    Expression(Expr),
}

/// A mark set whose rows come from an occurrence list.
#[derive(Clone, Debug, PartialEq)]
pub struct RowList {
    pub item: String,
    list: Vec<Occurrence>,
    columns: Vec<(String, Source)>,
}

fn refused(code: &'static str, path: String) -> Refused {
    Refused {
        code,
        path,
        detail: None,
    }
}

/// One column's source as written: a payload field's name, `{control}` or `{expr}`.
fn source_of(
    written: &Value,
    path: &str,
    control: impl Fn(&str) -> Option<(Vec<(i64, f64)>, f64)>,
) -> Result<Source, Refused> {
    match written {
        Value::String(s) if s == "flick" => Ok(Source::Flick),
        Value::String(s) => Ok(Source::Payload(s.clone())),
        Value::Object(o) => {
            if let Some(id) = o.get("control").and_then(Value::as_str) {
                let (entries, default) =
                    control(id).ok_or_else(|| refused("ref_unresolved", path.to_string()))?;
                return Ok(Source::Control(entries, default));
            }
            let Some(text) = o.get("expr").and_then(Value::as_str) else {
                return Err(refused("bad_doc", path.to_string()));
            };
            let expr = Expr::compile(text, &Nothing, DRIVER_OPS)
                .map_err(|_| refused("bad_doc", path.to_string()))?;
            Ok(Source::Expression(expr))
        }
        _ => Err(refused("bad_doc", path.to_string())),
    }
}

impl RowList {
    /// The set `id`'s rows from `list`, each column as `rows.columns` names it, by default its
    /// flick and the payload fields of its list.
    pub fn read(
        id: &str,
        rows: &Map<String, Value>,
        list: Vec<Occurrence>,
        control: impl Fn(&str) -> Option<(Vec<(i64, f64)>, f64)>,
    ) -> Result<RowList, Refused> {
        let path = format!("items/{id}/params/rows/columns");
        let mut columns = Vec::new();
        if let Some(written) = rows.get("columns") {
            let Some(written) = written.as_object() else {
                return Err(refused("bad_doc", path));
            };
            for (name, c) in written {
                columns.push((
                    name.clone(),
                    source_of(c, &format!("{path}/{name}"), &control)?,
                ));
            }
        } else {
            columns.push(("flick".to_string(), Source::Flick));
            let mut fields: Vec<&String> = list
                .iter()
                .filter_map(|o| o.payload.as_object())
                .flat_map(Map::keys)
                .collect();
            fields.sort();
            fields.dedup();
            columns.extend(
                fields
                    .into_iter()
                    .map(|f| (f.clone(), Source::Payload(f.clone()))),
            );
        }
        Ok(RowList {
            item: id.to_string(),
            list,
            columns,
        })
    }

    /// Writes the matches at or before `t` into the mark set's `n`, `key` and columns.
    pub fn write(&self, item: &mut Value, t: i64) {
        let shown = &self.list[..self.list.partition_point(|o| o.t <= t)];
        let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) else {
            return;
        };
        let mut columns = Map::new();
        for (name, source) in &self.columns {
            let bytes: Vec<u8> = shown
                .iter()
                .flat_map(|o| source.at(o).to_le_bytes())
                .collect();
            columns.insert(
                name.clone(),
                json!({"dtype": "f64", "len": shown.len(),
                       "data": deep_canvas::base64::encode(&bytes)}),
            );
        }
        let keys: Vec<String> = (0..shown.len()).map(|i| i.to_string()).collect();
        columns.insert(
            "key".to_string(),
            json!({"dtype": "str", "len": shown.len(), "data": keys}),
        );
        params.insert("n".to_string(), json!(shown.len()));
        params.insert("key".to_string(), json!("key"));
        params.insert("columns".to_string(), Value::Object(columns));
    }
}

impl Source {
    fn at(&self, o: &Occurrence) -> f64 {
        let field = |name: &str| o.payload.get(name).and_then(Value::as_f64);
        match self {
            Source::Flick => o.t as f64,
            Source::Payload(name) => field(name).unwrap_or(f64::NAN),
            Source::Control(entries, default) => {
                let i = entries.partition_point(|e| e.0 <= o.t);
                i.checked_sub(1).map_or(*default, |i| entries[i].1)
            }
            Source::Expression(e) => {
                let vars: Vec<f64> = e
                    .vars
                    .iter()
                    .map(|v| field(v).unwrap_or(f64::NAN))
                    .collect();
                e.eval_num(&vars)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn cue(t: i64, v: f64) -> Occurrence {
        Occurrence {
            t,
            end: t,
            a: None,
            b: None,
            kind: "cue".into(),
            tags: Vec::new(),
            payload: json!({"v": v}),
        }
    }

    #[test]
    fn a_column_reads_a_control_at_its_match_and_an_expression_over_its_payload() {
        let rows = json!({"columns": {"level": {"control": "gain"}, "double": {"expr": "v * 2"}}});
        let control = |id: &str| (id == "gain").then(|| (vec![(5, 3.0), (25, 7.0)], 1.0));
        let list = RowList::read(
            "set",
            rows.as_object().unwrap(),
            vec![cue(0, 1.0), cue(10, 2.0), cue(30, 4.0)],
            control,
        )
        .unwrap();
        let mut item = json!({"params": {}});
        list.write(&mut item, 12);
        assert_eq!(item["params"]["n"], 2);
        let read = |name: &str| -> Vec<f64> {
            let data = item["params"]["columns"][name]["data"].as_str().unwrap();
            let bytes = deep_canvas::base64::decode(data).unwrap();
            bytes
                .chunks_exact(8)
                .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
                .collect()
        };
        assert_eq!(
            read("level"),
            [1.0, 3.0],
            "each row reads the control at its own flick, never at t"
        );
        assert_eq!(read("double"), [2.0, 4.0]);
        assert_eq!(item["params"]["columns"]["key"]["data"], json!(["0", "1"]));
    }
}
