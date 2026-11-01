//! Issue #857's test canvas modules, compiled in only under the `test-threads` feature:
//! `test.serial`, whose operator declares itself not thread-safe, and `test.racy`, whose operator
//! reads and bumps a process-wide counter outside its read set without declaring it: the planted
//! operator the shuffle test at 8 threads catches. The canvas lint keeps statics out of every
//! deep-canvas* crate, so both live here, beside #387's `test.accent`.

use std::sync::atomic::{AtomicU64, Ordering};

use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::Val;

use crate::twins::{area, boxed_kind, of_kind, test_manifest};

/// The shared state the planted operator touches.
static COUNT: AtomicU64 = AtomicU64::new(0);

fn register_serial(r: &mut Registrar) {
    boxed_kind(r, "serial");
    r.array("test.serial.out", "f64", "item", "geometry", "items");
    r.operator("out", "items", &["self"], &["test.serial.out"])
        .applies(|_, _, item| of_kind(item, "test.serial@1"))
        .serial()
        .run(|v| {
            let a = area(v)?;
            v.write("test.serial.out", Val::typed(a))
        });
}

fn register_racy(r: &mut Registrar) {
    boxed_kind(r, "racy");
    r.array("test.racy.out", "counted", "item", "geometry", "items");
    r.operator("out", "items", &["self"], &["test.racy.out"])
        .applies(|_, _, item| of_kind(item, "test.racy@1"))
        .run(|v| {
            let a = area(v)?;
            // The planted read: shared state outside the read set, undeclared.
            let count = COUNT.fetch_add(1, Ordering::Relaxed);
            v.write("test.racy.out", Val::typed((a, count)))
        });
}

/// `test.serial` and `test.racy`.
pub fn modules() -> Vec<Module> {
    vec![
        Module {
            manifest: test_manifest("test.serial", "test-threads"),
            register: register_serial,
        },
        Module {
            manifest: test_manifest("test.racy", "test-threads"),
            register: register_racy,
        },
    ]
}
