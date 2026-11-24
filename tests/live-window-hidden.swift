// tests/live-window-hidden.test.ts's assistive client: `deep-show live`'s window read from outside its process while
// nobody can see it. It presses nothing and starts nothing; compiled by the test into a temporary folder.
//
//   hidden gate                  {"ax": bool, "locked": bool, "asleep": bool}
//   hidden watch <pid> <seconds> minimizes the process's window as soon as it lists, waits until AppKit says it is
//                                minimized, reads the tree, then hears the announcements asked for over <seconds>:
//                                {"window": bool, "minimized": bool, "elements": [{"identifier", "value"}], "heard": [text]}
import AppKit
import ApplicationServices

func emit(_ value: Any) {
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: value))
}
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
/// Every element under `element` that carries an identifier.
func identified(_ element: AXUIElement, _ depth: Int) -> [[String: Any]] {
  let id = attribute(element, kAXIdentifierAttribute) as? String ?? ""
  let own: [[String: Any]] = id.isEmpty ? [] : [["identifier": id, "value": attribute(element, kAXValueAttribute) as? String ?? ""]]
  let children = depth > 40 ? [] : attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
  return own + children.flatMap { identified($0, depth + 1) }
}

var heard: [String] = []
let args = CommandLine.arguments
if args.count == 2, args[1] == "gate" {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  emit([
    "ax": AXIsProcessTrusted(), "locked": session["CGSSessionScreenIsLocked"] as? Bool ?? false,
    "asleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0,
  ])
  exit(0)
}
guard args.count == 4, args[1] == "watch", let pid = pid_t(args[2]), let seconds = Double(args[3]) else { exit(2) }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 10)
func window() -> AXUIElement? { (attribute(app, kAXWindowsAttribute) as? [AXUIElement])?.first }
let listed = Date().addingTimeInterval(30)
while window() == nil && Date() < listed { CFRunLoopRunInMode(.defaultMode, 0.1, false) }
guard let window = window() else {
  emit(["window": false, "minimized": false, "elements": [[String: Any]](), "heard": heard] as [String: Any])
  exit(0)
}
AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
func minimized() -> Bool { attribute(window, kAXMinimizedAttribute) as? Bool ?? false }
let until = Date().addingTimeInterval(4)
while !minimized() && Date() < until { CFRunLoopRunInMode(.defaultMode, 0.05, false) }
// Hidden from here on, so nothing below is owed to a frame the display asked for.
let gone = minimized()
let elements = identified(window, 0)
var observer: AXObserver?
AXObserverCreateWithInfoCallback(pid, { _, _, _, info, _ in
  heard.append((info as NSDictionary)["AXAnnouncementKey"] as? String ?? "")
}, &observer)
// One registration, on the application: each announcement is called back once.
AXObserverAddNotification(observer!, app, "AXAnnouncementRequested" as CFString, nil)
CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer!), .defaultMode)
CFRunLoopRunInMode(.defaultMode, seconds, false)
emit(["window": true, "minimized": gone && minimized(), "elements": elements, "heard": heard] as [String: Any])
