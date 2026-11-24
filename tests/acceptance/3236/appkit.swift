// The #3236 suite's assistive client (criterion 8): `deep-show live`'s window read from outside its process through
// AppKit's accessibility API, as VoiceOver reads it. Cut down from #1459's probe (tests/acceptance/1459/probe.swift),
// with an observer of the announcements the window asks for (AXAnnouncementRequested, whose text is the
// AXAnnouncementKey of its user info: what AccessKit posts for a polite live region whose value changes).
//
//   appkit access                 {"ax": bool}: whether this process may read other processes' accessibility
//   appkit watch <pid> <seconds>  waits up to 30 s for the process's first window, reads its tree, then observes the
//                                 announcements the process asks for over <seconds>, and reads the tree again:
//                                 {"start": [tree], "end": [tree], "announcements": [{"ms", "text"}], "window": bool}
//                                 where a tree node is {"role", "title", "description", "value", "identifier",
//                                 "children"}, each text null when the client gets none
//
// Compiled by helpers.ts with swiftc into a temporary folder. It starts nothing, stops nothing and presses nothing.
import AppKit
import ApplicationServices
import Foundation

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
func die(_ text: String) -> Never {
  FileHandle.standardError.write(Data("appkit: \(text)\n".utf8))
  exit(2)
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> Any {
  guard let value = attribute(element, name) else { return NSNull() }
  if let s = value as? String { return s.isEmpty ? NSNull() : s }
  if let n = value as? NSNumber { return n.stringValue }
  return NSNull()
}
func node(_ element: AXUIElement, _ depth: Int) -> [String: Any] {
  let children = depth > 40 ? [] : (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [])
  return [
    "role": text(element, kAXRoleAttribute),
    "title": text(element, kAXTitleAttribute),
    "description": text(element, kAXDescriptionAttribute),
    "value": text(element, kAXValueAttribute),
    "identifier": text(element, kAXIdentifierAttribute),
    "children": children.map { node($0, depth + 1) },
  ]
}
func app(_ pid: pid_t) -> AXUIElement {
  let element = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(element, 5)
  return element
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(app(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }

/// The announcements heard, with the milliseconds since the watch began.
var heard: [[String: Any]] = []
var began = Date()

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: appkit <access|watch> ...") }

switch args[1] {
case "access":
  emit(["ax": AXIsProcessTrusted()] as [String: Any])
case "watch":
  guard args.count > 3, let pid = pid_t(args[2]), let seconds = Double(args[3]) else { die("watch takes a pid and seconds") }
  let until = Date().addingTimeInterval(30)
  var found = windows(pid)
  while found.isEmpty && Date() < until {
    CFRunLoopRunInMode(.defaultMode, 0.2, false)
    found = windows(pid)
  }
  if found.isEmpty {
    emit(["window": false, "start": [], "end": [], "announcements": []] as [String: Any])
    exit(0)
  }
  let start = found.map { node($0, 0) }
  var observer: AXObserver?
  let made = AXObserverCreateWithInfoCallback(pid, { _, _, notification, info, _ in
    let dict = info as NSDictionary
    let said = dict["AXAnnouncementKey"] as? String ?? ""
    heard.append(["ms": Int(Date().timeIntervalSince(began) * 1000), "text": said, "notification": notification as String])
  }, &observer)
  guard made == .success, let observer else { die("no observer for pid \(pid): \(made.rawValue)") }
  for element in [app(pid)] + found {
    _ = AXObserverAddNotification(observer, element, "AXAnnouncementRequested" as CFString, nil)
  }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
  began = Date()
  CFRunLoopRunInMode(.defaultMode, seconds, false)
  let end = windows(pid).map { node($0, 0) }
  emit(["window": true, "start": start, "end": end, "announcements": heard] as [String: Any])
default:
  die("unknown command \(args[1])")
}
