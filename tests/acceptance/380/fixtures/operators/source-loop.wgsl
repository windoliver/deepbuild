// The #380 fixture's WGSL-subset source: a pass whose loop has no count fixed at check.
fn pass(i: In) -> Out {
  var acc = vec4<f32>(0.0);
  loop {
    acc = acc + i.src;
    if (acc.x > 1.0) { break; }
  }
  return Out(acc);
}
