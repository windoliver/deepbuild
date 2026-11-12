// Issue #2010: what this build is, as cargo resolved it, for the bake key and the runtime digest
// (Bake: `key`): rapier3d and the crates under it whose results it depends on, each with its
// resolved version and features, read from `cargo tree` over the lockfile this build uses (the
// workspace's, or the one `resolver.lockfile-path` names), plus the target triple and rustc. A
// moved pin is a new key and a new digest.
use std::process::Command;

const BACKEND: &str = "rapier3d";
const PINNED: [&str; 6] = ["parry3d", "wide", "glam", "glamx", "simba", "libm"];

fn var(k: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| panic!("cargo sets {k} for a build script"))
}

fn main() {
    let dir = var("CARGO_MANIFEST_DIR");
    let target = var("TARGET");
    let lock = std::env::var("CARGO_RESOLVER_LOCKFILE_PATH")
        .unwrap_or_else(|_| format!("{dir}/../../Cargo.lock"));
    println!("cargo:rerun-if-env-changed=CARGO_RESOLVER_LOCKFILE_PATH");
    println!("cargo:rerun-if-changed={lock}");
    println!("cargo:rerun-if-changed={dir}/../../Cargo.toml");
    println!("cargo:rerun-if-changed={dir}/Cargo.toml");
    // `--locked`, not `--frozen`: cargo tree loads every git source the lockfile names, which a
    // build in fresh caches hasn't fetched when it needs none of them (issue #2012).
    let tree = Command::new(var("CARGO"))
        .args([
            "tree",
            "--locked",
            "-p",
            "deep-physics-rapier",
            "-e",
            "normal",
            "--prefix",
            "none",
            "-f",
            "{p}|{f}",
            "--target",
            &target,
        ])
        .current_dir(&dir)
        .output()
        .expect("cargo runs");
    assert!(
        tree.status.success(),
        "cargo tree couldn't read this build's resolution: {}",
        String::from_utf8_lossy(&tree.stderr)
    );
    // `name vX.Y.Z[ (source)]|f1,f2[ (*)]`, each package once.
    let mut pins: Vec<(String, String, String)> = String::from_utf8_lossy(&tree.stdout)
        .lines()
        .filter_map(|l| {
            let (p, f) = l.trim().split_once('|')?;
            let mut words = p.split(' ');
            let name = words.next()?.to_string();
            let version = words.next()?.strip_prefix('v')?.to_string();
            let mut features: Vec<&str> = f
                .trim_end_matches(" (*)")
                .split(',')
                .filter(|x| !x.is_empty())
                .collect();
            features.sort_unstable();
            Some((name, version, features.join(",")))
        })
        .filter(|(n, _, _)| n == BACKEND || PINNED.contains(&n.as_str()))
        .collect();
    pins.sort();
    pins.dedup();
    let line = |(n, v, f): &(String, String, String)| format!("{n} {v} {f}");
    let backend: Vec<String> = pins.iter().filter(|p| p.0 == BACKEND).map(line).collect();
    assert!(
        backend.len() == 1,
        "this build resolves one {BACKEND}: {backend:?}"
    );
    let others: Vec<String> = pins.iter().filter(|p| p.0 != BACKEND).map(line).collect();
    let rustc = Command::new(var("RUSTC"))
        .arg("-V")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=DEEP_PHYSICS_BACKEND={}", backend[0]);
    println!("cargo:rustc-env=DEEP_PHYSICS_PINS={}", others.join(";"));
    println!("cargo:rustc-env=DEEP_PHYSICS_TARGET={target}");
    println!("cargo:rustc-env=DEEP_PHYSICS_RUSTC={rustc}");
}
