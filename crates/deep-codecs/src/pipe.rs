//! #157: the helpers' framing. Every message is one JSON line; a line whose object has
//! `"bytes": n` is followed by exactly n raw bytes. Replies keep the `{"reply": …, "file": …}`
//! envelope. `Pipe` is the helper's side; `Helper::feed`, `hear` and `take` the parent's.

use std::io::{BufRead, Read, Write};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::Helper;

/// A helper's stdin and stdout.
pub(crate) struct Pipe<R, W> {
    pub r: R,
    pub w: W,
}

impl<R: BufRead, W: Write> Pipe<R, W> {
    /// The next message's head (`Null` when its line isn't JSON), its bytes read into `buf`;
    /// `None` once stdin has closed, even mid-message.
    pub fn next(&mut self, buf: &mut Vec<u8>) -> Option<Value> {
        let mut line = String::new();
        if self.r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let head: Value = serde_json::from_str(&line).unwrap_or_default();
        buf.resize(head["bytes"].as_u64().unwrap_or(0) as usize, 0);
        self.r.read_exact(buf).ok()?;
        Some(head)
    }

    /// One reply line naming the file its job read or wrote; false once stdout has closed.
    pub fn reply(&mut self, reply: &Value, file: Option<&str>) -> bool {
        writeln!(self.w, "{}", json!({"reply": reply, "file": file}))
            .and_then(|()| self.w.flush())
            .is_ok()
    }

    /// One reply line, then `bytes`; false once stdout has closed.
    pub fn send(&mut self, reply: &Value, bytes: &[u8]) -> bool {
        writeln!(self.w, "{}", json!({"reply": reply, "file": null}))
            .and_then(|()| self.w.write_all(bytes))
            .and_then(|()| self.w.flush())
            .is_ok()
    }
}

/// A reply line's `reply`, with its `file` merged in when it names one.
fn envelope(line: &str) -> Value {
    let v: Value = serde_json::from_str(line).unwrap_or_default();
    let mut reply = v["reply"].clone();
    if let (Some(file), Some(r)) = (v["file"].as_str(), reply.as_object_mut()) {
        r.insert("file".into(), json!(file));
    }
    reply
}

impl Helper {
    /// Sends one message (its line, then `bytes` when non-empty, with "bytes" set) and waits up to
    /// `wait` for one reply line: the reply, or None when none came in time or the helper died, in
    /// which case the helper is stopped by its own pid.
    pub fn feed(&mut self, head: &Value, bytes: &[u8], wait: Duration) -> Option<Value> {
        let mut head = head.clone();
        if !bytes.is_empty() {
            head["bytes"] = json!(bytes.len());
        }
        if let Some(op) = head["op"].as_str() {
            self.jobs.push((op.to_string(), None));
        }
        let (Some(stdin), Some(stdout), child) =
            (self.stdin.as_mut(), self.stdout.as_mut(), &mut self.child)
        else {
            return None;
        };
        // The exchange runs on its own thread, so a helper that neither reads nor answers is
        // stopped when the wait is over; its pipes then break and the thread ends.
        let line = std::thread::scope(|s| {
            let (tx, rx) = mpsc::channel();
            s.spawn(move || {
                let mut line = String::new();
                let ok = writeln!(stdin, "{head}").is_ok()
                    && stdin.write_all(bytes).is_ok()
                    && stdin.flush().is_ok()
                    && stdout.read_line(&mut line).is_ok_and(|n| n > 0);
                let _ = tx.send(ok.then_some(line));
            });
            let line = rx.recv_timeout(wait).ok().flatten();
            if line.is_none() {
                let _ = child.kill();
            }
            line
        });
        match line {
            Some(line) => Some(self.heard(&line)),
            None => {
                self.stop();
                None
            }
        }
    }

    /// The next reply line (the envelope's `reply`, with `file` merged in when present), or None.
    pub fn hear(&mut self) -> Option<Value> {
        let mut line = String::new();
        let stdout = self.stdout.as_mut()?;
        match stdout.read_line(&mut line) {
            Ok(n) if n > 0 => Some(self.heard(&line)),
            _ => None,
        }
    }

    /// Fills `buf` with the raw bytes that follow a reply whose `bytes` is buf.len(); false on EOF.
    pub fn take(&mut self, buf: &mut [u8]) -> bool {
        self.stdout
            .as_mut()
            .is_some_and(|o| o.read_exact(buf).is_ok())
    }

    /// A reply line read: the file it names joins the last job.
    fn heard(&mut self, line: &str) -> Value {
        let reply = envelope(line);
        if let (Some(file), Some(job)) = (reply["file"].as_str(), self.jobs.last_mut()) {
            job.1 = Some(file.to_string());
        }
        reply
    }

    /// Ends the helper by its own pid and waits for it; it answers nothing more.
    fn stop(&mut self) {
        let _ = self.child.kill();
        drop(self.stdin.take());
        drop(self.stdout.take());
        let _ = self.child.wait();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{Caps, Job, Planted, DECODE_WORKER};
    use std::io::Cursor;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::Instant;

    /// What a helper wrote: each reply (its `file` merged in) and the bytes after it, the count a
    /// reply's `bytes` names or, after a stream's head, its sound's.
    pub(crate) fn replies(out: &[u8]) -> Vec<(Value, Vec<u8>)> {
        let mut r = Cursor::new(out);
        let mut got = Vec::new();
        let mut line = String::new();
        while r.read_line(&mut line).is_ok_and(|n| n > 0) {
            let reply = envelope(&line);
            let n = (reply["bytes"].as_u64())
                .or(reply["stream"]["audio"]["bytes"].as_u64())
                .unwrap_or(0);
            let mut bytes = vec![0u8; n as usize];
            r.read_exact(&mut bytes).expect("the bytes a reply names");
            got.push((reply, bytes));
            line.clear();
        }
        got
    }

    /// A piped job for frames `first..first + n` of a `size` square at 24 a second, standard
    /// quality, as NV12 for a 4:2:0 codec and BGRA otherwise; `png` names `export.png`.
    pub(crate) fn piped_job(codec: &str, out: &str, size: u32, first: u64, n: u64) -> Value {
        let (op, format) = match codec {
            "png" => ("export.png", "bgra"),
            "prores_4444" => ("export.part", "bgra"),
            _ => ("export.part", "nv12"),
        };
        json!({"op": op, "codec": codec, "size": [size, size], "rate": [24, 1], "frames": n,
            "first": first, "out": out, "quality": "standard", "grain": false,
            "keyframe_interval": null, "format": format})
    }

    /// A piped export run in this process: `job`, then frames `first..` (each with its key
    /// flag), then the end when `end`, all written ahead as a parent writes them; every reply.
    pub(crate) fn piped(
        job: &Value,
        frames: &[(Vec<u8>, bool)],
        end: bool,
        planted: &str,
    ) -> Vec<(Value, Vec<u8>)> {
        let first = job["first"].as_u64().unwrap_or(0);
        let mut input = format!("{job}\n").into_bytes();
        for (k, (frame, key)) in frames.iter().enumerate() {
            let head = json!({"frame": first + k as u64, "bytes": frame.len(), "key": key});
            input.extend(format!("{head}\n").into_bytes());
            input.extend(frame);
        }
        if end {
            input.extend(b"{\"end\":true}\n");
        }
        let mut pipe = Pipe {
            r: Cursor::new(input),
            w: Vec::new(),
        };
        let head = pipe.next(&mut Vec::new()).unwrap();
        let (op, job) = (head["op"].as_str().unwrap(), head.as_object().unwrap());
        crate::export::stream(op, &Job { v: job }, &Planted::one(planted), &mut pipe);
        replies(&pipe.w)
    }

    /// A `stream` job run in this process; every reply.
    pub(crate) fn streamed(job: &Value, planted: &str) -> Vec<(Value, Vec<u8>)> {
        let mut pipe = Pipe {
            r: Cursor::new(Vec::new()),
            w: Vec::new(),
        };
        let job = Job {
            v: job.as_object().unwrap(),
        };
        crate::stream::run(&job, &Caps::default(), &Planted::one(planted), &mut pipe);
        replies(&pipe.w)
    }

    /// A helper program made of `script`, whatever its arguments.
    fn helper(dir: &Path, name: &str, script: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// #157: `feed` gives up on a helper that neither reads nor answers within its wait and stops
    /// it by its pid; a helper that answers is heard, with the file it names.
    #[test]
    fn feed_stops_a_helper_that_never_answers() {
        let dir = std::env::temp_dir().join(format!("deep-codecs-pipe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let silent = helper(&dir, "silent", "exec sleep 60");
        let answers = helper(
            &dir,
            "answers",
            "read -r line; echo '{\"reply\":{\"frame\":0},\"file\":\"ab\"}'; exec sleep 60",
        );
        let fed = crate::tests::finished(move || {
            let mut h = Helper::start(&silent, DECODE_WORKER, &Caps::default(), None).unwrap();
            let started = Instant::now();
            // A frame that doesn't fit the pipe, to a helper that never reads it.
            let frame = vec![7u8; 4 << 20];
            let got = h.feed(&json!({"frame": 0}), &frame, Duration::from_millis(300));
            let gone = h.child.try_wait().is_ok_and(|s| s.is_some());
            let again = h.feed(&json!({"frame": 1}), &[], Duration::from_secs(1));
            (got, started.elapsed(), gone, again)
        });
        let (got, took, gone, again) = fed.expect("feed returns");
        assert_eq!(got, None);
        assert!(took < Duration::from_secs(3), "{took:?}");
        assert!(gone, "the helper still runs");
        assert_eq!(again, None);
        let mut h = Helper::start(&answers, DECODE_WORKER, &Caps::default(), None).unwrap();
        let got = h.feed(&json!({"op": "x"}), &[], Duration::from_secs(5));
        assert_eq!(got, Some(json!({"frame": 0, "file": "ab"})));
        assert_eq!(h.jobs, [("x".to_string(), Some("ab".to_string()))]);
        h.stop();
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// #157: dropping a helper that is still writing (a stream nobody reads to its end) ends it
    /// instead of waiting on it forever.
    #[test]
    fn dropping_a_helper_mid_stream_ends_it() {
        let dir = std::env::temp_dir().join(format!("deep-codecs-drop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let writes = helper(&dir, "writes", "exec yes");
        let ended = crate::tests::finished(move || {
            let mut h = Helper::start(&writes, DECODE_WORKER, &Caps::default(), None).unwrap();
            assert!(h.take(&mut [0u8; 4096]));
            drop(h);
        });
        assert!(
            ended.is_some(),
            "the parent waits on a helper still writing"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
