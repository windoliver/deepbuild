//! `deep-contracts roundtrip <schema>` decodes each JSON line on stdin into the generated type for
//! `<schema>` and prints its RFC 8785 text; `deep-contracts jcs` prints each line's RFC 8785 text;
//! `deep-contracts check <schema>` prints `ok` or `refused <reason>` for each line, and goes on.

use std::io::{BufRead, Write};

type Step = Box<dyn Fn(&str) -> Result<String, String>>;

fn main() {
    let mut args = std::env::args().skip(1);
    let step: Step = match (args.next().as_deref(), args.next(), args.next()) {
        (Some("roundtrip"), Some(schema), None) => Box::new(move |line| {
            deep_contracts::roundtrip(&schema, line).map_err(|error| format!("{schema}: {error}"))
        }),
        (Some("check"), Some(schema), None) => Box::new(move |line| {
            Ok(match deep_contracts::roundtrip(&schema, line) {
                Ok(_) => "ok".to_string(),
                // One line per input: a refusal that quotes a key holding a newline stays on its line.
                Err(error) => format!(
                    "refused {}",
                    error.replace('\n', "\\n").replace('\r', "\\r")
                ),
            })
        }),
        (Some("jcs"), None, None) => {
            Box::new(|line| deep_contracts::parse(line).map(|value| deep_contracts::jcs(&value)))
        }
        _ => {
            eprintln!(
                "usage: deep-contracts roundtrip <schema> | deep-contracts check <schema> | deep-contracts jcs"
            );
            std::process::exit(2);
        }
    };
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap_or_else(|error| {
            eprintln!("stdin: {error}");
            std::process::exit(1);
        });
        match step(&line) {
            Ok(text) => writeln!(out, "{text}").expect("stdout"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
}
