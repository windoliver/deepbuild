//! What the macOS-only probes say elsewhere: they run on macOS only.

pub mod notification_center {
    pub fn delivered() -> Option<Vec<deep_app::notify::Notification>> {
        None
    }

    pub fn setting() -> Option<deep_app::notify::NotificationSetting> {
        None
    }

    pub fn print() {
        eprintln!("deep-app: --notification-center runs on macOS only");
        std::process::exit(1);
    }
}

pub mod capture_bug {
    pub fn start(_: std::path::PathBuf, _: &mut gpui_kit::App) {
        eprintln!("deep-app: the bug capture runs on macOS only");
    }
}
