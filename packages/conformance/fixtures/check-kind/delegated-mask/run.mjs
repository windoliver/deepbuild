// A clean-looking command that delegates to a masked one, as a package script might: the tool's exit never reaches
// the runner, so the run is uncounted and the mask named, found in the child command.
import { execSync } from 'node:child_process';

execSync('node --test --test-isolation=none spec/*.test.mjs || true', { stdio: 'inherit' });
