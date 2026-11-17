use super::*;

/// The input values as the frame uploads them: params from `params` by path, roles from
/// `roles`, defaults otherwise; f32 inputs round to f32 as the uniform holds them.
pub fn inputs(
    c: &Checked,
    params: &BTreeMap<String, Value>,
    roles: &BTreeMap<String, [f64; 3]>,
) -> BTreeMap<String, Val> {
    let mut out = BTreeMap::new();
    for (name, input) in &c.op.inputs {
        let v = match &input.from {
            From::Target { .. }
            | From::Asset(_)
            | From::Texture3d { .. }
            | From::Storage { .. }
            | From::Column { .. }
            | From::Attribute { .. } => Val::T(name.clone()),
            From::Spline(slots) => Val::A(
                Sc::F32,
                slots
                    .iter()
                    .map(|c| c.iter().map(|x| f32r(*x)).collect())
                    .collect(),
            ),
            From::Role(r) => Val::N(
                Sc::F32,
                roles
                    .get(r)
                    .map(|c| c.iter().map(|x| f32r(*x)).collect())
                    .unwrap_or(vec![0.0; 3]),
            ),
            From::Param(p) | From::Channel(p) => {
                let v = params
                    .get(p)
                    .or(input.default.as_ref())
                    .cloned()
                    .unwrap_or(Value::Null);
                typed_literal(&v, &input.ty)
            }
            // The step a stepped operator computes, which its runtime sets each step (#252).
            From::Step => Val::N(Sc::U32, vec![0.0]),
            // A light response's port comes from the light loop, never the uniform (#485).
            From::Time | From::Phase(_) | From::Seed | From::Port => continue,
        };
        out.insert(name.clone(), v);
    }
    out
}

/// Runs a checked pass at every pixel of rows `rows` of a `size` output; the rows' pixels, in
/// order.
pub fn pass_rows(
    c: &Checked,
    env: &Env<'_>,
    size: [u32; 2],
    rows: std::ops::Range<u32>,
) -> Result<Vec<[f64; 4]>, String> {
    let mut prog = Prog::new(c, env, size, BTreeMap::new())?;
    let color = prog_src(&mut prog, &c.op.outputs["color"]);
    let coverage = c.op.outputs.get("coverage").map(|a| prog_src(&mut prog, a));
    shade(prog, size, rows, false, |prog, regs| {
        let mut px = as_l(prog.get(regs, color), Sc::F32, 4).v;
        if let Some(cov) = coverage {
            let k = as_l(prog.get(regs, cov), Sc::F32, 1).v[0];
            px.iter_mut().for_each(|v| *v *= k);
        }
        px
    })
}
