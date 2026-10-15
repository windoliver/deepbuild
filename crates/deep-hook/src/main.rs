use std::{env, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [arg] if arg == "--version" => println!("{}", env!("CARGO_PKG_VERSION")),
        [arg] if arg == "--help" => println!(
            "Usage: deep-hook [--help | --version]\n\nRepository skeleton. Hook forwarding is not implemented yet."
        ),
        _ => {
            eprintln!("Hook forwarding is not implemented. Run deep-hook --help.");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
