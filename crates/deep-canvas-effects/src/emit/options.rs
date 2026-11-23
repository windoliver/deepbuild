/// How the core writes a pass: the planted wrong program that lifts its red by two 10-bit codes
/// (as the display reads them) is reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    pub off_by_two: bool,
    /// The planted emitter that drops a swizzle's last lane (writes it as zero).
    pub drops_swizzle_last: bool,
    /// The planted binding that declares a vec3 attribute at WGSL's 16-byte `vec3` stride over
    /// its packed 12-byte data.
    pub attribute_stride_16: bool,
    /// The planted small-array index that wraps (`i mod n`) instead of clamping (#483).
    pub index_wraps: bool,
    /// The planted indirect dispatch with no guard against its count (#484).
    pub no_count_guard: bool,
    /// #431's planted `sample_grad`, which takes the implicit derivatives of uv and ignores the
    /// gradients given.
    pub sample_grad_implicit: bool,
    /// #431's planted fbm, which wraps only its first octave on the period.
    pub period_first_octave: bool,
    /// #161: a pass writes each channel rounded to the nearest half float. A group's passes run on
    /// half-float targets, and a GPU that truncates there loses up to half a 10-bit code a write.
    pub nearest_half: bool,
}
