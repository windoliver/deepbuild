//! sandbox@1's conformance kit (Canvas module: interface and implementation): the interface's own
//! fixtures, each with the reference implementation's results as its expected values, which every
//! implementation of sandbox@1 must give bit for bit on every host. The issue's values (the
//! canonical NaNs, the tenth fill, each trap's kind) are the fixtures' answers set outside the
//! implementation; the hashes, functions and offsets are the reference's, blessed with them.

/// The kit: `{interface, fixtures: [{fixture, program, role, pad_to?, budget?, read?, expect}]}`.
pub const KIT: &str = include_str!("../kit/kit.json");

/// The kit's programs, as WebAssembly text.
pub const PROGRAMS: &[(&str, &str)] = &[
    ("fuel_fill.wat", include_str!("../kit/fuel_fill.wat")),
    ("fuel_loop.wat", include_str!("../kit/fuel_loop.wat")),
    ("nan_f32.wat", include_str!("../kit/nan_f32.wat")),
    ("nan_f64.wat", include_str!("../kit/nan_f64.wat")),
    ("pass_subset.wat", include_str!("../kit/pass_subset.wat")),
    (
        "pass_table_call.wat",
        include_str!("../kit/pass_table_call.wat"),
    ),
    (
        "refuse_atomic.wat",
        include_str!("../kit/refuse_atomic.wat"),
    ),
    (
        "refuse_data_drop.wat",
        include_str!("../kit/refuse_data_drop.wat"),
    ),
    (
        "refuse_exceptions.wat",
        include_str!("../kit/refuse_exceptions.wat"),
    ),
    (
        "refuse_extended_const.wat",
        include_str!("../kit/refuse_extended_const.wat"),
    ),
    ("refuse_gc.wat", include_str!("../kit/refuse_gc.wat")),
    (
        "refuse_import.wat",
        include_str!("../kit/refuse_import.wat"),
    ),
    (
        "refuse_memory64.wat",
        include_str!("../kit/refuse_memory64.wat"),
    ),
    (
        "refuse_memory_grows.wat",
        include_str!("../kit/refuse_memory_grows.wat"),
    ),
    (
        "refuse_multi_memory.wat",
        include_str!("../kit/refuse_multi_memory.wat"),
    ),
    (
        "refuse_mutable_funcref_global.wat",
        include_str!("../kit/refuse_mutable_funcref_global.wat"),
    ),
    (
        "refuse_table_65537.wat",
        include_str!("../kit/refuse_table_65537.wat"),
    ),
    (
        "refuse_table_set.wat",
        include_str!("../kit/refuse_table_set.wat"),
    ),
    (
        "refuse_tail_call.wat",
        include_str!("../kit/refuse_tail_call.wat"),
    ),
    (
        "refuse_vector.wat",
        include_str!("../kit/refuse_vector.wat"),
    ),
    ("stack_large.wat", include_str!("../kit/stack_large.wat")),
    ("stack_small.wat", include_str!("../kit/stack_small.wat")),
    ("trap_bounds.wat", include_str!("../kit/trap_bounds.wat")),
    ("trap_call.wat", include_str!("../kit/trap_call.wat")),
    (
        "trap_conversion.wat",
        include_str!("../kit/trap_conversion.wat"),
    ),
    ("trap_divide.wat", include_str!("../kit/trap_divide.wat")),
    ("trap_grow.wat", include_str!("../kit/trap_grow.wat")),
    (
        "trap_overflow.wat",
        include_str!("../kit/trap_overflow.wat"),
    ),
    (
        "trap_unreachable.wat",
        include_str!("../kit/trap_unreachable.wat"),
    ),
];
