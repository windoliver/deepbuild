use super::*;

fn bash(line: &str) -> Call {
    Call::new(
        "Bash",
        Some(line),
        (&[], &[], Names::Writes),
        Some(Path::new("/w")),
        Path::new("/h"),
        Path::new("/h/.deepbuild/hub.sock"),
    )
}

#[test]
fn the_shipped_service_rule_guards_what_changes_the_hub_s_environment() {
    let rule = include_str!("../default-rules.json")
        .split("\"no-hub-service-write\"")
        .nth(1)
        .and_then(|entry| entry.split("\"match\": \"").nth(1))
        .and_then(|tail| tail.split('"').next())
        .unwrap();
    let written = |path: &str| {
        let call = Call::new(
            "Write",
            None,
            (&[path.to_string()], &[], Names::Writes),
            Some(Path::new("/w")),
            Path::new("/h"),
            Path::new("/h/.deepbuild/hub.sock"),
        );
        call.matches(rule).is_some()
    };
    assert!(written("/h/.config/systemd/user/deepbuild-hub.service"));
    assert!(written(
        "/h/.config/systemd/user/deepbuild-hub.service.d/polkit.conf"
    ));
    assert!(written("/h/.config/environment.d/hub.conf"));
    assert!(!written("/h/.config/systemd/user/other.service"));
}

#[test]
fn unread_matches_only_a_call_the_reader_couldnt_read_whole() {
    assert!(known("unread:push") && !known("unread:nothing"));
    let hit = bash("\"$(printf git)\" push origin main")
        .matches("unread:push")
        .unwrap();
    assert!(hit.detail.unwrap().contains("couldn't be read"));
    assert!(bash("git push origin main")
        .matches("unread:push")
        .is_none());
    assert!(bash("\"$CC\" -o app main.c")
        .matches("unread:push")
        .is_none());
}

#[test]
fn a_call_read_in_part_meets_the_entries_it_may_be() {
    for line in [
        "\"$(printf git)\" push origin main",
        "\"$G\" push origin main",
    ] {
        let hit = bash(line).matches("effect:push").expect(line);
        assert!(hit.detail.unwrap().contains("couldn't be read"));
        assert!(bash(line).matches("run:git push").is_some(), "{line}");
        assert!(bash(line).matches("effect:merge").is_none(), "{line}");
    }
    let cc = bash("\"$CC\" -o app main.c");
    for pattern in [
        "effect:push",
        "run:git push",
        "effect:unknown-reach-delete",
        "effect:cloud-resource",
    ] {
        assert!(cc.matches(pattern).is_none(), "{pattern}");
    }
    assert!(bash("\"$X\" pr merge 12").matches("effect:merge").is_some());
    assert!(bash("\"$X\" -rf \"$OUT\"/*")
        .matches("effect:unknown-reach-delete")
        .is_some());
    let nest = |n: usize| {
        let mut line = "pkill node".to_string();
        for _ in 0..n {
            line = format!("sh -c {}", quote(&line));
        }
        bash(&line)
    };
    let read = nest(shell::DEPTH).matches("kill:by-name").unwrap();
    assert!(read.detail.is_none());
    let deep = nest(shell::DEPTH + 1).matches("kill:by-name").unwrap();
    assert!(deep.detail.unwrap().contains("nests"));
    assert!(nest(shell::DEPTH + 1).matches("run:deep off").is_some());
}

#[test]
fn a_word_is_whole_and_no_part_of_a_path() {
    let m = "word:kafka";
    assert!(bash("npm install kafka").matches(m).is_some());
    assert!(bash("npm install Kafka").matches(m).is_some());
    assert!(bash("npm install kafka-lite").matches(m).is_none());
    assert!(bash("cat src/kafka/a.ts").matches(m).is_none());
}

#[test]
fn a_rule_you_add_matches_what_the_call_runs() {
    let m = "run:terraform apply";
    assert!(bash("terraform apply").matches(m).is_some());
    assert!(
        bash("cd infra && env TF_LOG=1 terraform -chdir=x apply -auto-approve")
            .matches(m)
            .is_some()
    );
    assert!(bash("terraform plan").matches(m).is_none());
    assert!(bash("echo terraform apply").matches(m).is_none());
}

#[test]
fn a_stash_saved_with_no_message_is_unnamed() {
    assert!(bash("git stash save")
        .matches("git:stash-unnamed")
        .is_some());
    assert!(bash("git stash save -u")
        .matches("git:stash-unnamed")
        .is_some());
    assert!(bash("git stash save wip-316")
        .matches("git:stash-unnamed")
        .is_none());
}

#[test]
fn a_glob_after_a_bang_takes_paths_out() {
    let m = "write:.deepbuild/* !~/.deepbuild/*";
    assert!(bash("echo x > /repo/.deepbuild/done.yaml")
        .matches(m)
        .is_some());
    assert!(bash("echo x > /h/.deepbuild/workspaces/a")
        .matches(m)
        .is_none());
}

/// Paths under a folder that isn't there, so nothing resolves them on disk.
#[cfg(target_os = "macos")]
#[test]
fn a_name_the_mac_takes_for_a_guarded_one_is_guarded() {
    let m = "write:.deepbuild/* ~/.deepbuild/* !~/.deepbuild/workspaces/*";
    for line in [
        "echo x > /nowhere/.DEEPBUILD/done.yaml",
        "echo x > /nowhere/.DeepBuild/done.yaml",
        "echo x > /nowhere/.deepbuild/ſpec.md",
        "echo x > /nowhere/.deepbuild/\u{212A}ey",
        "echo x > /nowhere/.deepbuild/ﬁle",
        "echo x > /H/.DEEPBUILD/config.json",
    ] {
        assert!(bash(line).matches(m).is_some(), "{line}");
    }
    assert!(bash("echo x > /H/.deepbuild/WORKSPACES/a")
        .matches(m)
        .is_none());
    let ss = "write:.pi/settings.json";
    assert!(bash("echo x > /nowhere/.PI/SETTINGS.json")
        .matches(ss)
        .is_some());
    assert!(bash("echo x > /nowhere/.pi/settingſ.json")
        .matches(ss)
        .is_some());
    assert!(bash("echo x > /nowhere/.deepbuild/a")
        .matches("write:.DeepBuild/a")
        .is_some());
    assert!(
        bash("launchctl unload ~/Library/LaunchAgents/COM.DEEPBUILD.HUB.plist")
            .matches("hub:service")
            .is_some()
    );
    assert!(bash("ſed -i '' s/a/b/ .deepbuild/a")
        .matches("write:.deepbuild/a")
        .is_some());
    assert!(bash("baſh -c 'pkill x'").matches("run:pkill").is_some());
    let sharp = "write:.deepbuild/pass";
    assert!(bash("echo x > /nowhere/.deepbuild/paß")
        .matches(sharp)
        .is_some());
    assert!(bash("echo x > /nowhere/.deepbuild/other")
        .matches(sharp)
        .is_none());
}

#[cfg(target_os = "macos")]
#[test]
fn each_letter_that_folds_to_ascii_reads_as_its_fold() {
    for (guarded, spelled) in [
        ("sa", "ſa"),
        ("ka", "\u{212A}a"),
        ("ssa", "ßa"),
        ("ssb", "ẞb"),
        ("ffa", "ﬀa"),
        ("fia", "ﬁa"),
        ("fla", "ﬂa"),
        ("ffia", "ﬃa"),
        ("ffla", "ﬄa"),
        ("sta", "ﬅa"),
        ("stb", "ﬆb"),
    ] {
        let m = format!("write:/nowhere/{guarded}");
        assert!(
            bash(&format!("echo x > /nowhere/{spelled}"))
                .matches(&m)
                .is_some(),
            "{spelled}"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn a_script_whose_interpreter_the_mac_finds_is_read() {
    let folder = std::env::temp_dir().join(format!("dh863-script-{}", std::process::id()));
    fs::create_dir_all(&folder).unwrap();
    for (name, first) in [("upper", "#!/BIN/BASH"), ("fold", "#!/bin/baſh")] {
        let script = folder.join(name);
        fs::write(&script, format!("{first}\npkill x\n")).unwrap();
        assert!(
            bash(&script.to_string_lossy())
                .matches("run:pkill")
                .is_some(),
            "{first}"
        );
    }
    fs::remove_dir_all(&folder).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn a_link_a_program_and_its_arguments_read_as_the_mac_reads_them() {
    assert!(bash("ln -s ~/.deepbuild/config.json l; echo x > L")
        .matches("write:.deepbuild/config.json")
        .is_some());
    assert!(bash("cat .DEEPBUILD/secret")
        .matches("run:cat .deepbuild/secret")
        .is_some());
    assert!(bash("rm -R a").matches("run:rm -r").is_none());
    assert!(bash("ſed x").matches("run:ſed").is_some());
    assert!(bash("weiß x").matches("run:weiß").is_some());
}

#[test]
fn the_floor_reads_what_scope_names_beyond_the_criteria() {
    let home = "write:~/.deepbuild ~/.deepbuild/* !~/.deepbuild/workspaces/*";
    assert!(bash("touch ~/.deepbuild/workspaces/a/f")
        .matches(home)
        .is_none());
    assert!(bash("touch ~/.deepbuild/config.json")
        .matches(home)
        .is_some());
    assert!(
        bash("launchctl unload -w ~/Library/LaunchAgents/com.deepbuild.hub.plist")
            .matches("hub:service")
            .is_some()
    );
    assert!(bash("systemctl --user stop deepbuild-hub.service")
        .matches("hub:service")
        .is_some());
    // The hub's environment is its service's: a variable set for the manager reaches it at the next restart (#70).
    assert!(
        bash("systemctl --user set-environment DEEP_HUB_PLANT=answer-on-token")
            .matches("hub:service")
            .is_some()
    );
    assert!(bash("systemctl --user import-environment NODE_OPTIONS")
        .matches("hub:service")
        .is_some());
    assert!(bash("systemctl --user edit deepbuild-hub.service")
        .matches("hub:service")
        .is_some());
    assert!(bash("systemctl --user status deepbuild-hub.service")
        .matches("hub:service")
        .is_none());
    assert!(bash("launchctl list").matches("hub:service").is_none());
    assert!(bash("docker compose up -d")
        .matches("effect:service")
        .is_some());
    assert!(bash("docker ps").matches("effect:service").is_none());
    assert!(bash("git -C ../shop push origin main")
        .matches("effect:push")
        .is_some());
    assert!(bash("echo 'git push origin main'")
        .matches("effect:push")
        .is_none());
    assert!(bash("git commit -m push").matches("effect:push").is_none());
    assert!(bash("gh pr merge 12 --squash")
        .matches("effect:merge")
        .is_some());
    assert!(bash("gh pr view 12").matches("effect:merge").is_none());
    assert!(bash("gh issue comment 3 --body hi")
        .matches("effect:send")
        .is_some());
    assert!(bash(
        "gh api --method POST repos/acme/shop/pulls/23/comments/9101/replies -f body='Fixed.'"
    )
    .matches("effect:send")
    .is_some());
    assert!(bash("gh api repos/acme/shop/issues/3/comments -f body=hi")
        .matches("effect:send")
        .is_some());
    assert!(bash("gh api repos/acme/shop/pulls/23/comments")
        .matches("effect:send")
        .is_none());
    assert!(bash("gh repo delete acme/shop --yes")
        .matches("effect:delete")
        .is_some());
    assert!(bash("gh repo view acme/shop")
        .matches("effect:delete")
        .is_none());
    assert!(bash("rm -rf \"$OUT\"")
        .matches("effect:unknown-reach-delete")
        .is_some());
    assert!(bash("rm -rf out")
        .matches("effect:unknown-reach-delete")
        .is_none());
}

#[test]
fn an_options_value_is_not_read_as_the_subcommand() {
    let has = |line: &str, class: &str| bash(line).matches(&format!("effect:{class}")).is_some();
    for (line, class) in [
        ("aws kms create-key --profile shop-prod", "cloud-resource"),
        ("aws --profile shop-prod kms create-key", "cloud-resource"),
        (
            "aws --region us-east-1 ec2 run-instances --image-id ami-1",
            "cloud-resource",
        ),
        ("aws --region us-east-1 s3 mb s3://bucket", "cloud-resource"),
        (
            "aws s3 --profile shop-prod mb s3://bucket",
            "cloud-resource",
        ),
        (
            "aws --profile \"$P\" --output json kms create-key",
            "cloud-resource",
        ),
        ("docker compose -f docker-compose.dev.yml up -d", "service"),
        ("docker compose -p shop --env-file .env up", "service"),
        ("docker --context prod compose up", "service"),
        ("docker --context prod run -d nginx", "service"),
        ("docker run -p 80:80 nginx", "service"),
        ("docker-compose -f docker-compose.yml up -d", "service"),
        ("gh pr -R acme/shop merge 12", "merge"),
        ("gh pr --repo acme/shop create --fill", "pr"),
        ("gh issue -R acme/shop comment 3 --body hi", "send"),
        ("gh release -R acme/shop delete v1", "delete"),
    ] {
        assert!(has(line, class), "{line} as {class}");
    }
    for (line, class) in [
        ("aws s3 --profile create-prod ls", "cloud-resource"),
        ("aws --profile shop-prod kms list-keys", "cloud-resource"),
        ("docker compose --profile up ps", "service"),
        ("docker compose -f docker-compose.dev.yml ps", "service"),
        ("docker --context run ps", "service"),
        ("gh pr -R acme/shop view 12", "merge"),
    ] {
        assert!(!has(line, class), "{line} as {class}");
    }
    let read = |line: &str| bash(line).matches("effect:merge").unwrap().detail.unwrap();
    assert_eq!(read("gh pr -R acme/shop merge 12"), "merge pr=12");
    assert_eq!(
        read("gh pr merge --repo acme/shop 12 --auto"),
        "merge pr=12 auto"
    );
    assert_eq!(
        read("gh pr merge 12 --match-head-commit abc1234"),
        "merge pr=12 head=abc1234"
    );
}

#[test]
fn push_pr_and_merge_read_every_tools_spelling() {
    let has = |line: &str, class: &str| bash(line).matches(&format!("effect:{class}")).is_some();
    let q = "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_1\", expectedHeadOid: \"abc1234\"}) { clientMutationId } }'";
    for (line, classes) in [
        ("jj git push --bookmark main", &["push"][..]),
        ("jj -R ../shop git push", &["push"]),
        ("sl push --to main", &["push"]),
        ("gt submit --stack", &["push", "pr"]),
        ("gt ss", &["push", "pr"]),
        ("gt stack submit", &["push", "pr"]),
        ("git town propose", &["push", "pr"]),
        ("git-town sync", &["push"]),
        ("git town ship", &["push", "merge"]),
        ("sl pr submit", &["pr"]),
        ("glab mr create --fill", &["pr"]),
        ("glab mr merge 3", &["merge"]),
        ("gt merge", &["merge"]),
        (q, &["merge"]),
        ("gh api -X PUT repos/acme/shop/pulls/3/merge", &["merge"]),
        ("gh issue create -t x", &["send"]),
    ] {
        for class in ["push", "pr", "merge", "send"] {
            assert_eq!(
                has(line, class),
                classes.contains(&class),
                "{line} as {class}"
            );
        }
    }
    for line in [
        "jj log",
        "jj git fetch",
        "jj describe -m 'git push'",
        "gt log",
        "git town status",
        "sl log",
        "glab mr view 3",
        "gh api repos/acme/shop/pulls/3",
        "gh api repos/acme/shop/pulls/3/merge",
        "gh api --method GET repos/acme/shop/pulls/3/merge",
        "gh api graphql -f query='{ repository(owner: \"a\", name: \"b\") { id } }'",
    ] {
        for class in ["push", "pr", "merge", "send"] {
            assert!(!has(line, class), "{line} as {class}");
        }
    }
    let read = |line: &str| bash(line).matches("effect:merge").unwrap().detail.unwrap();
    assert_eq!(read(q), "merge pr=PR_1 head=abc1234");
    assert_eq!(
            read("gh api graphql -f query='mutation($h: GitObjectID) { enablePullRequestAutoMerge(input: {pullRequestId: \"PR_1\", expectedHeadOid: $h}) { clientMutationId } }' -f h=abc1234"),
            "merge pr=PR_1 head=abc1234 auto"
        );
    assert_eq!(
            read("gh api graphql -f query='mutation($expectedHeadOid: GitObjectID!) { mergePullRequest(input: {pullRequestId: \"PR_1\", expectedHeadOid: $expectedHeadOid}) { clientMutationId } }' -f expectedHeadOid=abc1234"),
            "merge pr=PR_1 head=abc1234"
        );
    let two = "gh api graphql -f query='mutation { a: mergePullRequest(input: {pullRequestId: \"A\", expectedHeadOid: \"abc1234\"}) { clientMutationId } b: mergePullRequest(input: {pullRequestId: \"B\"}) { clientMutationId } }'";
    assert!(!read(two).contains("head="), "two merges name no one head");
    let commented = "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"A\" # expectedHeadOid: \"abc1234\"\n}) { clientMutationId } }'";
    assert!(
        !read(commented).contains("head="),
        "a comment names no head"
    );
    let hidden = "gh api graphql -f query='mutation { addComment(input: {subjectId: \"I\", body: \"#\"}) { clientMutationId } m: mergePullRequest(input: {pullRequestId: \"A\"}) { clientMutationId } }'";
    assert!(has(hidden, "merge"), "a `#` in a string hides no merge");
    assert_eq!(
            read("gh api graphql -f query='mutation { disablePullRequestAutoMerge(input: {pullRequestId: \"PR_1\"}) { clientMutationId } }'"),
            "merge pr=PR_1 disable"
        );
    assert_eq!(
            read("gh api graphql -f query='mutation { mergePullRequest(input: {clientMutationId: \"\u{130}\u{130}\", pullRequestId: \"A\", expectedHeadOid: \"abc1234\"}) { clientMutationId } }'"),
            "merge pr=A head=abc1234"
        );
    assert_eq!(
        read("glab mr merge 3 --sha abc1234"),
        "merge pr=3 head=abc1234"
    );
    // Review round at 642a592e: gh's options before `graphql`, a query deep-hook can't read, the merge queue,
    // GitLab's REST merge, a disarm that also merges, a variable given twice, and global options before a push.
    let m = "mutation { mergePullRequest(input: {pullRequestId: \"A\"}) { clientMutationId } }";
    for line in [
            format!("gh api -X POST graphql -f query='{m}'"),
            format!("gh api --hostname ghe.example.com graphql -f query='{m}'"),
            format!("gh api -H 'X-Github-Next-Global-ID: 1' graphql -f query='{m}'"),
            format!("gh api graphql -fquery='{m}'"),
            "gh api graphql -F query=@merge.graphql".into(),
            "gh api graphql --input body.json".into(),
            "gh api graphql -f query=\"$Q\"".into(),
            "gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: \"A\"}) { clientMutationId } }'".into(),
            "glab api -X PUT projects/1/merge_requests/3/merge".into(),
        ] {
            assert!(has(&line, "merge"), "{line} as merge");
        }
    assert!(
        !has("glab api projects/1/merge_requests/3/merge", "merge"),
        "a GET of the endpoint"
    );
    assert!(has("sl --color never push --to main", "push"));
    assert!(has("jj --config-toml 'x=1' git push", "push"));
    let both = "gh api graphql -f query='mutation { d: disablePullRequestAutoMerge(input: {pullRequestId: \"A\"}) { clientMutationId } m: mergePullRequest(input: {pullRequestId: \"A\", expectedHeadOid: \"abc1234\"}) { clientMutationId } }'";
    assert_eq!(
        read(both),
        "merge",
        "disarming and merging at once is a merge with no head and no disable"
    );
    let twice = "gh api graphql -f query='mutation($h: GitObjectID) { mergePullRequest(input: {pullRequestId: \"A\", expectedHeadOid: $h}) { clientMutationId } }' -f h=abc1234 -F h=def5678";
    assert_eq!(
        read(twice),
        "merge pr=A",
        "a variable given twice names no head"
    );
    assert_eq!(
            read("gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: \"A\", expectedHeadOid: \"abc1234\"}) { clientMutationId } }'"),
            "merge pr=A head=abc1234 auto"
        );
    assert_eq!(read("gh api graphql -f query='mutation { dequeuePullRequest(input: {id: \"A\"}) { clientMutationId } }'"), "merge disable");
    assert_eq!(
        read("glab api -X PUT projects/1/merge_requests/3/merge -f sha=abc1234"),
        "merge pr=3 head=abc1234"
    );
    assert_eq!(read("gh api graphql -F query=@merge.graphql"), "merge");
    assert_eq!(read("gt merge"), "merge blind");
    assert_eq!(read("git town ship"), "merge blind");
    let unread = bash("\"$(printf jj)\" git push")
        .matches("unread:push")
        .unwrap();
    assert!(unread.detail.unwrap().contains("printf jj"));
    assert!(bash("\"$(printf gh)\" issue create -t x")
        .matches("effect:send")
        .is_some());
}

#[test]
fn a_folder_made_at_the_checkouts_top_is_new() {
    let repo = std::env::temp_dir().join(format!("dh317-top-{}", std::process::id()));
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::create_dir_all(repo.join("src")).unwrap();
    let call = |line: &str| {
        Call::new(
            "Bash",
            Some(line),
            (&[], &[], Names::Writes),
            Some(&repo),
            Path::new("/h"),
            Path::new("/h/s"),
        )
        .matches("effect:top-level-folder")
        .is_some()
    };
    let (made, file, existing) = (
        call("mkdir infra"),
        call("echo x > notes.md && mkdir src/a"),
        call("mkdir src/b"),
    );
    // #1503: a string in an inline program is a path it may reach, not a folder it makes.
    let held = call("python3 -c \"print(10/2); print('https://example.com/a/b')\"");
    fs::remove_dir_all(&repo).unwrap();
    assert!(!held, "an inline program's strings make no folder");
    assert!(made, "mkdir of a new folder at the top is recorded");
    assert!(
        !file,
        "a file at the top, and a folder under an existing one, are not"
    );
    assert!(!existing);
}

#[test]
fn a_patch_writes_the_files_it_names() {
    let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n*** Add File: .mcp.json\n+{}\n*** End Patch\n";
    let paths = patched(patch);
    assert_eq!(paths, ["src/a.rs", ".mcp.json"]);
    let call = Call::new(
        "apply_patch",
        None,
        (&paths, &[], Names::Writes),
        Some(Path::new("/repo")),
        Path::new("/h"),
        Path::new("/h/.deepbuild/hub.sock"),
    );
    assert!(call.matches("write:.mcp.json").is_some());
    assert!(call.matches("write:.claude/settings.json").is_none());
}

#[test]
fn a_discard_is_read_by_its_effect_and_a_move_of_the_work_is_not() {
    let discards = |line: &str| bash(line).matches("effect:discard-edits").is_some();
    for line in [
        "git reset --hard HEAD~2",
        "git reset --har",
        "git reset --merge",
        "git checkout -f main",
        "git checkout -- src/a.ts",
        "git checkout HEAD~1 -- src/a.ts",
        "git checkout \"$BRANCH\"",
        "git restore src/a.ts",
        "git restore -SW src/a.ts",
        "git restore --source=HEAD~1 src/a.ts",
        "git switch --discard-changes main",
        "git switch -fq main",
        "git rm -f src/a.ts",
        "git rm -rf src",
        "git checkout-index -a -f",
        "git read-tree -u --reset HEAD",
        "git worktree remove --force /w2",
        "git merge --abort",
        "git rebase --abort",
        "git rebase --skip",
        "git cherry-pick --abort",
        "git revert --abort",
        "git am --abort",
    ] {
        assert!(discards(line), "{line}");
    }
    for line in [
        "git reset --soft HEAD~1",
        "git reset HEAD src/a.ts",
        "git checkout -- ",
        "git checkout -b fix -- ",
        "git restore --staged src/a.ts",
        "git restore -S src/a.ts",
        "git switch main",
        "git switch -c fix",
        "git switch -cfix",
        "git log --hard",
        "echo git reset --hard",
        "git rm src/a.ts",
        "git rm -f --cached src/a.ts",
        "git checkout-index -a",
        "git read-tree HEAD",
        "git worktree remove /w2",
        "git worktree add -f /w2",
        "git merge --continue",
        "git rebase --continue",
        "git rebase --quit",
    ] {
        assert!(!discards(line), "{line}");
    }
}

#[test]
fn a_discard_reaches_its_paths_or_the_whole_tree() {
    let edits = |line: &str| {
        bash(line).edits().map(|p| {
            p.iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
        })
    };
    assert_eq!(
        edits("git checkout -- src/a.ts src"),
        Some(vec!["/w/src".to_string()])
    );
    assert_eq!(edits("git restore -- '*.ts'"), Some(vec!["/w".to_string()]));
    assert_eq!(
        edits("git -C sub restore -- a.ts"),
        Some(vec!["/w/sub/a.ts".to_string()])
    );
    // The line doesn't say where it works, or aims git at another tree: nothing can be listed.
    assert_eq!(edits("cd \"$REPO\" && git reset --hard"), None);
    assert_eq!(edits("git --work-tree=/x reset --hard"), None);
    assert_eq!(edits("GIT_DIR=/x/.git git reset --hard"), None);
    assert_eq!(
        edits("git rm -f -- src/a.ts"),
        Some(vec!["/w/src/a.ts".to_string()])
    );
    assert_eq!(edits("git merge --abort"), Some(vec!["/w".to_string()]));
    assert_eq!(
        edits("git worktree remove -f -- /w2"),
        Some(vec!["/w2".to_string()])
    );
    assert_eq!(edits("git worktree remove -f \"$TREE\""), None);
}

#[test]
fn a_stash_drop_names_its_entry() {
    let stash = |line: &str| {
        bash(line).stash().map(|p| {
            p.iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
        })
    };
    assert_eq!(
        stash("git stash drop -q stash@{1}"),
        Some(vec!["/w".to_string(), "stash@{1}".to_string()])
    );
    assert_eq!(
        stash("git stash drop"),
        Some(vec!["/w".to_string(), "stash@{0}".to_string()])
    );
    assert_eq!(stash("git stash clear"), Some(vec!["/w".to_string()]));
    assert_eq!(stash("git stash drop \"$E\""), None);
    // The second drop's stash@{0} is the first one's stash@{1}.
    assert_eq!(stash("git stash drop && git stash drop"), None);
}

/// A call in `cwd`, a fresh checkout under `/w`'s stand-in: no `.git` on disk, so the folder is the worktree.
fn bash_in(line: &str, cwd: &Path, home: &Path) -> Call {
    Call::new(
        "Bash",
        Some(line),
        (&[], &[], Names::Writes),
        Some(cwd),
        home,
        &home.join(".deepbuild/hub.sock"),
    )
}

#[test]
fn a_delete_past_its_worktree_is_unrestorable_and_one_inside_it_is_free() {
    let home = std::env::temp_dir().join(format!("dh1507-home-{}", std::process::id()));
    let repo = home.join("work/repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::create_dir_all(home.join("work/sibling")).unwrap();
    let home = real(&home);
    let repo = real(&repo);
    let past = |line: &str| {
        bash_in(line, &repo, &home)
            .matches("effect:unrestorable-delete")
            .is_some()
    };
    for line in [
        "rm -rf tests/ plan/ ~/",
        "rm -rf ~",
        "rm -rf /",
        "rm -rf ..",
        "rm -rf ../sibling",
        "unlink ../sibling/a",
        "shred -u ~/notes.txt",
        "find .. -delete",
        "rsync -a --delete empty/ ../sibling/",
        "cd .. && rm -rf repo",
        "git clean -fdx",
        "git clean -f",
        "git -C ../sibling clean -fd",
        "git clean --force -d",
    ] {
        assert!(past(line), "{line} reaches past its worktree");
    }
    for line in [
        "rm -rf node_modules",
        "rm -rf build/",
        "rm -rf ./build ../repo/dist",
        "rm /tmp/x",
        "find . -name '*.o' -delete",
        "find -delete",
        "rsync -a --delete src/ out/",
        "git clean -n",
        "git clean -fdn",
        "git clean --dry-run -f",
        "git clean",
        "ls ~",
        // A pattern's or a value's reach can't be worked out: the other class's (#347).
        "rm -rf ../*",
        "rm -rf \"$OUT\"",
    ] {
        assert!(!past(line), "{line} stays inside, or is the other class's");
    }
    // A folder with no checkout counts its working folder as the worktree.
    let bare = home.join("scratch");
    fs::create_dir_all(&bare).unwrap();
    let free = |line: &str| {
        bash_in(line, &bare, &home)
            .matches("effect:unrestorable-delete")
            .is_none()
    };
    assert!(free("rm -rf out"));
    assert!(!free("rm -rf ../work"));
    // The home folder is never a temporary folder, even under /tmp.
    let hit = bash_in("rm -rf ~/", &repo, &home)
        .matches("effect:unrestorable-delete")
        .unwrap();
    assert!(hit.detail.unwrap().contains(&home.display().to_string()));
    assert_eq!(
        bash_in("rm -rf tests/ plan/ ~/", &repo, &home).past(),
        Some(vec![home.clone()])
    );
    assert_eq!(
        bash_in("rm -rf ../sibling build", &repo, &home).past(),
        Some(vec![home.join("work/sibling")])
    );
    assert_eq!(
        bash_in("git clean -fdx", &repo, &home).past(),
        Some(vec![repo.clone()])
    );
    let _ = fs::remove_dir_all(&home);
}
