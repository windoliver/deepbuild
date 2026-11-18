// The #1808 suite's assistive client, keyboard and pointer on the real app, from outside its process. Built from #1462's
// probe (identifiers, keys posted to one PID) and #1454's (`place`, `front`), with what this issue reads: the window's
// frame placed and read back, the displays, a key pressed many times, and a pointer drag and a wheel posted to the app's
// PID at a point of its window, so nothing lands in the app you are using.
//
//   probe access                       {"ax": bool, "screen": bool, "locked": bool}
//   probe screens                      each display's frame in points, top-left origin: [[x, y, w, h]]
//   probe windows <pid>                the process's windows: [{"id", "frame": [x, y, w, h]}]
//   probe tree <pid>                   [{"frame", "tree"}], one per window; a node is {"role", "title", "description",
//                                      "value", "identifier", "frame", "children"}, each text null when the client gets none
//   probe frame <pid> <x> <y> <w> <h>  moves the process's largest window to x, y and sets its size, in points; its frame
//   probe front <pid>                  brings the process and its windows forward
//   probe key <pid> <keycode> [count] [cmd] [shift] [alt] [ctrl]   one key, down and up, count times (1 when left out),
//                                      posted to that process alone
//   probe focused <pid>                the application's AXFocusedUIElement as a node without children, or null
//   probe pressid <pid> <id>           the press a screen reader sends, to the first node whose identifier is <id>
//   probe drag <pid> <x0> <y0> <x1> <y1>   the left button down at x0, y0, moved in steps to x1, y1 and let go there,
//                                      in screen points, posted to that process alone with its window under the pointer
//   probe scroll <pid> <x> <y> <dy>    a wheel of dy points at x, y (positive scrolls toward the end), posted the same way
//
// Compiled by helpers.ts with swiftc into the run's own folder. It starts nothing and stops nothing.
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
func string(_ element: AXUIElement, _ name: String) -> String? { text(element, name) as? String }
func frame(_ element: AXUIElement) -> [Double] {
  var point = CGPoint.zero
  var size = CGSize.zero
  if let v = attribute(element, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &point) }
  if let v = attribute(element, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &size) }
  return [point.x, point.y, size.width, size.height].map(Double.init)
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func node(_ element: AXUIElement, _ depth: Int, deep: Bool = true) -> [String: Any] {
  let kids = !deep || depth > 60 ? [] : children(element)
  return [
    "role": text(element, kAXRoleAttribute),
    "title": text(element, kAXTitleAttribute),
    "description": text(element, kAXDescriptionAttribute),
    "value": text(element, kAXValueAttribute),
    "identifier": text(element, kAXIdentifierAttribute),
    "frame": frame(element),
    "children": kids.map { node($0, depth + 1) },
  ]
}
func app(_ pid: pid_t) -> AXUIElement {
  let element = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(element, 5)
  return element
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(app(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }
func windowList(_ pid: pid_t) -> [[String: Any]] {
  let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return info.compactMap { w in
    guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
      let b = w[kCGWindowBounds as String] as? [String: Double], b["Width"] != nil else { return nil }
    return ["id": w[kCGWindowNumber as String] as? Int ?? 0, "frame": [b["X"] ?? 0, b["Y"] ?? 0, b["Width"] ?? 0, b["Height"] ?? 0]]
  }
}
func largest(_ pid: pid_t) -> AXUIElement? {
  windows(pid).max { a, b in
    let (x, y) = (frame(a), frame(b))
    return x[2] * x[3] < y[2] * y[3]
  }
}
/// The window server's number of the process's window at a point, for the pointer events posted to it.
func windowAt(_ pid: pid_t, _ p: CGPoint) -> Int {
  for w in windowList(pid) {
    let f = w["frame"] as! [Double]
    if p.x >= f[0] && p.y >= f[1] && p.x < f[0] + f[2] && p.y < f[1] + f[3] { return w["id"] as! Int }
  }
  return 0
}
func post(_ pid: pid_t, _ code: CGKeyCode, _ flags: CGEventFlags) {
  let source = CGEventSource(stateID: .privateState)
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { die("no key event") }
    event.flags = flags
    event.postToPid(pid)
    usleep(20_000)
  }
}
func pointer(_ pid: pid_t, _ type: CGEventType, _ p: CGPoint, _ window: Int) {
  guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .privateState), mouseType: type, mouseCursorPosition: p, mouseButton: .left) else { die("no pointer event") }
  event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
  event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
  if type == .leftMouseDown || type == .leftMouseUp { event.setIntegerValueField(.mouseEventClickState, value: 1) }
  event.postToPid(pid)
  usleep(16_000)
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <access|screens|windows|tree|frame|front|key|focused|pressid|drag|scroll> ...") }
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
  let locked = (session?["CGSSessionScreenIsLocked"] as? Bool) ?? false
  emit(["ax": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess(), "locked": locked] as [String: Any])
case "screens":
  var count: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &count)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  CGGetActiveDisplayList(count, &ids, &count)
  emit(ids.map { id -> [Double] in
    let b = CGDisplayBounds(id)
    return [b.origin.x, b.origin.y, b.size.width, b.size.height].map(Double.init)
  })
case "windows":
  let own = windows(pid(2)).map(frame)
  emit(windowList(pid(2)).filter { w in
    let f = w["frame"] as! [Double]
    return own.contains { a in zip(a, f).allSatisfy { abs($0 - $1) < 2 } }
  })
case "tree":
  emit(windows(pid(2)).map { ["frame": frame($0), "tree": node($0, 0)] as [String: Any] })
case "frame":
  guard let window = largest(pid(2)) else { die("no window to place") }
  var at = CGPoint(x: number(3), y: number(4))
  var size = CGSize(width: number(5), height: number(6))
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!)
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!)
  emit(frame(window))
case "front":
  NSRunningApplication(processIdentifier: pid(2))?.activate(options: [.activateAllWindows])
  for window in windows(pid(2)) { AXUIElementPerformAction(window, kAXRaiseAction as CFString) }
  emit(true)
case "key":
  var flags: CGEventFlags = []
  if args.contains("cmd") { flags.insert(.maskCommand) }
  if args.contains("shift") { flags.insert(.maskShift) }
  if args.contains("alt") { flags.insert(.maskAlternate) }
  if args.contains("ctrl") { flags.insert(.maskControl) }
  let times = args.count > 4 ? Int(args[4]) ?? 1 : 1
  for _ in 0..<max(1, times) { post(pid(2), CGKeyCode(number(3)), flags) }
  emit(true)
case "focused":
  if let value = attribute(app(pid(2)), kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() {
    emit(node(value as! AXUIElement, 0, deep: false))
  } else {
    emit(NSNull())
  }
case "pressid":
  guard args.count > 3 else { die("pressid takes a pid and an identifier") }
  func find(_ element: AXUIElement, _ depth: Int) -> AXUIElement? {
    if string(element, kAXIdentifierAttribute) == args[3] { return element }
    if depth > 60 { return nil }
    for child in children(element) { if let found = find(child, depth + 1) { return found } }
    return nil
  }
  var pressed: [String: Any] = ["found": false]
  for window in windows(pid(2)) {
    guard let target = find(window, 0) else { continue }
    let result = AXUIElementPerformAction(target, kAXPressAction as CFString)
    pressed = ["found": true, "pressed": result == .success, "code": result.rawValue]
    break
  }
  emit(pressed)
case "drag":
  let (from, to) = (CGPoint(x: number(3), y: number(4)), CGPoint(x: number(5), y: number(6)))
  let window = windowAt(pid(2), from)
  pointer(pid(2), .mouseMoved, from, window)
  pointer(pid(2), .leftMouseDown, from, window)
  let steps = 12
  for i in 1...steps {
    let t = CGFloat(i) / CGFloat(steps)
    pointer(pid(2), .leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), window)
  }
  pointer(pid(2), .leftMouseUp, to, window)
  emit(["window": window])
case "scroll":
  let at = CGPoint(x: number(3), y: number(4))
  let window = windowAt(pid(2), at)
  // Ten wheel events of a tenth each, as a trackpad's deltas come; a positive dy moves toward the end, so the wheel is
  // turned the other way.
  let steps = 10
  let each = Int32((-number(5) / Double(steps)).rounded())
  for _ in 0..<steps {
    guard let event = CGEvent(scrollWheelEvent2Source: CGEventSource(stateID: .privateState), units: .pixel, wheelCount: 1, wheel1: each, wheel2: 0, wheel3: 0) else { die("no wheel event") }
    event.location = at
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
    event.postToPid(pid(2))
    usleep(16_000)
  }
  emit(["window": window])
default:
  die("unknown command \(args[1])")
}
