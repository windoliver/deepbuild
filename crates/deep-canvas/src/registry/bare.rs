//! The bare kind names that are a canvas module's, not the core's (Registry and seal).

/// The module kinds the design names without a family, with the module each is: the cell grid
/// `cells@1` (#402), scene3d's builders and curve (Builder; Curve `curve@1`; #420; Builder
/// `hull`, #440; Builder `surface`, #224) and its material (Material `material@1`; #421). Any other bare name is the core's.
pub(super) const BARE_MODULE_KINDS: &[(&str, &str)] = &[
    ("cells", "cells"),
    // #540: a lockstep match, Net `net@1`.
    ("net", "net"),
    ("slab", "scene3d"),
    ("lathe", "scene3d"),
    ("extrude", "scene3d"),
    ("tube", "scene3d"),
    ("ball", "scene3d"),
    ("coil", "scene3d"),
    ("plate", "scene3d"),
    ("display", "scene3d"),
    ("hull", "scene3d"),
    ("surface", "scene3d"),
    // #1636: trees from a seed.
    ("tree", "scene3d"),
    ("curve", "scene3d"),
    ("material", "scene3d"),
    ("sky", "scene3d"),
    ("vector", "vector"),
    ("salience", "record"),
    ("sheet", "sheet"),
    // #494: a graph is the graph module's, so a match morph pairs its nodes by key.
    ("graph", "graph"),
    // #533: the logic item keeps the logic module's name, as the cell grid does.
    ("logic", "logic"),
    // R1's mark sets, scales and axes are the data module's, which marks2d draws.
    ("marks", "data"),
    ("axis", "data"),
    ("scale", "data"),
    // #226: 3D axes are the data module's too, beside its scales and axes.
    ("axes3d", "data"),
    // #225: a vector field is the data module's, beside its scales and 3D axes.
    ("vector_field", "data"),
    // #269: a grid image is the data module's, which maps its grid as it maps logic columns.
    ("grid_image", "data"),
    ("puff", "scene3d"),
    ("cutaway", "scene3d"),
    ("instance", "scene3d"),
    ("effect", "scene3d"),
    // #1732: placement by relation in 3D is the motion module's.
    ("arrange", "motion"),
    // #222: a cue list is the motion module's, expanded at check.
    ("cues", "motion"),
];
