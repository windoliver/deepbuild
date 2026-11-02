// Issue #140: the GPU seam's backend version is the wgpu this crate is built with, read from the
// workspace's Cargo.lock, so a new wgpu is a new backend version in every key it feeds.
fn main() {
    let lock = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock");
    println!("cargo:rerun-if-changed={lock}");
    let text = std::fs::read_to_string(lock).unwrap_or_default();
    let version = text
        .split("[[package]]")
        .filter(|p| p.contains("name = \"wgpu\"\n"))
        .filter_map(|p| {
            p.lines()
                .find_map(|l| l.strip_prefix("version = \"")?.strip_suffix('"'))
        })
        .find(|v| v.starts_with("30."))
        .unwrap_or("unknown")
        .to_string();
    println!("cargo:rustc-env=DEEP_WGPU_VERSION={version}");
}
