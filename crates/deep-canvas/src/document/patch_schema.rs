//! The patch schema (canvas primitives: Patch; #1972): a patch's envelope fields and each op's
//! fields, with what each takes, and one example of each op on the gallery's product reveal. The
//! apply checks every patch against this table, and `deep_kinds` prints the patches guide and
//! `op: field` for `patch` and `patch.<op>` from it, so what an agent reads is what the apply
//! takes.

/// A field of the envelope or of an op.
#[derive(Clone, Copy, Debug)]
pub struct Field {
    pub name: &'static str,
    /// Whether a patch or an op may leave it out.
    pub optional: bool,
    /// What it takes, in a phrase.
    pub takes: &'static str,
}

/// An op: what it does, its fields (`op` first) and one example.
#[derive(Clone, Copy, Debug)]
pub struct Op {
    pub name: &'static str,
    pub does: &'static str,
    pub fields: &'static [Field],
    /// The example's ops, as JSON text: a patch of them applies to the gallery's product reveal,
    /// unless `does` names what more it needs.
    pub example: &'static str,
}

const fn required(name: &'static str, takes: &'static str) -> Field {
    Field {
        name,
        optional: false,
        takes,
    }
}

const fn optional(name: &'static str, takes: &'static str) -> Field {
    Field {
        name,
        optional: true,
        takes,
    }
}

/// The envelope's fields, in the order a patch is written.
pub const ENVELOPE: &[Field] = &[
    required("patch", "a ULID naming this patch, new for each patch"),
    required("doc", "the document's ID, as the hub minted it"),
    required("base", "the revision the patch was made on, a whole number"),
    required("reason", "why, in a sentence"),
    required("ops", "the ops, in order, applied all or nothing"),
    optional(
        "coalesce_key",
        "a string: of the waiting patches with one key, only the latest applies",
    ),
    optional(
        "dry_run",
        "true to get back the outcome, achieved counts, issues and cost change, with nothing committed",
    ),
];

const OP: Field = required("op", "the op's name");
const ID: Field = required("id", "the item's ID");

/// Every op a patch may hold, in the order the guide gives them.
pub const OPS: &[Op] = &[
    Op {
        name: "create",
        does: "adds an item, in your layer",
        fields: &[
            OP,
            required(
                "item",
                "the whole item: its id, kind, name, order and params, and its parent and at as it needs them",
            ),
        ],
        example: r#"[{"op": "create", "item": {"id": "price", "kind": "text@1", "name": "Price", "order": "a5", "params": {"font": "body", "size": 15, "box": {"w": 240, "h": 22}, "text": "Warm white, dimmable"}, "at": {"pos": [380, 214, 0]}}}]"#,
    },
    Op {
        name: "set",
        does: "sets one field of an item",
        fields: &[
            OP,
            ID,
            required(
                "path",
                "items/<id>/ and then params/<param>[/<key or index>…], at/<pos|rot|scale|pivot>[/<0, 1 or 2>], at/shear, or one of the item's own fields such as name, order or parent",
            ),
            required("value", "the new value, of the field's type"),
        ],
        example: r#"[{"op": "set", "id": "name", "path": "items/name/at/pos", "value": [380, 120, 0]}]"#,
    },
    Op {
        name: "unset",
        does: "removes one field of an item, so its default holds",
        fields: &[
            OP,
            ID,
            required(
                "path",
                "items/<id>/ and then params/<param>[/<key>…], at/<pos|rot|scale|pivot|shear>, or an optional field of the item",
            ),
        ],
        example: r#"[{"op": "unset", "id": "product", "path": "items/product/params/radius"}]"#,
    },
    Op {
        name: "delete",
        does: "removes an item",
        fields: &[
            OP,
            ID,
            optional(
                "cascade",
                "true to remove its descendants too; left out, the item goes alone",
            ),
        ],
        example: r#"[{"op": "delete", "id": "line"}]"#,
    },
    Op {
        name: "move",
        does: "puts an item under another parent",
        fields: &[
            OP,
            ID,
            required("parent", "the new parent's ID, or null for none"),
            optional(
                "keep",
                "world, the default, keeps the item where it is in the world; local keeps its at as written",
            ),
        ],
        example: r#"[{"op": "create", "item": {"id": "hero", "kind": "group@1", "name": "Hero", "order": "a5", "params": {}}}, {"op": "move", "id": "product", "parent": "hero"}]"#,
    },
    Op {
        name: "reorder",
        does: "moves an item among its siblings, its order key falling next to one of them",
        fields: &[
            OP,
            ID,
            optional("after", "the sibling it goes just after; give after or before"),
            optional("before", "the sibling it goes just before; give after or before"),
        ],
        example: r#"[{"op": "reorder", "id": "line", "before": "name"}]"#,
    },
    Op {
        name: "rows",
        does: "edits a mark set's rows in place, by its key column",
        fields: &[
            OP,
            required("id", "the mark set's ID, a marks@1 item"),
            optional(
                "append",
                "rows to add, each giving every data column a value; give one of append, set and remove",
            ),
            optional(
                "set",
                "rows to change, each naming its row by the key column and giving the columns it changes",
            ),
            optional("remove", "the keys of the rows to remove"),
        ],
        example: r#"[{"op": "create", "item": {"id": "dots", "kind": "marks@1", "name": "Dots", "order": "a6", "params": {"mark": "point", "n": 1, "key": "key", "columns": {"key": {"dtype": "str", "len": 1, "data": ["a"]}, "x": {"dtype": "f32", "len": 1, "data": "AADwQw=="}, "y": {"dtype": "f32", "len": 1, "data": "AACWQw=="}}, "encode": {"x": {"column": "x"}, "y": {"column": "y"}}}}}, {"op": "rows", "id": "dots", "append": [{"key": "b", "x": 520, "y": 300}]}]"#,
    },
    Op {
        name: "break_out",
        does: "takes an item a recipe instance derived and makes it your own, with its ID and the values it was expanded with; it needs a recipe instance from a pack the document names, which the product reveal has none of, so its example is on a chart board whose pack's recipe derives c1's bars",
        fields: &[
            OP,
            required("instance", "the recipe instance's ID"),
            required("item", "the derived item's ID"),
        ],
        example: r#"[{"op": "break_out", "instance": "c1", "item": "c1.bars.2"}]"#,
    },
];

/// The op named `name`.
pub fn op(name: &str) -> Option<&'static Op> {
    OPS.iter().find(|o| o.name == name)
}

/// The fields' names, joined by `, `.
pub fn names(fields: &[Field]) -> String {
    fields.iter().map(|f| f.name).collect::<Vec<_>>().join(", ")
}
