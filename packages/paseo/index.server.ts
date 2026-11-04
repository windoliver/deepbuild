// DeepBuild's paseo plugin (#55), loaded by paseo's daemon in a subprocess of its own.
import { contribute, type Server } from './server/plugin.ts';

export default function deepbuild(server: Server): () => void {
  return contribute(server);
}
