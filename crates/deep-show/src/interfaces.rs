use super::*;

/// Every canvas interface a build may hold, each with its reference implementation (#185): every
/// shipped canvas module is its interface's reference, as each seam's shipped backend is; the
/// test interfaces' references are their own test modules. An implementation of an interface
/// declared here hashes to its reference's digest or the seal refuses it.
pub(super) fn interfaces() -> Vec<deep_canvas::registry::Interface> {
    let kit = kit::interface_parts();
    let mut out: Vec<_> = modules(BuildSet::Full)
        .into_iter()
        .filter(|m| !m.manifest.name.starts_with("test."))
        .map(|m| {
            // #238: sandbox@1's reference is the shipped implementation, whichever a test build
            // holds, and its kit holds sandbox@1's own part.
            let interface = m.manifest.implements.clone();
            let sandbox = interface == deep_canvas_sandbox::module::INTERFACE;
            // #533: logic@1's reference is the shipped implementation, whichever a test build
            // holds.
            let logic = interface == deep_logic::module::INTERFACE;
            let mut parts = kit.clone();
            if sandbox {
                parts.push(kit::SANDBOX_PART.to_string());
            }
            // #191: physics@1's behavior part, its fixtures held by the interface's crate.
            if interface == deep_canvas_physics::module::INTERFACE {
                parts.push("behavior".to_string());
            }
            // #418, #399, #421: look@1's, data@1's, graph@1's, vector@1's and scene3d@1's
            // references are the shipped modules, whichever a test build holds.
            let reference = match interface.as_str() {
                _ if sandbox => deep_canvas_sandbox::module::module(),
                _ if logic => deep_logic::module::module(),
                "look@1" => deep_canvas_marks::modules::look(),
                "data@1" => deep_canvas_marks::modules::data(),
                "graph@1" => deep_canvas_graph::module::module(),
                "vector@1" => deep_canvas_vector::module::module(),
                "media@1" => deep_canvas_media::module::module(),
                _ if m.manifest.name == "scene3d" => deep_canvas_scene3d::module::module(),
                _ => m,
            };
            deep_canvas::registry::Interface {
                name: interface,
                reference,
                kit: parts,
                behavior: None,
            }
        })
        .collect();
    for m in seam_backends()
        .into_iter()
        .filter(|m| m.manifest.name.matches('.').count() == 1)
    {
        let seam = m.manifest.name.trim_start_matches("seam.").to_string();
        out.push(deep_canvas_seams::interface(&seam, m));
    }
    #[cfg(feature = "test-sim")]
    out.push(deep_canvas_test_modules::sim::interface(
        kit,
        cfg!(feature = "test-sim-behavior"),
    ));
    out
}
