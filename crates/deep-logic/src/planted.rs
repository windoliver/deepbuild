//! The planted twins `deep-logic --planted <name>` runs (AGENTS.md, Proof): each one criterion's
//! wrong program, kept apart from the module's calls.

use deep_canvas_sandbox::rewrite;

/// The planted twins `deep-logic --planted <name>` runs, each one criterion's wrong program.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    pub rewrite: rewrite::Faults,
    pub runs_unchecked: bool,
    pub digest_total_sizes: bool,
    pub mapper_ignores_shift: bool,
    pub budget_first_line: bool,
    pub check_step_hashes_only: bool,
    pub budget_sums_only_fuel: bool,
    pub checkpoint_drops_globals: bool,
    pub restore_keeps_regions_only: bool,
    pub restore_copies_assets: bool,
    pub simulate_runs_all_steps: bool,
    pub linker_adds_linking_section: bool,
    pub pack_check_skips_library_subset: bool,
    pub linker_links_in_listing_order: bool,
    pub read_region_orders_by_arrival: bool,
    pub read_region_drops_player: bool,
    pub save_drops_globals: bool,
    pub save_drops_input_position: bool,
    pub open_reapplies_segments: bool,
    /// #189: an open under a changed program that writes its segments over the save's pages
    /// with no check that they overlap saved state.
    pub open_writes_new_segments: bool,
    /// #189: a save that leaves out its highest page holding a nonzero byte.
    pub save_drops_a_page: bool,
    /// #189: an ended save that keeps the slot's earlier save once it reads back whole.
    pub ended_keeps_earlier_save: bool,
    /// #189: a migration run under its item's step fuel budget instead of its own.
    pub migration_runs_under_step_budget: bool,
    /// #189: a layout refusal between two field tables that names only the first field that differs.
    pub refusal_names_first_field: bool,
    pub replay_changes_step_37: bool,
    pub budget_counts_lane_reading: bool,
    pub seek_repeats_occurrences: bool,
    pub occurrences_keep_cap: bool,
    pub occurrences_sort_ties_by_payload: bool,
    pub turn_runs_at_frame_boundary: bool,
    pub turn_ignores_due: bool,
    pub linear_blends_forward: bool,
    pub seek_restores_arrays_only: bool,
    pub open_span_reads_zero: bool,
    pub judder_checks_shots_only: bool,
    pub budget_holds_steps_to_fuel_budget: bool,
    pub budget_web_passes_from_fuel: bool,
    pub pipeline_draws_before_step_ends: bool,
    pub ranges_drop_second_at_step_5000: bool,
    pub ring_drops_oldest: bool,
    pub keyframes_held_in_ring: bool,
    pub store_fails_at_step_120: bool,
    pub mirror_lists_first: bool,
    pub mirror_restores_whole: bool,
    pub services_after_checkpoint: bool,
    /// #548: a preview that runs on the item's own instance rather than a throwaway copy.
    pub preview_writes_item_memory: bool,
    /// #548: a preview that runs only when a control it reads changes, not after a step or seek.
    pub preview_runs_on_hover_only: bool,
    /// #548: a region map that lays the reads out by name rather than in declaration order.
    pub map_reads_by_name: bool,
    /// #1164: the restore a seek to step 225 starts from zeroes the u32 at the program's
    /// `moves_at`, a count it keeps only in memory.
    pub restore_zeroes_move_count: bool,
    /// #416: a resolver that gives an outside pack's interface a first-party pack's binding.
    pub outside_interface_binds_all: bool,
    /// #210: an `each` reading's read region that keeps only the last value a step received.
    pub read_region_keeps_last: bool,
    /// #860: a rewind that puts back only each item's arrays as the stop left them, leaving the
    /// rest of its memory and its globals as they stood when the rewind came.
    pub rewind_restores_arrays_only: bool,
    /// #860: a rewind that zeroes the carried seen array instead of keeping it.
    pub rewind_clears_seen: bool,
    /// #276: a replay whose track holds a profile entry reads the store's newest record instead.
    pub profile_replay_reads_store: bool,
    /// #276: a profile record bound to its item's data assets as well as its arrays' shape.
    pub profile_bound_to_content: bool,
    /// #276: a check's replica that names no fixture record starts from the viewer's stored one.
    pub check_reads_viewer_profile: bool,
    /// #1250: a piece that reads the wall clock: after every step of the first item, the wall
    /// clock's nanoseconds join the first value of its first array, in a play and its replica alike.
    pub reads_wall_clock: bool,
}

impl Planted {
    /// Each named twin applied to `self`; None for an unknown name.
    pub fn and(mut self, name: &str) -> Option<Planted> {
        let p = &mut self;
        match name {
            "check_compares_step_hashes" => p.check_step_hashes_only = true,
            "read_region_orders_by_arrival" => p.read_region_orders_by_arrival = true,
            "read_region_drops_player" => p.read_region_drops_player = true,
            "budget_sums_fuel_only" => p.budget_sums_only_fuel = true,
            "checkpoint_drops_globals" => p.checkpoint_drops_globals = true,
            "restore_keeps_regions_only" => p.restore_keeps_regions_only = true,
            "restore_copies_assets" => p.restore_copies_assets = true,
            "simulate_runs_all_steps" => p.simulate_runs_all_steps = true,
            "save_drops_globals" => p.save_drops_globals = true,
            "save_drops_input_position" => p.save_drops_input_position = true,
            "open_reapplies_segments" => p.open_reapplies_segments = true,
            "open_writes_new_segments" => p.open_writes_new_segments = true,
            "save_drops_a_page" => p.save_drops_a_page = true,
            "ended_keeps_earlier_save" => p.ended_keeps_earlier_save = true,
            "migration_runs_under_step_budget" => p.migration_runs_under_step_budget = true,
            "refusal_names_first_field" => p.refusal_names_first_field = true,
            "tracker_skips_memory_copy" => p.rewrite.skip_copy_pages = true,
            "tracker_skips_memory_fill" => p.rewrite.skip_fill_pages = true,
            "ranges_drop_second_at_step_5000" => p.ranges_drop_second_at_step_5000 = true,
            "ring_drops_oldest" => p.ring_drops_oldest = true,
            "keyframes_held_in_ring" => p.keyframes_held_in_ring = true,
            "store_fails_at_step_120" => p.store_fails_at_step_120 = true,
            "runs_unchecked" => p.runs_unchecked = true,
            "digest_compares_total_sizes" => p.digest_total_sizes = true,
            "mapper_ignores_fuel_shift" => p.mapper_ignores_shift = true,
            "budget_charges_function_first_line" => p.budget_first_line = true,
            "linker_adds_linking_section" => p.linker_adds_linking_section = true,
            "pack_check_skips_library_subset" => p.pack_check_skips_library_subset = true,
            "linker_links_in_listing_order" => p.linker_links_in_listing_order = true,
            "replay_changes_step_37" => p.replay_changes_step_37 = true,
            "logic_reads_wall_clock" => p.reads_wall_clock = true,
            "budget_counts_lane_reading" => p.budget_counts_lane_reading = true,
            "seek_repeats_occurrences" => p.seek_repeats_occurrences = true,
            "occurrences_keep_cap" => p.occurrences_keep_cap = true,
            "occurrences_sort_ties_by_payload" => p.occurrences_sort_ties_by_payload = true,
            "turn_runs_at_frame_boundary" => p.turn_runs_at_frame_boundary = true,
            "turn_ignores_due" => p.turn_ignores_due = true,
            "linear_blends_forward" => p.linear_blends_forward = true,
            "seek_restores_arrays_only" => p.seek_restores_arrays_only = true,
            "open_span_reads_zero" => p.open_span_reads_zero = true,
            "judder_checks_shots_only" => p.judder_checks_shots_only = true,
            "budget_holds_steps_to_fuel_budget" => p.budget_holds_steps_to_fuel_budget = true,
            "budget_web_passes_from_fuel" => p.budget_web_passes_from_fuel = true,
            "pipeline_draws_before_step_ends" => p.pipeline_draws_before_step_ends = true,
            "mirror_lists_before_reads" => p.mirror_lists_first = true,
            "mirror_whole_after_restore" => p.mirror_restores_whole = true,
            "services_after_checkpoint" => p.services_after_checkpoint = true,
            "preview_writes_item_memory" => p.preview_writes_item_memory = true,
            "preview_runs_on_hover_only" => p.preview_runs_on_hover_only = true,
            "restore_zeroes_move_count" => p.restore_zeroes_move_count = true,
            "outside_interface_binds_all" => p.outside_interface_binds_all = true,
            "read_region_keeps_last" => p.read_region_keeps_last = true,
            "rewind_restores_arrays_only" => p.rewind_restores_arrays_only = true,
            "rewind_clears_seen" => p.rewind_clears_seen = true,
            "profile_replay_reads_store" => p.profile_replay_reads_store = true,
            "profile_bound_to_content" => p.profile_bound_to_content = true,
            "check_reads_viewer_profile" => p.check_reads_viewer_profile = true,
            _ => return None,
        }
        Some(self)
    }
}
