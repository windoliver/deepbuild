use std::process::Command;

#[test]
fn version_identifies_the_built_hook() {
    let output = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "0.0.0\n");
}

#[test]
fn help_marks_the_skeleton() {
    let output = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("Usage: deep-hook [--help | --version]"));
}

#[test]
fn an_unimplemented_hook_never_claims_success() {
    let output = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("not implemented"));
}
