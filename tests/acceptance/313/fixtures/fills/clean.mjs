// The kit's own reference fill, exported the way `deep-conformance run --fill <module>` loads a fill: a module
// whose default export is a Fill. Imported from the built package, so `npm run build --workspaces` runs first.
import { cleanFill, kits } from '../../../../../packages/conformance/dist/index.js';

export default cleanFill(kits().find((kit) => kit.name === 'adapter@1'));
