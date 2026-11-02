//! `deep-relay-suite --relay https://<host> --ca <pem>`: the relay suite against that relay. Its
//! last stdout line is the report; it exits 0 on PASS and 1 on FAIL.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
    };
    let (Some(relay), Some(ca)) = (flag("--relay"), flag("--ca")) else {
        eprintln!("usage: deep-relay-suite --relay https://<host> --ca <pem>");
        std::process::exit(2);
    };
    let ca = std::fs::read(ca).unwrap_or_else(|e| {
        eprintln!("deep-relay-suite: {ca}: {e}");
        std::process::exit(2);
    });
    let report = deep_relay::suite::run(relay, &ca);
    println!("{report}");
    std::process::exit(if report["status"] == "PASS" { 0 } else { 1 });
}
