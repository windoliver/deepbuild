//! The push, pull request, comment and merge predicates: which runs of git, gh, glab, gt, jj, sl and git town do each.

use super::*;

/// A `gh` run whose first two plain words are one of `subs`.
/// A `gh api` call that posts in your name: a POST (by `--method` or `-X`, or by a field, which makes gh post) to an
/// issue's, a pull request's or a commit's comments, a review comment's replies, or a pull request's reviews (#323).
pub(super) fn posts_comment(run: &Run) -> bool {
    let words = run.words();
    let plain = plain(&words);
    if !run.is("gh") || plain.first() != Some(&"api") {
        return false;
    }
    api_method(&words) == "POST"
        && plain[1..].iter().any(|w| {
            let path = w
                .trim_start_matches("https://api.github.com")
                .trim_start_matches('/');
            let parts: Vec<&str> = path.split('?').next().unwrap_or("").split('/').collect();
            parts.first() == Some(&"repos")
                && matches!(
                    parts.get(3..).unwrap_or(&[]),
                    ["issues" | "pulls" | "commits", _, "comments"]
                        | ["pulls", _, "reviews"]
                        | ["pulls", _, "comments", _, "replies"]
                )
        })
}

/// The method of a `gh api` call: the one `--method` or `-X` names, or POST once a field or `--input` makes gh post,
/// else GET.
fn api_method(words: &[&str]) -> String {
    let method = words.iter().enumerate().find_map(|(k, w)| match *w {
        "-X" | "--method" => words.get(k + 1).copied(),
        _ => w
            .strip_prefix("--method=")
            .or(w.strip_prefix("-X"))
            .filter(|m| !m.is_empty() && !m.starts_with('-')),
    });
    match method {
        Some(m) => m.to_uppercase(),
        None if !fields(words).is_empty() || words.contains(&"--input") => "POST".into(),
        None => "GET".into(),
    }
}

/// A run's subcommand and what follows it, past the global options its program takes before one: git's, jj's,
/// sl's, gt's, glab's and git town's. `git town` reads as git-town.
fn sub(run: &Run) -> (&'static str, Vec<&str>) {
    const TOOLS: &[(&str, &[&str])] = &[
        ("git", GIT_VALUED),
        (
            "jj",
            &[
                "-R",
                "--repository",
                "--at-op",
                "--at-operation",
                "--config",
                "--config-toml",
                "--config-file",
                "--color",
            ],
        ),
        (
            "sl",
            &[
                "-R",
                "--repository",
                "--cwd",
                "--config",
                "--configfile",
                "--color",
                "--pager",
                "--encoding",
                "--encodingmode",
            ],
        ),
        ("gt", &["--cwd"]),
        ("glab", &["-R", "--repo"]),
        ("git-town", &[]),
    ];
    let Some((name, valued)) = TOOLS.iter().find(|(name, _)| run.is(name)) else {
        return ("", Vec::new());
    };
    let rest = past(&run.words(), valued);
    match (*name, rest.first()) {
        ("git", Some(&"town")) => ("git-town", rest[1..].to_vec()),
        _ => (name, rest),
    }
}

/// A push by any of the tools that push: `git push`, `jj git push`, `sl push`, `gt submit` and its stack forms, and
/// git town's commands that push.
pub(super) fn pushes(run: &Run) -> bool {
    match sub(run) {
        ("git", rest) => rest.first() == Some(&"push"),
        ("jj", rest) => rest.starts_with(&["git", "push"]),
        ("sl", rest) => rest.first() == Some(&"push"),
        _ => submits(run) || town(run, &["propose", "new-pull-request", "ship", "sync"]),
    }
}

/// What opens a pull request: `gh pr create`, `glab mr create`, `gt submit`, `git town propose`, `sl pr submit`.
pub(super) fn opens_pr(run: &Run) -> bool {
    gh(run, &[&["pr", "create"]])
        || submits(run)
        || town(run, &["propose", "new-pull-request"])
        || match sub(run) {
            ("glab", rest) => {
                rest.starts_with(&["mr", "create"]) || rest.starts_with(&["mr", "new"])
            }
            ("sl", rest) => rest.starts_with(&["pr", "submit"]),
            _ => false,
        }
}

/// `gt submit` and its stack forms, which push the stack's branches and open or update their pull requests.
fn submits(run: &Run) -> bool {
    let ("gt", rest) = sub(run) else { return false };
    let submit = |w: Option<&&str>| matches!(w, Some(&"submit" | &"s"));
    submit(rest.first())
        || rest.first() == Some(&"ss")
        || matches!(
            rest.first(),
            Some(&"stack" | &"upstack" | &"us" | &"downstack" | &"ds" | &"branch" | &"b")
        ) && submit(rest.get(1))
}

/// A git town command among `commands`, as `git town <command>` or `git-town <command>`.
fn town(run: &Run, commands: &[&str]) -> bool {
    matches!(sub(run), ("git-town", rest) if rest.first().is_some_and(|c| commands.contains(c)))
}

/// A merge by any of the tools that merge, and a GraphQL mutation that merges or arms one.
pub(super) fn merges(run: &Run) -> bool {
    gh(run, &[&["pr", "merge"]])
        || merge_endpoint(run).is_some_and(|_| api_method(&run.words()) != "GET")
        || glab_merge_endpoint(run).is_some_and(|_| api_method(&run.words()) != "GET")
        || graphql_merge(run).is_some()
        || gt_merge(run)
        || town(run, &["ship"])
        || matches!(sub(run), ("glab", rest) if rest.starts_with(&["mr", "merge"]) || rest.starts_with(&["mr", "accept"]))
}

/// The word of `glab api` naming a merge request's merge endpoint, `projects/<id>/merge_requests/<n>/merge`.
fn glab_merge_endpoint(run: &Run) -> Option<&str> {
    let ("glab", rest) = sub(run) else {
        return None;
    };
    if rest.first() != Some(&"api") {
        return None;
    }
    rest[1..].iter().copied().find(|w| {
        let parts: Vec<&str> = w.trim_matches('/').split('/').collect();
        parts.len() >= 3
            && parts[parts.len() - 1] == "merge"
            && parts[parts.len() - 3] == "merge_requests"
            && parts[parts.len() - 2].parse::<u64>().is_ok()
    })
}

fn gt_merge(run: &Run) -> bool {
    matches!(sub(run), ("gt", rest) if rest.first() == Some(&"merge"))
}

/// The mutations of a `gh api graphql` call that merge, arm (auto-merge or the merge queue) or disarm a merge.
const MUTATIONS: &[&str] = &[
    "mergePullRequest",
    "enablePullRequestAutoMerge",
    "enqueuePullRequest",
    "disablePullRequestAutoMerge",
    "dequeuePullRequest",
];
const ARMS: &[&str] = &["enablePullRequestAutoMerge", "enqueuePullRequest"];
const DISARMS: &[&str] = &["disablePullRequestAutoMerge", "dequeuePullRequest"];

/// The query of a `gh api graphql` call that merges, arms or disarms a merge, with its fields. A mutation's name
/// anywhere in it counts, a comment's too, so none hides behind a `#`. A query deep-hook can't read, from a file
/// (`@`), `--input`, a variable or none at all, is a merge with no head: the empty query.
fn graphql_merge(run: &Run) -> Option<(String, Vec<(String, String)>)> {
    let words = run.words();
    let at = api_at(run, &words)?;
    if !words[at..].contains(&"graphql") {
        return None;
    }
    let fields = fields(&words);
    let query = fields
        .iter()
        .find(|(k, _)| k == "query")
        .map(|(_, v)| v.clone());
    let Some(query) = query.filter(|q| !q.is_empty() && !q.starts_with('@') && !q.starts_with('$'))
    else {
        return Some((String::new(), fields));
    };
    MUTATIONS
        .iter()
        .any(|m| holds_word(&query, m))
        .then_some((query, fields))
}

/// A GraphQL argument's literal value for `name`, or the field a `$variable` in its place names; none unless the
/// query names it exactly once, as one merge's input does. A `$name` is a variable, not the argument.
fn graphql_value(query: &str, fields: &[(String, String)], name: &str) -> Option<String> {
    let args: Vec<usize> = words_at(query, name)
        .filter(|&at| !query[..at].ends_with('$'))
        .collect();
    let [at] = args[..] else { return None };
    let rest = query[at + name.len()..]
        .trim_start()
        .strip_prefix(':')?
        .trim_start();
    if let Some(var) = rest.strip_prefix('$') {
        // gh keeps the last field of a name; one given twice names no head.
        let var: String = var
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        let values: Vec<&String> = fields
            .iter()
            .filter(|(k, _)| *k == var)
            .map(|(_, v)| v)
            .collect();
        let [value] = values[..] else { return None };
        return Some(value.clone());
    }
    let value = rest.strip_prefix('"')?;
    value.find('"').map(|end| value[..end].to_string())
}

pub(super) fn gh(run: &Run, subs: &[&[&str]]) -> bool {
    let two = first_two(&run.words(), GH_VALUED);
    run.is("gh") && subs.iter().any(|s| two[..] == **s)
}

/// Where a `gh api` call's words past `api` start, gh's own options before it skipped; none for another call.
fn api_at(run: &Run, words: &[&str]) -> Option<usize> {
    if !run.is("gh") {
        return None;
    }
    let at = words.iter().position(|w| !w.starts_with('-'))?;
    (words[at] == "api").then_some(at + 1)
}

/// The word of `gh api` naming a pull request's merge endpoint, `repos/<owner>/<repo>/pulls/<n>/merge`.
fn merge_endpoint(run: &Run) -> Option<&str> {
    let words = run.words();
    let at = api_at(run, &words)?;
    words[at..].iter().copied().find(|w| {
        let parts: Vec<&str> = w.trim_matches('/').split('/').collect();
        parts.len() >= 3
            && parts[parts.len() - 1] == "merge"
            && parts[parts.len() - 3] == "pulls"
            && parts[parts.len() - 2].parse::<u64>().is_ok()
    })
}

/// What a merge names, as the hub reads it from the entry's note (#84): `merge pr=12 head=<sha> auto disable blind`,
/// each part only when the call has it. One commit, for `--match-head-commit`, the API's `sha` field, GraphQL's
/// `expectedHeadOid` or `glab mr merge --sha`; `blind` for `gt merge` and `git town ship`, which can't name one.
pub(super) fn merge_read(run: &Run) -> String {
    let words = run.words();
    let value = |flag: &str| {
        words.iter().enumerate().find_map(|(k, w)| {
            w.strip_prefix(&format!("{flag}="))
                .or_else(|| (*w == flag).then(|| words.get(k + 1).copied()).flatten())
        })
    };
    let (sub_name, rest) = sub(run);
    let mut disable = words.contains(&"--disable-auto");
    let (pr, head, auto) = if let Some(path) = merge_endpoint(run) {
        let pr = path
            .trim_matches('/')
            .rsplit('/')
            .nth(1)
            .map(str::to_string);
        (
            pr,
            words
                .iter()
                .find_map(|w| w.strip_prefix("sha="))
                .map(str::to_string),
            false,
        )
    } else if let Some((query, fields)) = graphql_merge(run) {
        // A head covers one merge: a query that holds more than one names none.
        let one = MUTATIONS
            .iter()
            .map(|m| words_at(&query, m).count())
            .sum::<usize>()
            == 1;
        let any = |names: &[&str]| names.iter().any(|m| holds_word(&query, m));
        // A query that disarms and also merges or arms is read as the merge, since `disable` alone skips the head rule.
        if any(DISARMS) && !any(ARMS) && !holds_word(&query, "mergePullRequest") {
            disable = true;
        }
        // A head only a comment names is none: the argument must be there with the comments taken out too.
        let bare: String = query
            .lines()
            .map(|l| l.split('#').next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        let head = graphql_value(&query, &fields, "expectedHeadOid")
            .filter(|_| one && holds_word(&bare, "expectedHeadOid"));
        (
            graphql_value(&query, &fields, "pullRequestId"),
            head,
            any(ARMS),
        )
    } else if let Some(path) = glab_merge_endpoint(run) {
        let pr = path
            .trim_matches('/')
            .rsplit('/')
            .nth(1)
            .map(str::to_string);
        (
            pr,
            words
                .iter()
                .find_map(|w| w.strip_prefix("sha="))
                .map(str::to_string),
            false,
        )
    } else if sub_name == "glab" {
        (
            plain(&rest).get(2).map(|p| p.to_string()),
            value("--sha").map(str::to_string),
            false,
        )
    } else {
        // The repository `-R` names is no pull request.
        let named: Vec<&str> = (0..words.len())
            .filter(|&k| k == 0 || !GH_VALUED.contains(&words[k - 1]))
            .map(|k| words[k])
            .collect();
        let pr = plain(&named).get(2).map(|p| p.to_string());
        (pr, value("--match-head-commit").map(str::to_string), false)
    };
    if gt_merge(run) || town(run, &["ship"]) {
        return "merge blind".into();
    }
    let mut read = String::from("merge");
    if let Some(pr) = pr {
        read.push_str(&format!(" pr={pr}"));
    }
    if let Some(head) = head {
        read.push_str(&format!(" head={head}"));
    }
    if auto || words.contains(&"--auto") {
        read.push_str(" auto");
    }
    if disable {
        read.push_str(" disable");
    }
    read
}
