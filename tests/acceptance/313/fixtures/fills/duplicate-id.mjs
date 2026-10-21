// The kit's broken fake whose message is "duplicate event ID", as a fill module for `deep-conformance run`.
import { kits } from '../../../../../packages/conformance/dist/index.js';

export default kits().find((kit) => kit.name === 'adapter@1').fakes.find((fake) => fake.message === 'duplicate event ID').fill;
