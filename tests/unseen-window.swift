// tests/unseen-window.test.mjs's assistive client: a process's window read from outside it while nobody can see it. It
// presses nothing and starts nothing; compiled by the test into a temporary folder.
//
//   unseen gate             {"ax": bool, "locked": bool, "asleep": bool}
//   unseen minimize <pid>   minimizes the process's window as soon as it lists, before anything under it is asked for:
//                           {"window": bool, "minimized": bool}
//   unseen read <pid> <line>  reads the window until its count's line is <line>, or 30 s passed:
//                           {"minimized": bool, "nodes": [{"identifier", "label"}]}, every node under the window
import AppKit
import ApplicationServices

func emit(_ value: Any) -> Never {
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: value))
  exit(0)
}
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func words(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
func nodes(_ element: AXUIElement, _ depth: Int) -> [[String: String]] {
  let title = words(element, kAXTitleAttribute)
  let own = ["identifier": words(element, kAXIdentifierAttribute), "label": title.isEmpty ? words(element, kAXDescriptionAttribute) : title]
  let children = depth > 40 ? [] : attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
  return [own] + children.flatMap { nodes($0, depth + 1) }
}

let args = CommandLine.arguments
if args.count == 2, args[1] == "gate" {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  emit([
    "ax": AXIsProcessTrusted(), "locked": session["CGSSessionScreenIsLocked"] as? Bool ?? false,
    "asleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0,
  ])
}
guard args.count >= 3, let pid = pid_t(args[2]) else { exit(2) }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 10)
func window() -> AXUIElement? { (attribute(app, kAXWindowsAttribute) as? [AXUIElement])?.first { words($0, kAXRoleAttribute) == kAXWindowRole } }
func minimized(_ window: AXUIElement) -> Bool { attribute(window, kAXMinimizedAttribute) as? Bool ?? false }
func wait(_ seconds: Double, for done: () -> Bool) {
  let until = Date().addingTimeInterval(seconds)
  while !done() && Date() < until { usleep(50_000) }
}
switch args[1] {
case "minimize":
  wait(180) { window() != nil }
  guard let window = window() else { emit(["window": false, "minimized": false]) }
  AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
  wait(6) { minimized(window) }
  emit(["window": true, "minimized": minimized(window)])
case "read":
  guard args.count == 4, let window = window() else { exit(2) }
  // The app draws what its record's reader brings a moment later.
  var seen = nodes(window, 0)
  wait(30) {
    seen = nodes(window, 0)
    return seen.contains { $0["identifier"] == "sidebar-count" && $0["label"] == args[3] }
  }
  emit(["minimized": minimized(window), "nodes": seen] as [String: Any])
default:
  exit(2)
}
