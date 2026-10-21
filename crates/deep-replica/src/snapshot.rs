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
            // An unnamed or unvalued node says so with `null`; a missing key is missing evidence.
            name: match value.get("name").ok_or("a node without a name key")? {
                Value::Null => None,
                Value::String(name) => Some(name.clone()),
                other => return Err(format!("a node whose name is not text: {other}")),
            },
            value: match value.get("value").ok_or("a node without a value key")? {
                Value::Null => None,
                other => Some(other.clone()),
            },
            bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
            // A leaf says so with `[]`; a missing list is missing evidence, not a leaf.
            children: value["children"]
                .as_array()
                .ok_or("a node without a children list")?
                .iter()
                .map(Node::from_json)
                .collect::<Result<_, _>>()?,
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
            // No items drawn is `[]`; a missing list, an item without an id or one without a
            // value is missing evidence.
            items: value["items"]
                .as_array()
                .ok_or("a snapshot without an items list")?
                .iter()
                .map(|item| {
                    let id = item["id"].as_str().ok_or("a canvas item without an id")?;
                    let value = item
                        .get("value")
                        .filter(|value| !value.is_null())
                        .ok_or("a canvas item without a value")?;
                    Ok((id.to_owned(), value.clone()))
                })
                .collect::<Result<_, &str>>()?,
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
/// node for node on role, name, value, bounds and children, so a node moved under another parent
/// is a difference even when the pre-order list of nodes is the same, and their canvas items are
/// equal too. Equal trees with different items differ at the index one past the last node. Two
/// snapshots of different windows, by size or scale, differ at node 0, the window.
pub fn first_difference(a: &Snapshot, b: &Snapshot) -> Option<(usize, String)> {
    if (a.size, a.scale) != (b.size, b.scale) {
        return Some((
            0,
            format!(
                "the window differs: {:?} at {}x vs {:?} at {}x",
                a.size, a.scale, b.size, b.scale
            ),
        ));
    }
    let mut index = 0;
    differ(&a.tree, &b.tree, &mut index).err().or_else(|| {
        (a.items != b.items).then(|| {
            (
                index,
                format!("the canvas items differ: {:?} vs {:?}", a.items, b.items),
            )
        })
    })
}

fn differ(x: &Node, y: &Node, index: &mut usize) -> Result<(), (usize, String)> {
    let at = *index;
    *index += 1;
    for (field, same) in [
        ("role", x.role == y.role),
        ("name", x.name == y.name),
        ("value", x.value == y.value),
        ("bounds", x.bounds == y.bounds),
    ] {
        if !same {
            return Err((
                at,
                format!(
                    "node {at} ({} {:?}) differs in {field}: {} vs {}",
                    x.role,
                    x.name,
                    describe(x, field),
                    describe(y, field)
                ),
            ));
        }
    }
    if x.children.len() != y.children.len() {
        return Err((
            at,
            format!(
                "node {at} ({} {:?}) has {} children in the first tree and {} in the second",
                x.role,
                x.name,
                x.children.len(),
                y.children.len()
            ),
        ));
    }
    for (child_x, child_y) in x.children.iter().zip(&y.children) {
        differ(child_x, child_y, index)?;
    }
    Ok(())
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
        let (index, why) = first_difference(&a, &shorter).unwrap();
        assert_eq!(index, 0);
        assert!(why.contains("2 children in the first tree and 1"), "{why}");
    }

    /// Each field the comparison reads, changed alone on one node, is found at that node and named;
    /// changed canvas items are found after the last node. A comparison that skipped any of them
    /// would pass the changed snapshot.
    #[test]
    fn each_compared_field_changed_alone_is_found() {
        let a = snapshot(vec![
            leaf("label", "x", [0, 0, 10, 10]),
            leaf("button", "y", [0, 20, 10, 10]),
        ]);
        type Change = (&'static str, fn(&mut Node));
        let changes: [Change; 4] = [
            ("role", |node| node.role = "label".into()),
            ("name", |node| node.name = Some("z".into())),
            ("value", |node| node.value = Some(json!("on"))),
            ("bounds", |node| node.bounds[3] = 11),
        ];
        for (field, change) in changes {
            let mut b = a.clone();
            change(&mut b.tree.children[1]);
            let (index, why) =
                first_difference(&a, &b).unwrap_or_else(|| panic!("a changed {field} went unseen"));
            assert_eq!(index, 2, "{field}");
            assert!(why.contains(&format!("differs in {field}")), "{why}");
        }
        let mut b = a.clone();
        b.items.push(("line".into(), json!([1, 2])));
        let (index, why) = first_difference(&a, &b).expect("changed items went unseen");
        assert_eq!(index, 3);
        assert!(why.contains("canvas items"), "{why}");
        for change in [
            |s: &mut Snapshot| s.size[0] = 1511,
            |s: &mut Snapshot| s.scale = 1,
        ] {
            let mut b = a.clone();
            change(&mut b);
            let (index, why) = first_difference(&a, &b).expect("a changed window went unseen");
            assert_eq!(index, 0);
            assert!(why.contains("the window differs"), "{why}");
        }
    }

    #[test]
    fn a_node_moved_under_another_parent_differs_though_the_preorder_is_the_same() {
        let flat = snapshot(vec![
            leaf("button", "x", [0, 0, 10, 10]),
            leaf("label", "y", [0, 20, 10, 10]),
        ]);
        let mut nested = snapshot(vec![leaf("button", "x", [0, 0, 10, 10])]);
        nested.tree.children[0]
            .children
            .push(leaf("label", "y", [0, 20, 10, 10]));
        assert_eq!(flat.flatten().len(), nested.flatten().len());
        assert_eq!(
            flat.flatten()
                .iter()
                .map(|node| &node.name)
                .collect::<Vec<_>>(),
            nested
                .flatten()
                .iter()
                .map(|node| &node.name)
                .collect::<Vec<_>>()
        );
        let (index, why) = first_difference(&flat, &nested).unwrap();
        assert_eq!(index, 0);
        assert!(why.contains("children"), "{why}");
    }

    /// A snapshot missing a node's children, name or value key, its items, or an item's id or
    /// value does not read as an empty or unnamed one, and a name that is not text is refused.
    #[test]
    fn missing_lists_and_item_fields_are_refused() {
        let mut with_item = snapshot(vec![leaf("label", "x", [0, 0, 10, 10])]);
        with_item.items.push(("line".into(), json!([1, 2])));
        let whole = with_item.to_json();
        assert_eq!(Snapshot::from_json(&whole).unwrap(), with_item);
        type Removal = (&'static str, fn(&mut Value));
        let removals: [Removal; 8] = [
            ("without a name key", |json| {
                json["tree"].as_object_mut().unwrap().remove("name");
            }),
            ("without a value key", |json| {
                json["tree"]["children"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("value");
            }),
            ("name is not text", |json| {
                json["tree"]["children"][0]["name"] = json!(7)
            }),
            ("children list", |json| {
                json["tree"]["children"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("children");
            }),
            ("children list", |json| {
                json["tree"]["children"] = json!(null)
            }),
            ("items list", |json| {
                json.as_object_mut().unwrap().remove("items");
            }),
            ("without an id", |json| {
                json["items"][0].as_object_mut().unwrap().remove("id");
            }),
            ("without a value", |json| {
                json["items"][0].as_object_mut().unwrap().remove("value");
            }),
        ];
        for (why, remove) in removals {
            let mut json = whole.clone();
            remove(&mut json);
            let error = Snapshot::from_json(&json).expect_err(why);
            assert!(error.contains(why), "{why}: {error}");
        }
    }

    #[test]
    fn json_round_trips_and_roles_are_snake_case() {
        let a = snapshot(vec![leaf("list_item", "x", [0, 0, 10, 10])]);
        assert_eq!(Snapshot::from_json(&a.to_json()).unwrap(), a);
        assert_eq!(snake_case("ListBoxOption"), "list_box_option");
        assert_eq!(role_name(Role::Window), "window");
    }
}
