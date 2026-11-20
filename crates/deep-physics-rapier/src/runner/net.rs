//! #551: a live world as a match's copy steps it (canvas primitives: Net: rollback): its whole
//! state as a rollback checkpoint takes it at a match step, restored with the steps it had run
//! then, and its deep hash, which the copy's full-state hash folds in.

use super::*;

impl Live {
    /// The whole world now, as the backend checkpoints it.
    pub fn checkpoint(&self) -> Checkpoint {
        self.b.checkpoint()
    }

    /// The world as `c` holds it, `steps` steps run.
    pub fn restore(&mut self, c: &Checkpoint, steps: u64) -> Result<(), Value> {
        self.b
            .restore(c)
            .map_err(|r| json!({"ok": false, "issues": [issue(&r)]}))?;
        self.steps = steps;
        Ok(())
    }

    /// The deep hash of the world's whole state now.
    pub fn deep_hash(&self) -> String {
        golden::deep_hash(&self.b.checkpoint().state)
    }
}
