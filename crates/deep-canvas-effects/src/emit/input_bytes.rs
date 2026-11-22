use super::*;

/// The inputs' uniform as [`bindings`] lays it out: a leading unused vec4, then each value input
/// in name order in whole vec4 slots (an array a slot per element, a matrix four).
pub fn input_bytes(
    c: &Checked,
    values: &std::collections::BTreeMap<String, crate::interp::Val>,
) -> Vec<u8> {
    use crate::interp::Val;
    let mut b = vec![0u8; 16];
    let word = |sc: Sc, x: f64| -> [u8; 4] {
        match sc {
            Sc::F32 => (x as f32).to_le_bytes(),
            Sc::I32 => (x as i32).to_le_bytes(),
            Sc::U32 | Sc::Bool => (x as u32).to_le_bytes(),
        }
    };
    for (name, input) in &c.op.inputs {
        if matches!(input.ty, Ty::Tex(_) | Ty::Tex3(_) | Ty::Storage(..))
            || matches!(input.from, From::Time | From::Seed)
        {
            continue;
        }
        let v = values.get(name);
        match &input.ty {
            Ty::V(sc, _) => {
                let lanes = match v {
                    Some(Val::N(_, l)) => l.clone(),
                    _ => Vec::new(),
                };
                for i in 0..4 {
                    b.extend_from_slice(&word(*sc, lanes.get(i).copied().unwrap_or(0.0)));
                }
            }
            Ty::Arr(sc, _, n) => {
                let items = match v {
                    Some(Val::A(_, items)) => items.clone(),
                    _ => Vec::new(),
                };
                for k in 0..*n as usize {
                    for i in 0..4 {
                        let x = items.get(k).and_then(|e| e.get(i)).copied().unwrap_or(0.0);
                        b.extend_from_slice(&word(*sc, x));
                    }
                }
            }
            Ty::Mat(n) => {
                let m = match v {
                    Some(Val::M(_, m)) => m.clone(),
                    _ => Vec::new(),
                };
                let n = *n as usize;
                for c in 0..4 {
                    for r in 0..4 {
                        let x = if c < n && r < n {
                            m.get(c * n + r).copied().unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        b.extend_from_slice(&(x as f32).to_le_bytes());
                    }
                }
            }
            _ => {}
        }
    }
    b
}
