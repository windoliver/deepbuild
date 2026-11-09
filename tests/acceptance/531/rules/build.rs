// The logic subset's memory: one memory whose maximum is its minimum (two 64 KiB pages), and a small
// shadow stack inside it, so the program the linker writes passes sandbox@1's check as it is.
fn main() {
    for arg in ["--initial-memory=131072", "--max-memory=131072", "-zstack-size=16384"] {
        println!("cargo:rustc-link-arg={arg}");
    }
}
