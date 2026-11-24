// The #1843 suite's assistive client, window mover and pointer on the real app, from outside its process. Built from
// #1808's probe (the tree by identifiers, the window's frame set through the Accessibility API, pointer events posted to
// one process), with what this issue reads: the question card's value and its options' frames, a resize with a press
// right behind it, another app brought forward, and the one click that is macOS's own.
//
//   probe gates                        {"ax", "locked", "asleep", "idle": seconds since the HID system saw an event}
//   probe screen                       the main display's frame in points, top-left origin: [x, y, w, h]
//   probe forward                      the pid of the app macOS has forward, 0 when none
//   probe front <pid> [keep]           brings the process forward, and its window to the front unless `keep`: {"front":
//                                      bool}, once it is forward or 5 s on
//   probe place <pid> <x> <y> <w> <h>  moves the process's window and sets its size, in points: its frame then
//   probe card <pid> <want> <address> <seconds>   the window's question card once it reads <want> at <address> (`any`
//                                      for either), or <seconds> later: {"value", "address", "window", "options":
//                                      [{"id", "frame"}], "front"}; frames are the screen's, in points. <want> `still` is
//                                      a card whose options lie where they lay a moment before
//   probe click <pid> <x> <y>          a click at a point of the process's window, posted to that process alone:
//                                      {"clicked": bool}, false when it has no window there
//   probe resized <pid> <w> <h> <x> <y> <ms...>   sets the window's size, clicks at x, y at once, then clicks an option
//                                      that still lies in the window <ms> after the resize for each <ms>, reading the
//                                      card all along: {"window", "reads": [{"ms", "value"}], "clicks": [{"ms", "option",
//                                      "at"}]}
//   probe behind <x> <y>               a small window of its own at x, y, until its stdin closes; prints {"ready": pid}
//   probe raise <pid> <x> <y> <identifier> <seconds>   the one step that takes the real cursor: the window server's own
//                                      click at x, y (the HID event tap), which must land on <identifier> in that
//                                      process's window. It waits up to <seconds> for the Mac to be out of use and
//                                      refuses, pressing nothing: {"refused": why}. Else {"pressed", "took_ms", "front",
//                                      "was", "cursor_back"}
//
// Behind a lock every window's elements answer as their application, so every command that reads or presses says
// {"refused"} when the screen is locked or the display asleep, before it reads and again after. Compiled by helpers.ts with
// swiftc. It starts no process and stops none.
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
func refuse(_ why: String) -> Never {
  emit(["refused": why])
  exit(0)
}

// ---- What the session lets anyone read.

func unreadable() -> String? {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  if session["CGSSessionScreenIsLocked"] as? Bool ?? false { return "the screen is locked" }
  if !(session["kCGSSessionOnConsoleKey"] as? Bool ?? false) { return "no login session is on the console" }
  if CGDisplayIsAsleep(CGMainDisplayID()) != 0 { return "the display is asleep" }
  return nil
}
func readable() { if let why = unreadable() { refuse(why) } }
func idle() -> Double { CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: CGEventType(rawValue: ~0)!) }
/// How long the HID system must have seen nothing before the cursor is taken.
let OUT_OF_USE = 30.0

// ---- The process's window and its tree.

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func string(_ element: AXUIElement, _ name: String) -> String? {
  guard let s = attribute(element, name) as? String, !s.isEmpty else { return nil }
  return s
}
func frame(_ element: AXUIElement) -> [Double] {
  var point = CGPoint.zero
  var size = CGSize.zero
  if let v = attribute(element, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &point) }
  if let v = attribute(element, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &size) }
  return [point.x, point.y, size.width, size.height].map(Double.init)
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func application(_ pid: pid_t) -> AXUIElement {
  let element = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(element, 5)
  return element
}
func frontmost(_ pid: pid_t) -> Bool { attribute(application(pid), kAXFrontmostAttribute) as? Bool ?? false }
/// The process's largest window. A window's role is AXWindow; behind a lock it would read as its application's.
func window(_ pid: pid_t) -> AXUIElement? {
  (attribute(application(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [])
    .filter { string($0, kAXRoleAttribute) == kAXWindowRole }
    .max { a, b in
      let (x, y) = (frame(a), frame(b))
      return x[2] * x[3] < y[2] * y[3]
    }
}
func set(_ window: AXUIElement, at point: CGPoint? = nil, size: CGSize? = nil) {
  if var at = point { AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!) }
  if var wh = size { AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &wh)!) }
}

/// The window's page, its card and the card's options, from one walk of its tree.
struct Read {
  var card: AXUIElement?
  var address: String?
  var options: [(id: String, element: AXUIElement)] = []
}
func walk(_ element: AXUIElement, _ depth: Int, _ into: inout Read) {
  if let id = string(element, kAXIdentifierAttribute) {
    if id == "question-card" { into.card = element }
    if id.hasPrefix("card-option:") { into.options.append((id, element)) }
    if id.range(of: "^(ask|session|project|page)/\\S+$", options: .regularExpression) != nil { into.address = id }
  }
  if depth > 60 { return }
  for child in children(element) { walk(child, depth + 1, &into) }
}
func read(_ pid: pid_t) -> Read {
  var out = Read()
  if let window = window(pid) { walk(window, 0, &out) }
  return out
}
func value(_ read: Read) -> String? { read.card.flatMap { string($0, kAXValueAttribute) } }
func described(_ pid: pid_t, _ read: Read) -> [String: Any] {
  [
    "value": value(read) as Any? ?? NSNull(), "address": read.address as Any? ?? NSNull(), "window": window(pid).map(frame) ?? [],
    "options": read.options.map { ["id": $0.id, "frame": frame($0.element)] as [String: Any] }, "front": frontmost(pid),
  ]
}
/// Whether `inner` lies wholly in `outer`, to the half point a layout rounds by.
func inside(_ inner: [Double], _ outer: [Double]) -> Bool {
  inner[2] > 0 && inner[3] > 0 && inner[0] >= outer[0] - 0.5 && inner[1] >= outer[1] - 0.5
    && inner[0] + inner[2] <= outer[0] + outer[2] + 0.5 && inner[1] + inner[3] <= outer[1] + outer[3] + 0.5
}
func center(_ f: [Double]) -> CGPoint { CGPoint(x: f[0] + f[2] / 2, y: f[1] + f[3] / 2) }

// ---- The pointer.

struct Listed {
  let pid: pid_t
  let number: Int
  let layer: Int
  let rect: CGRect
}
/// What the window server lists at `p`, front to back. A window above the ordinary level that covers the whole display, as
/// the menu bar's and the cursor's own do, is left out: macOS draws through it, and who gets a click there is asked apart.
func stack(_ p: CGPoint) -> [Listed] {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  let display = CGDisplayBounds(CGMainDisplayID())
  return list.compactMap { w in
    guard let bounds = w[kCGWindowBounds as String] as? NSDictionary, let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(p) else { return nil }
    if (w[kCGWindowAlpha as String] as? Double ?? 1) <= 0 { return nil }
    let layer = w[kCGWindowLayer as String] as? Int ?? 0
    if layer > 0 && rect.contains(display) { return nil }
    return Listed(pid: w[kCGWindowOwnerPID as String] as? pid_t ?? 0, number: w[kCGWindowNumber as String] as? Int ?? 0, layer: layer, rect: rect)
  }
}
/// Now, as an event's own timestamp counts: the host's uptime, which AppKit hands the app as the event's.
func uptime() -> CGEventTimestamp { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
/// The window server writes two things on a mouse event it routes that a posted one lacks, and AppKit hands a window no
/// event without both: the window's number (event field 51) and the point in it. Nothing public sets the second.
typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
let setWindowLocation = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGEventSetWindowLocation").map { unsafeBitCast($0, to: SetWindowLocation.self) }
let WINDOW_NUMBER = CGEventField(rawValue: 51)!
/// A left-button event at a point of the process's window, posted to that process alone.
func post(_ pid: pid_t, _ type: CGEventType, _ p: CGPoint, _ window: Listed) {
  guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .privateState), mouseType: type, mouseCursorPosition: p, mouseButton: .left) else { die("no pointer event") }
  for field in [CGEventField.mouseEventWindowUnderMousePointer, .mouseEventWindowUnderMousePointerThatCanHandleThisEvent, WINDOW_NUMBER] { event.setIntegerValueField(field, value: Int64(window.number)) }
  setWindowLocation!(event, CGPoint(x: p.x - window.rect.minX, y: p.y - window.rect.minY))
  if type != .mouseMoved { event.setIntegerValueField(.mouseEventClickState, value: 1) }
  event.timestamp = uptime()
  event.postToPid(pid)
}
/// One click, or false when the process has no window at the point.
func click(_ pid: pid_t, _ p: CGPoint) -> Bool {
  if setWindowLocation == nil { refuse("this macOS lets no process post a click to a window") }
  guard let window = stack(p).first(where: { $0.pid == pid && $0.layer == 0 }) else { return false }
  post(pid, .mouseMoved, p, window)
  usleep(8_000)
  post(pid, .leftMouseDown, p, window)
  usleep(40_000)
  post(pid, .leftMouseUp, p, window)
  return true
}
/// A left-button event at a point of the screen, as the window server takes one from a mouse.
func system(_ type: CGEventType, _ p: CGPoint) {
  guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .privateState), mouseType: type, mouseCursorPosition: p, mouseButton: .left) else { die("no pointer event") }
  if type != .mouseMoved { event.setIntegerValueField(.mouseEventClickState, value: 1) }
  event.timestamp = uptime()
  event.post(tap: .cghidEventTap)
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <gates|screen|forward|front|place|card|click|resized|behind|raise> ...") }
func pid(_ at: Int) -> pid_t {
  guard args.count > at, let p = pid_t(args[at]) else { die("\(args[1]) takes a pid") }
  return p
}
func numeral(_ at: Int) -> Double {
  guard args.count > at, let n = Double(args[at]) else { die("\(args[1]) takes numbers") }
  return n
}
func text(_ at: Int) -> String {
  guard args.count > at else { die("\(args[1]) takes a word") }
  return args[at]
}
func until(_ seconds: Double, _ done: () -> Bool) -> Bool {
  let end = Date().addingTimeInterval(seconds)
  while true {
    if done() { return true }
    if Date() > end { return false }
    usleep(40_000)
  }
}
switch args[1] {
case "gates":
  emit(["ax": AXIsProcessTrusted(), "unreadable": unreadable() as Any? ?? NSNull(), "idle": idle()] as [String: Any])
case "screen":
  let b = CGDisplayBounds(CGMainDisplayID())
  emit([b.origin.x, b.origin.y, b.size.width, b.size.height].map(Double.init))
case "forward":
  readable()
  var pid: pid_t = 0
  if let value = attribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() { AXUIElementGetPid(value as! AXUIElement, &pid) }
  if pid == 0 { pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0 }
  emit(Int(pid))
case "front":
  readable()
  let keep = args.contains("keep")
  if !keep, let w = window(pid(2)) { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
  let ok = until(5) {
    if frontmost(pid(2)) { return true }
    NSRunningApplication(processIdentifier: pid(2))?.activate(options: keep ? [] : [.activateAllWindows])
    AXUIElementSetAttributeValue(application(pid(2)), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    if !keep, let w = window(pid(2)) { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
    usleep(120_000)
    return frontmost(pid(2))
  }
  readable()
  emit(["front": ok])
case "place":
  readable()
  let (at, size) = (CGPoint(x: numeral(3), y: numeral(4)), CGSize(width: numeral(5), height: numeral(6)))
  _ = until(10) {
    guard let w = window(pid(2)) else { return false }
    set(w, at: at, size: size)
    set(w, at: at)
    usleep(60_000)
    let f = frame(w)
    return abs(f[0] - at.x) < 1 && abs(f[1] - at.y) < 1 && abs(f[2] - size.width) < 1 && abs(f[3] - size.height) < 1
  }
  readable()
  emit(window(pid(2)).map(frame) ?? [])
case "card":
  readable()
  var seen = Read()
  var lay: [[Double]] = []
  var nudged = Date()
  _ = until(numeral(5)) {
    if unreadable() != nil { return true }
    seen = read(pid(2))
    // A window builds its tree on a frame drawn after a client asks, and a still one may draw none: a point wider and back.
    if seen.card == nil, seen.address == nil, Date().timeIntervalSince(nudged) > 4, let w = window(pid(2)) {
      let f = frame(w)
      set(w, size: CGSize(width: f[2] + 1, height: f[3]))
      set(w, size: CGSize(width: f[2], height: f[3]))
      nudged = Date()
    }
    let (was, wanted) = (lay, text(3))
    lay = seen.options.map { frame($0.element) }
    if wanted == "still" { usleep(250_000) }
    let right = wanted == "any" || (wanted == "still" ? !lay.isEmpty && lay == was : value(seen) == wanted)
    return seen.card != nil && right && (text(4) == "any" || seen.address == text(4))
  }
  readable()
  emit(described(pid(2), seen))
case "click":
  readable()
  let pressed = click(pid(2), CGPoint(x: numeral(3), y: numeral(4)))
  readable()
  emit(["clicked": pressed])
case "resized":
  readable()
  guard let w = window(pid(2)) else { die("no window to resize") }
  guard var card = read(pid(2)).card else { die("no card in the window") }
  let size = CGSize(width: numeral(3), height: numeral(4))
  var marks = args[7...].compactMap(Double.init)
  var reads: [[String: Any]] = []
  var clicks: [[String: Any]] = []
  set(w, size: size)
  let start = Date()
  func ms() -> Double { Date().timeIntervalSince(start) * 1000 }
  let first = CGPoint(x: numeral(5), y: numeral(6))
  let at = ms()
  if click(pid(2), first) { clicks.append(["ms": at, "option": "where one lay", "at": [first.x, first.y]]) }
  let last = (marks.max() ?? 0) + 700
  while ms() < last {
    if string(card, kAXValueAttribute) == nil, let again = read(pid(2)).card { card = again }
    reads.append(["ms": ms(), "value": string(card, kAXValueAttribute) as Any? ?? NSNull()])
    if let mark = marks.first, ms() >= mark {
      marks.removeFirst()
      let shown = frame(w)
      // The option lying wholly in the window nearest its middle, so no edge takes the press.
      let here = read(pid(2)).options.map { (id: $0.id, f: frame($0.element)) }.filter { inside($0.f, shown) }
      let middle = shown[1] + shown[3] / 2
      if let option = here.min(by: { abs($0.f[1] + $0.f[3] / 2 - middle) < abs($1.f[1] + $1.f[3] / 2 - middle) }) {
        let (p, at) = (center(option.f), ms())
        if click(pid(2), p) { clicks.append(["ms": at, "option": option.id, "at": [p.x, p.y]]) }
      }
    }
    usleep(30_000)
  }
  let shown = frame(w)
  readable()
  emit(["window": shown, "reads": reads, "clicks": clicks] as [String: Any])
case "behind":
  readable()
  let app = NSApplication.shared
  app.setActivationPolicy(.regular)
  let top = NSScreen.screens.first?.frame.height ?? 0
  let own = NSWindow(contentRect: NSRect(x: numeral(2), y: top - numeral(3) - 80, width: 200, height: 80), styleMask: [.titled], backing: .buffered, defer: false)
  own.title = "behind"
  own.isReleasedWhenClosed = false
  // The test holds this process's stdin open; when it closes, the test has ended or died.
  Thread.detachNewThread {
    while !FileHandle.standardInput.availableData.isEmpty {}
    exit(0)
  }
  DispatchQueue.main.async {
    own.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    emit(["ready": Int(ProcessInfo.processInfo.processIdentifier)])
  }
  app.run()
case "raise":
  let p = CGPoint(x: numeral(3), y: numeral(4))
  readable()
  if !until(numeral(6), { idle() >= OUT_OF_USE || unreadable() != nil }) { refuse("the Mac is in use: the HID system saw an event \(Int(idle())) s ago") }
  readable()
  if frontmost(pid(2)) { refuse("the app is already forward, so no click could bring it forward") }
  guard let w = window(pid(2)), inside([Double(p.x) - 1, Double(p.y) - 1, 2, 2], frame(w)) else { refuse("the point isn't in the app's window") }
  guard let top = stack(p).first, top.pid == pid(2), top.layer == 0 else { refuse("another window is in front of the app's at the point") }
  var hit: AXUIElement?
  var owner: pid_t = 0
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(p.x), Float(p.y), &hit) == .success, let target = hit, AXUIElementGetPid(target, &owner) == .success, owner == pid(2) else {
    refuse("a click at the point wouldn't reach the app")
  }
  guard let option = read(pid(2)).options.first(where: { $0.id == text(5) }), inside([Double(p.x) - 1, Double(p.y) - 1, 2, 2], frame(option.element)) else {
    refuse("\(text(5)) isn't at the point")
  }
  let was = value(read(pid(2)))
  // Nobody moved the mouse or typed while this looked.
  if idle() < OUT_OF_USE { refuse("the Mac is in use: the HID system saw an event \(Int(idle())) s ago") }
  readable()
  let back = CGEvent(source: nil)?.location ?? p
  let taken = Date()
  system(.mouseMoved, p)
  usleep(40_000)
  // The window server's own answer, with the cursor there: still this window, or nothing is pressed.
  let still = stack(p).first.map { $0.pid == pid(2) && $0.layer == 0 } ?? false
  if still {
    system(.leftMouseDown, p)
    usleep(70_000)
    system(.leftMouseUp, p)
    usleep(20_000)
  }
  CGWarpMouseCursorPosition(back)
  CGAssociateMouseAndMouseCursorPosition(1)
  let took = Date().timeIntervalSince(taken) * 1000
  usleep(30_000)
  let now = CGEvent(source: nil)?.location ?? p
  if !still { refuse("another window came in front of the app's at the point") }
  let front = until(3) { frontmost(pid(2)) }
  readable()
  emit([
    "pressed": text(5), "took_ms": took, "front": front, "was": was as Any? ?? NSNull(),
    "cursor_back": abs(now.x - back.x) < 2 && abs(now.y - back.y) < 2,
  ] as [String: Any])
default:
  die("unknown command \(args[1])")
}
