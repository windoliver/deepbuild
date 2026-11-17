use super::*;

fn names(line: &str) -> Vec<String> {
    runs(line, Some(Path::new("/w")), Path::new("/h"))
        .into_iter()
        .map(|r| {
            let mut s = r.program.clone();
            for a in r.words() {
                s.push(' ');
                s.push_str(a);
            }
            if r.looked_up {
                s.push_str(" [looked]");
            }
            s
        })
        .collect()
}

#[test]
fn lookups_feed_kills() {
    assert_eq!(
        names("lsof -ti:3000 | xargs kill -9"),
        ["lsof -ti:3000", "kill -9 [looked]"]
    );
    assert!(names("for p in $(pgrep node); do kill $p; done")
        .last()
        .unwrap()
        .ends_with("[looked]"));
    assert!(names("pgrep node | while read p; do kill \"$p\"; done")
        .iter()
        .any(|n| n.starts_with("kill") && n.ends_with("[looked]")));
    assert!(names("kill $(lsof -t -i :3000)")
        .last()
        .unwrap()
        .ends_with("[looked]"));
    assert_eq!(names("kill 4242"), ["kill 4242"]);
}

#[test]
fn a_glob_matches_like_the_shell() {
    assert!(glob(b"pk?ll", b"pkill"));
    assert!(glob(b"pk[i]ll", b"pkill"));
    assert!(glob(b"p*", b"pkill"));
    assert!(!glob(b"pk[!i]ll", b"pkill"));
}

#[test]
fn a_path_resolved_in_one_call_reads_as_the_walk_reads_it() {
    use std::os::unix::fs::symlink;
    let at = std::env::temp_dir().join(format!("dh-real-{}", std::process::id()));
    let _ = fs::remove_dir_all(&at);
    fs::create_dir_all(at.join("dir/sub")).unwrap();
    fs::write(at.join("dir/sub/file"), "").unwrap();
    symlink(at.join("dir"), at.join("to-dir")).unwrap();
    symlink("dir/sub", at.join("to-sub")).unwrap();
    symlink("dir/sub/file", at.join("to-file")).unwrap();
    symlink("gone/new", at.join("to-gone")).unwrap();
    symlink("..", at.join("dir/up")).unwrap();
    let root = fs::canonicalize(&at).unwrap();
    for (written, read) in [
        ("to-dir/sub/file", "dir/sub/file"),
        ("to-file", "dir/sub/file"),
        ("to-sub/../new", "dir/new"),
        ("dir/up/to-sub/new", "dir/sub/new"),
        ("to-dir/new/deeper", "dir/new/deeper"),
        ("to-gone", "gone/new"),
        ("dir/sub/file/..", "dir/sub"),
    ] {
        assert_eq!(real(&at.join(written)), root.join(read), "{written}");
    }
    let names = [
        "dir", "sub", "file", "to-dir", "to-sub", "to-file", "to-gone", "up", "..", ".", "gone",
        "DIR",
    ];
    let mut spelled = vec![at.display().to_string()];
    for _ in 0..3 {
        spelled = spelled
            .iter()
            .flat_map(|head| names.iter().map(move |name| format!("{head}/{name}")))
            .collect();
        for path in spelled.iter().map(Path::new) {
            assert_eq!(real(path), walk(PathBuf::new(), path), "{}", path.display());
        }
    }
    let here = std::env::current_dir().unwrap();
    let around = Path::new("..").join(here.file_name().unwrap()).join("src");
    assert!(here.join(&around).is_dir());
    for relative in [
        around.as_path(),
        Path::new("src/../Cargo.toml"),
        Path::new(".."),
    ] {
        assert_eq!(
            real(relative),
            walk(PathBuf::new(), relative),
            "{}",
            relative.display()
        );
    }
    fs::remove_dir_all(&at).unwrap();
}

#[test]
fn a_path_through_links_that_loop_is_read_as_written() {
    use std::os::unix::fs::symlink;
    // A stack that runs out ends its process on a signal: the reads run in a child of this binary, so they fail
    // this test and no other.
    if std::env::var_os("DEEP_HOOK_LOOPING_LINKS").is_none() {
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "--nocapture"])
            .arg("shell::tests::a_path_through_links_that_loop_is_read_as_written")
            .env("DEEP_HOOK_LOOPING_LINKS", "1")
            .output()
            .unwrap();
        let said = String::from_utf8_lossy(&child.stdout).to_string()
            + &String::from_utf8_lossy(&child.stderr);
        assert!(child.status.success(), "{}: {said}", child.status);
        assert!(said.contains("1 passed"), "the reads ran: {said}");
        return;
    }
    let at = std::env::temp_dir().join(format!("dh-loop-{}", std::process::id()));
    let _ = fs::remove_dir_all(&at);
    fs::create_dir_all(&at).unwrap();
    symlink("self", at.join("self")).unwrap();
    symlink("b", at.join("a")).unwrap();
    symlink("a", at.join("b")).unwrap();
    symlink(at.join("far"), at.join("near")).unwrap();
    symlink(at.join("near"), at.join("far")).unwrap();
    for (link, to) in [("x", "y"), ("y", "z"), ("z", "x")] {
        symlink(to, at.join(link)).unwrap();
    }
    // A Mac holds a link's target to 1,024 bytes.
    symlink("long/".repeat(200), at.join("long")).unwrap();
    // The system never follows this one: the folder its target passes isn't there.
    symlink("none/../back", at.join("back")).unwrap();
    // Links whose targets pass through those loops, and the same link file in two folders: in `p` it ends in a
    // loop, in `q` at a file that isn't there yet (#2566).
    symlink("back/../link-1", at.join("via-back")).unwrap();
    symlink("none/../self/../link-1", at.join("via-self")).unwrap();
    fs::create_dir_all(at.join("p")).unwrap();
    fs::create_dir_all(at.join("q")).unwrap();
    symlink("none/../t", at.join("p/s")).unwrap();
    symlink("none/../t", at.join("p/t")).unwrap();
    fs::hard_link(at.join("p/s"), at.join("q/s")).unwrap();
    assert!(fs::symlink_metadata(at.join("q/s"))
        .unwrap()
        .file_type()
        .is_symlink());
    symlink("../gone", at.join("q/t")).unwrap();
    // As many links as the system follows, the last to a file that isn't there yet.
    symlink("gone", at.join("link-1")).unwrap();
    let past = format!("link-{}", LINKS + 1);
    for n in 2..=LINKS + 1 {
        symlink(format!("link-{}", n - 1), at.join(format!("link-{n}"))).unwrap();
    }
    let root = fs::canonicalize(&at).unwrap();
    // LINKS is the system's own count: it follows that many to the missing file, and gives up on one more.
    let system = |link: &str| fs::canonicalize(at.join(link)).unwrap_err().kind();
    assert_eq!(
        system(&format!("link-{LINKS}")),
        std::io::ErrorKind::NotFound
    );
    assert_ne!(system(&past), std::io::ErrorKind::NotFound);
    let looped = fs::canonicalize(at.join("self")).unwrap_err();
    assert_eq!(looped.raw_os_error(), Some(ELOOP));
    for (written, read) in [
        ("self", "self"),
        ("self/under", "self/under"),
        ("a", "a"),
        ("b", "b"),
        ("a/../new", "new"),
        ("near", "near"),
        ("x", "x"),
        // A name after links that loop is still resolved.
        ("x/../link-1", "gone"),
        ("self/../a/../link-1/..", ""),
        ("long", "long"),
        ("back", "back"),
        ("back/../link-1", "gone"),
        // A link found to loop, named again, stays as written at once, and a name after it still resolves.
        ("back/../back/../back/../link-1", "gone"),
        ("self/../self/../link-1", "gone"),
        // Reached again through another link's target, it still ends that link's count, and a loop the
        // system reports still doesn't.
        ("back/../via-back", "via-back"),
        ("self/../via-self", "gone"),
        // The same link file in another folder is another link.
        ("p/s/../../q/s", "gone"),
        (&format!("link-{LINKS}"), "gone"),
        // One link more than the system follows: a write through it fails, and it is no path to "gone".
        (&past, &past),
    ] {
        assert_eq!(real(&at.join(written)), root.join(read), "{written}");
    }
    fs::remove_dir_all(&at).unwrap();
}

#[test]
fn syntax_is_read_to_its_nesting_bound_and_is_unread_past_it() {
    let nest = |open: &str, n: usize, close: &str| {
        format!("{}pkill node{}", open.repeat(n), close.repeat(n))
    };
    let unread = |line: &str| {
        runs(line, Some(Path::new("/w")), Path::new("/h"))
            .iter()
            .any(|r| r.unread == Some(Unread::Depth))
    };
    // A simple command inside NESTING - 1 compound ones is NESTING commands deep.
    for (open, close) in [("(", ")"), ("{ ", "; }"), ("if ", "; then :; fi")] {
        let read = nest(open, NESTING - 1, close);
        assert_eq!(names(&read)[0], "pkill node", "{open}");
        assert!(!unread(&read), "{open}");
        assert!(unread(&nest(open, NESTING, close)), "{open}");
    }
    let default = |n: usize| format!("echo {}", nest("${a:-", n, "}"));
    assert_eq!(names(&default(NESTING)), ["echo pkill node"]);
    assert!(!unread(&default(NESTING)));
    assert!(unread(&default(NESTING + 1)));
}
