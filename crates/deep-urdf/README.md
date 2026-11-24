# deep-urdf

## What it is for

The import job's tool for a robot description, `urdf-import` (#3035; canvas primitives: Asset job: imports): a URDF file in, and out a canvas document by hash, the shipped clean look it names and a report. Each link becomes a `group@1` item and a `body@1` with the link's mass, centre of mass and inertia where the file gives them, and each collision box, sphere or cylinder becomes a shape of that body. Each joint becomes an articulated `joint@1` between its two links' bodies: revolute a hinge with limits in degrees, continuous a hinge with none, prismatic a slider with limits in metres, fixed a fixed joint, with the file's origin and axis as the joint's frames and its effort limit as the most its motor pushes. The file's Z-up, right-handed metres become ours, +Y up, by one rotation, −90° about X, applied as a change of axes to every pose, axis, shape and inertia and stated in the report's `rotation`. Everything else gets a row `{element, name}` in the report's `dropped`. A file that needs a macro expanded (an element of the macro namespace, or a value written as `${…}` or `$(…)`), or names a mesh, is refused naming it, since the job runs no code from a file and is given no mesh. It also runs the physics module's check on a document's worlds, for the kind's `import.document`. It is built to WebAssembly by `node scripts/urdf-wasm.mjs` and run by `packages/jobs/import/urdf/urdf.mjs`, outside the canvas core and never per frame.

## Where new code goes

- `src/read.rs`: the file's XML as links, joints and rows of what has no place, and the refusals a file's own text raises.
- `src/convert.rs`: the change of axes, each link's frame with every joint at 0, which links are bodies, and the document and report they make.
- `src/lib.rs`: the import, the worlds' check, the WebAssembly calls, and the tests.

## What it may import

The canvas core (`deep-canvas`) for canonical bytes, hashes and the ops module its angles go through; `deep-canvas-marks` for the shipped look; `deep-canvas-physics` for the check a written world passes; `roxmltree` to read the XML; `serde_json`.

## Deviations

- A link with no mass is no body of its own. A root with none is the world where it has no collision shape and a static body where it has one; any other is a frame on the body that holds its parent, so a fixed joint to it writes no joint, and a moving joint to it is listed in `dropped`.
- A joint that follows another (`<mimic>`), a floating or a planar joint is listed in `dropped` as the joint, and its child link stays a body where the file puts it, held by nothing.
- A centre of mass outside the bounds of its link's collision shapes, or off the origin of a link that has none, is listed in `dropped` as the link's `origin`, since `body@1` takes a `centre_of_mass` only within its shapes' bounds.
- An `<inertia>` that leaves a product of inertia about the link's own axes is listed in `dropped` and the body takes its shapes' inertia, since `inertia` is three moments. A revolute joint whose range is 360° or more is written with no limits and its `<limit>` is listed.
- A joint's speed limit is not carried: `joint@1`'s motor has a most it pushes and no most it runs at.
- A `<visual>` of a box, a sphere or a cylinder is listed in `dropped`: a link's item draws its meshes, and no mesh reaches the job until the mesh convert-in job (#1984) gives it one.
