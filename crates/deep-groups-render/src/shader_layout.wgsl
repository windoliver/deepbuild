// Issue #3256's two small pairs (shader_layout.rs): no pass reads them. A vec3<f32> is 12 bytes
// and aligns to 16, so the f32 after one sits at 12 and a second vec3<f32> at 16.

struct OffsetsAgree3256 {
    a: vec3<f32>,
    b: f32,
}

struct OffsetsDiffer3256 {
    a: vec3<f32>,
    b: vec3<f32>,
}
