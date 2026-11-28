use super::*;

#[test]
fn the_windows_reader_presents_the_token_of_a_hub_started_after_it() {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;
    let dir = std::env::temp_dir().join(format!("dh2958r-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let socket = dir.join("hub.sock");
    let mut reader = RecordReader::unopened_folded(&socket);

    let beside = dir.join(
        crate::hub::token(&crate::hub::root().join("hub.sock"))
            .file_name()
            .unwrap(),
    );
    std::fs::write(&beside, "the later hub's token\n").unwrap();
    let listener = UnixListener::bind(&socket).unwrap();
    let (said, heard) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut writer = stream.try_clone().unwrap();
        let hello = json!({ "v": 1, "hello": "deep-hub", "contract": crate::hub::CONTRACT, "features": crate::hub::NEEDS });
        writeln!(writer, "{hello}").unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        let _ = said.send(serde_json::from_str::<Value>(&line).unwrap());
        writeln!(
            writer,
            "{}",
            json!({ "v": 1, "error": { "code": "credential" } })
        )
        .unwrap();
    });
    let _ = reader.poll(Duration::from_millis(100));
    let hello = heard.recv_timeout(Duration::from_secs(10));
    std::fs::remove_dir_all(&dir).unwrap();
    let hello = hello.expect("the reader said hello to the hub at its socket");
    assert!(
        hello["token"] == "the later hub's token",
        "the reader presented another token than the one beside the socket"
    );
}
