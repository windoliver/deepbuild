use super::spool_file::append;
use crate::tool_paths::pi_path;
use deep_hook::shell::glob;
use std::fs::{self, DirBuilder};
use std::os::unix::fs::DirBuilderExt;

#[test]
fn a_pi_path_is_the_file_pi_opens() {
    for (given, opened) in [
        ("@a/b", "a/b"),
        ("@@a", "@a"),
        ("a\u{00A0}b\u{3000}c", "a b c"),
        ("~", "~/"),
        ("@~", "~/"),
        ("~/a", "~/a"),
        ("file:///h/.d/t", "/h/.d/t"),
        ("@file:///h/t", "/h/t"),
        ("file://localhost/h/t", "/h/t"),
        ("file://LOCALHOST/h/t", "/h/t"),
        ("file://%6Cocalhost/h/t", "/h/t"),
        ("file://local\u{00AD}host/h/t", "/h/t"),
        ("file:///h/%2Ed/t%20u", "/h/.d/t u"),
        ("file:///h/t?x#y", "/h/t"),
        ("file:///h/t#y?x", "/h/t"),
        ("file:///h/\tt\n", "/h/t"),
        ("file:///h\\t", "/h/t"),
        ("file:///h/t%zz%2", "/h/t%zz%2"),
        ("file:///h/é%C3%A9", "/h/éé"),
    ] {
        assert_eq!(pi_path(given), opened, "{given}");
    }
}

#[test]
fn a_line_written_to_a_spool_moved_aside_is_written_again_to_the_new_one() {
    let folder = std::env::temp_dir().join(format!("dh315-append-{}", std::process::id()));
    let _ = fs::remove_dir_all(&folder);
    // Yours alone, as deep-hook makes it: a umask of 002, Ubuntu's, would leave it group-writable, which it refuses.
    DirBuilder::new().mode(0o700).create(&folder).unwrap();
    let live = folder.join("spool.jsonl");
    let moved = folder.join("replay-1.jsonl");
    // The hub moves the file aside, reads it and removes it while this write holds it open.
    let mut first = true;
    append(&folder, "{\"id\":\"A\"}\n", &mut || {
        if first {
            first = false;
            fs::rename(&live, &moved).unwrap();
            fs::remove_file(&moved).unwrap();
        }
    })
    .unwrap();
    assert_eq!(fs::read_to_string(&live).unwrap(), "{\"id\":\"A\"}\n");
    fs::remove_dir_all(&folder).unwrap();
}

#[test]
fn a_star_matches_any_run_and_the_rest_matches_whole() {
    assert!(glob(b"pkill *", b"pkill -f node"));
    assert!(glob(b"ls*", b"ls"));
    assert!(glob(b"ls*", b"ls -la"));
    assert!(!glob(b"pkill *", b"git push origin main"));
    assert!(!glob(b"pkill *", b"pkill"));
    assert!(!glob(b"ls*", b"echo ls"));
    assert!(glob(b"a*b*c", b"a xx b yy c"));
    assert!(!glob(b"a*b*c", b"a xx b yy"));
}
