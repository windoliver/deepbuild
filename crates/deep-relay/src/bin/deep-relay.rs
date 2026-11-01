//! `deep-relay --listen <addr> --cert <pem> --key <pem> [--planted <name>]`: the relay DeepBuild
//! ships, serving relay@1 over https until it is stopped. Once listening it prints one line,
//! `{"listening": "<addr>"}`.

use std::net::TcpListener;
use std::sync::Arc;

use deep_relay::relay::{serve, Planted};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;

fn main() {
    if let Err(e) = start() {
        eprintln!("deep-relay: {e}");
        std::process::exit(2);
    }
}

fn start() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
    };
    let usage = "usage: deep-relay --listen <addr> --cert <pem> --key <pem>";
    let (Some(listen), Some(cert), Some(key)) = (flag("--listen"), flag("--cert"), flag("--key"))
    else {
        return Err(usage.into());
    };
    let planted = match flag("--planted") {
        None => None,
        Some(name) => Some(Planted::named(name).ok_or(format!("no planted relay {name}"))?),
    };
    let chain = CertificateDer::pem_file_iter(cert)
        .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
        .map_err(|e| format!("{cert}: {e}"))?;
    let key = PrivateKeyDer::from_pem_file(key).map_err(|e| format!("{key}: {e}"))?;
    let tls =
        ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_no_client_auth()
            .with_single_cert(chain, key)
            .map_err(|e| e.to_string())?;
    let listener = TcpListener::bind(listen).map_err(|e| format!("{listen}: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    println!("{}", serde_json::json!({"listening": addr.to_string()}));
    serve(listener, tls, planted);
    Ok(())
}
