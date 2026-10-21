//! The text snapshot: a tree of accessibility roles, names, values and bounds in whole device
//! pixels, plus the canvas items drawn. The replica builds it from the elements the views
//! observe; the live capture builds the same shape from the real window's accessibility tree, so
//! the two compare node for node.

use gpui_kit::{base::test_support::snapshots, ElementId, Pixels, Role, Window};
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub role: String,
    pub name: Option<String>,
    pub value: Option<Value>,
    /// `[x, y, width, height]` in device pixels, inside the window.
    pub bounds: [i64; 4],
    pub children: Vec<Node>,
}

impl Node {
    pub fn to_json(&self) -> Value {
        json!({
            "role": self.role,
            "name": self.name,
            "value": self.value,
            "bounds": self.bounds,
            "children": self.children.iter().map(Node::to_json).collect::<Vec<_>>(),
        })
    }

    pub fn from_json(value: &Value) -> Result<Self, String> {
        let bounds = value["bounds"]
            .as_array()
            .filter(|bounds| bounds.len() == 4)
            .ok_or("a node without [x, y, w, h] bounds")?
            .iter()
            .map(|side| side.as_i64().ok_or("a fractional bound"))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            role: value["role"]
                .as_str()
                .ok_or("a node without a role")?
                .to_owned(),
            name: value["name"].as_str().map(str::to_owned),
            value: match &value["value"] {
                Value::Null => None,
                other => Some(other.clone()),
            },
            bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
            children: value["children"]
                .as_array()
                .map(|children| children.iter().map(Node::from_json).collect())
                .unwrap_or(Ok(Vec::new()))?,
        })
    }

    fn flatten<'a>(&'a self, into: &mut Vec<&'a Node>) {
        into.push(self);
        for child in &self.children {
            child.flatten(into);
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    /// The window's size in points and its scale.
    pub size: [u32; 2],
    pub scale: u32,
    pub tree: Node,
    pub items: Vec<(String, Value)>,
}

impl Snapshot {
    pub fn to_json(&self) -> Value {
        json!({
            "window": { "size": self.size, "scale": self.scale },
            "tree": self.tree.to_json(),
            "items": self.items.iter().map(|(id, value)| json!({ "id": id, "value": value })).collect::<Vec<_>>(),
        })
    }

    pub fn from_json(value: &Value) -> Result<Self, String> {
        let size = value["window"]["size"]
            .as_array()
            .filter(|size| size.len() == 2)
            .ok_or("a snapshot without window.size")?;
        Ok(Self {
            size: [
                size[0].as_u64().ok_or("a window width")? as u32,
                size[1].as_u64().ok_or("a window height")? as u32,
            ],
            scale: value["window"]["scale"]
                .as_u64()
                .ok_or("a snapshot without window.scale")? as u32,
            tree: Node::from_json(&value["tree"])?,
            items: value["items"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|item| {
                            (
                                item["id"].as_str().unwrap_or_default().to_owned(),
                                item["value"].clone(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    pub fn read(path: &std::path::Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        let value: Value =
            serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
        Self::from_json(&value).map_err(|error| format!("{}: {error}", path.display()))
    }

    /// The nodes in pre-order.
    pub fn flatten(&self) -> Vec<&Node> {
        let mut nodes = Vec::new();
        self.tree.flatten(&mut nodes);
        nodes
    }
}

/// The first node, in pre-order, where two snapshots differ, with why; `None` when they are equal
/// node for node on role, name, value and bounds.
pub fn first_difference(a: &Snapshot, b: &Snapshot) -> Option<(usize, String)> {
    let left = a.flatten();
    let right = b.flatten();
    for index in 0..left.len().max(right.len()) {
        let (Some(x), Some(y)) = (left.get(index), right.get(index)) else {
            return Some((
                index,
                format!(
                    "{} tree ends at node {index}",
                    if left.len() <= index {
                        "the first"
                    } else {
                        "the second"
                    }
                ),
            ));
        };
        for (field, same) in [
            ("role", x.role == y.role),
            ("name", x.name == y.name),
            ("value", x.value == y.value),
            ("bounds", x.bounds == y.bounds),
        ] {
            if !same {
                return Some((
                    index,
                    format!(
                        "node {index} ({} {:?}) differs in {field}: {} vs {}",
                        x.role,
                        x.name,
                        describe(x, field),
                        describe(y, field)
                    ),
                ));
            }
        }
    }
    None
}

fn describe(node: &Node, field: &str) -> String {
    match field {
        "role" => node.role.clone(),
        "name" => format!("{:?}", node.name),
        "value" => format!("{:?}", node.value),
        _ => format!("{:?}", node.bounds),
    }
}

/// `ListBoxOption` → `list_box_option`, as gpui-shell spells roles for scripts.
pub fn snake_case(variant: &str) -> String {
    let mut out = String::with_capacity(variant.len() + 4);
    for (index, character) in variant.char_indices() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

pub fn role_name(role: Role) -> String {
    snake_case(&format!("{role:?}"))
}

/// The replica's snapshot of a drawn window: every observed element with an accessibility role,
/// in the order the frame drew them (which is the element tree's order, the order the
/// accessibility tree lists them in too), nested by its element path under the nearest such
/// ancestor, under one `window` root. Bounds are the layout bounds at the window's scale, rounded
/// to whole device pixels.
pub fn from_observed(window: &Window) -> Snapshot {
    let scale = window.scale_factor();
    let viewport = window.viewport_size();
    let device = |value: Pixels| (f32::from(value) * scale).round() as i64;
    let observed: Vec<(Vec<ElementId>, Node)> = snapshots(window)
        .into_iter()
        .filter(|element| element.visible())
        .filter_map(|element| {
            let role = element.role()?;
            let bounds = element.bounds();
            Some((
                element.path().to_vec(),
                Node {
                    role: role_name(role),
                    name: element.label().map(str::to_owned),
                    value: element.value().map(|value| json!(value)),
                    bounds: [
                        device(bounds.origin.x),
                        device(bounds.origin.y),
                        device(bounds.size.width),
                        device(bounds.size.height),
                    ],
                    children: Vec::new(),
                },
            ))
        })
        .collect();
    // Each node's parent is the longest other path that is a strict prefix of its own.
    let parents: Vec<Option<usize>> = (0..observed.len())
        .map(|index| {
            let path = &observed[index].0;
            (0..observed.len())
                .filter(|&other| {
                    let candidate = &observed[other].0;
                    other != index && candidate.len() < path.len() && path.starts_with(candidate)
                })
                .max_by_key(|&other| observed[other].0.len())
        })
        .collect();
    let mut root = Node {
        role: role_name(Role::Window),
        name: None,
        value: None,
        bounds: [0, 0, device(viewport.width), device(viewport.height)],
        children: Vec::new(),
    };
    root.children = children_of(None, &observed, &parents);
    Snapshot {
        size: [
            f32::from(viewport.width).round() as u32,
            f32::from(viewport.height).round() as u32,
        ],
        scale: scale.round() as u32,
        tree: root,
        items: deep_app::canvas::items(),
    }
}

/// The nodes under `parent`, in the order the accessibility tree lists them. Observed elements
/// carry no draw order, so it is rebuilt from the layout: siblings that share an element parent
/// (the same path but for their own id) form a group the view drew together; groups go in the
/// order of their top-left corners, top to bottom then left to right, which is how the dock lays
/// out its regions; within a group, rows go the same way, and two at one corner go by their
/// element path, so the order is a function of the frame alone. This is a reading of the
/// layout, not the draw order itself: a view that draws a lower row before a higher one, or
/// a right column before a left one, would be ordered differently here than the accessibility
/// tree lists it. The live capture is the proof it matches for the shipped views.
fn children_of(
    parent: Option<usize>,
    observed: &[(Vec<ElementId>, Node)],
    parents: &[Option<usize>],
) -> Vec<Node> {
    let indices: Vec<usize> = (0..observed.len())
        .filter(|&index| parents[index] == parent)
        .collect();
    let group = |index: usize| {
        let path = &observed[index].0;
        &path[..path.len().saturating_sub(1)]
    };
    let corner = |index: usize| (observed[index].1.bounds[1], observed[index].1.bounds[0]);
    let group_corner = |index: usize| {
        indices
            .iter()
            .filter(|&&other| group(other) == group(index))
            .map(|&other| corner(other))
            .min()
            .expect("the group holds its own member")
    };
    let keys = indices
        .iter()
        .map(|&index| {
            (
                group_corner(index),
                corner(index),
                format!("{:?}", observed[index].0),
            )
        })
        .collect::<Vec<_>>();
    let mut order: Vec<usize> = (0..indices.len()).collect();
    order.sort_by(|&a, &b| keys[a].cmp(&keys[b]));
    order
        .into_iter()
        .map(|at| indices[at])
        .map(|index| {
            let mut node = observed[index].1.clone();
            node.children = children_of(Some(index), observed, parents);
            node
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(role: &str, name: &str, bounds: [i64; 4]) -> Node {
        Node {
            role: role.into(),
            name: Some(name.into()),
            value: None,
            bounds,
            children: Vec::new(),
        }
    }

    fn snapshot(children: Vec<Node>) -> Snapshot {
        Snapshot {
            size: [1512, 982],
            scale: 2,
            tree: Node {
                role: "window".into(),
                name: None,
                value: None,
                bounds: [0, 0, 3024, 1964],
                children,
            },
            items: Vec::new(),
        }
    }

    #[test]
    fn equal_trees_have_no_first_difference_and_a_moved_node_is_found() {
        let a = snapshot(vec![
            leaf("label", "x", [0, 0, 10, 10]),
            leaf("button", "y", [0, 20, 10, 10]),
        ]);
        let mut b = a.clone();
        assert_eq!(first_difference(&a, &b), None);
        b.tree.children[1].bounds[0] = 1;
        let (index, why) = first_difference(&a, &b).unwrap();
        assert_eq!(index, 2);
        assert!(why.contains("bounds"), "{why}");
        let shorter = snapshot(vec![leaf("label", "x", [0, 0, 10, 10])]);
        assert_eq!(first_difference(&a, &shorter).unwrap().0, 2);
    }

    #[test]
    fn json_round_trips_and_roles_are_snake_case() {
        let a = snapshot(vec![leaf("list_item", "x", [0, 0, 10, 10])]);
        assert_eq!(Snapshot::from_json(&a.to_json()).unwrap(), a);
        assert_eq!(snake_case("ListBoxOption"), "list_box_option");
        assert_eq!(role_name(Role::Window), "window");
    }
}
