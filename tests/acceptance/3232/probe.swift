// The #3232 suite's assistive client: the real app read from outside its process through the Accessibility API, as a
// screen reader reads AppKit's tree. Cut down from #1459's probe (tests/acceptance/1459/probe.swift), with each node's
// subrole and its live-region mark (AXARIALive) added, and what stops a reading (no permission, a locked session, a
// window that isn't in front) said as data.
//
//   probe access                  {"ax": bool, "locked": bool}
//   probe windows <pid>           the frames of the process's windows the Accessibility API lists: [[x, y, w, h]]
//   probe tree <pid>              [node], one per window; a node is {"role", "subrole", "title", "description",
//                                 "value", "identifier", "live", "children"}, each text null when the client gets none
//   probe place <pid> <w> <h>     moves the process's largest window to the top left and sets its size, in points
//   probe front <pid>             brings the process and its windows forward: {"front": bool, "main": bool}, whether
//                                 its window is the frontmost on screen and whether AppKit calls it the main one
//
// Compiled by helpers.ts with swiftc into the run's temp folder. It starts nothing, stops nothing and presses nothing.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
func die(_ text: String) -> Never {
  FileHandle.standardError.write(Data("probe: \(text)\n".utf8))
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
func frame(_ element: AXUIElement) -> [Double] {
  var point = CGPoint.zero
  var size = CGSize.zero
  if let v = attribute(element, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &point) }
  if let v = attribute(element, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &size) }
  return [point.x, point.y, size.width, size.height].map(Double.init)
}
func node(_ element: AXUIElement, _ depth: Int) -> [String: Any] {
  let children = depth > 40 ? [] : (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [])
  return [
    "role": text(element, kAXRoleAttribute),
    "subrole": text(element, kAXSubroleAttribute),
    "title": text(element, kAXTitleAttribute),
    "description": text(element, kAXDescriptionAttribute),
    "value": text(element, kAXValueAttribute),
    "identifier": text(element, kAXIdentifierAttribute),
    // How AppKit's tree marks a live region and how politely it speaks: "polite", "assertive" or "off".
    "live": text(element, "AXARIALive"),
    "children": children.map { node($0, depth + 1) },
  ]
}
func app(_ pid: pid_t) -> AXUIElement {
  let element = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(element, 5)
  return element
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(app(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }
func largest(_ pid: pid_t) -> AXUIElement? {
  windows(pid).max { a, b in
    let (x, y) = (frame(a), frame(b))
    return x[2] * x[3] < y[2] * y[3]
  }
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <access|windows|tree|place|front> ...") }
func pid(_ at: Int) -> pid_t {
  guard args.count > at, let p = pid_t(args[at]) else { die("\(args[1]) takes a pid") }
  return p
}
func number(_ at: Int) -> Double {
  guard args.count > at, let n = Double(args[at]) else { die("\(args[1]) takes numbers") }
  return n
}

switch args[1] {
case "access":
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  let locked = (session?["CGSSessionScreenIsLocked"] as? NSNumber)?.boolValue ?? false
  emit(["ax": AXIsProcessTrusted(), "locked": locked || session == nil] as [String: Any])
case "windows":
  emit(windows(pid(2)).map(frame))
case "tree":
  emit(windows(pid(2)).map { node($0, 0) })
case "place":
  guard let window = largest(pid(2)) else { die("no window to place") }
  var at = CGPoint(x: 0, y: 40)
  var size = CGSize(width: number(3), height: number(4))
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!)
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
  emit(frame(window))
case "front":
  let target = pid(2)
  NSRunningApplication(processIdentifier: target)?.activate(options: [.activateAllWindows])
  for window in windows(target) { AXUIElementPerformAction(window, kAXRaiseAction as CFString) }
  // The window server's own order, front to back: the first ordinary window on screen is the one in front.
  let onScreen = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  let first = onScreen.first { ($0[kCGWindowLayer as String] as? Int) == 0 }
  let front = (first?[kCGWindowOwnerPID as String] as? pid_t) == target
  let main = largest(target).flatMap { attribute($0, kAXMainAttribute) as? NSNumber }?.boolValue ?? false
  emit(["front": front, "main": main] as [String: Any])
default:
  die("unknown command \(args[1])")
}
