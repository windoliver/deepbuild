use super::*;

/// #140: `marks` alone over transparent black at `size` px, drawn by GPUI's frame path (the draws
/// `present` makes, with no layer cache) in a window of `cx` at scale 1, read back from GPUI's
/// offscreen Metal renderer; straight alpha. That renderer's frames are opaque, so the marks draw
/// twice, over a black ground and over a white one: where they leave `1 - a` of the ground showing,
/// the two differ by `(1 - a) · 255`, and the color over black is the marks' premultiplied color.
pub(crate) fn picture(
    cx: &mut HeadlessAppContext,
    marks: &[&Drawn],
    size: [u32; 2],
    planted: crate::layer::Planted,
) -> Result<image::RgbaImage, Value> {
    gpui_draws(marks.iter().copied())?;
    let mut session = Renderer::new_session();
    let mut list = Renderer::draws(
        &mut session,
        marks,
        path::bucket(1.0),
        1.0,
        false,
        &mut BTreeSet::new(),
    )?;
    if planted.shifts_glyphs {
        // #385 AC1's wrong program: every glyph quad half a device px to the right.
        for (draw, _) in &mut list {
            if let Draw::Text { origin, .. } = draw {
                origin.x += px(0.5);
            }
        }
    }
    if planted.paths_apart {
        // #385 AC8's wrong program: each path drawn alone, its own antialiased coverage laid
        // over what's under it, so a shared edge shows the ground between two paths.
        for placed in &mut list {
            if let Draw::Path { .. } = placed.0 {
                let mut alone = picture_of(cx, std::slice::from_ref(placed), size)?;
                for p in alone.pixels_mut() {
                    p.0.swap(0, 2);
                }
                placed.0 = Draw::Picture {
                    image: Arc::new(RenderImage::new([image::Frame::new(alone)])),
                    bounds: None,
                    image_bounds: None,
                };
            }
        }
    }
    picture_of(cx, &list, size)
}

/// The document's status marks and their legend alone over transparent black, as GPUI draws them
/// after every writer layer (#385's window).
pub(crate) fn status_picture(
    cx: &mut HeadlessAppContext,
    status: &[StatusMark],
    frame: &scene::Frame,
    palette: &scene::Palette,
) -> Result<image::RgbaImage, Value> {
    let mut list = Vec::new();
    status_draws(
        status,
        &status::occupied(frame),
        palette,
        frame.size,
        1.0,
        &mut list,
    );
    let size = [frame.size[0].round() as u32, frame.size[1].round() as u32];
    picture_of(cx, &list, size)
}
