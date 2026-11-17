//! An item's scopes (moved from scene.rs, #2031): its ancestors' (a mask's, a frame's overflow
//! scissor, a group's opacity, a lit group's light) and the masks and mattes whose collections
//! hold it.

use super::*;

/// The most masks that may clip one item (Mask: "nest deeper than 4" it can never).
const MASK_DEPTH: usize = 4;

/// A mask's scope over the items it applies to: a scissor for a shape mask, coverage from its own
/// paint for an alpha or luminance one, and for a feathered one its rect's coverage ramped over the
/// feather (#385); a path ID's shape clips by that path's outline where it draws (#1175: an SVG's
/// `<clipPath>`). A rounded rect, a soft path, a shape naming no path, inverted and combined
/// masks wait.
fn mask_scope(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Scope, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    match p.get("shape").and_then(Value::as_str).unwrap_or("rect") {
        "rect" => {}
        "rounded rect" => return refuse("mask_r2", format!("{path}/shape")),
        shape => {
            let plain = p.get("mode").is_none_or(|m| m == "shape")
                && ["feather", "expand"]
                    .iter()
                    .all(|k| num(p.get(*k)).unwrap_or(0.0) == 0.0)
                && p.get("invert").is_none_or(|v| v == &Value::Bool(false))
                && p.get("combine").is_none_or(|c| c == "add");
            if !plain {
                return refuse("mask_r2", path);
            }
            let is_path = items.get(shape).and_then(|i| i.get("kind")) == Some(&json!("path@1"));
            let Some(verbs) = item_outline(items, shape).filter(|_| is_path) else {
                return refuse("mask_r2", format!("{path}/shape"));
            };
            return Ok(Scope::Shape {
                item: id.to_string(),
                verbs: Arc::new(verbs),
            });
        }
    }
    let feather = num(p.get("feather")).unwrap_or(0.0);
    if feather < 0.0 {
        return refuse("bad_doc", format!("{path}/feather"));
    }
    let soft = p.get("invert") == Some(&Value::Bool(true))
        || p.get("combine")
            .and_then(Value::as_str)
            .is_some_and(|c| c != "add");
    if soft {
        return refuse("mask_r2", path);
    }
    let b: Option<Vec<f64>> = p
        .get("box")
        .and_then(Value::as_array)
        .map(|b| b.iter().map(|v| num(Some(v))).collect())
        .unwrap_or(None);
    let Some([x, y, w, h]) = b.as_deref().and_then(|b| <[f64; 4]>::try_from(b).ok()) else {
        return refuse("bad_doc", format!("{path}/box"));
    };
    let e = num(p.get("expand")).unwrap_or(0.0);
    let rect = Place::of(item).rect([x - e, y - e, w + 2.0 * e, h + 2.0 * e]);
    let luminance = match p.get("mode").and_then(Value::as_str) {
        None | Some("shape") if feather > 0.0 => {
            return Ok(Scope::Mask {
                item: id.to_string(),
                rect,
                luminance: false,
                fill: Fill::Solid([255, 255, 255]),
                feather,
            })
        }
        None | Some("shape") => {
            return Ok(Scope::Clip {
                item: id.to_string(),
                rect,
                radius: 0.0,
            })
        }
        Some("alpha") => false,
        Some("luminance") => true,
        Some(_) => return refuse("bad_doc", format!("{path}/mode")),
    };
    // Alpha and luminance take coverage from the mask's own paint.
    let Some(fill) = p
        .get("paint")
        .and_then(|pt| pt.get("fill"))
        .and_then(Value::as_object)
    else {
        return refuse("bad_paint", format!("{path}/paint/fill"));
    };
    Ok(Scope::Mask {
        item: id.to_string(),
        fill: fill_of(palette, fill, &format!("{path}/paint/fill"), rect)?,
        rect,
        luminance,
        feather,
    })
}

/// The scope an ancestor puts its children in: a mask's, a frame's overflow scissor, or a group's
/// opacity (one offscreen pass, which GPUI's per-primitive opacity can't do).
pub(super) fn ancestor_scope(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Option<Scope>, Refused> {
    let p = item.get("params");
    let get = |k: &str| p.and_then(|p| p.get(k));
    Ok(match item.get("kind").and_then(Value::as_str) {
        Some("mask@1") => match get("applies_to").and_then(Value::as_str) {
            None | Some("children") => Some(mask_scope(id, item, items, palette)?),
            Some(_) => None,
        },
        Some("frame@1") if get("overflow").and_then(Value::as_str) != Some("show") => {
            Some(Scope::Clip {
                item: id.to_string(),
                rect: Place::of(item).rect(frame_box(id, item)?),
                radius: num(get("radius")).unwrap_or(0.0).max(0.0),
            })
        }
        Some("group@1") => {
            let alpha = num(get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0);
            let blend = Blend::read(id, get("blend"))?;
            let effect = Effect::read(id, p, blend, items)?;
            let isolated =
                get("isolate") == Some(&Value::Bool(true)) || blend.is_some() || effect.is_some();
            (alpha < 1.0 || isolated).then(|| Scope::Opacity {
                item: id.to_string(),
                alpha,
                blend,
                effect: effect.map(Arc::new),
            })
        }
        _ => None,
    })
}

/// Whether `id` is `root` or has it among its ancestors.
pub(super) fn is_under(items: &Map<String, Value>, id: &str, root: &str) -> bool {
    let mut at = Some(id);
    for _ in 0..=items.len() {
        match at {
            Some(a) if a == root => return true,
            Some(a) => {
                at = items
                    .get(a)
                    .and_then(|i| i.get("parent"))
                    .and_then(Value::as_str)
            }
            None => return false,
        }
    }
    false
}

/// Each item's scopes, outermost first: its ancestors' (a mask's children are the items whose
/// `parent` it is, at any depth), then the masks whose collection holds it. A mask never reaches
/// another writer's items, and a fifth mask over one item is refused, naming that mask.
pub(super) fn scopes_of(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    mattes: &BTreeMap<String, Arc<Vec<Drawn>>>,
    planted: Planted,
) -> Result<BTreeMap<String, Vec<Scope>>, Refused> {
    // #504: a parent that names an assembly ends the chain of item scopes; the motion module
    // composes the assembly's transform.
    let assembly = |id: &str| doc.get("assemblies").and_then(|a| a.get(id)).is_some();
    let parent = |id: &str| {
        items
            .get(id)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .filter(|p| !assembly(p))
            .map(str::to_string)
    };
    let shown =
        |id: &str| items.get(id).and_then(|i| i.get("visible")) != Some(&Value::Bool(false));
    let mut collection_masks: Vec<(String, BTreeSet<String>)> = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("mask@1") || !shown(id) {
            continue;
        }
        // Every mask is held to what this build draws, whether or not anything is under it.
        mask_scope(id, item, items, palette)?;
        let applies = item.get("params").and_then(|p| p.get("applies_to"));
        let collection = match applies {
            None => continue,
            Some(Value::String(c)) if c == "children" => continue,
            Some(Value::String(c)) => c,
            Some(_) => return refuse("bad_doc", format!("items/{id}/params/applies_to")),
        };
        let Some(Value::Array(m)) = doc
            .get("collections")
            .and_then(|c| c.get(collection))
            .and_then(|c| c.get("members"))
        else {
            return refuse("ref_unresolved", format!("items/{id}/params/applies_to"));
        };
        let members = m
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        collection_masks.push((id.clone(), members));
    }
    // Each matte with what it applies to: an item and everything under it, or a collection.
    let mut matte_of: Vec<(&str, Scope, Option<BTreeSet<String>>, &str)> = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("matte@1") || !shown(id) {
            continue;
        }
        let p = object_or_empty(item.get("params"));
        let mode = MatteMode::read(id, p.get("mode"))?;
        let encoded = match p.get("luma").and_then(Value::as_str) {
            None | Some("linear") => false,
            Some("encoded") => true,
            Some(_) => return refuse("bad_doc", format!("items/{id}/params/luma")),
        };
        if p.get("resolution")
            .and_then(Value::as_str)
            .is_some_and(|r| r != "full")
        {
            return refuse("module_missing", format!("items/{id}/params/resolution"));
        }
        let Some(Value::String(target)) = p.get("applies_to") else {
            return refuse("bad_doc", format!("items/{id}/params/applies_to"));
        };
        let members = match items.get(target) {
            Some(_) => None,
            None => {
                let Some(Value::Array(m)) = doc
                    .get("collections")
                    .and_then(|c| c.get(target))
                    .and_then(|c| c.get("members"))
                else {
                    return refuse("ref_unresolved", format!("items/{id}/params/applies_to"));
                };
                Some(
                    m.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect(),
                )
            }
        };
        let source = mattes.get(id).cloned().unwrap_or_default();
        matte_of.push((
            id,
            Scope::Matte {
                item: id.clone(),
                source,
                mode,
                encoded,
            },
            members,
            target,
        ));
    }
    // #2031: each lit group's light at t; a refused one names what the check names.
    if let Some(p) = crate::light::problems(items).into_iter().next() {
        return refuse(p.code, p.path);
    }
    let mut lit = BTreeMap::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("group@1") {
            continue;
        }
        if let Some(light) = crate::light::read(id, item, palette, planted)? {
            lit.insert(id.as_str(), Arc::new(light));
        }
    }
    // A lit group and every group around it that isolates draws its children as one unit, as a
    // blended group does, so a lit run never splits the opacity it sits in.
    let mut around_lit = BTreeSet::new();
    for id in lit.keys() {
        let mut at = Some(id.to_string());
        while let Some(a) = at {
            if !around_lit.insert(a.clone()) {
                break;
            }
            at = parent(&a);
        }
    }
    let status_bound = crate::light::status_bound(doc);
    let mut out = BTreeMap::new();
    for (id, item) in items {
        // The ancestors, innermost first, bounded so a cycle the check refuses can't spin.
        let mut chain = Vec::new();
        let mut at = parent(id);
        while let Some(p) = at {
            if chain.len() > items.len() || &p == id {
                break;
            }
            at = parent(&p);
            chain.push(p);
        }
        let mut scopes = Vec::new();
        let mut masks: Vec<&str> = Vec::new();
        // #2031: the light of the lit group above the item, if the item takes it.
        let mut light = None;
        // (ancestor, true) for a parent's scope; (mask, false) for a collection's mask.
        let ancestors = chain.iter().rev().map(|a| (a.as_str(), true));
        let collected = collection_masks
            .iter()
            .filter(|(_, members)| members.contains(id))
            .map(|(m, _)| (m.as_str(), false));
        for (a, by_parent) in ancestors.chain(collected) {
            let Some(ancestor) = items.get(a) else {
                return refuse("ref_unresolved", format!("items/{id}/parent"));
            };
            if !shown(a) && ancestor.get("kind").and_then(Value::as_str) == Some("mask@1") {
                continue;
            }
            let scope = if by_parent {
                ancestor_scope(a, ancestor, items, palette)?
            } else {
                Some(mask_scope(a, ancestor, items, palette)?)
            };
            // #2031: a lit group's lit children draw inside its light, innermost, so each child
            // is lit before it composites as an unlit group's child does; an unlit or status one
            // draws outside it.
            if let Some(l) = lit.get(a).filter(|_| by_parent) {
                if crate::light::is_lit(items, id, a, &status_bound, planted) {
                    light = Some(crate::light::scope(a, l));
                }
            }
            let Some(mut scope) = scope else { continue };
            if let Scope::Opacity {
                blend: b @ None, ..
            } = &mut scope
            {
                if by_parent && around_lit.contains(a) {
                    *b = Some(Blend::Normal);
                }
            }
            if ancestor.get("kind").and_then(Value::as_str) == Some("mask@1") {
                if ancestor.get("layer") != item.get("layer") {
                    return refuse("mask_writer", format!("items/{a}: {id}"));
                }
                masks.push(a);
                if masks.len() > MASK_DEPTH {
                    return refuse("mask_depth", format!("items/{a}"));
                }
            }
            scopes.push(scope);
        }
        for (_, scope, members, target) in &matte_of {
            let under = match members {
                Some(m) => m.contains(id),
                None => id == target || chain.iter().any(|a| a == target),
            };
            if under {
                scopes.push(scope.clone());
            }
        }
        scopes.extend(light);
        out.insert(id.clone(), scopes);
    }
    Ok(out)
}
