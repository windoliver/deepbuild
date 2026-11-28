pub(super) fn dfg_table() -> Vec<[f32; 4]> {
    const N: u32 = 1024;
    let mut out = vec![[0f32; 4]; 512];
    for j in 0..32u32 {
        let rough = f64::from(j) / 31.0;
        let a = (rough * rough).max(1e-4);
        let a2 = a * a;
        for i in 0..32u32 {
            let nv = (f64::from(i) / 31.0).max(1.0 / 64.0);
            let v = [(1.0 - nv * nv).sqrt(), 0.0, nv];
            let (mut sa, mut sb) = (0.0, 0.0);
            for k in 0..N {
                let u = (f64::from(k) + 0.5) / f64::from(N);
                let w = f64::from(k.reverse_bits()) / 4_294_967_296.0;
                let phi = std::f64::consts::TAU * u;
                let cos_t = ((1.0 - w) / (1.0 + (a2 - 1.0) * w)).sqrt();
                let sin_t = (1.0 - cos_t * cos_t).sqrt();
                let h = [sin_t * phi.cos(), sin_t * phi.sin(), cos_t];
                let vh = v[0] * h[0] + v[1] * h[1] + v[2] * h[2];
                let nl = 2.0 * vh * h[2] - v[2];
                if nl <= 0.0 || vh <= 0.0 {
                    continue;
                }
                let gv = nl * (nv * nv * (1.0 - a2) + a2).sqrt();
                let gl = nv * (nl * nl * (1.0 - a2) + a2).sqrt();
                let g = 0.5 / (gv + gl) * 4.0 * nl * vh / h[2];
                let fc = (1.0 - vh).powi(5);
                sa += (1.0 - fc) * g;
                sb += fc * g;
            }
            let e = (j * 32 + i) as usize;
            let at = &mut out[e / 2][(e % 2) * 2..(e % 2) * 2 + 2];
            at[0] = (sa / f64::from(N)) as f32;
            at[1] = (sb / f64::from(N)) as f32;
        }
    }
    out.resize(1024, [0.0; 4]);
    out
}

pub(super) fn sheen_table() -> Vec<[f32; 4]> {
    use std::f64::consts::PI;
    let l = |x: f64, a: f64| {
        let t = (1.0 - a) * (1.0 - a);
        let m = |p: f64, q: f64| p + (q - p) * t;
        m(21.5473, 25.3245) / (1.0 + m(3.82987, 3.32435) * x.powf(m(0.19823, 0.16801)))
            + m(-1.97760, -1.27393) * x
            + m(-4.32054, -4.85967)
    };
    let lambda = |c: f64, a: f64| {
        if c < 0.5 {
            l(c, a).exp()
        } else {
            (2.0 * l(0.5, a) - l(1.0 - c, a)).exp()
        }
    };
    const T: u32 = 128;
    const P: u32 = 64;
    let mut flat = vec![0f32; 2048];
    for j in 0..32u32 {
        let r = f64::from(j) / 31.0;
        let a = r.max(1e-3).powi(2);
        for i in 0..64u32 {
            let nv = (f64::from(i) / 63.0).max(1.0 / 128.0);
            let v = [(1.0 - nv * nv).sqrt(), 0.0, nv];
            let mut e = 0.0;
            for ti in 0..T {
                let th = (f64::from(ti) + 0.5) * PI / 2.0 / f64::from(T);
                let (st, ct) = th.sin_cos();
                for pi in 0..P {
                    let ph = (f64::from(pi) + 0.5) * 2.0 * PI / f64::from(P);
                    let lv = [st * ph.cos(), st * ph.sin(), ct];
                    let h = [v[0] + lv[0], v[1] + lv[1], v[2] + lv[2]];
                    let hl = (h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).sqrt();
                    let nh = h[2] / hl;
                    let sin2 = (1.0 - nh * nh).max(1e-7);
                    let d = (2.0 + 1.0 / a) * sin2.powf(0.5 / a) / (2.0 * PI);
                    let vis = (1.0 / ((1.0 + lambda(nv, a) + lambda(ct, a)) * 4.0 * nv * ct))
                        .clamp(0.0, 1.0);
                    e += d * vis * ct * st;
                }
            }
            let dw = (PI / 2.0 / f64::from(T)) * (2.0 * PI / f64::from(P));
            flat[(j * 64 + i) as usize] = (e * dw).min(1.0) as f32;
        }
    }
    flat.chunks(4).map(|c| [c[0], c[1], c[2], c[3]]).collect()
}
