use std::io::Write;
use std::process::Command;

#[test]
fn a_session_start_reports_whether_each_route_variable_is_set_never_its_value() {
    let url = "http://127.0.0.1:9/dh1886-bridge";
    let start = |case: &str, env: &[(&str, &str)]| {
        let home = std::env::temp_dir().join(format!("dh1886-route-{case}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
            .args(["claude-code", "SessionStart"])
            .env_clear()
            .env("HOME", &home)
            .envs(env.iter().copied())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let payload = br#"{"session_id":"s","hook_event_name":"SessionStart","source":"startup"}"#;
        child.stdin.take().unwrap().write_all(payload).unwrap();
        let exited = child.wait().ok();
        let spooled =
            std::fs::read_to_string(home.join(".deepbuild/spool/spool.jsonl")).unwrap_or_default();
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(
            exited.and_then(|s| s.code()),
            Some(0),
            "{case}: the hook is allowed"
        );
        assert!(
            !spooled.contains("127.0.0.1:9") && !spooled.contains("dh1886-bridge"),
            "{case}: the request holds no value: {spooled:?}"
        );
        spooled
    };
    let behind = start("set", &[("ANTHROPIC_BASE_URL", url)]);
    assert!(
        behind.contains(r#""route":{"ANTHROPIC_BASE_URL":true,"ANTHROPIC_BEDROCK_BASE_URL":false,"ANTHROPIC_VERTEX_BASE_URL":false,"ANTHROPIC_FOUNDRY_BASE_URL":false,"ANTHROPIC_AWS_BASE_URL":false,"ANTHROPIC_BEDROCK_MANTLE_BASE_URL":false,"ANTHROPIC_GOOGLE_CLOUD_BASE_URL":false,"OPENAI_BASE_URL":false}"#),
        "the SessionStart says which route variables are set: {behind:?}"
    );
    let empty = start(
        "empty",
        &[("ANTHROPIC_BASE_URL", ""), ("OPENAI_BASE_URL", url)],
    );
    assert!(
        empty.contains(r#""route":{"ANTHROPIC_BASE_URL":false,"ANTHROPIC_BEDROCK_BASE_URL":false,"ANTHROPIC_VERTEX_BASE_URL":false,"ANTHROPIC_FOUNDRY_BASE_URL":false,"ANTHROPIC_AWS_BASE_URL":false,"ANTHROPIC_BEDROCK_MANTLE_BASE_URL":false,"ANTHROPIC_GOOGLE_CLOUD_BASE_URL":false,"OPENAI_BASE_URL":true}"#),
        "an empty variable reads unset: {empty:?}"
    );
    for key in [
        "ANTHROPIC_BEDROCK_BASE_URL",
        "ANTHROPIC_VERTEX_BASE_URL",
        "ANTHROPIC_FOUNDRY_BASE_URL",
        "ANTHROPIC_AWS_BASE_URL",
        "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
        "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
    ] {
        let gateway = start(key, &[(key, url)]);
        assert!(
            gateway.contains(&format!(r#""{key}":true"#)) && gateway.matches(":true").count() == 1,
            "{key} is reported set, and only it: {gateway:?}"
        );
    }
}
