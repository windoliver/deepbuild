// Issue #380: the versions of wgpu and wgpu-profiler this binary is built with, read from the
// workspace's Cargo.lock, for a run's environment fingerprint and the profiler it names.
fn main() {
    let lock = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock");
    println!("cargo:rerun-if-changed={lock}");
    let text = std::fs::read_to_string(lock).unwrap_or_default();
    let version = |name: &str, major: &str| -> String {
        text.split("[[package]]")
            .filter(|p| p.contains(&format!("name = \"{name}\"\n")))
            .filter_map(|p| {
                p.lines()
                    .find_map(|l| l.strip_prefix("version = \"")?.strip_suffix('"'))
            })
            .find(|v| v.starts_with(major))
            .unwrap_or("unknown")
            .to_string()
    };
    println!(
        "cargo:rustc-env=DEEP_WGPU_VERSION={}",
        version("wgpu", "30.")
    );
    println!(
        "cargo:rustc-env=DEEP_WGPU_PROFILER_VERSION={}",
        version("wgpu-profiler", "0.28.")
    );
}
