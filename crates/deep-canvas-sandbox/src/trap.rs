//! The trap kinds (canvas primitives: Logic: sandbox), closed. The rewrite raises fuel, stack and
//! grow itself; the engine raises the rest, which each implementation maps to a kind.

/// Every kind a program's run can stop with. The last five are the logic module's.
pub const KINDS: [&str; 14] = [
    "fuel",
    "stack",
    "grow",
    "unreachable",
    "divide",
    "overflow",
    "conversion",
    "bounds",
    "call",
    "occurrences",
    "pages",
    "pages_full",
    "block_write",
    "services",
];

/// The kind of a trap the rewrite raised, from the code it left in `sandbox.trap`.
pub fn raised(code: i32) -> Option<&'static str> {
    match code {
        crate::rewrite::TRAP_FUEL => Some("fuel"),
        crate::rewrite::TRAP_STACK => Some("stack"),
        crate::rewrite::TRAP_GROW => Some("grow"),
        _ => None,
    }
}

/// Where a run stopped: the kind, and the function and byte offset in the rewritten program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trap {
    pub kind: String,
    pub function: u32,
    pub offset: u32,
}
