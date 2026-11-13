//! Each WebAssembly operator's proposal and visit name, as the pinned parser lists them: wasmparser
//! 0.258.3's `for_each_operator!`, with the features this crate builds it with (`simd` among them).
//! The table was written out from that list when the pin was set, so it is plain code the canvas
//! lint reads, not a macro's expansion; a parser that adds an operator reaches the last arm, whose
//! `unknown` proposal needs every feature and is refused by name. Bumping the pin means writing
//! the table out again from the new list (one arm per `@proposal Op => visit_name` entry).
//!
//! The operator, proposal and visit names come from wasmparser (the Bytecode Alliance's
//! wasm-tools), licensed Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT.

use wasmparser::Operator;

/// The proposal and the visit name of `op`, from the parser's own list.
pub(crate) fn classify(op: &Operator<'_>) -> (&'static str, &'static str) {
    match op {
        Operator::Unreachable { .. } => ("mvp", "visit_unreachable"),
        Operator::Nop { .. } => ("mvp", "visit_nop"),
        Operator::Block { .. } => ("mvp", "visit_block"),
        Operator::Loop { .. } => ("mvp", "visit_loop"),
        Operator::If { .. } => ("mvp", "visit_if"),
        Operator::Else { .. } => ("mvp", "visit_else"),
        Operator::End { .. } => ("mvp", "visit_end"),
        Operator::Br { .. } => ("mvp", "visit_br"),
        Operator::BrIf { .. } => ("mvp", "visit_br_if"),
        Operator::BrTable { .. } => ("mvp", "visit_br_table"),
        Operator::Return { .. } => ("mvp", "visit_return"),
        Operator::Call { .. } => ("mvp", "visit_call"),
        Operator::CallIndirect { .. } => ("mvp", "visit_call_indirect"),
        Operator::Drop { .. } => ("mvp", "visit_drop"),
        Operator::Select { .. } => ("mvp", "visit_select"),
        Operator::LocalGet { .. } => ("mvp", "visit_local_get"),
        Operator::LocalSet { .. } => ("mvp", "visit_local_set"),
        Operator::LocalTee { .. } => ("mvp", "visit_local_tee"),
        Operator::GlobalGet { .. } => ("mvp", "visit_global_get"),
        Operator::GlobalSet { .. } => ("mvp", "visit_global_set"),
        Operator::I32Load { .. } => ("mvp", "visit_i32_load"),
        Operator::I64Load { .. } => ("mvp", "visit_i64_load"),
        Operator::F32Load { .. } => ("mvp", "visit_f32_load"),
        Operator::F64Load { .. } => ("mvp", "visit_f64_load"),
        Operator::I32Load8S { .. } => ("mvp", "visit_i32_load8_s"),
        Operator::I32Load8U { .. } => ("mvp", "visit_i32_load8_u"),
        Operator::I32Load16S { .. } => ("mvp", "visit_i32_load16_s"),
        Operator::I32Load16U { .. } => ("mvp", "visit_i32_load16_u"),
        Operator::I64Load8S { .. } => ("mvp", "visit_i64_load8_s"),
        Operator::I64Load8U { .. } => ("mvp", "visit_i64_load8_u"),
        Operator::I64Load16S { .. } => ("mvp", "visit_i64_load16_s"),
        Operator::I64Load16U { .. } => ("mvp", "visit_i64_load16_u"),
        Operator::I64Load32S { .. } => ("mvp", "visit_i64_load32_s"),
        Operator::I64Load32U { .. } => ("mvp", "visit_i64_load32_u"),
        Operator::I32Store { .. } => ("mvp", "visit_i32_store"),
        Operator::I64Store { .. } => ("mvp", "visit_i64_store"),
        Operator::F32Store { .. } => ("mvp", "visit_f32_store"),
        Operator::F64Store { .. } => ("mvp", "visit_f64_store"),
        Operator::I32Store8 { .. } => ("mvp", "visit_i32_store8"),
        Operator::I32Store16 { .. } => ("mvp", "visit_i32_store16"),
        Operator::I64Store8 { .. } => ("mvp", "visit_i64_store8"),
        Operator::I64Store16 { .. } => ("mvp", "visit_i64_store16"),
        Operator::I64Store32 { .. } => ("mvp", "visit_i64_store32"),
        Operator::MemorySize { .. } => ("mvp", "visit_memory_size"),
        Operator::MemoryGrow { .. } => ("mvp", "visit_memory_grow"),
        Operator::I32Const { .. } => ("mvp", "visit_i32_const"),
        Operator::I64Const { .. } => ("mvp", "visit_i64_const"),
        Operator::F32Const { .. } => ("mvp", "visit_f32_const"),
        Operator::F64Const { .. } => ("mvp", "visit_f64_const"),
        Operator::I32Eqz { .. } => ("mvp", "visit_i32_eqz"),
        Operator::I32Eq { .. } => ("mvp", "visit_i32_eq"),
        Operator::I32Ne { .. } => ("mvp", "visit_i32_ne"),
        Operator::I32LtS { .. } => ("mvp", "visit_i32_lt_s"),
        Operator::I32LtU { .. } => ("mvp", "visit_i32_lt_u"),
        Operator::I32GtS { .. } => ("mvp", "visit_i32_gt_s"),
        Operator::I32GtU { .. } => ("mvp", "visit_i32_gt_u"),
        Operator::I32LeS { .. } => ("mvp", "visit_i32_le_s"),
        Operator::I32LeU { .. } => ("mvp", "visit_i32_le_u"),
        Operator::I32GeS { .. } => ("mvp", "visit_i32_ge_s"),
        Operator::I32GeU { .. } => ("mvp", "visit_i32_ge_u"),
        Operator::I64Eqz { .. } => ("mvp", "visit_i64_eqz"),
        Operator::I64Eq { .. } => ("mvp", "visit_i64_eq"),
        Operator::I64Ne { .. } => ("mvp", "visit_i64_ne"),
        Operator::I64LtS { .. } => ("mvp", "visit_i64_lt_s"),
        Operator::I64LtU { .. } => ("mvp", "visit_i64_lt_u"),
        Operator::I64GtS { .. } => ("mvp", "visit_i64_gt_s"),
        Operator::I64GtU { .. } => ("mvp", "visit_i64_gt_u"),
        Operator::I64LeS { .. } => ("mvp", "visit_i64_le_s"),
        Operator::I64LeU { .. } => ("mvp", "visit_i64_le_u"),
        Operator::I64GeS { .. } => ("mvp", "visit_i64_ge_s"),
        Operator::I64GeU { .. } => ("mvp", "visit_i64_ge_u"),
        Operator::F32Eq { .. } => ("mvp", "visit_f32_eq"),
        Operator::F32Ne { .. } => ("mvp", "visit_f32_ne"),
        Operator::F32Lt { .. } => ("mvp", "visit_f32_lt"),
        Operator::F32Gt { .. } => ("mvp", "visit_f32_gt"),
        Operator::F32Le { .. } => ("mvp", "visit_f32_le"),
        Operator::F32Ge { .. } => ("mvp", "visit_f32_ge"),
        Operator::F64Eq { .. } => ("mvp", "visit_f64_eq"),
        Operator::F64Ne { .. } => ("mvp", "visit_f64_ne"),
        Operator::F64Lt { .. } => ("mvp", "visit_f64_lt"),
        Operator::F64Gt { .. } => ("mvp", "visit_f64_gt"),
        Operator::F64Le { .. } => ("mvp", "visit_f64_le"),
        Operator::F64Ge { .. } => ("mvp", "visit_f64_ge"),
        Operator::I32Clz { .. } => ("mvp", "visit_i32_clz"),
        Operator::I32Ctz { .. } => ("mvp", "visit_i32_ctz"),
        Operator::I32Popcnt { .. } => ("mvp", "visit_i32_popcnt"),
        Operator::I32Add { .. } => ("mvp", "visit_i32_add"),
        Operator::I32Sub { .. } => ("mvp", "visit_i32_sub"),
        Operator::I32Mul { .. } => ("mvp", "visit_i32_mul"),
        Operator::I32DivS { .. } => ("mvp", "visit_i32_div_s"),
        Operator::I32DivU { .. } => ("mvp", "visit_i32_div_u"),
        Operator::I32RemS { .. } => ("mvp", "visit_i32_rem_s"),
        Operator::I32RemU { .. } => ("mvp", "visit_i32_rem_u"),
        Operator::I32And { .. } => ("mvp", "visit_i32_and"),
        Operator::I32Or { .. } => ("mvp", "visit_i32_or"),
        Operator::I32Xor { .. } => ("mvp", "visit_i32_xor"),
        Operator::I32Shl { .. } => ("mvp", "visit_i32_shl"),
        Operator::I32ShrS { .. } => ("mvp", "visit_i32_shr_s"),
        Operator::I32ShrU { .. } => ("mvp", "visit_i32_shr_u"),
        Operator::I32Rotl { .. } => ("mvp", "visit_i32_rotl"),
        Operator::I32Rotr { .. } => ("mvp", "visit_i32_rotr"),
        Operator::I64Clz { .. } => ("mvp", "visit_i64_clz"),
        Operator::I64Ctz { .. } => ("mvp", "visit_i64_ctz"),
        Operator::I64Popcnt { .. } => ("mvp", "visit_i64_popcnt"),
        Operator::I64Add { .. } => ("mvp", "visit_i64_add"),
        Operator::I64Sub { .. } => ("mvp", "visit_i64_sub"),
        Operator::I64Mul { .. } => ("mvp", "visit_i64_mul"),
        Operator::I64DivS { .. } => ("mvp", "visit_i64_div_s"),
        Operator::I64DivU { .. } => ("mvp", "visit_i64_div_u"),
        Operator::I64RemS { .. } => ("mvp", "visit_i64_rem_s"),
        Operator::I64RemU { .. } => ("mvp", "visit_i64_rem_u"),
        Operator::I64And { .. } => ("mvp", "visit_i64_and"),
        Operator::I64Or { .. } => ("mvp", "visit_i64_or"),
        Operator::I64Xor { .. } => ("mvp", "visit_i64_xor"),
        Operator::I64Shl { .. } => ("mvp", "visit_i64_shl"),
        Operator::I64ShrS { .. } => ("mvp", "visit_i64_shr_s"),
        Operator::I64ShrU { .. } => ("mvp", "visit_i64_shr_u"),
        Operator::I64Rotl { .. } => ("mvp", "visit_i64_rotl"),
        Operator::I64Rotr { .. } => ("mvp", "visit_i64_rotr"),
        Operator::F32Abs { .. } => ("mvp", "visit_f32_abs"),
        Operator::F32Neg { .. } => ("mvp", "visit_f32_neg"),
        Operator::F32Ceil { .. } => ("mvp", "visit_f32_ceil"),
        Operator::F32Floor { .. } => ("mvp", "visit_f32_floor"),
        Operator::F32Trunc { .. } => ("mvp", "visit_f32_trunc"),
        Operator::F32Nearest { .. } => ("mvp", "visit_f32_nearest"),
        Operator::F32Sqrt { .. } => ("mvp", "visit_f32_sqrt"),
        Operator::F32Add { .. } => ("mvp", "visit_f32_add"),
        Operator::F32Sub { .. } => ("mvp", "visit_f32_sub"),
        Operator::F32Mul { .. } => ("mvp", "visit_f32_mul"),
        Operator::F32Div { .. } => ("mvp", "visit_f32_div"),
        Operator::F32Min { .. } => ("mvp", "visit_f32_min"),
        Operator::F32Max { .. } => ("mvp", "visit_f32_max"),
        Operator::F32Copysign { .. } => ("mvp", "visit_f32_copysign"),
        Operator::F64Abs { .. } => ("mvp", "visit_f64_abs"),
        Operator::F64Neg { .. } => ("mvp", "visit_f64_neg"),
        Operator::F64Ceil { .. } => ("mvp", "visit_f64_ceil"),
        Operator::F64Floor { .. } => ("mvp", "visit_f64_floor"),
        Operator::F64Trunc { .. } => ("mvp", "visit_f64_trunc"),
        Operator::F64Nearest { .. } => ("mvp", "visit_f64_nearest"),
        Operator::F64Sqrt { .. } => ("mvp", "visit_f64_sqrt"),
        Operator::F64Add { .. } => ("mvp", "visit_f64_add"),
        Operator::F64Sub { .. } => ("mvp", "visit_f64_sub"),
        Operator::F64Mul { .. } => ("mvp", "visit_f64_mul"),
        Operator::F64Div { .. } => ("mvp", "visit_f64_div"),
        Operator::F64Min { .. } => ("mvp", "visit_f64_min"),
        Operator::F64Max { .. } => ("mvp", "visit_f64_max"),
        Operator::F64Copysign { .. } => ("mvp", "visit_f64_copysign"),
        Operator::I32WrapI64 { .. } => ("mvp", "visit_i32_wrap_i64"),
        Operator::I32TruncF32S { .. } => ("mvp", "visit_i32_trunc_f32_s"),
        Operator::I32TruncF32U { .. } => ("mvp", "visit_i32_trunc_f32_u"),
        Operator::I32TruncF64S { .. } => ("mvp", "visit_i32_trunc_f64_s"),
        Operator::I32TruncF64U { .. } => ("mvp", "visit_i32_trunc_f64_u"),
        Operator::I64ExtendI32S { .. } => ("mvp", "visit_i64_extend_i32_s"),
        Operator::I64ExtendI32U { .. } => ("mvp", "visit_i64_extend_i32_u"),
        Operator::I64TruncF32S { .. } => ("mvp", "visit_i64_trunc_f32_s"),
        Operator::I64TruncF32U { .. } => ("mvp", "visit_i64_trunc_f32_u"),
        Operator::I64TruncF64S { .. } => ("mvp", "visit_i64_trunc_f64_s"),
        Operator::I64TruncF64U { .. } => ("mvp", "visit_i64_trunc_f64_u"),
        Operator::F32ConvertI32S { .. } => ("mvp", "visit_f32_convert_i32_s"),
        Operator::F32ConvertI32U { .. } => ("mvp", "visit_f32_convert_i32_u"),
        Operator::F32ConvertI64S { .. } => ("mvp", "visit_f32_convert_i64_s"),
        Operator::F32ConvertI64U { .. } => ("mvp", "visit_f32_convert_i64_u"),
        Operator::F32DemoteF64 { .. } => ("mvp", "visit_f32_demote_f64"),
        Operator::F64ConvertI32S { .. } => ("mvp", "visit_f64_convert_i32_s"),
        Operator::F64ConvertI32U { .. } => ("mvp", "visit_f64_convert_i32_u"),
        Operator::F64ConvertI64S { .. } => ("mvp", "visit_f64_convert_i64_s"),
        Operator::F64ConvertI64U { .. } => ("mvp", "visit_f64_convert_i64_u"),
        Operator::F64PromoteF32 { .. } => ("mvp", "visit_f64_promote_f32"),
        Operator::I32ReinterpretF32 { .. } => ("mvp", "visit_i32_reinterpret_f32"),
        Operator::I64ReinterpretF64 { .. } => ("mvp", "visit_i64_reinterpret_f64"),
        Operator::F32ReinterpretI32 { .. } => ("mvp", "visit_f32_reinterpret_i32"),
        Operator::F64ReinterpretI64 { .. } => ("mvp", "visit_f64_reinterpret_i64"),
        Operator::I32Extend8S { .. } => ("sign_extension", "visit_i32_extend8_s"),
        Operator::I32Extend16S { .. } => ("sign_extension", "visit_i32_extend16_s"),
        Operator::I64Extend8S { .. } => ("sign_extension", "visit_i64_extend8_s"),
        Operator::I64Extend16S { .. } => ("sign_extension", "visit_i64_extend16_s"),
        Operator::I64Extend32S { .. } => ("sign_extension", "visit_i64_extend32_s"),
        Operator::RefEq { .. } => ("gc", "visit_ref_eq"),
        Operator::StructNew { .. } => ("gc", "visit_struct_new"),
        Operator::StructNewDefault { .. } => ("gc", "visit_struct_new_default"),
        Operator::StructGet { .. } => ("gc", "visit_struct_get"),
        Operator::StructGetS { .. } => ("gc", "visit_struct_get_s"),
        Operator::StructGetU { .. } => ("gc", "visit_struct_get_u"),
        Operator::StructSet { .. } => ("gc", "visit_struct_set"),
        Operator::ArrayNew { .. } => ("gc", "visit_array_new"),
        Operator::ArrayNewDefault { .. } => ("gc", "visit_array_new_default"),
        Operator::ArrayNewFixed { .. } => ("gc", "visit_array_new_fixed"),
        Operator::ArrayNewData { .. } => ("gc", "visit_array_new_data"),
        Operator::ArrayNewElem { .. } => ("gc", "visit_array_new_elem"),
        Operator::ArrayGet { .. } => ("gc", "visit_array_get"),
        Operator::ArrayGetS { .. } => ("gc", "visit_array_get_s"),
        Operator::ArrayGetU { .. } => ("gc", "visit_array_get_u"),
        Operator::ArraySet { .. } => ("gc", "visit_array_set"),
        Operator::ArrayLen { .. } => ("gc", "visit_array_len"),
        Operator::ArrayFill { .. } => ("gc", "visit_array_fill"),
        Operator::ArrayCopy { .. } => ("gc", "visit_array_copy"),
        Operator::ArrayInitData { .. } => ("gc", "visit_array_init_data"),
        Operator::ArrayInitElem { .. } => ("gc", "visit_array_init_elem"),
        Operator::RefTestNonNull { .. } => ("gc", "visit_ref_test_non_null"),
        Operator::RefTestNullable { .. } => ("gc", "visit_ref_test_nullable"),
        Operator::RefCastNonNull { .. } => ("gc", "visit_ref_cast_non_null"),
        Operator::RefCastNullable { .. } => ("gc", "visit_ref_cast_nullable"),
        Operator::BrOnCast { .. } => ("gc", "visit_br_on_cast"),
        Operator::BrOnCastFail { .. } => ("gc", "visit_br_on_cast_fail"),
        Operator::AnyConvertExtern { .. } => ("gc", "visit_any_convert_extern"),
        Operator::ExternConvertAny { .. } => ("gc", "visit_extern_convert_any"),
        Operator::RefI31 { .. } => ("gc", "visit_ref_i31"),
        Operator::I31GetS { .. } => ("gc", "visit_i31_get_s"),
        Operator::I31GetU { .. } => ("gc", "visit_i31_get_u"),
        Operator::StructNewDesc { .. } => ("custom_descriptors", "visit_struct_new_desc"),
        Operator::StructNewDefaultDesc { .. } => {
            ("custom_descriptors", "visit_struct_new_default_desc")
        }
        Operator::RefGetDesc { .. } => ("custom_descriptors", "visit_ref_get_desc"),
        Operator::RefCastDescEqNonNull { .. } => {
            ("custom_descriptors", "visit_ref_cast_desc_eq_non_null")
        }
        Operator::RefCastDescEqNullable { .. } => {
            ("custom_descriptors", "visit_ref_cast_desc_eq_nullable")
        }
        Operator::BrOnCastDescEq { .. } => ("custom_descriptors", "visit_br_on_cast_desc_eq"),
        Operator::BrOnCastDescEqFail { .. } => {
            ("custom_descriptors", "visit_br_on_cast_desc_eq_fail")
        }
        Operator::I32TruncSatF32S { .. } => {
            ("saturating_float_to_int", "visit_i32_trunc_sat_f32_s")
        }
        Operator::I32TruncSatF32U { .. } => {
            ("saturating_float_to_int", "visit_i32_trunc_sat_f32_u")
        }
        Operator::I32TruncSatF64S { .. } => {
            ("saturating_float_to_int", "visit_i32_trunc_sat_f64_s")
        }
        Operator::I32TruncSatF64U { .. } => {
            ("saturating_float_to_int", "visit_i32_trunc_sat_f64_u")
        }
        Operator::I64TruncSatF32S { .. } => {
            ("saturating_float_to_int", "visit_i64_trunc_sat_f32_s")
        }
        Operator::I64TruncSatF32U { .. } => {
            ("saturating_float_to_int", "visit_i64_trunc_sat_f32_u")
        }
        Operator::I64TruncSatF64S { .. } => {
            ("saturating_float_to_int", "visit_i64_trunc_sat_f64_s")
        }
        Operator::I64TruncSatF64U { .. } => {
            ("saturating_float_to_int", "visit_i64_trunc_sat_f64_u")
        }
        Operator::MemoryInit { .. } => ("bulk_memory", "visit_memory_init"),
        Operator::DataDrop { .. } => ("bulk_memory", "visit_data_drop"),
        Operator::MemoryCopy { .. } => ("bulk_memory", "visit_memory_copy"),
        Operator::MemoryFill { .. } => ("bulk_memory", "visit_memory_fill"),
        Operator::TableInit { .. } => ("bulk_memory", "visit_table_init"),
        Operator::ElemDrop { .. } => ("bulk_memory", "visit_elem_drop"),
        Operator::TableCopy { .. } => ("bulk_memory", "visit_table_copy"),
        Operator::TypedSelect { .. } => ("reference_types", "visit_typed_select"),
        Operator::TypedSelectMulti { .. } => ("reference_types", "visit_typed_select_multi"),
        Operator::RefNull { .. } => ("reference_types", "visit_ref_null"),
        Operator::RefIsNull { .. } => ("reference_types", "visit_ref_is_null"),
        Operator::RefFunc { .. } => ("reference_types", "visit_ref_func"),
        Operator::TableFill { .. } => ("reference_types", "visit_table_fill"),
        Operator::TableGet { .. } => ("reference_types", "visit_table_get"),
        Operator::TableSet { .. } => ("reference_types", "visit_table_set"),
        Operator::TableGrow { .. } => ("reference_types", "visit_table_grow"),
        Operator::TableSize { .. } => ("reference_types", "visit_table_size"),
        Operator::ReturnCall { .. } => ("tail_call", "visit_return_call"),
        Operator::ReturnCallIndirect { .. } => ("tail_call", "visit_return_call_indirect"),
        Operator::MemoryDiscard { .. } => ("memory_control", "visit_memory_discard"),
        Operator::MemoryAtomicNotify { .. } => ("threads", "visit_memory_atomic_notify"),
        Operator::MemoryAtomicWait32 { .. } => ("threads", "visit_memory_atomic_wait32"),
        Operator::MemoryAtomicWait64 { .. } => ("threads", "visit_memory_atomic_wait64"),
        Operator::AtomicFence { .. } => ("threads", "visit_atomic_fence"),
        Operator::I32AtomicLoad { .. } => ("threads", "visit_i32_atomic_load"),
        Operator::I64AtomicLoad { .. } => ("threads", "visit_i64_atomic_load"),
        Operator::I32AtomicLoad8U { .. } => ("threads", "visit_i32_atomic_load8_u"),
        Operator::I32AtomicLoad16U { .. } => ("threads", "visit_i32_atomic_load16_u"),
        Operator::I64AtomicLoad8U { .. } => ("threads", "visit_i64_atomic_load8_u"),
        Operator::I64AtomicLoad16U { .. } => ("threads", "visit_i64_atomic_load16_u"),
        Operator::I64AtomicLoad32U { .. } => ("threads", "visit_i64_atomic_load32_u"),
        Operator::I32AtomicStore { .. } => ("threads", "visit_i32_atomic_store"),
        Operator::I64AtomicStore { .. } => ("threads", "visit_i64_atomic_store"),
        Operator::I32AtomicStore8 { .. } => ("threads", "visit_i32_atomic_store8"),
        Operator::I32AtomicStore16 { .. } => ("threads", "visit_i32_atomic_store16"),
        Operator::I64AtomicStore8 { .. } => ("threads", "visit_i64_atomic_store8"),
        Operator::I64AtomicStore16 { .. } => ("threads", "visit_i64_atomic_store16"),
        Operator::I64AtomicStore32 { .. } => ("threads", "visit_i64_atomic_store32"),
        Operator::I32AtomicRmwAdd { .. } => ("threads", "visit_i32_atomic_rmw_add"),
        Operator::I64AtomicRmwAdd { .. } => ("threads", "visit_i64_atomic_rmw_add"),
        Operator::I32AtomicRmw8AddU { .. } => ("threads", "visit_i32_atomic_rmw8_add_u"),
        Operator::I32AtomicRmw16AddU { .. } => ("threads", "visit_i32_atomic_rmw16_add_u"),
        Operator::I64AtomicRmw8AddU { .. } => ("threads", "visit_i64_atomic_rmw8_add_u"),
        Operator::I64AtomicRmw16AddU { .. } => ("threads", "visit_i64_atomic_rmw16_add_u"),
        Operator::I64AtomicRmw32AddU { .. } => ("threads", "visit_i64_atomic_rmw32_add_u"),
        Operator::I32AtomicRmwSub { .. } => ("threads", "visit_i32_atomic_rmw_sub"),
        Operator::I64AtomicRmwSub { .. } => ("threads", "visit_i64_atomic_rmw_sub"),
        Operator::I32AtomicRmw8SubU { .. } => ("threads", "visit_i32_atomic_rmw8_sub_u"),
        Operator::I32AtomicRmw16SubU { .. } => ("threads", "visit_i32_atomic_rmw16_sub_u"),
        Operator::I64AtomicRmw8SubU { .. } => ("threads", "visit_i64_atomic_rmw8_sub_u"),
        Operator::I64AtomicRmw16SubU { .. } => ("threads", "visit_i64_atomic_rmw16_sub_u"),
        Operator::I64AtomicRmw32SubU { .. } => ("threads", "visit_i64_atomic_rmw32_sub_u"),
        Operator::I32AtomicRmwAnd { .. } => ("threads", "visit_i32_atomic_rmw_and"),
        Operator::I64AtomicRmwAnd { .. } => ("threads", "visit_i64_atomic_rmw_and"),
        Operator::I32AtomicRmw8AndU { .. } => ("threads", "visit_i32_atomic_rmw8_and_u"),
        Operator::I32AtomicRmw16AndU { .. } => ("threads", "visit_i32_atomic_rmw16_and_u"),
        Operator::I64AtomicRmw8AndU { .. } => ("threads", "visit_i64_atomic_rmw8_and_u"),
        Operator::I64AtomicRmw16AndU { .. } => ("threads", "visit_i64_atomic_rmw16_and_u"),
        Operator::I64AtomicRmw32AndU { .. } => ("threads", "visit_i64_atomic_rmw32_and_u"),
        Operator::I32AtomicRmwOr { .. } => ("threads", "visit_i32_atomic_rmw_or"),
        Operator::I64AtomicRmwOr { .. } => ("threads", "visit_i64_atomic_rmw_or"),
        Operator::I32AtomicRmw8OrU { .. } => ("threads", "visit_i32_atomic_rmw8_or_u"),
        Operator::I32AtomicRmw16OrU { .. } => ("threads", "visit_i32_atomic_rmw16_or_u"),
        Operator::I64AtomicRmw8OrU { .. } => ("threads", "visit_i64_atomic_rmw8_or_u"),
        Operator::I64AtomicRmw16OrU { .. } => ("threads", "visit_i64_atomic_rmw16_or_u"),
        Operator::I64AtomicRmw32OrU { .. } => ("threads", "visit_i64_atomic_rmw32_or_u"),
        Operator::I32AtomicRmwXor { .. } => ("threads", "visit_i32_atomic_rmw_xor"),
        Operator::I64AtomicRmwXor { .. } => ("threads", "visit_i64_atomic_rmw_xor"),
        Operator::I32AtomicRmw8XorU { .. } => ("threads", "visit_i32_atomic_rmw8_xor_u"),
        Operator::I32AtomicRmw16XorU { .. } => ("threads", "visit_i32_atomic_rmw16_xor_u"),
        Operator::I64AtomicRmw8XorU { .. } => ("threads", "visit_i64_atomic_rmw8_xor_u"),
        Operator::I64AtomicRmw16XorU { .. } => ("threads", "visit_i64_atomic_rmw16_xor_u"),
        Operator::I64AtomicRmw32XorU { .. } => ("threads", "visit_i64_atomic_rmw32_xor_u"),
        Operator::I32AtomicRmwXchg { .. } => ("threads", "visit_i32_atomic_rmw_xchg"),
        Operator::I64AtomicRmwXchg { .. } => ("threads", "visit_i64_atomic_rmw_xchg"),
        Operator::I32AtomicRmw8XchgU { .. } => ("threads", "visit_i32_atomic_rmw8_xchg_u"),
        Operator::I32AtomicRmw16XchgU { .. } => ("threads", "visit_i32_atomic_rmw16_xchg_u"),
        Operator::I64AtomicRmw8XchgU { .. } => ("threads", "visit_i64_atomic_rmw8_xchg_u"),
        Operator::I64AtomicRmw16XchgU { .. } => ("threads", "visit_i64_atomic_rmw16_xchg_u"),
        Operator::I64AtomicRmw32XchgU { .. } => ("threads", "visit_i64_atomic_rmw32_xchg_u"),
        Operator::I32AtomicRmwCmpxchg { .. } => ("threads", "visit_i32_atomic_rmw_cmpxchg"),
        Operator::I64AtomicRmwCmpxchg { .. } => ("threads", "visit_i64_atomic_rmw_cmpxchg"),
        Operator::I32AtomicRmw8CmpxchgU { .. } => ("threads", "visit_i32_atomic_rmw8_cmpxchg_u"),
        Operator::I32AtomicRmw16CmpxchgU { .. } => ("threads", "visit_i32_atomic_rmw16_cmpxchg_u"),
        Operator::I64AtomicRmw8CmpxchgU { .. } => ("threads", "visit_i64_atomic_rmw8_cmpxchg_u"),
        Operator::I64AtomicRmw16CmpxchgU { .. } => ("threads", "visit_i64_atomic_rmw16_cmpxchg_u"),
        Operator::I64AtomicRmw32CmpxchgU { .. } => ("threads", "visit_i64_atomic_rmw32_cmpxchg_u"),
        Operator::V128Load { .. } => ("simd", "visit_v128_load"),
        Operator::V128Load8x8S { .. } => ("simd", "visit_v128_load8x8_s"),
        Operator::V128Load8x8U { .. } => ("simd", "visit_v128_load8x8_u"),
        Operator::V128Load16x4S { .. } => ("simd", "visit_v128_load16x4_s"),
        Operator::V128Load16x4U { .. } => ("simd", "visit_v128_load16x4_u"),
        Operator::V128Load32x2S { .. } => ("simd", "visit_v128_load32x2_s"),
        Operator::V128Load32x2U { .. } => ("simd", "visit_v128_load32x2_u"),
        Operator::V128Load8Splat { .. } => ("simd", "visit_v128_load8_splat"),
        Operator::V128Load16Splat { .. } => ("simd", "visit_v128_load16_splat"),
        Operator::V128Load32Splat { .. } => ("simd", "visit_v128_load32_splat"),
        Operator::V128Load64Splat { .. } => ("simd", "visit_v128_load64_splat"),
        Operator::V128Load32Zero { .. } => ("simd", "visit_v128_load32_zero"),
        Operator::V128Load64Zero { .. } => ("simd", "visit_v128_load64_zero"),
        Operator::V128Store { .. } => ("simd", "visit_v128_store"),
        Operator::V128Load8Lane { .. } => ("simd", "visit_v128_load8_lane"),
        Operator::V128Load16Lane { .. } => ("simd", "visit_v128_load16_lane"),
        Operator::V128Load32Lane { .. } => ("simd", "visit_v128_load32_lane"),
        Operator::V128Load64Lane { .. } => ("simd", "visit_v128_load64_lane"),
        Operator::V128Store8Lane { .. } => ("simd", "visit_v128_store8_lane"),
        Operator::V128Store16Lane { .. } => ("simd", "visit_v128_store16_lane"),
        Operator::V128Store32Lane { .. } => ("simd", "visit_v128_store32_lane"),
        Operator::V128Store64Lane { .. } => ("simd", "visit_v128_store64_lane"),
        Operator::V128Const { .. } => ("simd", "visit_v128_const"),
        Operator::I8x16Shuffle { .. } => ("simd", "visit_i8x16_shuffle"),
        Operator::I8x16ExtractLaneS { .. } => ("simd", "visit_i8x16_extract_lane_s"),
        Operator::I8x16ExtractLaneU { .. } => ("simd", "visit_i8x16_extract_lane_u"),
        Operator::I8x16ReplaceLane { .. } => ("simd", "visit_i8x16_replace_lane"),
        Operator::I16x8ExtractLaneS { .. } => ("simd", "visit_i16x8_extract_lane_s"),
        Operator::I16x8ExtractLaneU { .. } => ("simd", "visit_i16x8_extract_lane_u"),
        Operator::I16x8ReplaceLane { .. } => ("simd", "visit_i16x8_replace_lane"),
        Operator::I32x4ExtractLane { .. } => ("simd", "visit_i32x4_extract_lane"),
        Operator::I32x4ReplaceLane { .. } => ("simd", "visit_i32x4_replace_lane"),
        Operator::I64x2ExtractLane { .. } => ("simd", "visit_i64x2_extract_lane"),
        Operator::I64x2ReplaceLane { .. } => ("simd", "visit_i64x2_replace_lane"),
        Operator::F32x4ExtractLane { .. } => ("simd", "visit_f32x4_extract_lane"),
        Operator::F32x4ReplaceLane { .. } => ("simd", "visit_f32x4_replace_lane"),
        Operator::F64x2ExtractLane { .. } => ("simd", "visit_f64x2_extract_lane"),
        Operator::F64x2ReplaceLane { .. } => ("simd", "visit_f64x2_replace_lane"),
        Operator::I8x16Swizzle { .. } => ("simd", "visit_i8x16_swizzle"),
        Operator::I8x16Splat { .. } => ("simd", "visit_i8x16_splat"),
        Operator::I16x8Splat { .. } => ("simd", "visit_i16x8_splat"),
        Operator::I32x4Splat { .. } => ("simd", "visit_i32x4_splat"),
        Operator::I64x2Splat { .. } => ("simd", "visit_i64x2_splat"),
        Operator::F32x4Splat { .. } => ("simd", "visit_f32x4_splat"),
        Operator::F64x2Splat { .. } => ("simd", "visit_f64x2_splat"),
        Operator::I8x16Eq { .. } => ("simd", "visit_i8x16_eq"),
        Operator::I8x16Ne { .. } => ("simd", "visit_i8x16_ne"),
        Operator::I8x16LtS { .. } => ("simd", "visit_i8x16_lt_s"),
        Operator::I8x16LtU { .. } => ("simd", "visit_i8x16_lt_u"),
        Operator::I8x16GtS { .. } => ("simd", "visit_i8x16_gt_s"),
        Operator::I8x16GtU { .. } => ("simd", "visit_i8x16_gt_u"),
        Operator::I8x16LeS { .. } => ("simd", "visit_i8x16_le_s"),
        Operator::I8x16LeU { .. } => ("simd", "visit_i8x16_le_u"),
        Operator::I8x16GeS { .. } => ("simd", "visit_i8x16_ge_s"),
        Operator::I8x16GeU { .. } => ("simd", "visit_i8x16_ge_u"),
        Operator::I16x8Eq { .. } => ("simd", "visit_i16x8_eq"),
        Operator::I16x8Ne { .. } => ("simd", "visit_i16x8_ne"),
        Operator::I16x8LtS { .. } => ("simd", "visit_i16x8_lt_s"),
        Operator::I16x8LtU { .. } => ("simd", "visit_i16x8_lt_u"),
        Operator::I16x8GtS { .. } => ("simd", "visit_i16x8_gt_s"),
        Operator::I16x8GtU { .. } => ("simd", "visit_i16x8_gt_u"),
        Operator::I16x8LeS { .. } => ("simd", "visit_i16x8_le_s"),
        Operator::I16x8LeU { .. } => ("simd", "visit_i16x8_le_u"),
        Operator::I16x8GeS { .. } => ("simd", "visit_i16x8_ge_s"),
        Operator::I16x8GeU { .. } => ("simd", "visit_i16x8_ge_u"),
        Operator::I32x4Eq { .. } => ("simd", "visit_i32x4_eq"),
        Operator::I32x4Ne { .. } => ("simd", "visit_i32x4_ne"),
        Operator::I32x4LtS { .. } => ("simd", "visit_i32x4_lt_s"),
        Operator::I32x4LtU { .. } => ("simd", "visit_i32x4_lt_u"),
        Operator::I32x4GtS { .. } => ("simd", "visit_i32x4_gt_s"),
        Operator::I32x4GtU { .. } => ("simd", "visit_i32x4_gt_u"),
        Operator::I32x4LeS { .. } => ("simd", "visit_i32x4_le_s"),
        Operator::I32x4LeU { .. } => ("simd", "visit_i32x4_le_u"),
        Operator::I32x4GeS { .. } => ("simd", "visit_i32x4_ge_s"),
        Operator::I32x4GeU { .. } => ("simd", "visit_i32x4_ge_u"),
        Operator::I64x2Eq { .. } => ("simd", "visit_i64x2_eq"),
        Operator::I64x2Ne { .. } => ("simd", "visit_i64x2_ne"),
        Operator::I64x2LtS { .. } => ("simd", "visit_i64x2_lt_s"),
        Operator::I64x2GtS { .. } => ("simd", "visit_i64x2_gt_s"),
        Operator::I64x2LeS { .. } => ("simd", "visit_i64x2_le_s"),
        Operator::I64x2GeS { .. } => ("simd", "visit_i64x2_ge_s"),
        Operator::F32x4Eq { .. } => ("simd", "visit_f32x4_eq"),
        Operator::F32x4Ne { .. } => ("simd", "visit_f32x4_ne"),
        Operator::F32x4Lt { .. } => ("simd", "visit_f32x4_lt"),
        Operator::F32x4Gt { .. } => ("simd", "visit_f32x4_gt"),
        Operator::F32x4Le { .. } => ("simd", "visit_f32x4_le"),
        Operator::F32x4Ge { .. } => ("simd", "visit_f32x4_ge"),
        Operator::F64x2Eq { .. } => ("simd", "visit_f64x2_eq"),
        Operator::F64x2Ne { .. } => ("simd", "visit_f64x2_ne"),
        Operator::F64x2Lt { .. } => ("simd", "visit_f64x2_lt"),
        Operator::F64x2Gt { .. } => ("simd", "visit_f64x2_gt"),
        Operator::F64x2Le { .. } => ("simd", "visit_f64x2_le"),
        Operator::F64x2Ge { .. } => ("simd", "visit_f64x2_ge"),
        Operator::V128Not { .. } => ("simd", "visit_v128_not"),
        Operator::V128And { .. } => ("simd", "visit_v128_and"),
        Operator::V128AndNot { .. } => ("simd", "visit_v128_andnot"),
        Operator::V128Or { .. } => ("simd", "visit_v128_or"),
        Operator::V128Xor { .. } => ("simd", "visit_v128_xor"),
        Operator::V128Bitselect { .. } => ("simd", "visit_v128_bitselect"),
        Operator::V128AnyTrue { .. } => ("simd", "visit_v128_any_true"),
        Operator::I8x16Abs { .. } => ("simd", "visit_i8x16_abs"),
        Operator::I8x16Neg { .. } => ("simd", "visit_i8x16_neg"),
        Operator::I8x16Popcnt { .. } => ("simd", "visit_i8x16_popcnt"),
        Operator::I8x16AllTrue { .. } => ("simd", "visit_i8x16_all_true"),
        Operator::I8x16Bitmask { .. } => ("simd", "visit_i8x16_bitmask"),
        Operator::I8x16NarrowI16x8S { .. } => ("simd", "visit_i8x16_narrow_i16x8_s"),
        Operator::I8x16NarrowI16x8U { .. } => ("simd", "visit_i8x16_narrow_i16x8_u"),
        Operator::I8x16Shl { .. } => ("simd", "visit_i8x16_shl"),
        Operator::I8x16ShrS { .. } => ("simd", "visit_i8x16_shr_s"),
        Operator::I8x16ShrU { .. } => ("simd", "visit_i8x16_shr_u"),
        Operator::I8x16Add { .. } => ("simd", "visit_i8x16_add"),
        Operator::I8x16AddSatS { .. } => ("simd", "visit_i8x16_add_sat_s"),
        Operator::I8x16AddSatU { .. } => ("simd", "visit_i8x16_add_sat_u"),
        Operator::I8x16Sub { .. } => ("simd", "visit_i8x16_sub"),
        Operator::I8x16SubSatS { .. } => ("simd", "visit_i8x16_sub_sat_s"),
        Operator::I8x16SubSatU { .. } => ("simd", "visit_i8x16_sub_sat_u"),
        Operator::I8x16MinS { .. } => ("simd", "visit_i8x16_min_s"),
        Operator::I8x16MinU { .. } => ("simd", "visit_i8x16_min_u"),
        Operator::I8x16MaxS { .. } => ("simd", "visit_i8x16_max_s"),
        Operator::I8x16MaxU { .. } => ("simd", "visit_i8x16_max_u"),
        Operator::I8x16AvgrU { .. } => ("simd", "visit_i8x16_avgr_u"),
        Operator::I16x8ExtAddPairwiseI8x16S { .. } => {
            ("simd", "visit_i16x8_extadd_pairwise_i8x16_s")
        }
        Operator::I16x8ExtAddPairwiseI8x16U { .. } => {
            ("simd", "visit_i16x8_extadd_pairwise_i8x16_u")
        }
        Operator::I16x8Abs { .. } => ("simd", "visit_i16x8_abs"),
        Operator::I16x8Neg { .. } => ("simd", "visit_i16x8_neg"),
        Operator::I16x8Q15MulrSatS { .. } => ("simd", "visit_i16x8_q15mulr_sat_s"),
        Operator::I16x8AllTrue { .. } => ("simd", "visit_i16x8_all_true"),
        Operator::I16x8Bitmask { .. } => ("simd", "visit_i16x8_bitmask"),
        Operator::I16x8NarrowI32x4S { .. } => ("simd", "visit_i16x8_narrow_i32x4_s"),
        Operator::I16x8NarrowI32x4U { .. } => ("simd", "visit_i16x8_narrow_i32x4_u"),
        Operator::I16x8ExtendLowI8x16S { .. } => ("simd", "visit_i16x8_extend_low_i8x16_s"),
        Operator::I16x8ExtendHighI8x16S { .. } => ("simd", "visit_i16x8_extend_high_i8x16_s"),
        Operator::I16x8ExtendLowI8x16U { .. } => ("simd", "visit_i16x8_extend_low_i8x16_u"),
        Operator::I16x8ExtendHighI8x16U { .. } => ("simd", "visit_i16x8_extend_high_i8x16_u"),
        Operator::I16x8Shl { .. } => ("simd", "visit_i16x8_shl"),
        Operator::I16x8ShrS { .. } => ("simd", "visit_i16x8_shr_s"),
        Operator::I16x8ShrU { .. } => ("simd", "visit_i16x8_shr_u"),
        Operator::I16x8Add { .. } => ("simd", "visit_i16x8_add"),
        Operator::I16x8AddSatS { .. } => ("simd", "visit_i16x8_add_sat_s"),
        Operator::I16x8AddSatU { .. } => ("simd", "visit_i16x8_add_sat_u"),
        Operator::I16x8Sub { .. } => ("simd", "visit_i16x8_sub"),
        Operator::I16x8SubSatS { .. } => ("simd", "visit_i16x8_sub_sat_s"),
        Operator::I16x8SubSatU { .. } => ("simd", "visit_i16x8_sub_sat_u"),
        Operator::I16x8Mul { .. } => ("simd", "visit_i16x8_mul"),
        Operator::I16x8MinS { .. } => ("simd", "visit_i16x8_min_s"),
        Operator::I16x8MinU { .. } => ("simd", "visit_i16x8_min_u"),
        Operator::I16x8MaxS { .. } => ("simd", "visit_i16x8_max_s"),
        Operator::I16x8MaxU { .. } => ("simd", "visit_i16x8_max_u"),
        Operator::I16x8AvgrU { .. } => ("simd", "visit_i16x8_avgr_u"),
        Operator::I16x8ExtMulLowI8x16S { .. } => ("simd", "visit_i16x8_extmul_low_i8x16_s"),
        Operator::I16x8ExtMulHighI8x16S { .. } => ("simd", "visit_i16x8_extmul_high_i8x16_s"),
        Operator::I16x8ExtMulLowI8x16U { .. } => ("simd", "visit_i16x8_extmul_low_i8x16_u"),
        Operator::I16x8ExtMulHighI8x16U { .. } => ("simd", "visit_i16x8_extmul_high_i8x16_u"),
        Operator::I32x4ExtAddPairwiseI16x8S { .. } => {
            ("simd", "visit_i32x4_extadd_pairwise_i16x8_s")
        }
        Operator::I32x4ExtAddPairwiseI16x8U { .. } => {
            ("simd", "visit_i32x4_extadd_pairwise_i16x8_u")
        }
        Operator::I32x4Abs { .. } => ("simd", "visit_i32x4_abs"),
        Operator::I32x4Neg { .. } => ("simd", "visit_i32x4_neg"),
        Operator::I32x4AllTrue { .. } => ("simd", "visit_i32x4_all_true"),
        Operator::I32x4Bitmask { .. } => ("simd", "visit_i32x4_bitmask"),
        Operator::I32x4ExtendLowI16x8S { .. } => ("simd", "visit_i32x4_extend_low_i16x8_s"),
        Operator::I32x4ExtendHighI16x8S { .. } => ("simd", "visit_i32x4_extend_high_i16x8_s"),
        Operator::I32x4ExtendLowI16x8U { .. } => ("simd", "visit_i32x4_extend_low_i16x8_u"),
        Operator::I32x4ExtendHighI16x8U { .. } => ("simd", "visit_i32x4_extend_high_i16x8_u"),
        Operator::I32x4Shl { .. } => ("simd", "visit_i32x4_shl"),
        Operator::I32x4ShrS { .. } => ("simd", "visit_i32x4_shr_s"),
        Operator::I32x4ShrU { .. } => ("simd", "visit_i32x4_shr_u"),
        Operator::I32x4Add { .. } => ("simd", "visit_i32x4_add"),
        Operator::I32x4Sub { .. } => ("simd", "visit_i32x4_sub"),
        Operator::I32x4Mul { .. } => ("simd", "visit_i32x4_mul"),
        Operator::I32x4MinS { .. } => ("simd", "visit_i32x4_min_s"),
        Operator::I32x4MinU { .. } => ("simd", "visit_i32x4_min_u"),
        Operator::I32x4MaxS { .. } => ("simd", "visit_i32x4_max_s"),
        Operator::I32x4MaxU { .. } => ("simd", "visit_i32x4_max_u"),
        Operator::I32x4DotI16x8S { .. } => ("simd", "visit_i32x4_dot_i16x8_s"),
        Operator::I32x4ExtMulLowI16x8S { .. } => ("simd", "visit_i32x4_extmul_low_i16x8_s"),
        Operator::I32x4ExtMulHighI16x8S { .. } => ("simd", "visit_i32x4_extmul_high_i16x8_s"),
        Operator::I32x4ExtMulLowI16x8U { .. } => ("simd", "visit_i32x4_extmul_low_i16x8_u"),
        Operator::I32x4ExtMulHighI16x8U { .. } => ("simd", "visit_i32x4_extmul_high_i16x8_u"),
        Operator::I64x2Abs { .. } => ("simd", "visit_i64x2_abs"),
        Operator::I64x2Neg { .. } => ("simd", "visit_i64x2_neg"),
        Operator::I64x2AllTrue { .. } => ("simd", "visit_i64x2_all_true"),
        Operator::I64x2Bitmask { .. } => ("simd", "visit_i64x2_bitmask"),
        Operator::I64x2ExtendLowI32x4S { .. } => ("simd", "visit_i64x2_extend_low_i32x4_s"),
        Operator::I64x2ExtendHighI32x4S { .. } => ("simd", "visit_i64x2_extend_high_i32x4_s"),
        Operator::I64x2ExtendLowI32x4U { .. } => ("simd", "visit_i64x2_extend_low_i32x4_u"),
        Operator::I64x2ExtendHighI32x4U { .. } => ("simd", "visit_i64x2_extend_high_i32x4_u"),
        Operator::I64x2Shl { .. } => ("simd", "visit_i64x2_shl"),
        Operator::I64x2ShrS { .. } => ("simd", "visit_i64x2_shr_s"),
        Operator::I64x2ShrU { .. } => ("simd", "visit_i64x2_shr_u"),
        Operator::I64x2Add { .. } => ("simd", "visit_i64x2_add"),
        Operator::I64x2Sub { .. } => ("simd", "visit_i64x2_sub"),
        Operator::I64x2Mul { .. } => ("simd", "visit_i64x2_mul"),
        Operator::I64x2ExtMulLowI32x4S { .. } => ("simd", "visit_i64x2_extmul_low_i32x4_s"),
        Operator::I64x2ExtMulHighI32x4S { .. } => ("simd", "visit_i64x2_extmul_high_i32x4_s"),
        Operator::I64x2ExtMulLowI32x4U { .. } => ("simd", "visit_i64x2_extmul_low_i32x4_u"),
        Operator::I64x2ExtMulHighI32x4U { .. } => ("simd", "visit_i64x2_extmul_high_i32x4_u"),
        Operator::F32x4Ceil { .. } => ("simd", "visit_f32x4_ceil"),
        Operator::F32x4Floor { .. } => ("simd", "visit_f32x4_floor"),
        Operator::F32x4Trunc { .. } => ("simd", "visit_f32x4_trunc"),
        Operator::F32x4Nearest { .. } => ("simd", "visit_f32x4_nearest"),
        Operator::F32x4Abs { .. } => ("simd", "visit_f32x4_abs"),
        Operator::F32x4Neg { .. } => ("simd", "visit_f32x4_neg"),
        Operator::F32x4Sqrt { .. } => ("simd", "visit_f32x4_sqrt"),
        Operator::F32x4Add { .. } => ("simd", "visit_f32x4_add"),
        Operator::F32x4Sub { .. } => ("simd", "visit_f32x4_sub"),
        Operator::F32x4Mul { .. } => ("simd", "visit_f32x4_mul"),
        Operator::F32x4Div { .. } => ("simd", "visit_f32x4_div"),
        Operator::F32x4Min { .. } => ("simd", "visit_f32x4_min"),
        Operator::F32x4Max { .. } => ("simd", "visit_f32x4_max"),
        Operator::F32x4PMin { .. } => ("simd", "visit_f32x4_pmin"),
        Operator::F32x4PMax { .. } => ("simd", "visit_f32x4_pmax"),
        Operator::F64x2Ceil { .. } => ("simd", "visit_f64x2_ceil"),
        Operator::F64x2Floor { .. } => ("simd", "visit_f64x2_floor"),
        Operator::F64x2Trunc { .. } => ("simd", "visit_f64x2_trunc"),
        Operator::F64x2Nearest { .. } => ("simd", "visit_f64x2_nearest"),
        Operator::F64x2Abs { .. } => ("simd", "visit_f64x2_abs"),
        Operator::F64x2Neg { .. } => ("simd", "visit_f64x2_neg"),
        Operator::F64x2Sqrt { .. } => ("simd", "visit_f64x2_sqrt"),
        Operator::F64x2Add { .. } => ("simd", "visit_f64x2_add"),
        Operator::F64x2Sub { .. } => ("simd", "visit_f64x2_sub"),
        Operator::F64x2Mul { .. } => ("simd", "visit_f64x2_mul"),
        Operator::F64x2Div { .. } => ("simd", "visit_f64x2_div"),
        Operator::F64x2Min { .. } => ("simd", "visit_f64x2_min"),
        Operator::F64x2Max { .. } => ("simd", "visit_f64x2_max"),
        Operator::F64x2PMin { .. } => ("simd", "visit_f64x2_pmin"),
        Operator::F64x2PMax { .. } => ("simd", "visit_f64x2_pmax"),
        Operator::I32x4TruncSatF32x4S { .. } => ("simd", "visit_i32x4_trunc_sat_f32x4_s"),
        Operator::I32x4TruncSatF32x4U { .. } => ("simd", "visit_i32x4_trunc_sat_f32x4_u"),
        Operator::F32x4ConvertI32x4S { .. } => ("simd", "visit_f32x4_convert_i32x4_s"),
        Operator::F32x4ConvertI32x4U { .. } => ("simd", "visit_f32x4_convert_i32x4_u"),
        Operator::I32x4TruncSatF64x2SZero { .. } => ("simd", "visit_i32x4_trunc_sat_f64x2_s_zero"),
        Operator::I32x4TruncSatF64x2UZero { .. } => ("simd", "visit_i32x4_trunc_sat_f64x2_u_zero"),
        Operator::F64x2ConvertLowI32x4S { .. } => ("simd", "visit_f64x2_convert_low_i32x4_s"),
        Operator::F64x2ConvertLowI32x4U { .. } => ("simd", "visit_f64x2_convert_low_i32x4_u"),
        Operator::F32x4DemoteF64x2Zero { .. } => ("simd", "visit_f32x4_demote_f64x2_zero"),
        Operator::F64x2PromoteLowF32x4 { .. } => ("simd", "visit_f64x2_promote_low_f32x4"),
        Operator::I8x16RelaxedSwizzle { .. } => ("relaxed_simd", "visit_i8x16_relaxed_swizzle"),
        Operator::I32x4RelaxedTruncF32x4S { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_trunc_f32x4_s")
        }
        Operator::I32x4RelaxedTruncF32x4U { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_trunc_f32x4_u")
        }
        Operator::I32x4RelaxedTruncF64x2SZero { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_trunc_f64x2_s_zero")
        }
        Operator::I32x4RelaxedTruncF64x2UZero { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_trunc_f64x2_u_zero")
        }
        Operator::F32x4RelaxedMadd { .. } => ("relaxed_simd", "visit_f32x4_relaxed_madd"),
        Operator::F32x4RelaxedNmadd { .. } => ("relaxed_simd", "visit_f32x4_relaxed_nmadd"),
        Operator::F64x2RelaxedMadd { .. } => ("relaxed_simd", "visit_f64x2_relaxed_madd"),
        Operator::F64x2RelaxedNmadd { .. } => ("relaxed_simd", "visit_f64x2_relaxed_nmadd"),
        Operator::I8x16RelaxedLaneselect { .. } => {
            ("relaxed_simd", "visit_i8x16_relaxed_laneselect")
        }
        Operator::I16x8RelaxedLaneselect { .. } => {
            ("relaxed_simd", "visit_i16x8_relaxed_laneselect")
        }
        Operator::I32x4RelaxedLaneselect { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_laneselect")
        }
        Operator::I64x2RelaxedLaneselect { .. } => {
            ("relaxed_simd", "visit_i64x2_relaxed_laneselect")
        }
        Operator::F32x4RelaxedMin { .. } => ("relaxed_simd", "visit_f32x4_relaxed_min"),
        Operator::F32x4RelaxedMax { .. } => ("relaxed_simd", "visit_f32x4_relaxed_max"),
        Operator::F64x2RelaxedMin { .. } => ("relaxed_simd", "visit_f64x2_relaxed_min"),
        Operator::F64x2RelaxedMax { .. } => ("relaxed_simd", "visit_f64x2_relaxed_max"),
        Operator::I16x8RelaxedQ15mulrS { .. } => ("relaxed_simd", "visit_i16x8_relaxed_q15mulr_s"),
        Operator::I16x8RelaxedDotI8x16I7x16S { .. } => {
            ("relaxed_simd", "visit_i16x8_relaxed_dot_i8x16_i7x16_s")
        }
        Operator::I32x4RelaxedDotI8x16I7x16AddS { .. } => {
            ("relaxed_simd", "visit_i32x4_relaxed_dot_i8x16_i7x16_add_s")
        }
        Operator::TryTable { .. } => ("exceptions", "visit_try_table"),
        Operator::Throw { .. } => ("exceptions", "visit_throw"),
        Operator::ThrowRef { .. } => ("exceptions", "visit_throw_ref"),
        Operator::Try { .. } => ("legacy_exceptions", "visit_try"),
        Operator::Catch { .. } => ("legacy_exceptions", "visit_catch"),
        Operator::Rethrow { .. } => ("legacy_exceptions", "visit_rethrow"),
        Operator::Delegate { .. } => ("legacy_exceptions", "visit_delegate"),
        Operator::CatchAll { .. } => ("legacy_exceptions", "visit_catch_all"),
        Operator::GlobalAtomicGet { .. } => {
            ("shared_everything_threads", "visit_global_atomic_get")
        }
        Operator::GlobalAtomicSet { .. } => {
            ("shared_everything_threads", "visit_global_atomic_set")
        }
        Operator::GlobalAtomicRmwAdd { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_add")
        }
        Operator::GlobalAtomicRmwSub { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_sub")
        }
        Operator::GlobalAtomicRmwAnd { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_and")
        }
        Operator::GlobalAtomicRmwOr { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_or")
        }
        Operator::GlobalAtomicRmwXor { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_xor")
        }
        Operator::GlobalAtomicRmwXchg { .. } => {
            ("shared_everything_threads", "visit_global_atomic_rmw_xchg")
        }
        Operator::GlobalAtomicRmwCmpxchg { .. } => (
            "shared_everything_threads",
            "visit_global_atomic_rmw_cmpxchg",
        ),
        Operator::TableAtomicGet { .. } => ("shared_everything_threads", "visit_table_atomic_get"),
        Operator::TableAtomicSet { .. } => ("shared_everything_threads", "visit_table_atomic_set"),
        Operator::TableAtomicRmwXchg { .. } => {
            ("shared_everything_threads", "visit_table_atomic_rmw_xchg")
        }
        Operator::TableAtomicRmwCmpxchg { .. } => (
            "shared_everything_threads",
            "visit_table_atomic_rmw_cmpxchg",
        ),
        Operator::StructAtomicGet { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_get")
        }
        Operator::StructAtomicGetS { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_get_s")
        }
        Operator::StructAtomicGetU { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_get_u")
        }
        Operator::StructAtomicSet { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_set")
        }
        Operator::StructAtomicRmwAdd { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_add")
        }
        Operator::StructAtomicRmwSub { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_sub")
        }
        Operator::StructAtomicRmwAnd { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_and")
        }
        Operator::StructAtomicRmwOr { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_or")
        }
        Operator::StructAtomicRmwXor { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_xor")
        }
        Operator::StructAtomicRmwXchg { .. } => {
            ("shared_everything_threads", "visit_struct_atomic_rmw_xchg")
        }
        Operator::StructAtomicRmwCmpxchg { .. } => (
            "shared_everything_threads",
            "visit_struct_atomic_rmw_cmpxchg",
        ),
        Operator::ArrayAtomicGet { .. } => ("shared_everything_threads", "visit_array_atomic_get"),
        Operator::ArrayAtomicGetS { .. } => {
            ("shared_everything_threads", "visit_array_atomic_get_s")
        }
        Operator::ArrayAtomicGetU { .. } => {
            ("shared_everything_threads", "visit_array_atomic_get_u")
        }
        Operator::ArrayAtomicSet { .. } => ("shared_everything_threads", "visit_array_atomic_set"),
        Operator::ArrayAtomicRmwAdd { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_add")
        }
        Operator::ArrayAtomicRmwSub { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_sub")
        }
        Operator::ArrayAtomicRmwAnd { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_and")
        }
        Operator::ArrayAtomicRmwOr { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_or")
        }
        Operator::ArrayAtomicRmwXor { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_xor")
        }
        Operator::ArrayAtomicRmwXchg { .. } => {
            ("shared_everything_threads", "visit_array_atomic_rmw_xchg")
        }
        Operator::ArrayAtomicRmwCmpxchg { .. } => (
            "shared_everything_threads",
            "visit_array_atomic_rmw_cmpxchg",
        ),
        Operator::RefI31Shared { .. } => ("shared_everything_threads", "visit_ref_i31_shared"),
        Operator::CallRef { .. } => ("function_references", "visit_call_ref"),
        Operator::ReturnCallRef { .. } => ("function_references", "visit_return_call_ref"),
        Operator::RefAsNonNull { .. } => ("function_references", "visit_ref_as_non_null"),
        Operator::BrOnNull { .. } => ("function_references", "visit_br_on_null"),
        Operator::BrOnNonNull { .. } => ("function_references", "visit_br_on_non_null"),
        Operator::ContNew { .. } => ("stack_switching", "visit_cont_new"),
        Operator::ContBind { .. } => ("stack_switching", "visit_cont_bind"),
        Operator::Suspend { .. } => ("stack_switching", "visit_suspend"),
        Operator::Resume { .. } => ("stack_switching", "visit_resume"),
        Operator::ResumeThrow { .. } => ("stack_switching", "visit_resume_throw"),
        Operator::ResumeThrowRef { .. } => ("stack_switching", "visit_resume_throw_ref"),
        Operator::Switch { .. } => ("stack_switching", "visit_switch"),
        Operator::I64Add128 { .. } => ("wide_arithmetic", "visit_i64_add128"),
        Operator::I64Sub128 { .. } => ("wide_arithmetic", "visit_i64_sub128"),
        Operator::I64MulWideS { .. } => ("wide_arithmetic", "visit_i64_mul_wide_s"),
        Operator::I64MulWideU { .. } => ("wide_arithmetic", "visit_i64_mul_wide_u"),
        _ => ("unknown", "visit_unknown"),
    }
}
