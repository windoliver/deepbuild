//! The floating-point control register a golden step asserts at its start (Golden: "Golden runs
//! assert the floating-point control register at each step's start"): round to nearest, no
//! flush-to-zero, no denormals-as-zero, no default NaN, exceptions masked, which is what every
//! target's results assume. FPCR on arm64, MXCSR on x86_64.

#[cfg(target_arch = "aarch64")]
mod reg {
    pub const NAME: &str = "FPCR";
    const FZ: u64 = 1 << 24;
    /// Each control bit that changes results, and what it does when set.
    const BITS: [(u64, &str); 6] = [
        (FZ, "FZ (flush-to-zero)"),
        (1 << 25, "DN (default NaN)"),
        (3 << 22, "RMode (rounding other than to nearest)"),
        (1 << 19, "FZ16 (half-precision flush-to-zero)"),
        (1 << 1, "AH (alternate handling)"),
        (1, "FIZ (flush inputs to zero)"),
    ];

    fn read() -> u64 {
        let v: u64;
        // SAFETY: reading FPCR has no side effect.
        unsafe {
            core::arch::asm!("mrs {}, fpcr", out(reg) v, options(nomem, nostack, preserves_flags))
        };
        v
    }

    fn write(v: u64) {
        // SAFETY: only the guard's own fault and its reset write it, on this thread.
        unsafe {
            core::arch::asm!("msr fpcr, {}", in(reg) v, options(nomem, nostack, preserves_flags))
        };
    }

    pub fn set() -> Vec<&'static str> {
        let v = read();
        BITS.iter()
            .filter(|(b, _)| v & b != 0)
            .map(|(_, what)| *what)
            .collect()
    }

    pub fn flush_to_zero(on: bool) {
        let v = read();
        write(if on { v | FZ } else { v & !FZ });
    }

    pub fn reset() {
        write(read() & !BITS.iter().fold(0, |m, (b, _)| m | b));
    }
}

#[cfg(target_arch = "x86_64")]
mod reg {
    pub const NAME: &str = "MXCSR";
    const FTZ: u32 = 1 << 15;
    /// The exception masks, all set by default.
    const MASKS: u32 = 0x1f80;
    const BITS: [(u32, &str); 3] = [
        (FTZ, "FTZ (flush-to-zero)"),
        (1 << 6, "DAZ (denormals-are-zero)"),
        (3 << 13, "RC (rounding other than to nearest)"),
    ];

    fn read() -> u32 {
        let mut v: u32 = 0;
        // SAFETY: stmxcsr writes the register to `v` only.
        unsafe {
            core::arch::asm!("stmxcsr [{}]", in(reg) &mut v, options(nostack, preserves_flags))
        };
        v
    }

    fn write(v: u32) {
        // SAFETY: only the guard's own fault and its reset write it, on this thread.
        unsafe {
            core::arch::asm!("ldmxcsr [{}]", in(reg) &v, options(nostack, readonly, preserves_flags))
        };
    }

    pub fn set() -> Vec<&'static str> {
        let v = read();
        let mut out: Vec<&str> = BITS
            .iter()
            .filter(|(b, _)| v & b != 0)
            .map(|(_, what)| *what)
            .collect();
        if v & MASKS != MASKS {
            out.push("an exception unmasked");
        }
        out
    }

    pub fn flush_to_zero(on: bool) {
        let v = read();
        write(if on { v | FTZ } else { v & !FTZ });
    }

    pub fn reset() {
        write((read() & !BITS.iter().fold(0, |m, (b, _)| m | b)) | MASKS);
    }
}

#[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
mod reg {
    // wasm32 has no floating-point control register: its float semantics are fixed.
    pub const NAME: &str = "none";
    pub fn set() -> Vec<&'static str> {
        Vec::new()
    }
    pub fn flush_to_zero(_: bool) {}
    pub fn reset() {}
}

/// This machine's floating-point control register's name.
pub const REGISTER: &str = reg::NAME;

/// What this thread's control register holds that results don't assume, or `None` when it is as
/// every step expects.
pub fn check() -> Option<String> {
    let set = reg::set();
    (!set.is_empty()).then(|| format!("{REGISTER} has {} set", set.join(", ")))
}

/// Sets or clears flush-to-zero on this thread: the fault a golden's guard must catch.
pub fn flush_to_zero(on: bool) {
    reg::flush_to_zero(on);
}

/// Puts this thread's control register back as every step expects.
pub fn reset() {
    reg::reset();
}
