//! `deep-gpu run [--headless] [--backend noop] [--withhold <feature>]… [--validation]
//! [--planted <name>]` (issue #377; tests/acceptance/377/README.md, The surface under test; #379
//! adds the meter's calls, tests/acceptance/379/README.md; #140 the GPU seam's, with `--adapters
//! <file>` and `--quirks <file>` in test-seam builds, tests/acceptance/140/gpu/README.md): one JSON
//! scenario per stdin line, `{"out": dir, "calls":
//! [Call]}`, answered with one line `{"ok": true, "replies": [Reply]}`. Every call of a run uses one
//! app: one GPU (one wgpu device), one headless window, and each scene's session from call to call.
//! With `--headless` (#140, tests/acceptance/140/view/README.md, "deep-gpu: the live-headless
//! calls") the run is the headless canvas worker instead: it answers `snapshot` alone, with one GPU
//! and no app, so no window. #385 adds the 2D calls (`layers`, `window2d`, `vello_gpu`,
//! `spike2d`; tests/acceptance/385/README.md) and, in test-spike builds, `--spike-record <file>`.
//! #417 adds `film2d`: a 2D film in the window under a look, with its look switches timed.
//! #1056 adds `index_record` and `cross_index`: a pixel look's per-frame index records, compared
//! across GPU families (records.rs).

#[cfg(feature = "test-meter")]
mod allocations;
mod axes;
mod blur;
mod budget;
mod calibrate;
mod columns;
mod compare;
mod compile;
mod conformance;
mod counting;
mod effects;
mod envelope;
#[cfg(feature = "test-faults")]
mod faults;
mod fed;
mod film;
mod fix;
mod fixtures;
mod flat;
mod flows2d;
mod frames;
mod full_lane;
mod golden;
mod grids2d;
mod guard;
mod hdr;
mod hidden;
mod host;
use deep_groups_render::indexed;
mod insets;
mod interp_suite;
mod levels;
mod live;
mod liveview;
mod lod;
mod look_ops;
mod marks2d;
mod op_transition;
mod opframe;
mod parity;
mod particles;
mod physics;
mod plugin;
mod print2d;
mod records;
mod reference;
mod regions;
mod relation;
mod reseed;
mod scene;
mod sea;
mod seam;
mod serve;
mod session3;
mod shader_layout;
mod simplify;
mod spawn;
mod status;
mod steps_ref;
#[cfg(feature = "test-meter")]
mod testgpu;
mod textures;
mod timing;
mod tone;
mod touches;
mod trails;
mod validation;
mod video;
mod view3d;
mod warm;
mod window;
mod worker;

use std::collections::HashMap;
use std::sync::Arc;

use deep_gpu::device::{Backend, Gpu};
use deep_gpu::guard::Declarations;
use deep_gpu::seam::Startup;
use deep_gpu::surface::Path;
use gpui_kit::HeadlessAppContext;
use serde_json::{json, Value};

// #1561: the 2D compositor and the drawn passes are a render crate's, which deep-show draws
// through too.
pub(crate) use deep_groups_render::{drawn, groups, lightfx};

use crate::scene::Scene;
use crate::serve::serve;
use crate::window::Win;
use crate::worker::Worker;

/// The wrong programs, each reachable only through `--planted` (README: Planted programs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// #466: an operator transition aligned on its progress's half, not its output's coverage.
    MosaicRevealByProgress,
    /// #432's wrong warm-ups (tests/acceptance/432/README.md: Planted programs): only the
    /// feature sets in use at t = 0; only each variant set's default option's fused chain; only
    /// the pipelines that draw into the view.
    WarmsInUseAtT0,
    FusesDefaultOptions,
    WarmsViewOnly,
    /// #431's wrong programs (tests/acceptance/431/README.md: Planted programs).
    VelocityFromPreviousFrame,
    EmissionThresholdsColor,
    BuildsUnreadTargets,
    SampleGradImplicit,
    NoDivergenceRule,
    BackdropAfterSeeThrough,
    PeriodFirstOctave,
    /// #458's wrong programs (tests/acceptance/458/pairs/README.md: Planted programs): an
    /// `instance@1`'s elements write nothing to the velocity target; the GPU layer composites a
    /// group whose blend is multiply as screen.
    InstancedSkipsVelocity,
    GpuLayerMultiplyAsScreen,
    /// #458's wrong programs (tests/acceptance/458/relations/README.md: Planted programs).
    LightSumClamped,
    ExposureAfterToneMap,
    OrthoCameraSnapsToGrid,
    ShadesByLocalTangent,
    ShadowBrightens,
    InstancesSkipNormalTarget,
    LaneAdapterFromConfiguration,
    AbsoluteF32WorldPositions,
    LightCutAbsoluteIlluminance,
    /// #2054's: a local light faded by (1 − (d ÷ range)²)², not the design's window.
    LightWindowSquared,
    /// #430's wrong programs (tests/acceptance/430/README.md: Planted programs).
    GroupPassAtLayerEnd,
    GroupPassReadsEarlier,
    GroupPassPastGrow,
    BackdropReadsOtherWriter,
    BackdropReadsLaterItems,
    BackdropPastCoverage,
    BackdropReadsStatus,
    /// #467 AC5's: a bevel lit from the side opposite its light.
    BevelLitOpposite,
    VividLightAsLinearLight,
    DissolveReadsPlayback,
    PassLinearIn2d,
    PassEncodedIn3d,
    DividesAlpha,
    DrawsSurfacesAfterScene,
    SubmitsOnCompletion,
    ReleasesBeforeCompletion,
    WaitsOnGpu,
    /// #177's wrong HDR output: the surface carries the SDR curve; the shoulder replaced by the
    /// identity clipped at the headroom; the whole curve scaled by it; what draws over the scene
    /// scaled by it; the headroom read once; an export drawn from the HDR surface; the HDR layer
    /// above the window's; a view drawing 3D over 2D presenting HDR.
    ClipsAtOne,
    ClipsAtHeadroom,
    MovesToe,
    StatusOverPaperWhite,
    ReadsHeadroomOnce,
    ExportReadsHdrSurface,
    HdrLayerAboveChrome,
    CatcherViewGoesHdr,
    CompilesOnUiThread,
    ExposesGpuToPanels,
    /// #537's wrong programs (tests/acceptance/537/README.md: Planted twins).
    InstancerAddressesBySlot,
    OverlayKeepsGridOnSeek,
    LineReadsPreviousStep,
    PartPoseInWorldSpace,
    /// #1381's wrong programs (tests/acceptance/1381/README.md: Assumed surfaces 5): a terrain
    /// plate whose horizon table is never read, and its sky occlusion from its slope alone.
    TerrainNoHorizonBake,
    TerrainOcclusionFromSlope,
    /// #3036's wrong program: a plate that keeps the surface the frame before drew.
    TracksKeepLastFrame,
    /// #2215's wrong program (tests/acceptance/2215/README.md: Assumed surfaces 3): the frame's
    /// receipt lists no part that refracts through the round lobe.
    RasterListsNothing,
    /// #378's wrong programs (tests/acceptance/378/README.md: Planted programs).
    ForwardZ,
    EncodesTwice,
    SkipsEncode,
    EncodesEveryFrame,
    ReplaysAfterAdd,
    PairsNewestSlot,
    /// #2516: wrong ambient-occlusion estimators (tests/acceptance/2516).
    AoMainLoop,
    AoUniformHemisphere,
    AoFullRadius,
    /// #380's wrong programs (tests/acceptance/380/README.md: Planted programs).
    HostUnclipped,
    SlowGlow,
    ComparesAnyEnvironment,
    FailsMissingSnapshot,
    SkipsOperatorCheck,
    NoiseFromFrameCounter,
    NoiseFromClock,
    PassOffByTwo,
    BloomWithoutKaris,
    PassesOneGpu,
    /// #161's wrong programs (tests/acceptance/161/README.md: Planted programs).
    FxLevelsGpuOffByTwo,
    SliceShiftSeededByFrame,
    InvertOnPremultiplied,
    InvertWithoutAlphaGuard,
    TwirlCenterFromFrameOrigin,
    BlurRadiusInDevicePx,
    KeyKeepsColorAtAlpha0,
    /// #508's wrong programs (tests/acceptance/508/README.md: Surfaces this job invents, 10): a
    /// plume's haze run before the check readbacks are taken, so they read its bent pixels; and
    /// the film effects taking their time from the wall clock instead of the frame's t.
    HazeFeedsCheckReadback,
    EffectReadsWallClock,
    /// #379's wrong programs (tests/acceptance/379/README.md: Planted programs).
    SumsPassIntervals,
    AllocatesPerFrame,
    CompilesAtSwap,
    ChargesFirstHolder,
    KeepsUnreadResults,
    FormulaCount,
    StepsOnFirstSlowFrame,
    SkipsARung,
    StepsEveryWriter,
    SharesMeterWithWorker,
    /// #381's: labels shaped at a fixed em for masks of their own, nothing in the atlas.
    LabelMask,
    /// #382's wrong programs (tests/acceptance/382/README.md: Planted programs).
    GuardEverywhere,
    GuardHalfDistance,
    HostKeepsDocumentLook,
    HostCacheByDocId,
    HostCheckOnce,
    GuardToGrey,
    /// #383's wrong programs (tests/acceptance/383/README.md: Planted programs).
    LoadsEverything,
    SlowGpuFrame,
    /// #465: each ghost at a fixed place, whatever its light.
    FlareFixedGhosts,
    /// #465: the flare built as if nothing covered its light.
    FlareIgnoresOcclusion,
    /// #2691's wrong programs (tests/acceptance/2691/README.md: Planted programs): the mirror's
    /// pass at half of half the internal size; a plain mirror's lookup by the pixel's place over
    /// the frame's full size.
    MirrorHalvesTwice,
    MirrorSamplesFullFrame,
    /// #468: a circle of confusion linear in |d − s|, matched to the physical one at 10 m.
    CocLinearInDistance,
    /// #166: the water's foam carried from frame to frame as simulation state.
    WaterFoamKeepsState,
    /// #268: the shore's field measured from each item's centre, not where it meets the water.
    ShoreFieldFromCentre,
    /// #268: waves at full amplitude by the shore, ignoring its field.
    ShoreCalmIgnoresField,
    /// #968: the flow's noise moved in one phase, jumping back at every wrap.
    WaterFlowSinglePhase,
    /// #2760: each touch's ring centred where the rain's hash puts a drop.
    WaterRingsAtRainHash,
    /// #2760: a ring started when a drawn frame first passes its occurrence, kept as state.
    WaterRingsStartOnDrawnFrame,
    /// #3034: the water's surface from below drawn with an index of 1: no cone.
    WaterBelowIorOne,
    /// #3034: under water, a color dimmed by its point's depth below the surface.
    WaterBelowTintByDepth,
    /// #3034: the water's surface from below showing what is above it at every angle.
    WaterBelowSkyAtEveryAngle,
    /// #290's wrong hidden views (tests/acceptance/290/README.md: Planted programs).
    HiddenViewDrawsWhereVisible,
    HiddenViewWithoutOwnDepth,
    HiddenViewWritesIds,
    HiddenViewAfterStatus,
    /// #3033's wrong seas (tests/acceptance/3033/README.md: Planted programs): every amplitude
    /// of the table halved; every row at the longest wave's speed; only its four longest kept.
    WaterSeaAmplitudesHalved,
    WaterSeaSpeedOfLongest,
    WaterSeaDrawsFourLongest,
    /// #971: the local tone map's base brought back up with a range weight of 1 at every tap.
    LocalBaseIgnoresEdges,
    /// #971: the local tone map's pyramid has the look's `levels` at every output size.
    LocalPyramidFixedLevels,
    /// #854's wrong program: the renderer compiles its pipelines in the first frame.
    CompilesOnFirstFrame,
    /// #777's wrong programs (tests/acceptance/777/README.md: Planted programs).
    BudgetsEachWindow,
    StepsMainWindow,
    TellsFirstStepOnly,
    /// #140's wrong programs (tests/acceptance/140/gpu/README.md: Planted programs).
    WithholdsInCode,
    PicksFirstAdapter,
    InstallsStalePipelines,
    ReadsPastBuffer,
    WritesNan,
    ReadsPixelsOnly,
    /// #140's (tests/acceptance/140/view/README.md: Planted programs): the live GPU layer's
    /// read-back has one pixel one code value off in one channel.
    ShiftsGpuPixel,
    /// #386's wrong programs (tests/acceptance/386/README.md: Planted programs).
    BilinearOnly,
    UpscaleReadsPreviousFrame,
    ExportsLiveSurface,
    SlowUpscale,
    StatusBeforeUpscale,
    StatusWithoutDepth,
    OutlinesBeforeUpscale,
    /// #1174's wrong program: screen-size labels drawn in the geometry pass, before the upscale.
    LabelsBeforeUpscale,
    /// #1173's wrong programs (tests/acceptance/1173/README.md: Planted programs).
    SingleSampleTargets,
    ClaimsMsaaOverSingleSample,
    PuffBlockCopy,
    ResolveAccumulatesFrames,
    /// #385's wrong programs (tests/acceptance/385/README.md: Planted programs): the GPU layer's
    /// solid fills two codes redder; GPUI's glyph quads half a device px right; Vello GPU on
    /// whatever its spike record says; each sector of a group composited on its own.
    ShiftsFillTwoCodes,
    ShiftsGlyphQuads,
    IgnoresSpike,
    SectorsSourceOver,
    /// #420's wrong programs (tests/acceptance/420/README.md: Planted programs): particles
    /// stepped from the last frame; mesh edges read unwelded, or drawn without the depth test;
    /// a shared result released when a revision drops its last reader.
    ParticlesIntegrate,
    /// #419's wrong programs (tests/acceptance/419/README.md: Assumed surfaces 11).
    VelocityFromTransform,
    SamplerStepsWorld,
    VelocityPairsByIndex,
    SettleResetsEachFrame,
    SamplerHoldsCamera,
    /// #173's wrong programs (tests/acceptance/173/README.md: Planted programs): a resolve that
    /// keeps the grid frame before its window; a determinism check that hashes the live view's
    /// resolved frames; a window grid at the display's refresh; outlines drawn into the window.
    KeepsFramePastWindow,
    DeterminismHashesLiveView,
    GridAtRefresh,
    OutlinesInHistory,
    EdgesUnwelded,
    EdgesSkipDepth,
    /// #1640's: crease lines keep the edges below their angle, derive their set every frame, or
    /// read their dash in the other size space.
    CreaseBelowAngle,
    EdgesDeriveEveryFrame,
    EdgesDashOtherSpace,
    /// By name: #1782's (tests/acceptance/1782/README.md: Planted programs), a crease line's wrong
    /// picker and a hidden style's span classifiers, cache, edge IDs and dash; and #853's two.
    Named(&'static str),
    ReleasesAtRevision,
    /// #417's: the look switch's clock stops at the request, before the new look is on screen.
    StopsAtRequest,
    /// #462's wrong programs (tests/acceptance/462/README.md: Planted programs): strokes drawn
    /// where the previous frame's camera put them; each side of a region's edge clipped by its own
    /// copy of the edge; status drawn in the look under it; motifs written into the document.
    StrokesFromPreviousFrame,
    RegionSidesClipIndependently,
    StatusInLook,
    MotifsWriteDocument,
    /// #421's wrong programs (tests/acceptance/421/README.md: Planted programs): front faces
    /// chosen without the world determinant; coplanar ties left to a submission order that turns
    /// over each frame; a spot's lumens spread over its cone; status outlines tone mapped.
    WindingIgnoresDeterminant,
    TiesBySubmission,
    SpotCountsCone,
    StatusBeforeToneMap,
    /// #418's: the bloom's lens dirt laid over the frame instead of multiplying its light.
    DirtOverlay,
    /// #429's wrong programs (tests/acceptance/429/README.md: Planted programs).
    RenderBackDrawsLiveOnly,
    TakesDeclaredClass,
    AttributeStride16,
    PartialUpdate2Bytes,
    RecopiesWholeColumn,
    F32CompareFloorExact,
    TrustsWriteIndex,
    DropsSwizzleLast,
    NoiseWeightHalved,
    SettlesWithFallback,
    /// #423's wrong programs (tests/acceptance/423/README.md: Planted programs): the
    /// metallic-roughness map decoded from sRGB; a PNG's gAMA applied as it decodes; every map
    /// sampled at anisotropy 1; a KTX2 normal map transcoded as sRGB color.
    MrFromSrgb,
    AppliesImageGamma,
    AnisotropyOne,
    NormalMapAsSrgb,
    /// #422's wrong programs (tests/acceptance/422/README.md: Planted programs): every final
    /// target black; the puffs not drawn; a cascade kept while the solid count holds; the
    /// environment prefiltered one mip a frame; the specular lobe uncompensated, or compensated on
    /// environment light alone; metallic premixed into one F0 before shading.
    DrawsBlack,
    /// #463's wrong program (tests/acceptance/463/README.md: Planted programs): `art.halftone_pop`
    /// drawn with `art.dot`'s passes.
    HalftonePopTakesDotPasses,
    InkFillFlat,
    RimKeepsFirst,
    /// #1857's wrong program: a look's check admits a line profile's break of 0, and draws it.
    ProfileAdmitsZeroBreaks,
    /// #1561's wrong programs (tests/acceptance/1561/README.md: Planted programs): a live window
    /// that hands a 2D document's frames no page and none of its look's drawn fields; and a
    /// frame that reuses the last frame's marks drawn with no page.
    LivePassesNoPage,
    ReuseDropsPage,
    DropsClouds,
    /// #424's wrong programs.
    AddWritesDepth,
    AddWithoutDepthTest,
    IdsByDrawPosition,
    GpuCullByCenter,
    CountReadBack,
    CompactInReverse,
    IdsByCompactedRow,
    RowAsElement,
    DispatchWithoutGuard,
    /// #1637's wrong programs (tests/acceptance/1637/README.md: Planted programs).
    PyramidFromPreviousFrame,
    OcclusionByCentre,
    OcclusionInCascades,
    OcclusionInProbeCaptures,
    IdsIgnoreMask,
    CutsColorOnly,
    SoftNoiseFromFrame,
    LocalMapStale,
    /// #2034's twins: slots in arrival order, the fixed caps kept, hysteresis, a filter in the
    /// tile's texels, a tile's key without its size.
    TileArrivalOrder,
    TileKeepsFixedCaps,
    TileHysteresis,
    TileFilterInTexels,
    TileKeyWithoutSize,
    IesPeakNormalized,
    CascadeUnsnapped,
    CascadeFilterInTexels,
    CascadeNoPenumbraReach,
    LocalMapIgnoresT,
    LocalMapRekeysOnAnyT,
    CutKeyOmitsPlanes,
    SinglePixelPick,
    /// #1976's: a hit's point put back from the depth target.
    HitFromDepth,
    CascadeCacheKeepsStale,
    PrefilterOverFrames,
    UncompensatedLobe,
    CompensatesEnvironmentOnly,
    PremixedMetallic,
    /// #425's wrong programs (tests/acceptance/425/README.md: Planted programs): a band or the
    /// light cut held by session hysteresis; a band change faded over wall-clock time; a mesh
    /// level chosen from the previous frame's view; band masks keyed per band; the blend level
    /// computed in f32 from the drawn frame; a climb that never steps down; canonical renders at
    /// the live rung; a frame-health drop climbed again without a view change.
    BandHysteresis,
    LightCutHysteresis,
    /// #506's wrong programs (tests/acceptance/506/README.md: Planted programs): an eye inset
    /// drawn from the eye through a frustum centred on the window, its picture laid on the face's
    /// corners; a view overlay that reads the main view's backdrop, mirror or light cut from the
    /// same frame; an inset's premultiplied render sampled as straight alpha.
    EyeInsetCentredFrustum,
    OneBackdropPerFrame,
    OneMirrorPerFrame,
    OneLightCutPerFrame,
    InsetPremultipliedAsStraight,
    /// #298's wrong programs (tests/acceptance/298/README.md: Planted programs): a clamp of each
    /// axis on its own, of an unmirrored behind-camera projection, and to the frame instead of the
    /// safe frame; a driver that reads the frame before's `edge` and `edge_angle`; a leader that
    /// draws while its overlay is clamped.
    ClampEachAxis,
    ClampUnmirroredBehind,
    ClampToFrame,
    EdgeFromPreviousFrame,
    LeaderDrawsWhileClamped,
    BandFadeByWallClock,
    LevelByEarlierFrame,
    BandMasksIndependent,
    BlendLevelOnGpu,
    ClimbNeverStepsDown,
    CanonicalClimbs,
    ReclimbsWithoutViewChange,
    /// #2017's wrong programs (tests/acceptance/2017/README.md: Assumed surfaces 8): a terrain
    /// tile's level by its distance alone, as a 1920 × 1080 view would choose it at every size;
    /// each tile shaded from its level's own vertex normals.
    TerrainLodByDistance,
    TerrainShadesOwnLevelNormals,
    /// #428's wrong programs (tests/acceptance/428/README.md: Planted programs).
    DropsDispersion,
    AbsorptionIgnoresThickness,
    TransmissionIgnoresRoughness,
    DispersionSamplesOnce,
    SpecularColorIgnored,
    IridescenceIgnoresThickness,
    DiffuseLambert,
    OrenNayarUncompensated,
    RetroreflectionIgnored,
    FlakesByPixel,
    // #481: the subsurface spread takes every tap, whatever part it lands on; the spread light is
    // added to the whole diffuse.
    SubsurfaceAcrossParts,
    SubsurfaceAddsToDiffuse,
    // #486: a lobe output multiplies its field; occlusion scales the direct light and emission
    // too; core.bump@1 ignores the tangent's handedness; coat_normal bends the base lobes too;
    // the check admits a lobe the material lacks, which the frame it first runs compiles.
    LobeOutputScalesField,
    OcclusionScalesDirect,
    BumpIgnoresHandedness,
    CoatNormalBendsBase,
    MissingLobeTurnedOn,
    // #485: core.light@1 without its Fresnel term; core.ambient@1 adding 0.01 × n.z; the light
    // loop handing `light` a shadow of 1, calling it for the lights the policy cut too, handing
    // `ambient` the world-space normal, and handing both `v` away from the eye.
    LightDropsFresnel,
    AmbientAddsNz,
    LoopShadowOne,
    LoopCallsCutLights,
    LoopWorldNormal,
    LoopViewAway,
    // #1634 (tests/acceptance/1634/README.md: Planted programs): fill lights under the key
    // lights' 32; a cluster pass that appends lights as they arrive; a cluster's cap that keeps
    // the first of the document's order; an automatic range cut at a fixed 0.05 lx.
    FillTop32,
    ClusterArrivalOrder,
    ClusterCapByListOrder,
    AutoRangeFixedCut,
    // #483: the structural steps' wrong programs.
    IterateFeedsFirst,
    SortTiesDecreasing,
    CompactByAtomic,
    IndexWraps,
    MipsLevel0Only,
    MipsKeptUnderOldKey,
    PoolWithoutClear,
    // #252: stepped carried state's wrong programs.
    StepsPerFrame,
    RingKeepsEveryCheckpoint,
    CarriedClassExact,
    // #1993: stepped grids' and fields' wrong programs (tests/acceptance/1993/*/README.md).
    StepReadsLivePointer,
    RingCheckpointsTexturesOnAlternateSteps,
    RestoreStartsFromClearValue,
    CheckSkipsBound,
    // #464: print and pixel looks' wrong programs (tests/acceptance/464/README.md).
    VignettePixels,
    GrainFromT,
    PartialCoverage,
    PuffFullOpacity,
    LightAfterUpscale,
    FlickerWallTime,
    // #1619: the screen's wrong programs (tests/acceptance/1619/README.md: Planted programs).
    ConvergenceAngleIgnored,
    TrackingWallTime,
    /// #1413's wrong programs (tests/acceptance/1413/README.md: Planted programs).
    KeepsLatestError,
    ReopensTightLoop,
    ResizeLeavesRendering,
    /// #1899's wrong programs (tests/acceptance/1899/README.md: Planted programs).
    RepeatsLastReading,
    DropsUnresolvedFrames,
    LadderActsInBudgetRun,
    /// #1903's wrong programs (tests/acceptance/1903/README.md: Planted programs).
    TimesEachPassAlone,
    TakesFirstMeasurementAsLimit,
    HoldsInput,
    HeldInputMeterAtEncode,
    BindGroupPerItem,
    UploadsEveryTransform,
    WarmsPerItem,
    TimesOnlyScene,
    WaitClockAfterWarmup,
    /// #1937's wrong chooser (tests/acceptance/1937/README.md: Planted programs).
    PicksLargestGain,
    /// #503's wrong programs: a point set's video frame chosen at a time that advances only on a
    /// played step, so a session opened later or a seek keeps the frame decoded before it; the
    /// video background's frame prefiltered into the environment, keyed per frame.
    PointVideoKeepsFrameBeforeSeek,
    VideoBackgroundPrefiltered,
    /// #449's wrong programs (tests/acceptance/449/README.md: Planted programs).
    CountCap65536EveryClass,
    CountCap1048576EveryClass,
    BounceFirstTwoPlanes,
    LandFloorPlaneOnly,
    DragFirstOrder,
    DragEuler120,
    TurbulenceTableZeros,
    BoundsEmitRegionOnly,
    HidesAtSpanEnd,
    SurfaceTrianglesUniform,
    SurfaceBindPose,
    InheritPreviousFrame,
    BoundsBindPose,
    /// #450's: a whole trail drawn from the frames drawn so far (tests/acceptance/450/README.md).
    TrailAppendsPerFrame,
    /// #265's (tests/acceptance/265/README.md: Planted programs): a world-space emitter's anchor
    /// kept from the frames drawn, a trail through a linear array's stored steps, and a wake
    /// that keeps the last frame's samples.
    AnchorKeptFromFrame,
    TrailReadsStoredSteps,
    WakeKeepsLastFrame,
    /// #451's: particles on a vector field's stream move instead in a straight line along the
    /// field's arrow at their birth point (tests/acceptance/451/README.md: The planted program).
    ParticlesFollowArrows,
    /// #226's wrong programs (tests/acceptance/226/README.md: The planted programs).
    AxesModAppliesTransform,
    Axes3dOwnTickRule,
    AxesModMapsEveryFrame,
    /// #2031's wrong programs (tests/acceptance/2031/README.md: Planted programs).
    LightLinearFalloff,
    LightEncodedSum,
    LightDefaultAmbientZero,
    LightEveryChild,
    LightStaleList,
    /// #2032's wrong programs (tests/acceptance/2032/README.md: Planted programs).
    ShadowBoundingBoxes,
    SunFarPointLight,
    ShadowInsideOutline,
    ShadowRemovesAmbient,
    ShadowEdgeAliased,
    /// #2053's wrong programs (tests/acceptance/2053/README.md: Planted programs).
    NormalFlippedGreen,
    NormalDotAlone,
    NormalUnturned,
    LightStaleHeight,
    /// #269's wrong programs (tests/acceptance/269/README.md: Plants): a played frame's grid image
    /// holds the step before its own; a pixel takes its cell's role before the rebuild.
    GridKeepsPreviousStep,
    GridRoleBeforeRebuild,
}

impl Planted {
    /// The compositor's wrong program this one is, if it is one of the render crate's (#1561).
    pub(crate) fn composed(self) -> Option<deep_groups_render::Planted> {
        use deep_groups_render::Planted as P;
        Some(match self {
            Planted::GroupPassAtLayerEnd => P::GroupPassAtLayerEnd,
            Planted::GroupPassReadsEarlier => P::GroupPassReadsEarlier,
            Planted::GroupPassPastGrow => P::GroupPassPastGrow,
            Planted::BackdropReadsLaterItems => P::BackdropReadsLaterItems,
            Planted::BackdropPastCoverage => P::BackdropPastCoverage,
            Planted::BevelLitOpposite => P::BevelLitOpposite,
            Planted::LightLinearFalloff => P::LightLinearFalloff,
            Planted::LightEncodedSum => P::LightEncodedSum,
            Planted::LightDefaultAmbientZero => P::LightDefaultAmbientZero,
            Planted::LightEveryChild => P::LightEveryChild,
            Planted::LightStaleList => P::LightStaleList,
            Planted::VividLightAsLinearLight => P::VividLightAsLinearLight,
            Planted::PassLinearIn2d => P::PassLinearIn2d,
            Planted::PassEncodedIn3d => P::PassEncodedIn3d,
            Planted::InkFillFlat => P::InkFillFlat,
            Planted::RimKeepsFirst => P::RimKeepsFirst,
            Planted::ShadowBoundingBoxes => P::ShadowBoundingBoxes,
            Planted::SunFarPointLight => P::SunFarPointLight,
            Planted::ShadowInsideOutline => P::ShadowInsideOutline,
            Planted::ShadowRemovesAmbient => P::ShadowRemovesAmbient,
            Planted::ShadowEdgeAliased => P::ShadowEdgeAliased,
            Planted::NormalFlippedGreen => P::NormalFlippedGreen,
            Planted::NormalDotAlone => P::NormalDotAlone,
            Planted::NormalUnturned => P::NormalUnturned,
            Planted::LightStaleHeight => P::LightStaleHeight,
            Planted::SliceShiftSeededByFrame => P::SliceShiftSeededByFrame,
            Planted::InvertOnPremultiplied => P::InvertOnPremultiplied,
            Planted::InvertWithoutAlphaGuard => P::InvertWithoutAlphaGuard,
            Planted::TwirlCenterFromFrameOrigin => P::TwirlCenterFromFrameOrigin,
            Planted::BlurRadiusInDevicePx => P::BlurRadiusInDevicePx,
            Planted::KeyKeepsColorAtAlpha0 => P::KeyKeepsColorAtAlpha0,
            _ => return None,
        })
    }

    fn parse(name: &str) -> Option<Planted> {
        Some(match name {
            "warms_in_use_at_t0" => Planted::WarmsInUseAtT0,
            "fuses_default_options" => Planted::FusesDefaultOptions,
            "warms_view_only" => Planted::WarmsViewOnly,
            "velocity_from_previous_frame" => Planted::VelocityFromPreviousFrame,
            "emission_thresholds_color" => Planted::EmissionThresholdsColor,
            "builds_unread_targets" => Planted::BuildsUnreadTargets,
            "sample_grad_implicit" => Planted::SampleGradImplicit,
            "no_divergence_rule" => Planted::NoDivergenceRule,
            "backdrop_after_see_through" => Planted::BackdropAfterSeeThrough,
            "period_first_octave" => Planted::PeriodFirstOctave,
            "instanced_skips_velocity" => Planted::InstancedSkipsVelocity,
            "gpu_layer_multiply_as_screen" => Planted::GpuLayerMultiplyAsScreen,
            "light_sum_clamped" => Planted::LightSumClamped,
            "exposure_after_tone_map" => Planted::ExposureAfterToneMap,
            "ortho_camera_snaps_to_grid" => Planted::OrthoCameraSnapsToGrid,
            "shades_by_local_tangent" => Planted::ShadesByLocalTangent,
            "shadow_brightens" => Planted::ShadowBrightens,
            "instances_skip_normal_target" => Planted::InstancesSkipNormalTarget,
            "lane_adapter_from_configuration" => Planted::LaneAdapterFromConfiguration,
            "absolute_f32_world_positions" => Planted::AbsoluteF32WorldPositions,
            "light_cut_absolute_illuminance" => Planted::LightCutAbsoluteIlluminance,
            "light_window_squared" => Planted::LightWindowSquared,
            "group_pass_at_layer_end" => Planted::GroupPassAtLayerEnd,
            "group_pass_reads_earlier" => Planted::GroupPassReadsEarlier,
            "group_pass_past_grow" => Planted::GroupPassPastGrow,
            "backdrop_reads_other_writer" => Planted::BackdropReadsOtherWriter,
            "backdrop_reads_later_items" => Planted::BackdropReadsLaterItems,
            "backdrop_past_coverage" => Planted::BackdropPastCoverage,
            "backdrop_reads_status" => Planted::BackdropReadsStatus,
            "bevel_lit_opposite" => Planted::BevelLitOpposite,
            "light_linear_falloff" => Planted::LightLinearFalloff,
            "light_encoded_sum" => Planted::LightEncodedSum,
            "light_default_ambient_zero" => Planted::LightDefaultAmbientZero,
            "light_every_child" => Planted::LightEveryChild,
            "light_stale_list" => Planted::LightStaleList,
            "shadow_bounding_boxes" => Planted::ShadowBoundingBoxes,
            "sun_far_point_light" => Planted::SunFarPointLight,
            "shadow_inside_outline" => Planted::ShadowInsideOutline,
            "shadow_removes_ambient" => Planted::ShadowRemovesAmbient,
            "shadow_edge_aliased" => Planted::ShadowEdgeAliased,
            "normal_flipped_green" => Planted::NormalFlippedGreen,
            "normal_dot_alone" => Planted::NormalDotAlone,
            "normal_unturned" => Planted::NormalUnturned,
            "light_stale_height" => Planted::LightStaleHeight,
            "vivid_light_as_linear_light" => Planted::VividLightAsLinearLight,
            "dissolve_reads_playback" => Planted::DissolveReadsPlayback,
            "pass_linear_in_2d" => Planted::PassLinearIn2d,
            "pass_encoded_in_3d" => Planted::PassEncodedIn3d,
            "divides_alpha" => Planted::DividesAlpha,
            "draws_surfaces_after_scene" => Planted::DrawsSurfacesAfterScene,
            "submits_on_completion" => Planted::SubmitsOnCompletion,
            "releases_before_completion" => Planted::ReleasesBeforeCompletion,
            "waits_on_gpu" => Planted::WaitsOnGpu,
            "clips_at_one" => Planted::ClipsAtOne,
            "clips_at_headroom" => Planted::ClipsAtHeadroom,
            "moves_toe" => Planted::MovesToe,
            "status_over_paper_white" => Planted::StatusOverPaperWhite,
            "reads_headroom_once" => Planted::ReadsHeadroomOnce,
            "export_reads_hdr_surface" => Planted::ExportReadsHdrSurface,
            "hdr_layer_above_chrome" => Planted::HdrLayerAboveChrome,
            "catcher_view_goes_hdr" => Planted::CatcherViewGoesHdr,
            "compiles_on_ui_thread" => Planted::CompilesOnUiThread,
            "exposes_gpu_to_panels" => Planted::ExposesGpuToPanels,
            "forward_z" => Planted::ForwardZ,
            "encodes_twice" => Planted::EncodesTwice,
            "skips_encode" => Planted::SkipsEncode,
            "encodes_every_frame" => Planted::EncodesEveryFrame,
            "replays_after_add" => Planted::ReplaysAfterAdd,
            "pairs_newest_slot" => Planted::PairsNewestSlot,
            "ao_main_loop" => Planted::AoMainLoop,
            "ao_uniform_hemisphere" => Planted::AoUniformHemisphere,
            "ao_full_radius" | "ao_points_at_radius" => Planted::AoFullRadius,
            "host_unclipped" => Planted::HostUnclipped,
            "slow_glow" => Planted::SlowGlow,
            "compares_any_environment" => Planted::ComparesAnyEnvironment,
            "fails_missing_snapshot" => Planted::FailsMissingSnapshot,
            "skips_operator_check" => Planted::SkipsOperatorCheck,
            "noise_from_frame_counter" => Planted::NoiseFromFrameCounter,
            "noise_from_clock" => Planted::NoiseFromClock,
            "pass_off_by_two" => Planted::PassOffByTwo,
            "fx_levels_gpu_off_by_two" => Planted::FxLevelsGpuOffByTwo,
            "slice_shift_seeded_by_frame" => Planted::SliceShiftSeededByFrame,
            "invert_on_premultiplied" => Planted::InvertOnPremultiplied,
            "invert_without_alpha_guard" => Planted::InvertWithoutAlphaGuard,
            "twirl_center_from_frame_origin" => Planted::TwirlCenterFromFrameOrigin,
            "blur_radius_in_device_px" => Planted::BlurRadiusInDevicePx,
            "key_keeps_color_at_alpha_0" => Planted::KeyKeepsColorAtAlpha0,
            "bloom_without_karis" => Planted::BloomWithoutKaris,
            "passes_one_gpu" => Planted::PassesOneGpu,
            "haze_feeds_check_readback" => Planted::HazeFeedsCheckReadback,
            "effect_reads_wall_clock" => Planted::EffectReadsWallClock,
            "sums_pass_intervals" => Planted::SumsPassIntervals,
            "allocates_per_frame" => Planted::AllocatesPerFrame,
            "compiles_at_swap" => Planted::CompilesAtSwap,
            "charges_first_holder" => Planted::ChargesFirstHolder,
            "keeps_unread_results" => Planted::KeepsUnreadResults,
            "formula_count" => Planted::FormulaCount,
            "steps_on_first_slow_frame" => Planted::StepsOnFirstSlowFrame,
            "skips_a_rung" => Planted::SkipsARung,
            "steps_every_writer" => Planted::StepsEveryWriter,
            "shares_meter_with_worker" => Planted::SharesMeterWithWorker,
            "label_mask" => Planted::LabelMask,
            "guard_everywhere" => Planted::GuardEverywhere,
            "guard_half_distance" => Planted::GuardHalfDistance,
            "host_keeps_document_look" => Planted::HostKeepsDocumentLook,
            "host_cache_by_doc_id" => Planted::HostCacheByDocId,
            "host_check_once" => Planted::HostCheckOnce,
            "guard_to_grey" => Planted::GuardToGrey,
            "loads_everything" => Planted::LoadsEverything,
            "slow_gpu_frame" => Planted::SlowGpuFrame,
            "flare_fixed_ghosts" => Planted::FlareFixedGhosts,
            "mirror_halves_twice" => Planted::MirrorHalvesTwice,
            "mirror_samples_full_frame" => Planted::MirrorSamplesFullFrame,
            "coc_linear_in_distance" => Planted::CocLinearInDistance,
            "flare_ignores_occlusion" => Planted::FlareIgnoresOcclusion,
            "water_foam_keeps_state" => Planted::WaterFoamKeepsState,
            "shore_field_from_centre" => Planted::ShoreFieldFromCentre,
            "shore_calm_ignores_field" => Planted::ShoreCalmIgnoresField,
            "water_flow_single_phase" => Planted::WaterFlowSinglePhase,
            "water_rings_at_rain_hash" => Planted::WaterRingsAtRainHash,
            "water_rings_start_on_drawn_frame" => Planted::WaterRingsStartOnDrawnFrame,
            "water_below_ior_one" => Planted::WaterBelowIorOne,
            "water_below_tint_by_depth" => Planted::WaterBelowTintByDepth,
            "water_below_sky_at_every_angle" => Planted::WaterBelowSkyAtEveryAngle,
            "hidden_view_draws_where_visible" => Planted::HiddenViewDrawsWhereVisible,
            "hidden_view_without_own_depth" => Planted::HiddenViewWithoutOwnDepth,
            "hidden_view_writes_ids" => Planted::HiddenViewWritesIds,
            "hidden_view_after_status" => Planted::HiddenViewAfterStatus,
            "water_sea_amplitudes_halved" => Planted::WaterSeaAmplitudesHalved,
            "water_sea_speed_of_longest" => Planted::WaterSeaSpeedOfLongest,
            "water_sea_draws_four_longest" => Planted::WaterSeaDrawsFourLongest,
            "local_base_ignores_edges" => Planted::LocalBaseIgnoresEdges,
            "local_pyramid_fixed_levels" => Planted::LocalPyramidFixedLevels,
            "compiles_on_first_frame" => Planted::CompilesOnFirstFrame,
            "budgets_each_window" => Planted::BudgetsEachWindow,
            "steps_main_window" => Planted::StepsMainWindow,
            "tells_first_step_only" => Planted::TellsFirstStepOnly,
            "withholds_in_code" => Planted::WithholdsInCode,
            "picks_first_adapter" => Planted::PicksFirstAdapter,
            "installs_stale_pipelines" => Planted::InstallsStalePipelines,
            "reads_past_buffer" => Planted::ReadsPastBuffer,
            "writes_nan" => Planted::WritesNan,
            "reads_pixels_only" => Planted::ReadsPixelsOnly,
            "shifts_gpu_pixel" => Planted::ShiftsGpuPixel,
            "bilinear_only" => Planted::BilinearOnly,
            "upscale_reads_previous_frame" => Planted::UpscaleReadsPreviousFrame,
            "exports_live_surface" => Planted::ExportsLiveSurface,
            "slow_upscale" => Planted::SlowUpscale,
            "status_before_upscale" => Planted::StatusBeforeUpscale,
            "status_without_depth" => Planted::StatusWithoutDepth,
            "outlines_before_upscale" => Planted::OutlinesBeforeUpscale,
            "labels_before_upscale" => Planted::LabelsBeforeUpscale,
            "single_sample_targets" => Planted::SingleSampleTargets,
            "claims_msaa_over_single_sample" => Planted::ClaimsMsaaOverSingleSample,
            "puff_block_copy" => Planted::PuffBlockCopy,
            "resolve_accumulates_frames" => Planted::ResolveAccumulatesFrames,
            "shifts_fill_two_codes" => Planted::ShiftsFillTwoCodes,
            "grid_keeps_previous_step" => Planted::GridKeepsPreviousStep,
            "grid_role_before_rebuild" => Planted::GridRoleBeforeRebuild,
            "shifts_glyph_quads" => Planted::ShiftsGlyphQuads,
            "ignores_spike" => Planted::IgnoresSpike,
            "sectors_source_over" => Planted::SectorsSourceOver,
            "particles_integrate" => Planted::ParticlesIntegrate,
            "count_cap_65536_every_class" => Planted::CountCap65536EveryClass,
            "count_cap_1048576_every_class" => Planted::CountCap1048576EveryClass,
            "bounce_first_two_planes" => Planted::BounceFirstTwoPlanes,
            "land_floor_plane_only" => Planted::LandFloorPlaneOnly,
            "drag_first_order" => Planted::DragFirstOrder,
            "drag_euler_120" => Planted::DragEuler120,
            "turbulence_table_zeros" => Planted::TurbulenceTableZeros,
            "bounds_emit_region_only" => Planted::BoundsEmitRegionOnly,
            "hides_at_span_end" => Planted::HidesAtSpanEnd,
            "surface_triangles_uniform" => Planted::SurfaceTrianglesUniform,
            "surface_bind_pose" => Planted::SurfaceBindPose,
            "inherit_previous_frame" => Planted::InheritPreviousFrame,
            "bounds_bind_pose" => Planted::BoundsBindPose,
            "trail_appends_per_frame" => Planted::TrailAppendsPerFrame,
            "anchor_kept_from_frame" => Planted::AnchorKeptFromFrame,
            "trail_reads_stored_steps" => Planted::TrailReadsStoredSteps,
            "wake_keeps_last_frame" => Planted::WakeKeepsLastFrame,
            "particles_follow_arrows" => Planted::ParticlesFollowArrows,
            "axes_mod_applies_transform" => Planted::AxesModAppliesTransform,
            "axes3d_own_tick_rule" => Planted::Axes3dOwnTickRule,
            "axes_mod_maps_every_frame" => Planted::AxesModMapsEveryFrame,
            "velocity_from_transform" => Planted::VelocityFromTransform,
            "sampler_steps_world" => Planted::SamplerStepsWorld,
            "velocity_pairs_by_index" => Planted::VelocityPairsByIndex,
            "settle_resets_each_frame" => Planted::SettleResetsEachFrame,
            "sampler_holds_camera" => Planted::SamplerHoldsCamera,
            "keeps_frame_past_window" => Planted::KeepsFramePastWindow,
            "determinism_hashes_live_view" => Planted::DeterminismHashesLiveView,
            "grid_at_refresh" => Planted::GridAtRefresh,
            "outlines_in_history" => Planted::OutlinesInHistory,
            "edges_unwelded" => Planted::EdgesUnwelded,
            "edges_skip_depth" => Planted::EdgesSkipDepth,
            "crease_below_angle" => Planted::CreaseBelowAngle,
            "edges_derive_every_frame" => Planted::EdgesDeriveEveryFrame,
            "edges_dash_other_space" => Planted::EdgesDashOtherSpace,
            "releases_at_revision" => Planted::ReleasesAtRevision,
            "stops_at_request" => Planted::StopsAtRequest,
            "strokes_from_previous_frame" => Planted::StrokesFromPreviousFrame,
            "region_sides_clip_independently" => Planted::RegionSidesClipIndependently,
            "mosaic_reveal_by_progress" => Planted::MosaicRevealByProgress,
            "status_in_look" => Planted::StatusInLook,
            "motifs_write_document" => Planted::MotifsWriteDocument,
            "winding_ignores_determinant" => Planted::WindingIgnoresDeterminant,
            "ties_by_submission" => Planted::TiesBySubmission,
            "spot_counts_cone" => Planted::SpotCountsCone,
            "status_before_tone_map" => Planted::StatusBeforeToneMap,
            "dirt_overlay" => Planted::DirtOverlay,
            "render_back_draws_live_only" => Planted::RenderBackDrawsLiveOnly,
            "takes_declared_class" => Planted::TakesDeclaredClass,
            "attribute_stride_16" => Planted::AttributeStride16,
            "partial_update_2_bytes" => Planted::PartialUpdate2Bytes,
            "recopies_whole_column" => Planted::RecopiesWholeColumn,
            "f32_compare_floor_exact" => Planted::F32CompareFloorExact,
            "trusts_write_index" => Planted::TrustsWriteIndex,
            "drops_swizzle_last" => Planted::DropsSwizzleLast,
            "noise_weight_halved" => Planted::NoiseWeightHalved,
            "settles_with_fallback" => Planted::SettlesWithFallback,
            "mr_from_srgb" => Planted::MrFromSrgb,
            "applies_image_gamma" => Planted::AppliesImageGamma,
            "anisotropy_one" => Planted::AnisotropyOne,
            "normal_map_as_srgb" => Planted::NormalMapAsSrgb,
            "draws_black" => Planted::DrawsBlack,
            "halftone_pop_takes_dot_passes" => Planted::HalftonePopTakesDotPasses,
            "ink_fill_flat" => Planted::InkFillFlat,
            "rim_keeps_first" => Planted::RimKeepsFirst,
            "profile_admits_zero_breaks" => Planted::ProfileAdmitsZeroBreaks,
            "live_passes_no_page" => Planted::LivePassesNoPage,
            "reuse_drops_page" => Planted::ReuseDropsPage,
            "drops_clouds" => Planted::DropsClouds,
            "add_writes_depth" => Planted::AddWritesDepth,
            "add_skips_depth_test" => Planted::AddWithoutDepthTest,
            "ids_by_draw_position" => Planted::IdsByDrawPosition,
            "gpu_cull_by_center" => Planted::GpuCullByCenter,
            "count_read_back" => Planted::CountReadBack,
            "compact_in_reverse" => Planted::CompactInReverse,
            "ids_by_compacted_row" => Planted::IdsByCompactedRow,
            "row_as_element" => Planted::RowAsElement,
            "dispatch_without_guard" => Planted::DispatchWithoutGuard,
            "pyramid_from_previous_frame" => Planted::PyramidFromPreviousFrame,
            "occlusion_by_centre" => Planted::OcclusionByCentre,
            "occlusion_in_cascades" => Planted::OcclusionInCascades,
            "occlusion_in_probe_captures" => Planted::OcclusionInProbeCaptures,
            "ids_ignore_mask" => Planted::IdsIgnoreMask,
            "cut_color_only" => Planted::CutsColorOnly,
            "soft_noise_from_frame" => Planted::SoftNoiseFromFrame,
            "local_map_stale" => Planted::LocalMapStale,
            "tile_arrival_order" => Planted::TileArrivalOrder,
            "tile_keeps_fixed_caps" => Planted::TileKeepsFixedCaps,
            "tile_hysteresis" => Planted::TileHysteresis,
            "tile_filter_in_texels" => Planted::TileFilterInTexels,
            "tile_key_without_size" => Planted::TileKeyWithoutSize,
            "ies_peak_normalized" => Planted::IesPeakNormalized,
            "cascade_unsnapped" => Planted::CascadeUnsnapped,
            "cascade_filter_in_texels" => Planted::CascadeFilterInTexels,
            "cascade_no_penumbra_reach" => Planted::CascadeNoPenumbraReach,
            "local_map_ignores_t" => Planted::LocalMapIgnoresT,
            "local_map_rekeys_on_any_t" => Planted::LocalMapRekeysOnAnyT,
            "cut_key_omits_planes" => Planted::CutKeyOmitsPlanes,
            "single_pixel_pick" => Planted::SinglePixelPick,
            "hit_from_depth" => Planted::HitFromDepth,
            "cascade_cache_keeps_stale" => Planted::CascadeCacheKeepsStale,
            "prefilter_over_frames" => Planted::PrefilterOverFrames,
            "uncompensated_lobe" => Planted::UncompensatedLobe,
            "compensates_environment_only" => Planted::CompensatesEnvironmentOnly,
            "premixed_metallic" => Planted::PremixedMetallic,
            "band_hysteresis" => Planted::BandHysteresis,
            "light_cut_hysteresis" => Planted::LightCutHysteresis,
            "eye_inset_centred_frustum" => Planted::EyeInsetCentredFrustum,
            "one_backdrop_per_frame" => Planted::OneBackdropPerFrame,
            "one_mirror_per_frame" => Planted::OneMirrorPerFrame,
            "one_light_cut_per_frame" => Planted::OneLightCutPerFrame,
            "inset_premultiplied_as_straight" => Planted::InsetPremultipliedAsStraight,
            "clamp_each_axis" => Planted::ClampEachAxis,
            "clamp_unmirrored_behind" => Planted::ClampUnmirroredBehind,
            "clamp_to_frame" => Planted::ClampToFrame,
            "edge_from_previous_frame" => Planted::EdgeFromPreviousFrame,
            "leader_draws_while_clamped" => Planted::LeaderDrawsWhileClamped,
            "band_fade_by_wall_clock" => Planted::BandFadeByWallClock,
            "level_by_earlier_frame" => Planted::LevelByEarlierFrame,
            "band_masks_independent" => Planted::BandMasksIndependent,
            "blend_level_on_gpu" => Planted::BlendLevelOnGpu,
            "climb_never_steps_down" => Planted::ClimbNeverStepsDown,
            "canonical_climbs" => Planted::CanonicalClimbs,
            "reclimbs_without_view_change" => Planted::ReclimbsWithoutViewChange,
            "terrain_lod_by_distance" => Planted::TerrainLodByDistance,
            "terrain_shades_own_level_normals" => Planted::TerrainShadesOwnLevelNormals,
            "drops_dispersion" => Planted::DropsDispersion,
            "absorption_ignores_thickness" => Planted::AbsorptionIgnoresThickness,
            "transmission_ignores_roughness" => Planted::TransmissionIgnoresRoughness,
            "dispersion_samples_once" => Planted::DispersionSamplesOnce,
            "specular_color_ignored" => Planted::SpecularColorIgnored,
            "iridescence_ignores_thickness" => Planted::IridescenceIgnoresThickness,
            "diffuse_lambert" => Planted::DiffuseLambert,
            "oren_nayar_uncompensated" => Planted::OrenNayarUncompensated,
            "retroreflection_ignored" => Planted::RetroreflectionIgnored,
            "flakes_by_pixel" => Planted::FlakesByPixel,
            "subsurface_across_parts" => Planted::SubsurfaceAcrossParts,
            "subsurface_adds_to_diffuse" => Planted::SubsurfaceAddsToDiffuse,
            "lobe_output_scales_field" => Planted::LobeOutputScalesField,
            "occlusion_scales_direct" => Planted::OcclusionScalesDirect,
            "bump_ignores_handedness" => Planted::BumpIgnoresHandedness,
            "coat_normal_bends_base" => Planted::CoatNormalBendsBase,
            "missing_lobe_turned_on" => Planted::MissingLobeTurnedOn,
            "light_drops_fresnel" => Planted::LightDropsFresnel,
            "ambient_adds_nz" => Planted::AmbientAddsNz,
            "loop_shadow_one" => Planted::LoopShadowOne,
            "loop_calls_cut_lights" => Planted::LoopCallsCutLights,
            "loop_world_normal" => Planted::LoopWorldNormal,
            "loop_view_away" => Planted::LoopViewAway,
            "fill_top_32" => Planted::FillTop32,
            "cluster_arrival_order" => Planted::ClusterArrivalOrder,
            "cluster_cap_by_list_order" => Planted::ClusterCapByListOrder,
            "auto_range_fixed_cut" => Planted::AutoRangeFixedCut,
            "iterate_feeds_first" => Planted::IterateFeedsFirst,
            "sort_ties_decreasing" => Planted::SortTiesDecreasing,
            "compact_by_atomic" => Planted::CompactByAtomic,
            "index_wraps" => Planted::IndexWraps,
            "mips_level0_only" => Planted::MipsLevel0Only,
            "mips_kept_under_old_key" => Planted::MipsKeptUnderOldKey,
            "pool_without_clear" => Planted::PoolWithoutClear,
            "steps_per_frame" => Planted::StepsPerFrame,
            "ring_keeps_every_checkpoint" => Planted::RingKeepsEveryCheckpoint,
            "carried_class_exact" => Planted::CarriedClassExact,
            "step_reads_live_pointer" => Planted::StepReadsLivePointer,
            "restore_starts_from_clear_value" => Planted::RestoreStartsFromClearValue,
            "check_skips_bound" => Planted::CheckSkipsBound,
            "ring_checkpoints_textures_on_alternate_steps" => {
                Planted::RingCheckpointsTexturesOnAlternateSteps
            }
            "vignette_pixels" => Planted::VignettePixels,
            "grain_from_t" => Planted::GrainFromT,
            "partial_coverage" => Planted::PartialCoverage,
            "puff_full_opacity" => Planted::PuffFullOpacity,
            "light_after_upscale" => Planted::LightAfterUpscale,
            "flicker_wall_time" => Planted::FlickerWallTime,
            "convergence_angle_ignored" => Planted::ConvergenceAngleIgnored,
            "tracking_wall_time" => Planted::TrackingWallTime,
            "keeps_latest_error" => Planted::KeepsLatestError,
            "reopens_tight_loop" => Planted::ReopensTightLoop,
            "resize_leaves_rendering" => Planted::ResizeLeavesRendering,
            "repeats_last_reading" => Planted::RepeatsLastReading,
            "drops_unresolved_frames" => Planted::DropsUnresolvedFrames,
            "ladder_acts_in_budget_run" => Planted::LadderActsInBudgetRun,
            "times_each_pass_alone" => Planted::TimesEachPassAlone,
            "takes_first_measurement_as_limit" => Planted::TakesFirstMeasurementAsLimit,
            "holds_input" => Planted::HoldsInput,
            "held_input_meter_at_encode" => Planted::HeldInputMeterAtEncode,
            "bind_group_per_item" => Planted::BindGroupPerItem,
            "uploads_every_transform" => Planted::UploadsEveryTransform,
            "warms_per_item" => Planted::WarmsPerItem,
            "times_only_scene" => Planted::TimesOnlyScene,
            "wait_clock_after_warmup" => Planted::WaitClockAfterWarmup,
            "picks_largest_gain" => Planted::PicksLargestGain,
            "point_video_keeps_frame_before_seek" => Planted::PointVideoKeepsFrameBeforeSeek,
            "video_background_prefiltered" => Planted::VideoBackgroundPrefiltered,
            "instancer_addresses_by_slot" => Planted::InstancerAddressesBySlot,
            "overlay_keeps_grid_on_seek" => Planted::OverlayKeepsGridOnSeek,
            "line_reads_previous_step" => Planted::LineReadsPreviousStep,
            "part_pose_in_world_space" => Planted::PartPoseInWorldSpace,
            "terrain_no_horizon_bake" => Planted::TerrainNoHorizonBake,
            "terrain_occlusion_from_slope" => Planted::TerrainOcclusionFromSlope,
            deep_canvas_scene3d::tracks::KEEPS_LAST_FRAME => Planted::TracksKeepLastFrame,
            "raster_lists_nothing" => Planted::RasterListsNothing,
            _ => {
                let named = deep_canvas_scene3d::spans::PLANTED.iter().map(|p| p.0);
                Planted::Named(named.chain(particles::PLANTED).find(|p| *p == name)?)
            }
        })
    }
}

/// The handoff the surface takes, as the last conformance run decided it.
pub struct Decision {
    pub path: Path,
    pub fps_cap: Option<u32>,
    pub internal_scale: f64,
    /// Health readings: one per failed conformance part.
    pub readings: Vec<Value>,
}

pub struct App {
    pub cx: HeadlessAppContext,
    pub worker: Worker,
    pub backend: Backend,
    pub planted: Option<Planted>,
    /// The `--planted` name, which a process the app starts runs under too (#1903).
    pub planted_name: Option<String>,
    pub decision: Decision,
    pub declarations: Declarations,
    /// Dark declarations in the order they were recorded.
    pub dark: Vec<(String, String)>,
    pub window: Option<Win>,
    pub scenes: HashMap<String, Arc<Scene>>,
    /// Each scene session's UI side, routed GPUI's surface reports.
    pub watched: HashMap<String, deep_gpu::view::Ui>,
    /// The compile-thread job held open, and how many jobs were held (#140).
    pub held: Option<compile::Held>,
    pub jobs: u64,
    /// A validation lane's run (`--validation`, #140).
    pub validation: bool,
    /// Whether Vello GPU draws 2D writer layers, by its spike record (#385).
    pub vello: marks2d::Gate,
    /// The run's decode worker and the maps it made (#423).
    pub made: textures::Made,
    /// #458: what a `relation` call's draw reads beside view3d's own targets (`exposed`,
    /// `geometry_normal`, `lighting`); empty for every other call.
    pub relation_reads: std::collections::BTreeSet<&'static str>,
    /// #458: the adapter the full lane's configuration names, which only the planted lane reads.
    pub lane_adapter: Option<full_lane::Adapter>,
}

pub fn refused(code: &str, reason: impl Into<String>) -> Value {
    json!({"code": code, "reason": reason.into()})
}

impl App {
    /// The app's planted program as the compositor's render crate names it (#1561).
    pub(crate) fn composed(&self) -> Option<deep_groups_render::Planted> {
        self.planted.and_then(Planted::composed)
    }

    pub fn scene(&mut self, path: &str) -> Result<Arc<Scene>, Value> {
        if let Some(s) = self.scenes.get(path) {
            return Ok(s.clone());
        }
        let scene = Arc::new(Scene::load(path).map_err(|e| refused("bad_input", e))?);
        self.scenes.insert(path.to_string(), scene.clone());
        Ok(scene)
    }

    /// The run's window at `size`, opened (or reopened at another size).
    pub fn window(&mut self, size: [u32; 2]) -> Result<&Win, Value> {
        if self.window.as_ref().is_none_or(|w| w.size != size) {
            if let Some(old) = self.window.take() {
                old.close(&mut self.cx);
            }
            self.window = Some(Win::open(&mut self.cx, size).map_err(|e| refused("no_window", e))?);
        }
        Ok(self.window.as_ref().expect("opened above"))
    }

    fn backend_name(&self) -> &'static str {
        match self.backend {
            Backend::Noop => "noop",
            Backend::Gpu if cfg!(target_os = "macos") => "metal",
            Backend::Gpu => "gpu",
        }
    }

    fn surface(&mut self) -> Value {
        let backend = self.backend_name();
        let (fps_cap, internal_scale) = (self.decision.fps_cap, self.decision.internal_scale);
        let decided = self.decision.path;
        self.worker.call(move |state| {
            let device = json!({"backend": backend, "count": Gpu::count()});
            let Some(s) = state.current() else {
                return json!({"device": device, "path": decided.name(), "size_px": [0, 0], "scale": 1, "internal_scale": internal_scale,
                    "format": "bgra8_premultiplied", "color_space": "srgb", "slots": [], "msaa": "transient", "fps_cap": fps_cap});
            };
            let slots: Vec<Value> = s.view.ui().states().iter().map(|st| json!({"state": st.name()})).collect();
            json!({
                "device": device,
                "path": s.path.name(),
                "size_px": s.view.config().size,
                "scale": 1,
                "internal_scale": internal_scale,
                "format": "bgra8_premultiplied",
                "color_space": "srgb",
                "slots": slots,
                "msaa": "transient",
                "fps_cap": fps_cap,
                "rebuilds": s.view.rebuilds(),
            })
        })
    }

    /// `raise_errors` (#1413, test-faults): `count` identical validation errors on the app's
    /// device, through its uncaptured-error callback, as fast as it can.
    #[cfg(feature = "test-faults")]
    fn raise_errors(&mut self, call: &Value) -> Value {
        let count = call["count"].as_u64().unwrap_or(0);
        self.worker.call(move |state| {
            let device = match state.gpu.recover() {
                Ok(d) => d,
                Err(e) => return refused("no_device", e),
            };
            let before = deep_gpu::device::raised_total();
            let start = std::time::Instant::now();
            for _ in 0..count {
                // A buffer both read- and write-mapped: invalid, the same error each time.
                drop(device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("raise_errors"),
                    size: 4,
                    usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::MAP_WRITE,
                    mapped_at_creation: false,
                }));
            }
            let ms = start.elapsed().as_secs_f64() * 1e3;
            device.take_raised();
            json!({"raised": deep_gpu::device::raised_total() - before, "ms": ms, "burst": deep_gpu::device::BURST})
        })
    }

    fn resources(&mut self) -> Value {
        self.worker.call(|state| {
            let epoch = state.gpu.device().epoch;
            let mut out = Vec::new();
            for s in state.sessions.values() {
                let module = s.view.module();
                let built = module.built_on().unwrap_or(0);
                for d in module.declared() {
                    let (name, kind) = d.split_once(':').unwrap_or((d, "resource"));
                    out.push(json!({"module": module.name(), "name": format!("{}/{name}", s.scene.name), "kind": kind, "device_epoch": built}));
                }
                for (i, built) in s.view.slots_built().into_iter().enumerate() {
                    if built {
                        out.push(json!({"module": "gpu.surface", "name": format!("{}/slot {i}", s.scene.name), "kind": "texture", "device_epoch": s.view.device().epoch}));
                    }
                }
            }
            json!({"device_epoch": epoch, "resources": out})
        })
    }

    fn buffer(&mut self, call: &Value) -> Value {
        let size = call["size"].as_u64().unwrap_or(0);
        let writes: Vec<(u64, Vec<u8>)> = call["writes"]
            .as_array()
            .map(|w| {
                w.iter()
                    .map(|x| {
                        let bytes = x["bytes"]
                            .as_array()
                            .map(|b| b.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect())
                            .unwrap_or_default();
                        (x["offset"].as_u64().unwrap_or(0), bytes)
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.worker.call(move |state| {
            let device = match state.gpu.recover() {
                Ok(d) => d,
                Err(e) => return refused("no_device", e),
            };
            let d = &device.device;
            let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("deep-gpu buffer call"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            for (offset, bytes) in &writes {
                device.queue.write_buffer(&buffer, *offset, bytes);
            }
            let staging = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("deep-gpu buffer read back"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut encoder = d.create_command_encoder(&Default::default());
            encoder.copy_buffer_to_buffer(&buffer, 0, &staging, 0, size);
            device.queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            let _ = d.poll(wgpu::PollType::wait_indefinitely());
            if !matches!(rx.recv(), Ok(Ok(()))) {
                return refused("no_read_back", "the buffer didn't map");
            }
            let read: Vec<u8> = match staging.slice(..).get_mapped_range() {
                Ok(data) => data.to_vec(),
                Err(e) => return refused("no_read_back", e.to_string()),
            };
            json!({"size": size, "read": read})
        })
    }

    fn health(&self) -> Value {
        json!({"readings": self.decision.readings})
    }

    fn call(&mut self, out: &str, call: &Value) -> Value {
        match call["call"].as_str() {
            Some("frames") => frames::call(self, out, call),
            Some("surface") => self.surface(),
            Some("resources") => self.resources(),
            Some("health") => self.health(),
            Some("buffer") => self.buffer(call),
            Some("conformance") => conformance::call(self, out, call),
            Some("render") => frames::render(self, call),
            Some("compile") => compile::call(self, call),
            Some("lose_device") => compile::lose_device(self),
            Some("release_job") => compile::release_job(self),
            Some("gated") => seam::gated(self, call),
            Some("seam_suite") => seam::seam_suite(self, out, call),
            Some("validate") => validation::validate(self, out, call),
            Some("check_render") => validation::check_render(self, call),
            Some("compare") => compare::compare(self, call),
            Some("declare_dark") => compare::declare(self, call),
            Some("decisions") => compare::decisions(self),
            Some("plugin") => plugin::call(self, out, call),
            Some("view3d") => view3d::call(self, out, call),
            Some("relation") => relation::call(self, out, call),
            Some("full_lane") => full_lane::call(self, out, call),
            Some("particles") => particles::call(self, out, call),
            Some("trail") => trails::call(self, out, call),
            Some("simplify") => simplify::call(out, call),
            Some("workers") => textures::workers(self),
            Some("tone") => tone::call(self, out, call),
            Some("host") => host::call(self, out, call),
            Some("guard") => guard::call(self, out, call),
            Some("operators") => effects::operators(self),
            Some("calibrate") => calibrate::calibrate(self),
            Some("reference") => effects::reference(self, out, call),
            Some("check_operator") if opframe::wants(call) => opframe::call(self, out, call),
            Some("check_operator") => effects::check_operator(self, out, call),
            Some("op") => effects::op(self, call),
            Some("columns") => columns::call(self, call),
            Some("exact") => effects::exact(self, out),
            Some("cross_gpu") => effects::cross_gpu(self, call),
            Some("index_record") => records::index_record(self, out, call),
            Some("cross_index") => records::cross_index(call),
            Some("op_table") => steps_ref::op_table(),
            Some("steps_reference") => steps_ref::steps_reference(self, out),
            Some("interp_suite") => interp_suite::call(self, call),
            Some("golden") => golden::golden(self, out, call),
            Some("decide") => golden::decide(self, call),
            Some("live") => live::call(self, out, call),
            #[cfg(feature = "test-faults")]
            Some("raise_errors") => self.raise_errors(call),
            Some("live_frame") => parity::live_frame(self, out, call),
            Some("layers") => marks2d::layers(self, out, call),
            Some("window2d") => marks2d::window2d(self, out, call),
            Some("vello_gpu") => marks2d::vello_gpu(self),
            Some("spike2d") => marks2d::spike2d(self, out, call),
            Some("film2d") => film::film2d(self, out, call),
            Some("canonical") => live::canonical(self, out, call),
            Some("frame_budget") => budget::call(self, call),
            Some("envelope") => envelope::call(self, out, call),
            Some("envelope_counts") => envelope::counts(self, call),
            Some("envelope_opens") => envelope::opens(self, call),
            Some("budget_fix") => fix::call(self, out, call),
            Some("adapter") => timing::adapter(self),
            Some("tick") => timing::tick(self, call),
            #[cfg(feature = "test-meter")]
            Some("allocate") => allocations::allocate(self, call),
            #[cfg(feature = "test-meter")]
            Some("release") => allocations::release(self, call),
            _ => refused("bad_input", "unknown call"),
        }
    }
}

fn bad_input() -> ! {
    println!("{}", json!({"ok": false, "code": "bad_input"}));
    std::process::exit(2);
}

fn main() {
    let mut args = std::env::args().skip(1);
    // #423: a copy of this binary started as the run's decode worker (deep-codecs).
    let first = args.next();
    if first.as_deref() == Some("decode-worker") {
        let rest: Vec<String> = args.collect();
        std::process::exit(deep_codecs::serve(deep_codecs::DECODE_WORKER, &rest));
    }
    // #149: a copy of this binary started as a film's encode tool.
    if first.as_deref() == Some("encode-tool") {
        let rest: Vec<String> = args.collect();
        std::process::exit(deep_codecs::serve(deep_codecs::ENCODE_TOOL, &rest));
    }
    if first.as_deref() != Some("run") {
        bad_input();
    }
    let (mut backend, mut planted, mut planted_name) = (Backend::Gpu, None, None);
    let (mut startup, mut validation) = (Startup::default(), false);
    let mut headless = false;
    // The planted reopen (#1413, test-faults): the first n reopens fail, or every one.
    #[allow(unused_mut)]
    let mut fail_reopen: Option<Option<u64>> = None;
    // The shipped record, or in test-spike builds the one `--spike-record` names.
    #[allow(unused_mut)]
    let mut spike = marks2d::SPIKE.to_string();
    while let Some(a) = args.next() {
        match a.as_str() {
            #[cfg(feature = "test-spike")]
            "--spike-record" => match args.next().map(std::fs::read_to_string) {
                Some(Ok(text)) => spike = text,
                _ => bad_input(),
            },
            "--headless" => headless = true,
            "--backend" => match args.next().as_deref() {
                Some("noop") => backend = Backend::Noop,
                _ => bad_input(),
            },
            "--planted" => match args.next().and_then(|n| Some((Planted::parse(&n)?, n))) {
                Some((p, name)) => {
                    planted_name = Some(name);
                    planted = Some(p)
                }
                None => bad_input(),
            },
            "--withhold" => match args.next().as_deref().and_then(deep_gpu::seam::row) {
                Some(r) => startup.withhold.push(r.feature),
                None => bad_input(),
            },
            "--validation" => validation = true,
            #[cfg(feature = "test-faults")]
            "--fail-reopen" => match args.next().as_deref() {
                Some("always") => fail_reopen = Some(None),
                Some(n) => match n.parse() {
                    Ok(n) => fail_reopen = Some(Some(n)),
                    Err(_) => bad_input(),
                },
                None => bad_input(),
            },
            #[cfg(feature = "test-seam")]
            "--adapters" => match args.next().as_deref().and_then(seam::test_adapters) {
                Some(a) => startup.adapters = Some(a),
                None => bad_input(),
            },
            #[cfg(feature = "test-seam")]
            "--quirks" => match args.next().map(std::fs::read_to_string) {
                Some(Ok(text)) => match deep_gpu::seam::Quirks::parse(&text) {
                    Ok(q) => startup.quirks = q,
                    Err(_) => bad_input(),
                },
                _ => bad_input(),
            },
            _ => bad_input(),
        }
    }
    let Ok(vello) = marks2d::Gate::read(&spike, planted == Some(Planted::IgnoresSpike)) else {
        bad_input();
    };
    startup.picks_first = planted == Some(Planted::PicksFirstAdapter);
    startup.withholds_in_code = planted == Some(Planted::WithholdsInCode);
    if validation {
        // Metal reads these as the device opens, so they're set before it does (README: The
        // validation lane).
        for var in validation::ENV {
            std::env::set_var(var, "1");
        }
    }
    #[cfg(target_os = "macos")]
    {
        use gpui_apple::metal_renderer::gpu_surfaces::{plant, Planted as Patch};
        plant(match planted {
            Some(Planted::DividesAlpha) => Patch::DividesAlpha,
            Some(Planted::DrawsSurfacesAfterScene) => Patch::AfterScene,
            _ => Patch::None,
        });
    }
    let worker = match Worker::start(
        backend,
        &startup,
        planted == Some(Planted::SubmitsOnCompletion),
        planted == Some(Planted::ReleasesBeforeCompletion),
    ) {
        Ok(w) => w,
        Err(r) if r.code == "missing_feature" => {
            println!(
                "{}",
                json!({"ok": false, "code": r.code, "adapter": r.adapter, "missing": r.missing, "reason": r.reason})
            );
            std::process::exit(1);
        }
        Err(r) => {
            println!(
                "{}",
                json!({"ok": false, "code": "no_device", "reason": r.reason})
            );
            std::process::exit(1);
        }
    };
    if let Some(n) = fail_reopen {
        worker.call(move |state| state.gpu.fail_reopens(n));
    }
    if headless {
        // The headless canvas worker opens no window and holds no app: no GPUI context, the GPU
        // layer drawn into its offscreen slots (#140).
        serve(|out, call| match call["call"].as_str() {
            Some("snapshot") => parity::snapshot(&worker, backend, out, call),
            _ => refused("bad_input", "the headless worker answers snapshot alone"),
        });
        return;
    }
    // The platform's handoff as this task ships it: macOS passed the conformance fixture, so it
    // hands off zero copy until a conformance run on this machine says otherwise; the noop backend
    // has no surface to share, so it copies.
    let path = if cfg!(target_os = "macos") && backend == Backend::Gpu {
        Path::ZeroCopy
    } else {
        Path::Copy
    };
    let mut app = App {
        cx: deep_replica::headless_context(),
        worker,
        backend,
        planted,
        planted_name,
        decision: Decision {
            path,
            fps_cap: None,
            internal_scale: 1.,
            readings: Vec::new(),
        },
        declarations: Declarations::default(),
        dark: Vec::new(),
        window: None,
        scenes: HashMap::new(),
        watched: HashMap::new(),
        held: None,
        jobs: 0,
        validation,
        vello,
        made: Default::default(),
        relation_reads: Default::default(),
        lane_adapter: None,
    };
    serve(|out, call| app.call(out, call));
}
