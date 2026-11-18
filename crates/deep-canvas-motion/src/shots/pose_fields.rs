use super::*;

/// The fields of a pose a channel may not write while an unkeyed shot holds its camera.
pub(super) const POSE_FIELDS: [&str; 7] = [
    "target",
    "position",
    "orbit",
    "view_width",
    "roll",
    "fov",
    "zoom",
];

impl Plan {
    /// Compiles the document's shots and their transitions against its compiled program.
    pub fn compile(doc: &Map<String, Value>, program: &Program) -> Result<Option<Plan>, Refused> {
        let shots_json = doc.get("shots").and_then(Value::as_object);
        // Only shots with a start are a timeline's; a stage's shots are #417's.
        let timeline: Vec<(&String, &Map<String, Value>)> = shots_json
            .into_iter()
            .flatten()
            .filter_map(|(id, s)| {
                s.as_object()
                    .filter(|s| s.contains_key("start"))
                    .map(|s| (id, s))
            })
            .collect();
        let planted = program.options.planted;
        let rate = program.motion.frame_rate;
        let ctx = Ctx::timeline(doc, rate)?;
        let size = match doc.get("size").and_then(Value::as_array).map(Vec::as_slice) {
            Some([w, h]) => [w.as_f64().unwrap_or(1920.0), h.as_f64().unwrap_or(1080.0)],
            _ => [1920.0, 1080.0],
        };
        let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
        let frame = Frame { size, safe };
        let mut cameras = Vec::new();
        for (id, item) in doc
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if item.get("kind").and_then(Value::as_str) != Some("camera@1") {
                continue;
            }
            let params = item
                .get("params")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let path = format!("items/{id}/params");
            let mut kicks = Vec::new();
            for (k, kick) in params
                .get("kick")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let kp = format!("{path}/kick/{k}");
                let Some(kick) = kick.as_object() else {
                    return bad(kp);
                };
                let by = num(kick.get("by"), &format!("{kp}/by"))?.unwrap_or(2.0);
                let s = match kick.get("s") {
                    None => FLICKS_PER_SECOND * 18 / 100,
                    v => time(v, &ctx, &format!("{kp}/s"))?,
                };
                if s > FLICKS_PER_SECOND || s <= 0 {
                    return refused("out_of_range", format!("{kp}/s"), Value::Null);
                }
                let hz = num(kick.get("hz"), &format!("{kp}/hz"))?.unwrap_or(30.0);
                for at in kick
                    .get("at")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let at = time(Some(at), &ctx, &format!("{kp}/at"))?;
                    kicks.push(Kick {
                        at,
                        by,
                        s,
                        hz,
                        index: kicks.len() as u64,
                    });
                }
            }
            let fit = match params.get("fit").and_then(Value::as_object) {
                Some(f) => Some(framing_of(f, None, &format!("{path}/fit"))?),
                None => None,
            };
            let mut readable = params.clone();
            readable.remove("kick");
            let spec = Spec::read(
                &deep_canvas::kinds::with_defaults("camera@1", &readable),
                &path,
            );
            let own = spec.ok().and_then(|s| {
                s.rig(&path)
                    .ok()
                    .map(|r| Pose::of_core(&s.pose(&r, &Offsets::default())))
            });
            cameras.push(Camera {
                id: id.clone(),
                flat: own.is_some_and(|p| p.flat),
                params,
                own,
                kicks,
                fit,
            });
        }
        if cameras.is_empty() {
            return Ok(None);
        }
        // Read every shot's span and camera first: overlaps and transitions need them all.
        let mut raws: Vec<Raw> = Vec::new();
        for (id, s) in &timeline {
            let path = format!("shots/{id}");
            let camera_name = s
                .get("camera")
                .and_then(Value::as_str)
                .or(doc.get("camera").and_then(Value::as_str));
            let Some(camera) = cameras
                .iter()
                .position(|c| Some(c.id.as_str()) == camera_name)
            else {
                return refused(
                    "ref_unresolved",
                    format!("{path}/camera"),
                    json!({"shot": id}),
                );
            };
            let start = time(s.get("start"), &ctx, &format!("{path}/start"))?;
            let end = time(s.get("end"), &ctx, &format!("{path}/end"))?;
            if end <= start {
                return refused("bad_time", format!("{path}/end"), json!({"shot": id}));
            }
            raws.push(Raw {
                id: (*id).clone(),
                def: s,
                camera,
                start,
                end,
            });
        }
        raws.sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
        // Transitions between shots.
        let mut trans_raw = Vec::new();
        for (id, tr) in doc
            .get("transitions")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(tr) = tr.as_object() else { continue };
            let names = |f: &str| {
                tr.get(f)
                    .and_then(Value::as_str)
                    .and_then(|n| raws.iter().position(|r| r.id == n))
            };
            let (Some(from), Some(to)) = (names("from"), names("to")) else {
                continue;
            };
            trans_raw.push((id.clone(), tr, from, to));
        }
        // Two shots that overlap outside a transition joining them, on any camera (Shot). A
        // transition joins shots that meet at its cut, so any time two shots share lies outside it.
        for (i, a) in raws.iter().enumerate() {
            for b in &raws[i + 1..] {
                if a.start < b.end && b.start < a.end {
                    return refused(
                        "shot_overlap",
                        format!("shots/{}", b.id),
                        json!({"shots": [a.id, b.id], "why": "two shots overlap outside a transition that joins them"}),
                    );
                }
            }
        }
        // A channel or driver on a pose field of a camera an unkeyed shot holds (Shot).
        let writers = program
            .motion
            .channels
            .iter()
            .map(|c| ("channels", &c.id, &c.target))
            .chain(
                program
                    .motion
                    .drivers
                    .iter()
                    .map(|d| ("drivers", &d.id, &d.target)),
            );
        for (section, wid, target) in writers {
            let on_pose = target.field.len() >= 2
                && target.field[0] == "params"
                && POSE_FIELDS.contains(&target.field[1].as_str());
            if !on_pose {
                continue;
            }
            for r in &raws {
                let keyed = r.def.get("keyed").and_then(Value::as_bool).unwrap_or(false);
                if cameras[r.camera].id == target.owner && !keyed {
                    return refused(
                        "shot_pose_written",
                        format!("{section}/{wid}/target"),
                        json!({"channel": wid, "shot": r.id, "camera": target.owner,
                               "why": "while a shot is active it alone writes its camera's pose, unless it is keyed"}),
                    );
                }
            }
        }
        let mut shots: Vec<Shot> = Vec::new();
        for r in &raws {
            let shot = Plan::shot_of(doc, program, &cameras, r, &frame, planted)?;
            shots.push(shot);
        }
        let mut transitions = Vec::new();
        for (id, tr, from, to) in trans_raw {
            let path = format!("transitions/{id}");
            let cut = shots[from].end;
            if shots[to].start != cut {
                return refused("transition_gap", path, json!({"transition": id}));
            }
            let span = match tr.get("span") {
                None => 0,
                v => time(v, &ctx, &format!("{path}/span"))?,
            };
            let kind_name = tr.get("kind").and_then(Value::as_str).unwrap_or("cut");
            let mut kind = kinds::kind_of(kind_name, tr.get(kind_name), &path, &ctx)?;
            // #466: a document channel on the iris's radius keys it.
            if let Kind::Iris(iris) = &mut kind {
                let owner = format!("data/{}", crate::doc::iris_radius(&id));
                if let Some(c) = program
                    .motion
                    .channels
                    .iter()
                    .find(|c| c.target.owner == owner)
                {
                    iris.radius = Radius::Channel(c.id.clone());
                }
            }
            let align = kinds::align_from(tr.get("align"), &format!("{path}/align"))?;
            if let Kind::Iris(Iris {
                center: Center::Item { id: item, .. },
                ..
            }) = &kind
            {
                if !program.items.iter().any(|x| x == item) {
                    return refused(
                        "ref_unresolved",
                        format!("{path}/iris/center"),
                        json!({"transition": id}),
                    );
                }
            }
            let (a, b) = (&shots[from], &shots[to]);
            if span > (a.end - a.start).min(b.end - b.start) {
                return refused(
                    "transition_span",
                    format!("{path}/span"),
                    json!({"transition": id}),
                );
            }
            let ease = match tr.get("progress") {
                None => Ease::InOutCubic,
                v => ease_named(v, &format!("{path}/progress"))?,
            };
            // A match cut frames the incoming shot so `to` lands where `from` was (Transition).
            if let (Kind::Cut, Some(m)) = (&kind, tr.get("match").and_then(Value::as_object)) {
                if planted != Planted::MatchFramerIgnoresMatch {
                    let (Some(fid), Some(tid)) = (
                        m.get("from").and_then(Value::as_str),
                        m.get("to").and_then(Value::as_str),
                    ) else {
                        return bad(format!("{path}/match"));
                    };
                    let step = FLICKS_PER_SECOND * i64::from(rate.1) / i64::from(rate.0.max(1));
                    let last = (cut - step).max(a.start);
                    let mut state = program.state();
                    program.evaluate(last, Validity::Full, &mut state);
                    let outgoing = shots[from].moved(&shots[from].u(last), last, planted);
                    let Some(fb) = bounds_at(program, doc, &state, fid) else {
                        return refused(
                            "ref_unresolved",
                            format!("{path}/match/from"),
                            json!({"transition": id}),
                        );
                    };
                    program.evaluate(cut, Validity::Full, &mut state);
                    let Some(tb) = bounds_at(program, doc, &state, tid) else {
                        return refused(
                            "ref_unresolved",
                            format!("{path}/match/to"),
                            json!({"transition": id}),
                        );
                    };
                    let Some((c, bx)) = project(&outgoing.projector(size), &fb, size) else {
                        return refused(
                            "match_unseen",
                            format!("{path}/match/from"),
                            json!({"transition": id}),
                        );
                    };
                    let incoming = &mut shots[to];
                    incoming.framed = matched(&incoming.framed, &tb, c, bx[3] - bx[1], &frame);
                }
            }
            let mut tr = Transition {
                id,
                from,
                to,
                kind,
                cut,
                start: cut - span / 2,
                end: cut + (span - span / 2),
                ease,
                align,
            };
            kinds::place(&mut tr, span, rate, &path)?;
            if tr.start < shots[from].start || tr.end > shots[to].end {
                return refused(
                    "transition_span",
                    format!("{path}/align"),
                    json!({"transition": tr.id}),
                );
            }
            transitions.push(tr);
        }
        // #504: each stage's shot, framed once (its kept items bounded over the document's span).
        let transport = program.motion.transport;
        let (from, until) = (
            transport.start,
            transport.start + transport.span.unwrap_or(0),
        );
        let mut stage = Vec::with_capacity(program.motion.shots.len());
        for s in &program.motion.shots {
            let def = shots_json
                .and_then(|m| m.get(&s.id))
                .and_then(Value::as_object);
            stage.push(match def {
                Some(def) if !def.contains_key("start") && cameras[s.camera].own.is_some() => {
                    let r = Raw {
                        id: s.id.clone(),
                        def,
                        camera: s.camera,
                        start: from,
                        end: until,
                    };
                    Some(Plan::shot_of(doc, program, &cameras, &r, &frame, planted)?)
                }
                _ => None,
            });
        }
        Ok(Some(Plan {
            stage,
            staged: program.inputs.staged.clone(),
            size,
            safe,
            frame_rate: rate,
            shots,
            transitions,
            slow: doc
                .get("transport")
                .and_then(|t| t.get("reduced_motion"))
                .and_then(Value::as_str)
                == Some("slow"),
            doc_camera: doc
                .get("camera")
                .and_then(Value::as_str)
                .and_then(|c| cameras.iter().position(|x| x.id == c)),
            groups: doc
                .get("items")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(id, item)| parallax_of(id, item))
                .collect(),
            cameras,
        }))
    }

    pub(super) fn shot_of(
        doc: &Map<String, Value>,
        program: &Program,
        cameras: &[Camera],
        r: &Raw,
        frame: &Frame,
        planted: Planted,
    ) -> Result<Shot, Refused> {
        let s = r.def;
        let id = &r.id;
        let path = format!("shots/{id}");
        let cam = &cameras[r.camera];
        let ctx = Ctx::timeline(doc, program.motion.frame_rate)?;
        let mv = match s.get("move") {
            None => Move::Hold,
            Some(Value::String(m)) => match m.as_str() {
                "hold" => Move::Hold,
                "push" => Move::Push,
                "pull" => Move::Pull,
                "pan" => Move::Pan,
                "orbit" => Move::Orbit,
                "slam" => Move::Slam,
                "shake" => Move::Shake,
                "log_zoom" => Move::LogZoom,
                "lens_zoom" => Move::LensZoom,
                _ => return bad(format!("{path}/move")),
            },
            Some(Value::Object(m)) if m.len() == 1 && m.contains_key("follow_forward") => {
                let item = m["follow_forward"].as_str();
                let Some(i) = program.items.iter().position(|x| Some(x.as_str()) == item) else {
                    return refused(
                        "ref_unresolved",
                        format!("{path}/move/follow_forward"),
                        json!({"shot": id}),
                    );
                };
                Move::FollowForward(i)
            }
            Some(_) => return bad(format!("{path}/move")),
        };
        let Some(own) = cam.own else {
            return refused(
                "out_of_range",
                format!("items/{}/params", cam.id),
                json!({"shot": id, "why": "the camera's params aren't a pose"}),
            );
        };
        if cam.flat && matches!(mv, Move::Orbit | Move::LensZoom) {
            return refused(
                "shot_move",
                format!("{path}/move"),
                json!({"shot": id, "why": "this move turns a 3D camera; it's refused in 2D"}),
            );
        }
        let ease = ease_named(s.get("ease"), &format!("{path}/ease"))?;
        let by_default = match mv {
            Move::Push | Move::Pull | Move::LensZoom => 0.15,
            Move::Pan => {
                if own.perspective() {
                    15.0
                } else {
                    0.25
                }
            }
            Move::Orbit => 30.0,
            Move::Slam => 1.7,
            Move::Shake => 0.5,
            _ => 0.0,
        };
        let by = num(s.get("by"), &format!("{path}/by"))?.unwrap_or(by_default);
        let angle = num(s.get("angle"), &format!("{path}/angle"))?.unwrap_or(0.0);
        let roll = num(s.get("roll"), &format!("{path}/roll"))?.unwrap_or(0.0);
        // The base orientation: the camera's own, with the shot's explicit pose over it.
        let target = match s.get("target") {
            Some(v) => vec3(v, &format!("{path}/target"))?,
            None => own.target,
        };
        let mut base = Pose {
            target,
            roll,
            ..own
        };
        if !own.flat {
            let (mut az, mut el) = own.angles();
            let mut d = own.distance();
            if let Some(o) = s.get("orbit").and_then(Value::as_object) {
                az = num(o.get("azimuth"), &format!("{path}/orbit/azimuth"))?.unwrap_or(az);
                el = num(o.get("elevation"), &format!("{path}/orbit/elevation"))?.unwrap_or(el);
                d = num(o.get("distance"), &format!("{path}/orbit/distance"))?.unwrap_or(d);
            }
            if let Some(w) = num(s.get("view_width"), &format!("{path}/view_width"))? {
                if own.perspective() {
                    d = w / (2.0 * tan(rad(own.fov) / 2.0));
                } else {
                    base.view_width = w;
                }
            }
            base.position = add(target, scale(orbit_direction(az, el), d));
        } else {
            if let Some(w) = num(s.get("view_width"), &format!("{path}/view_width"))? {
                base.view_width = w;
            }
            base.position = target;
        }
        if planted == Planted::ShotWritesRoll0 {
            base.roll = 0.0;
        }
        let framing = match s.get("frame").and_then(Value::as_object) {
            Some(f) => Some(framing_of(f, cam.fit.as_ref(), &format!("{path}/frame"))?),
            None => None,
        };
        let mut union = None;
        let mut follow = None;
        let framed = match framing.as_ref().filter(|f| !f.keep.is_empty()) {
            Some(f) => {
                // A follow move takes the fit's centre from the move: it sizes to the item at the start.
                let u = match mv {
                    Move::FollowForward(_) => at_start(program, doc, &f.keep, r.start, id)?,
                    _ => union_over(program, doc, &f.keep, r.start, r.end, id)?,
                };
                union = Some(u);
                // #407: a shot's one framed pose is its explicit pose where it sets one (a view
                // width), else a fit of its kept items (Shot).
                if s.get("view_width").is_some() {
                    base
                } else {
                    fit(&base, &u, f.pad, f.fill, frame.place_px(f.place), frame)
                }
            }
            None => base,
        };
        if let Move::FollowForward(item) = mv {
            // Baked at check: the running maximum of the item's x plus a lead, smoothed by a
            // Gaussian, so the target never moves back and seeking equals playing.
            let mut state = program.state();
            let raw: Vec<f64> = grid(r.start, r.end + FOLLOW_STEP, FOLLOW_STEP)
                .into_iter()
                .map(|t| {
                    program.evaluate(t, Validity::Full, &mut state);
                    state.slots[item * TRANSFORM]
                })
                .collect();
            let first = raw.first().copied().unwrap_or(0.0);
            let mut high = f64::NEG_INFINITY;
            let maxed: Vec<f64> = raw
                .iter()
                .map(|x| {
                    high = high.max(*x);
                    high - first
                })
                .collect();
            let sigma = 24.0;
            let reach = 72i64;
            let weights: Vec<f64> = (-reach..=reach)
                .map(|k| exp(-((k * k) as f64) / (2.0 * sigma * sigma)))
                .collect();
            let total: f64 = weights.iter().sum();
            let n = maxed.len() as i64;
            let smooth: Vec<f64> = (0..n)
                .map(|i| {
                    (-reach..=reach)
                        .map(|k| {
                            weights[(k + reach) as usize] * maxed[(i + k).clamp(0, n - 1) as usize]
                        })
                        .sum::<f64>()
                        / total
                })
                .collect();
            follow = Some(smooth.into_iter().map(|d| framed.target[0] + d).collect());
        }
        let glide = match s.get("join") {
            None | Some(Value::Null) => None,
            Some(Value::String(j)) if j == "cut" => None,
            Some(Value::Object(j)) if j.contains_key("glide") => {
                Some(match j["glide"].get("span") {
                    None => FLICKS_PER_SECOND * 4 / 5,
                    v => time(v, &ctx, &format!("{path}/join/glide/span"))?,
                })
            }
            Some(_) => return bad(format!("{path}/join")),
        };
        let shake = match s.get("shake").and_then(Value::as_object) {
            Some(k) => Some(Shake {
                by: num(k.get("by"), &format!("{path}/shake/by"))?.unwrap_or(0.5),
                hz: num(k.get("hz"), &format!("{path}/shake/hz"))?.unwrap_or(2.0),
                roll: num(k.get("roll"), &format!("{path}/shake/roll"))?.unwrap_or(0.0),
            }),
            None if mv == Move::Shake => Some(Shake {
                by,
                hz: num(s.get("hz"), &format!("{path}/hz"))?.unwrap_or(2.0),
                roll: 0.0,
            }),
            None => None,
        };
        let from = match mv {
            Move::LogZoom => Some(if s.get("by").is_some() {
                framed.widened(by)
            } else {
                // From a fit of the first kept item at the shot's start.
                match framing
                    .as_ref()
                    .and_then(|f| f.keep.first().map(|k| (f, k)))
                {
                    Some((f, k)) => {
                        let u = at_start(program, doc, std::slice::from_ref(k), r.start, id)?;
                        fit(&base, &u, f.pad, f.fill, frame.place_px(f.place), frame)
                    }
                    None => framed.widened(0.01),
                }
            }),
            _ => None,
        };
        Ok(Shot {
            id: id.clone(),
            camera: r.camera,
            start: r.start,
            end: r.end,
            moves: mv,
            ease,
            by,
            angle,
            framed,
            from,
            glide,
            keyed: s.get("keyed").and_then(Value::as_bool).unwrap_or(false),
            essential: s.get("essential").and_then(Value::as_bool).unwrap_or(false),
            shake,
            look: s.get("look").and_then(Value::as_str).map(str::to_string),
            regions: regions_of(s, &path)?,
            union,
            follow,
        })
    }

    /// The camera at index `cam` at t.
    pub fn shown(&self, cam: usize, t: i64, at: &At) -> Shown {
        let mut out = self.shown_bare(cam, t, at);
        if !at.reduced {
            out.pose = self.kicked(cam, &out.pose, t, at);
        }
        out
    }

    /// Shot `i`'s side of a transition at t: its own pose at t, as if it alone wrote the camera,
    /// its camera's kick applied.
    pub fn side(&self, i: usize, t: i64, at: &At) -> Pose {
        let pose = self.shot_pose(i, t.min(self.shots[i].end), at).pose;
        if at.reduced {
            pose
        } else {
            self.kicked(self.shots[i].camera, &pose, t, at)
        }
    }

    /// The shot that writes camera `cam` at t: the active one, else the last one that ended.
    pub fn shot_at(&self, cam: usize, t: i64) -> Option<usize> {
        let mine = || {
            self.shots
                .iter()
                .enumerate()
                .filter(|(_, s)| s.camera == cam)
        };
        mine()
            .filter(|(_, s)| s.start <= t && t < s.end)
            .map(|(i, _)| i)
            .next_back()
            .or_else(|| {
                mine()
                    .filter(|(_, s)| s.end <= t)
                    .max_by_key(|(_, s)| s.end)
                    .map(|(i, _)| i)
            })
    }

    pub(super) fn shown_bare(&self, cam: usize, t: i64, at: &At) -> Shown {
        self.shown_upto(cam, self.staged.get(cam).map_or(0, Vec::len), t, at)
    }

    /// [`Plan::shown_bare`] counting only the camera's first `n` stage shots: a stage shot's
    /// pose first, else the timeline's.
    pub(super) fn shown_upto(&self, cam: usize, n: usize, t: i64, at: &At) -> Shown {
        if let Some(shown) = self.staged(cam, n, t, at) {
            return shown;
        }
        let camera = &self.cameras[cam];
        // A whip's window turns the side it shows (Transition: whip).
        for tr in &self.transitions {
            let Kind::Whip { angle, sweep } = tr.kind else {
                continue;
            };
            if self.shots[tr.from].camera != cam || t < tr.start || t >= tr.end || at.reduced {
                continue;
            }
            let side = if t < tr.cut { tr.from } else { tr.to };
            let pose = self.shot_pose(side, t, at).pose;
            let half = (tr.end - tr.start) as f64 / 2.0;
            let quad_in_out = |x: f64| {
                if x < 0.5 {
                    2.0 * x * x
                } else {
                    1.0 - 2.0 * (1.0 - x) * (1.0 - x)
                }
            };
            let a = if t < tr.cut {
                let x = (t - tr.start) as f64 / half;
                sweep
                    * if at.planted == Planted::WhipEasesHalves {
                        quad_in_out(x)
                    } else {
                        x * x
                    }
            } else {
                let x = (t - tr.cut) as f64 / half;
                -sweep
                    * if at.planted == Planted::WhipEasesHalves {
                        1.0 - quad_in_out(x)
                    } else {
                        (1.0 - x) * (1.0 - x)
                    }
            };
            let turned = if pose.flat {
                pose
            } else {
                let (y, p) = yaw_pitch(sub(pose.target, pose.position));
                aimed(&pose, y + a * cos(rad(angle)), p - a * sin(rad(angle)))
            };
            return Shown {
                pose: turned,
                shot: Some(side),
                stage: None,
                dissolve: None,
                moving: true,
            };
        }
        match self.shot_at(cam, t) {
            Some(i) if t < self.shots[i].end => self.shot_pose(i, t, at),
            Some(i) => Shown {
                pose: self.shot_pose(i, self.shots[i].end, at).pose,
                shot: Some(i),
                stage: None,
                dissolve: None,
                moving: false,
            },
            None => Shown {
                pose: camera.own.unwrap_or(Pose {
                    position: [0.0; 3],
                    target: [0.0; 3],
                    fov: 0.0,
                    view_width: 1.0,
                    roll: 0.0,
                    flat: true,
                }),
                shot: None,
                stage: None,
                dissolve: None,
                moving: false,
            },
        }
    }

    /// Shot `i`'s pose at t (at its end, its last pose), with its glide, its shake and reduced
    /// motion.
    pub(super) fn shot_pose(&self, i: usize, t: i64, at: &At) -> Shown {
        let s = &self.shots[i];
        if s.keyed {
            let pose = (at.keyed)(s.camera).unwrap_or(s.framed);
            return Shown {
                pose,
                shot: Some(i),
                stage: None,
                dissolve: None,
                moving: false,
            };
        }
        let reduced_cut = at.reduced && !self.slow && !s.essential;
        let span = (s.end - s.start).max(1);
        let mut dissolve = None;
        let mut moving = s.moves != Move::Hold || s.shake.is_some();
        let mut pose = if reduced_cut && s.moves.animates() {
            // Under reduced motion a move cuts to its final framing at its midpoint, with a 200 ms
            // dissolve (Transport).
            let mid = s.start + span / 2;
            let a = s.moved(&s.at_u(0.0), s.start, at.planted);
            let b = s.moved(&s.at_u(1.0), s.end, at.planted);
            if (t - mid).abs() < DISSOLVE / 2 {
                let mix = (t - (mid - DISSOLVE / 2)) as f64 / DISSOLVE as f64;
                dissolve = Some((mix, a, b));
            }
            moving = false;
            if t < mid {
                a
            } else {
                b
            }
        } else if at.reduced && matches!(s.moves, Move::Slam) {
            s.framed
        } else {
            s.moved(&s.u(t), t, at.planted)
        };
        if let Some(g) = s.glide.filter(|g| *g > 0 && t < s.start + g) {
            let before = self
                .shots
                .iter()
                .enumerate()
                .filter(|(k, p)| p.camera == s.camera && p.end <= s.start && *k != i)
                .max_by_key(|(_, p)| p.end)
                .map(|(k, p)| self.shot_pose(k, p.end, at).pose)
                .or(self.cameras[s.camera].own);
            if let Some(before) = before {
                let (glided, faded, glides) =
                    joined(&before, &pose, s.start, g, s.ease, t, reduced_cut);
                pose = glided;
                dissolve = faded.or(dissolve);
                moving |= glides;
            }
        }
        if let Some(k) = s.shake.filter(|_| !at.reduced) {
            pose = self.shaken(s, &pose, k, t, at);
        }
        Shown {
            pose,
            shot: Some(i),
            stage: None,
            dissolve,
            moving,
        }
    }

    /// #504: what camera `cam` shows at t from its stage shots, counting the first `n`: the
    /// latest at or before t, unless a timeline shot started after it, glides from the pose shown
    /// at its entry into its stage's framed pose (Control: "A stage's shot starts at the stage's
    /// entry and, unless it says `join: cut`, glides there over 0.8 s from the pose shown").
    /// `None` where no stage shot writes the camera at t.
    pub(super) fn staged(&self, cam: usize, n: usize, t: i64, at: &At) -> Option<Shown> {
        let list = self.staged.get(cam)?;
        let k = list[..n.min(list.len())]
            .partition_point(|s| s.t <= t)
            .checked_sub(1)?;
        let st = list[k];
        let stage = self.stage.get(st.shot)?.as_ref()?;
        if self
            .shots
            .iter()
            .any(|s| s.camera == cam && s.start > st.t && s.start <= t)
        {
            return None;
        }
        // The pose shown at the entry: the earlier stage shots' and the timeline's.
        let before = self.shown_upto(cam, k, st.t, at).pose;
        let reduced = at.reduced && !self.slow && !stage.essential;
        let (mut pose, dissolve, moving) =
            joined(&before, &stage.framed, st.t, st.span, st.ease, t, reduced);
        if at.planted == Planted::StageGlideMovesTargetOnly {
            pose.position = stage.framed.position;
        }
        Some(Shown {
            pose,
            shot: None,
            stage: Some(st.shot),
            dissolve,
            moving,
        })
    }

    /// The pose turned by the shot's shake: lattice noise of (t × hz, the shot's ID) on yaw and
    /// pitch, and on roll, never past `by` (Shot).
    pub(super) fn shaken(&self, s: &Shot, pose: &Pose, k: Shake, t: i64, at: &At) -> Pose {
        let seed = fnv(&s.id);
        let x = if at.planted == Planted::ShakeFreshPerFrame {
            self.frame_of(t) as f64 + 0.5
        } else {
            t as f64 / F * k.hz
        };
        let (mut ex, mut ey) = (noise(seed, x), noise(seed ^ 0x5bd1_e995, x));
        let m = sqrt(ex * ex + ey * ey);
        if m > 1.0 {
            ex /= m;
            ey /= m;
        }
        let er = noise(seed ^ 0x2545_f491, x);
        let mut out = if pose.flat {
            let w = pose.view_width / self.size[0];
            let target = [
                pose.target[0] + ex * k.by * w,
                pose.target[1] - ey * k.by * w,
                pose.target[2],
            ];
            Pose {
                position: target,
                target,
                ..*pose
            }
        } else {
            tilted(pose, ex, ey, k.by)
        };
        out.roll = pose.roll + er * k.roll;
        out
    }

    pub(super) fn frame_of(&self, t: i64) -> i64 {
        let (p, q) = self.frame_rate;
        (i128::from(t) * i128::from(p)).div_euclid(i128::from(FLICKS_PER_SECOND) * i128::from(q))
            as i64
    }

    /// The camera's kicks at t added to `pose` (Camera `camera@1`: kick): their sum clamped to
    /// `by`, in an indexed look rounded to whole target pixels.
    pub(super) fn kicked(&self, cam: usize, pose: &Pose, t: i64, at: &At) -> Pose {
        let camera = &self.cameras[cam];
        let seed = fnv(&camera.id);
        let (mut ox, mut oy, mut by) = (0.0, 0.0, 0.0f64);
        for k in camera.kicks.iter().filter(|k| k.at <= t && t < k.at + k.s) {
            let u = (t - k.at) as f64 / k.s as f64;
            let w = (1.0 - u) * (1.0 - u);
            let x = if at.planted == Planted::KickFreshPerFrame {
                self.frame_of(t) as f64 + 0.5
            } else {
                t as f64 / F * k.hz
            };
            let ks = seed ^ k.index.wrapping_mul(0x9E37_79B9);
            ox += noise(ks, x) * k.by * w;
            oy += noise(ks ^ 0x5bd1_e995, x) * k.by * w;
            by = by.max(k.by);
        }
        if by == 0.0 {
            return *pose;
        }
        ox = ox.clamp(-by, by);
        oy = oy.clamp(-by, by);
        if pose.perspective() {
            let mut p = tilted(pose, ox / by, oy / by, by);
            p.roll = pose.roll;
            return p;
        }
        let per_px = match at.indexed {
            Some(w) => {
                ox = ox.round();
                oy = oy.round();
                pose.view_width / w
            }
            None => pose.view_width / self.size[0],
        };
        let d = [ox * per_px, oy * per_px];
        let target = [pose.target[0] + d[0], pose.target[1] + d[1], pose.target[2]];
        let position = if pose.flat {
            target
        } else {
            [
                pose.position[0] + d[0],
                pose.position[1] + d[1],
                pose.position[2],
            ]
        };
        Pose {
            position,
            target,
            ..*pose
        }
    }

    /// The sub-samples a frame at t averages under motion blur (Motion blur: stratified over the
    /// shutter centred on t), each with the shot whose side it draws, inside a declared move.
    pub fn blur(
        &self,
        cam: usize,
        t: i64,
        at: &At,
        shutter: f64,
        samples: u32,
    ) -> Vec<(i64, Option<usize>, Pose)> {
        if at.reduced || samples == 0 || !self.shown(cam, t, at).moving {
            return Vec::new();
        }
        let (p, q) = self.frame_rate;
        let open = shutter / 360.0 * F * f64::from(q) / f64::from(p);
        (0..samples)
            .map(|k| {
                let dt = ((f64::from(k) + 0.5) / f64::from(samples) - 0.5) * open;
                let ts = t + dt.round() as i64;
                let shown = self.shown(cam, ts, at);
                (ts, shown.shot, shown.pose)
            })
            .collect()
    }

    /// A keyed shot's pose: its camera's own params as the program's channels write them.
    pub fn keyed_pose(&self, cam: usize, program: &Program, state: &State) -> Option<Pose> {
        let camera = &self.cameras[cam];
        let mut params = Value::Object(camera.params.clone());
        params.as_object_mut()?.remove("kick");
        let (_, fields) = program.item_values(state, &camera.id)?;
        for (path, value) in fields {
            if path.first().map(String::as_str) != Some("params") {
                continue;
            }
            let pointer = format!("/{}", path[1..].join("/"));
            let v = match value {
                Datum::Num(x) => json!(x),
                Datum::Nums(xs) => json!(xs),
                _ => continue,
            };
            if let Some(slot) = params.pointer_mut(&pointer) {
                *slot = v;
            }
        }
        let path = format!("items/{}/params", camera.id);
        let spec = Spec::read(
            &deep_canvas::kinds::with_defaults("camera@1", params.as_object()?),
            &path,
        )
        .ok()?;
        let rig = spec.rig(&path).ok()?;
        Some(Pose::of_core(&spec.pose(&rig, &Offsets::default())))
    }

    /// The index of the camera named `id`.
    pub fn camera(&self, id: &str) -> Option<usize> {
        self.cameras.iter().position(|c| c.id == id)
    }

    /// #508: the camera the picture shows at t, from camera `main` and each camera no item views
    /// through: the one whose shot came in last at or before t (a timeline shot's start, a stage
    /// shot's entry); `main` on a tie or where no other camera's shot has.
    pub fn showing(&self, doc: &Value, main: usize, t: i64) -> usize {
        let viewed = |id: &str| {
            doc.get("items")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .any(|(_, i)| {
                    ["/params/camera", "/params/view/camera"]
                        .iter()
                        .any(|p| i.pointer(p).and_then(Value::as_str) == Some(id))
                })
        };
        let came_in = |c: usize| {
            let timeline = self
                .shots
                .iter()
                .filter(|s| s.camera == c && s.start <= t)
                .map(|s| s.start);
            let staged = self
                .staged
                .get(c)
                .into_iter()
                .flatten()
                .filter(|s| s.t <= t);
            timeline.chain(staged.map(|s| s.t)).max()
        };
        let mut best = (came_in(main), main);
        for c in (0..self.cameras.len()).filter(|c| *c != main) {
            let at = came_in(c);
            if at > best.0 && !viewed(&self.cameras[c].id) {
                best = (at, c);
            }
        }
        best.1
    }
}
