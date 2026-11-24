//! The import job's tool for a robot description (issue #3035; canvas primitives: Asset job:
//! imports): a URDF file in, and out a canvas document of one item and one body a link with the
//! joints that have a place, the look it names, and a report of the one rotation applied and of
//! every element that had no place. It writes items, never code, and runs nothing a file carries.
//! Built to WebAssembly by `node scripts/urdf-wasm.mjs`.

mod convert;
mod read;

use deep_canvas::canon::{canonical_bytes, sha256_hex, NoShape};
use serde_json::{json, Value};

/// One import's outputs, each as the bytes the job keeps.
pub struct Imported {
    pub document: Vec<u8>,
    pub look: Vec<u8>,
    pub report: Vec<u8>,
}

/// The canonical bytes of a JSON value: keys in order, whole numbers as integers.
fn bytes(v: &Value) -> Vec<u8> {
    canonical_bytes(v, &NoShape).unwrap_or_else(|_| v.to_string().into_bytes())
}

/// The file as a document, the shipped clean look it names and its report; or why the file is
/// refused, naming what in it.
pub fn import(file: &[u8], params: &Value) -> Result<Imported, String> {
    if params.get("from").and_then(Value::as_str) != Some("urdf") {
        return Err(
            "this tool converts a robot description, from: urdf; nothing was written".into(),
        );
    }
    let look =
        deep_canvas_marks::look::shipped("clean").ok_or("the shipped clean look is missing")?;
    let look = bytes(&look);
    let (document, report) = convert::convert(&read::robot(file)?, &sha256_hex(&look))?;
    Ok(Imported {
        document: bytes(&document),
        look,
        report: bytes(&report),
    })
}

/// Every world of `doc` held to the physics module's check: its refusals, none where each passes.
pub fn worlds(doc: &Value) -> Vec<Value> {
    use deep_canvas_physics::{caps, check, roles};
    let mut out = Vec::new();
    for (id, world) in doc
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if let Err(refusals) = check::check(world, caps::asked(world), &roles::TABLE) {
            out.extend(refusals.into_iter().map(|r| json!({"code": r.code, "path": format!("worlds/{id}/{}", r.path), "what": r.what})));
        }
    }
    out
}

/// The tool's WebAssembly calls: a block for the request, one call, and the answer's block back.
#[cfg(target_arch = "wasm32")]
mod wasm {
    #[no_mangle]
    pub extern "C" fn deep_urdf_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_urdf_alloc` or a call gave.
    #[no_mangle]
    pub unsafe extern "C" fn deep_urdf_free(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_urdf_alloc` gave, filled with a request as
    /// [`crate::call`] frames it.
    #[no_mangle]
    pub unsafe extern "C" fn deep_urdf_call(ptr: *mut u8, len: usize) -> u64 {
        let bytes = Vec::from_raw_parts(ptr, len, len);
        let mut out = crate::call(&bytes).into_boxed_slice();
        let (p, n) = (out.as_mut_ptr(), out.len());
        std::mem::forget(out);
        ((p as u64) << 32) | n as u64
    }
}

/// The parts of a framed block: each a little-endian `u32` length, then that many bytes.
fn parts(mut b: &[u8]) -> Option<Vec<&[u8]>> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let n = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
        out.push(b.get(4..4 + n)?);
        b = &b[4 + n..];
    }
    Some(out)
}

fn framed(status: u8, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = vec![status];
    for p in parts {
        out.extend((p.len() as u32).to_le_bytes());
        out.extend_from_slice(p);
    }
    out
}

/// One request of the tool's WebAssembly module, its op's name then its parts framed: `import`
/// with the params' JSON and the file answers 0 then the document, the look and the report, or 1
/// then why the file is refused; `worlds` with a document answers 0 then the physics check's
/// refusals on its worlds as a JSON list.
pub fn call(request: &[u8]) -> Vec<u8> {
    let Some(p) = parts(request) else {
        return framed(2, &[b"the request isn't framed"]);
    };
    match p.as_slice() {
        [b"import", params, file] => {
            let params: Value = serde_json::from_slice(params).unwrap_or(Value::Null);
            match import(file, &params) {
                Ok(i) => framed(0, &[&i.document, &i.look, &i.report]),
                Err(why) => framed(1, &[why.as_bytes()]),
            }
        }
        [b"worlds", document] => {
            let doc: Value = serde_json::from_slice(document).unwrap_or(Value::Null);
            framed(0, &[Value::Array(worlds(&doc)).to_string().as_bytes()])
        }
        _ => framed(2, &[b"the request names no op: import or worlds"]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn converted(urdf: &str) -> (Value, Value) {
        let i = import(urdf.as_bytes(), &json!({"from": "urdf"})).expect("the file converts");
        let document: Value = serde_json::from_slice(&i.document).unwrap();
        assert_eq!(
            worlds(&document),
            Vec::<Value>::new(),
            "the physics check takes the world"
        );
        (document, serde_json::from_slice(&i.report).unwrap())
    }
    fn near(v: &Value, want: &[f64]) -> bool {
        let got: Vec<f64> = v
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_f64)
            .collect();
        got.len() == want.len() && got.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-9)
    }
    const BLOCK: &str = r#"<inertial><mass value="1"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.03"/></inertial>
        <collision><geometry><box size="0.2 0.4 0.6"/></geometry></collision>"#;

    /// A root with no mass is the world, a frame with none rides its parent's body, a cylinder
    /// stands along our Y, and an effort limit is the motor's.
    #[test]
    fn frames_ride_their_bodies() {
        let (document, report) = converted(&format!(
            r#"<robot name="Cart-1">
              <link name="world"/>
              <link name="Post">{BLOCK}</link>
              <link name="wheel"><inertial><origin xyz="0 0 0"/><mass value="2"/></inertial>
                <collision><geometry><cylinder radius="0.1" length="0.04"/></geometry></collision></link>
              <link name="tool"/>
              <joint name="stand" type="fixed"><parent link="world"/><child link="Post"/><origin xyz="1 2 3"/></joint>
              <joint name="mount" type="fixed"><parent link="Post"/><child link="tool"/><origin xyz="0 0 0.5"/></joint>
              <joint name="axle" type="continuous"><parent link="tool"/><child link="wheel"/><origin xyz="0.1 0 0"/>
                <axis xyz="0 0 2"/><limit effort="7" velocity="3"/></joint>
            </robot>"#
        ));
        let world = &document["worlds"]["cart_1"];
        assert_eq!(
            world["bodies"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            ["post", "wheel"]
        );
        assert!(near(
            &world["bodies"]["post"]["pose"]["pos"],
            &[1.0, 3.0, -2.0]
        ));
        assert!(near(
            &world["bodies"]["post"]["inertia"],
            &[0.01, 0.03, 0.02]
        ));
        assert!(near(&world["shapes"]["post"]["half"], &[0.1, 0.3, 0.2]));
        assert_eq!(
            world["shapes"]["wheel"],
            json!({"kind": "cylinder", "half_height": 0.02, "radius": 0.1})
        );
        assert_eq!(world["joints"]["stand"]["a"], "world");
        assert!(near(
            &world["joints"]["stand"]["frame_a"]["anchor"],
            &[1.0, 3.0, -2.0]
        ));
        // The wheel's joint leaves the frame `tool`, which stands 0.5 m up the post's Z: its anchor is on the post.
        let axle = &world["joints"]["axle"];
        assert_eq!(
            (
                axle["kind"].as_str(),
                axle["a"].as_str(),
                axle.get("limits")
            ),
            (Some("hinge"), Some("post"), None)
        );
        assert!(
            near(&axle["frame_a"]["anchor"], &[0.1, 0.5, 0.0])
                && near(&axle["frame_b"]["axis"], &[0.0, 1.0, 0.0])
        );
        assert_eq!(
            axle["motor"],
            json!({"mode": "velocity", "target": 0, "max_torque": 7})
        );
        assert!(world["joints"].get("mount").is_none());
        assert_eq!(document["items"].as_object().unwrap().len(), 4);
        assert_eq!(document["items"]["post"]["name"], "Post");
        // The post's item takes its pose from its body, and the frame's item rides it.
        assert_eq!(
            world["outputs"]["post"],
            json!({"from": "post", "read": "pose", "to": "items/post/at"})
        );
        let tool = &document["items"]["tool"];
        assert!(
            tool["parent"] == "post"
                && near(&tool["at"]["pos"], &[0.0, 0.5, 0.0])
                && document["items"]["post"].get("parent").is_none()
        );
        assert_eq!(report["dropped"], json!([]));
        // 3 rad/s, in the degrees a second a hinge's speed is written in.
        assert!(
            report["speed_limits"][0]["joint"] == "axle"
                && near(
                    &json!([report["speed_limits"][0]["max"]]),
                    &[171.88733853924697]
                )
        );
    }

    /// What has no place is listed once each, by its element and its name; nothing else is.
    #[test]
    fn what_has_no_place_is_listed() {
        let (document, report) = converted(&format!(
            r#"<robot name="rig">
              <material name="paint"/>
              <link name="base">{BLOCK}<visual name="skin"><geometry><sphere radius="1"/></geometry></visual></link>
              <link name="drift"><inertial><origin rpy="0 0 0.3"/><mass value="1"/>
                <inertia ixx="0.01" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.03"/></inertial>
                <collision><geometry><sphere radius="0.1"/></geometry></collision></link>
              <link name="turn">{BLOCK}</link>
              <link name="lean"><inertial><origin xyz="1 0 0"/><mass value="1"/></inertial>
                <collision><geometry><sphere radius="0.1"/></geometry></collision></link>
              <link name="bare"><inertial><origin xyz="0 0 0.2"/><mass value="1"/></inertial></link>
              <joint name="free" type="floating"><parent link="base"/><child link="drift"/></joint>
              <joint name="wide" type="revolute"><parent link="base"/><child link="turn"/>
                <limit lower="-6.3" upper="6.3"/><dynamics damping="0.1"/></joint>
              <gazebo reference="base"/>
            </robot>"#
        ));
        let rows: Vec<String> = report["dropped"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                format!(
                    "{} {}",
                    r["element"].as_str().unwrap(),
                    r["name"].as_str().unwrap()
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                "material paint",
                "visual skin",
                "joint free",
                "dynamics wide",
                "gazebo base",
                "inertia drift",
                "limit wide",
                "origin lean",
                "origin bare"
            ]
        );
        let world = &document["worlds"]["rig"];
        assert!(
            world["joints"].get("free").is_none()
                && world["joints"]["wide"].get("limits").is_none()
        );
        // A centre of mass outside its body's shapes is left out; one inside them is kept.
        assert!(
            world["bodies"]["lean"].get("centre_of_mass").is_none()
                && world["bodies"]["bare"].get("centre_of_mass").is_none()
                && near(&world["bodies"]["base"]["centre_of_mass"], &[0.0; 3])
        );
        assert!(
            world["bodies"]["drift"].get("inertia").is_none()
                && world["bodies"]["drift"]["mass"] == 1
        );
    }

    /// A root with a shape and no mass stands still, a turned shape keeps its turn, a slider's
    /// motor pushes in newtons, and a moving joint to a link with no mass is listed.
    #[test]
    fn roots_sliders_and_frames() {
        let (document, report) = converted(&format!(
            r#"<robot name="r">
              <link name="plinth"><collision><origin xyz="0 0 -0.05" rpy="0 0 1.5707963267948966"/>
                <geometry><box size="1 2 0.1"/></geometry></collision></link>
              <link name="sled">{BLOCK}</link>
              <link name="probe"/>
              <joint name="slide" type="prismatic"><parent link="plinth"/><child link="sled"/><origin xyz="0 0 0.5"/>
                <axis xyz="0 0 1"/><limit lower="0" upper="0.2" effort="50" velocity="0.5"/></joint>
              <joint name="swing" type="revolute"><parent link="sled"/><child link="probe"/><origin xyz="0.1 0 0"/>
                <limit lower="-1" upper="1"/></joint>
            </robot>"#
        ));
        let world = &document["worlds"]["r"];
        let plinth = &world["bodies"]["plinth"];
        assert!(plinth["kind"] == "static" && plinth.get("mass").is_none());
        // The box's sizes follow the file's axes to ours; its quarter turn about the file's Z is one about our Y.
        let half = std::f64::consts::FRAC_1_SQRT_2;
        let offset = &plinth["shapes"][0]["offset"];
        assert!(near(&world["shapes"]["plinth"]["half"], &[0.5, 0.05, 1.0]));
        assert!(
            near(&offset["pos"], &[0.0, -0.05, 0.0])
                && near(&offset["rot"], &[0.0, half, 0.0, half])
        );
        let slide = &world["joints"]["slide"];
        assert_eq!(
            (slide["kind"].as_str(), slide["a"].as_str()),
            (Some("slider"), Some("plinth"))
        );
        assert_eq!(
            slide["motor"],
            json!({"mode": "velocity", "target": 0, "max_force": 50})
        );
        assert_eq!(
            report["speed_limits"],
            json!([{"joint": "slide", "max": 0.5}])
        );
        // The probe has no mass, so its joint has nothing to move: it is listed, and the probe rides the sled.
        assert!(world["joints"].get("swing").is_none());
        assert_eq!(
            report["dropped"],
            json!([{"element": "joint", "name": "swing"}])
        );
        assert_eq!(document["items"]["probe"]["parent"], "sled");
    }

    /// A file is refused naming what in it can't be read as written, and the tool takes its own format alone.
    #[test]
    fn refusals_name_what_they_refuse() {
        let refused = |urdf: &str| {
            import(urdf.as_bytes(), &json!({"from": "urdf"}))
                .err()
                .unwrap_or_default()
        };
        assert!(refused(r#"<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="a"/><xacro:macro name="leg"/></robot>"#).contains("xacro:macro"));
        assert!(refused(r#"<robot name="r"><link name="a"><inertial><mass value="${m}"/></inertial></link></robot>"#).contains("${m}"));
        assert!(
            refused(r#"<robot name="r"><link name="${side}_a"/></robot>"#).contains("${side}_a")
        );
        assert!(refused(r#"<robot name="r"><link name="a"><collision><geometry><mesh filename="package://r/hull.stl"/></geometry></collision></link></robot>"#).contains("package://r/hull.stl"));
        assert!(refused(r#"<robot name="r"><link name="a"/><joint name="j" type="fixed"><parent link="a"/><child link="gone"/></joint></robot>"#).contains(" j "));
        // A tree of links: no name twice, no link held by two joints, no loop.
        assert!(
            refused(r#"<robot name="r"><link name="a"/><link name="a"/></robot>"#)
                .contains("two links named a")
        );
        assert!(refused(r#"<robot name="r"><link name="a"/><link name="b"/><link name="c"/><joint name="j" type="fixed"><parent link="a"/><child link="c"/></joint><joint name="k" type="fixed"><parent link="b"/><child link="c"/></joint></robot>"#).contains("link c is the child of two joints"));
        assert!(refused(r#"<robot name="r"><link name="a"/><link name="b"/><joint name="j" type="fixed"><parent link="a"/><child link="b"/></joint><joint name="k" type="fixed"><parent link="b"/><child link="a"/></joint></robot>"#).contains("close a loop"));
        assert!(refused(r#"<robot name="r"><link name="a"/><link name="b"><inertial><mass value="1"/></inertial></link><joint name="j" type="revolute"><parent link="a"/><child link="b"/><axis xyz="0 0 0"/></joint></robot>"#).contains("joint j's axis has no length"));
        assert!(refused(r#"<robot name="r"><link name="a"><inertial><mass value="heavy"/></inertial></link></robot>"#).contains("heavy"));
        assert!(refused(r#"<model name="r"/>"#).contains("<model>"));
        assert!(import(b"<robot/>", &json!({"from": "lottie"})).is_err());
    }
}
