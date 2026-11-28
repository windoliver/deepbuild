use super::Card;

impl Card {
    pub(super) fn catch_up(&mut self) -> bool {
        let Some(controller) = self.controller.as_mut() else {
            return false;
        };
        let since = self.moved_at;
        let asks = controller.judged_asks();
        let (at, moved) = crate::record::with_view(|view| {
            let docs: Vec<&str> = view
                .events
                .iter()
                .filter(|event| {
                    event["kind"] == "ask.created"
                        && asks.iter().any(|a| *a == crate::states::handle(event))
                })
                .filter_map(|event| crate::pictures::pinned_doc(&event["data"]["pinned_to"]))
                .collect();
            let moved = view.events.iter().any(|event| {
                event["kind"] == "doc.patched"
                    && event["log_pos"].as_u64().is_some_and(|pos| pos > since)
                    && event["data"]["doc"]
                        .as_str()
                        .is_some_and(|doc| docs.contains(&doc))
            });
            (view.log_pos, moved)
        })
        .unwrap_or((since, false));
        self.moved_at = at;
        if moved {
            controller.record_changed(&crate::record::history(), crate::views::now());
        }
        moved
    }
}
