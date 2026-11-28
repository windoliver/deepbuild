use gpui_kit::{
    div, AnyElement, AnyView, App, Empty, IntoElement, ParentElement, StyleRefinement, Styled,
    Window,
};

use super::{Kind, Shipped};

pub(super) struct CachedPanels;

impl gpui_kit::base::dock::DockAreaRenderer for CachedPanels {
    fn tab_group_renderer(&self) -> std::rc::Rc<dyn gpui_kit::base::dock::TabGroupRenderer> {
        std::rc::Rc::new(CachedPanels)
    }
}

impl gpui_kit::base::dock::TabGroupRenderer for CachedPanels {
    fn render_tab_bar(
        &self,
        _: &gpui_kit::base::dock::TabGroupContext,
        _: &mut Window,
        _: &mut App,
    ) -> AnyElement {
        Empty.into_any_element()
    }

    fn render_active_panel(
        &self,
        panel: AnyView,
        _: &gpui_kit::base::dock::TabGroupContext,
        _: &mut Window,
        cx: &mut App,
    ) -> AnyElement {
        let list = panel
            .clone()
            .downcast::<Shipped>()
            .is_ok_and(|panel| panel.read(cx).kind == Kind::Sidebar);
        if list {
            return div().size_full().child(panel).into_any_element();
        }
        panel
            .cached(StyleRefinement::default().size_full())
            .into_any_element()
    }
}
