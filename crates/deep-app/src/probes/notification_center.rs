use std::{ptr::NonNull, sync::mpsc, time::Duration};

use block2::RcBlock;
use deep_app::notify::{Notification, NotificationSetting};
use objc2_foundation::{NSArray, NSBundle};
use objc2_user_notifications::{
    UNAlertStyle, UNAuthorizationStatus, UNNotification, UNNotificationSettings,
    UNUserNotificationCenter,
};

/// What macOS says of the app's notifications; `None` outside the bundle, or when the OS doesn't answer.
pub fn setting() -> Option<NotificationSetting> {
    NSBundle::mainBundle().bundleIdentifier()?;
    let (sender, receiver) = mpsc::channel();
    let read = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        // SAFETY: the OS passes valid settings for the call's duration.
        let settings = unsafe { settings.as_ref() };
        let _ = sender.send(
            if settings.authorizationStatus() == UNAuthorizationStatus::Denied {
                NotificationSetting::Denied
            } else if settings.authorizationStatus() != UNAuthorizationStatus::NotDetermined
                && settings.alertStyle() == UNAlertStyle::None
            {
                NotificationSetting::AlertsNone
            } else {
                NotificationSetting::Allowed
            },
        );
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&read);
    receiver.recv_timeout(Duration::from_secs(2)).ok()
}

/// What Notification Center holds from the app's bundle, as the OS lists it: each one's tag as its session and
/// no ask, which only the record can name. `None` outside the bundle, where the center aborts the process, as
/// gpui notes, or when the OS doesn't answer.
pub fn delivered() -> Option<Vec<Notification>> {
    NSBundle::mainBundle().bundleIdentifier()?;
    let (sender, receiver) = mpsc::channel();
    let listed = RcBlock::new(move |list: NonNull<NSArray<UNNotification>>| {
        // SAFETY: the OS passes a valid array for the call's duration.
        let list = unsafe { list.as_ref() };
        let held: Vec<Notification> = list
            .iter()
            .map(|notification| {
                let request = notification.request();
                let content = request.content();
                let title = content.title().to_string();
                Notification {
                    ask: None,
                    session: request.identifier().to_string(),
                    text: format!("{title}\n{}", content.body()),
                    title,
                    sound: None,
                }
            })
            .collect();
        let _ = sender.send(held);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getDeliveredNotificationsWithCompletionHandler(&listed);
    receiver.recv_timeout(Duration::from_secs(10)).ok()
}

/// `--notification-center`: one JSON line per notification it holds.
pub fn print() {
    let Some(held) = delivered() else {
        eprintln!("deep-app: Notification Center didn't list the app's notifications (run it from the bundle)");
        std::process::exit(1);
    };
    for notification in held {
        let body = notification
            .text
            .split_once('\n')
            .map_or("", |(_, body)| body);
        let line = serde_json::json!({"tag": notification.session, "title": notification.title, "body": body});
        println!("{line}");
    }
}
