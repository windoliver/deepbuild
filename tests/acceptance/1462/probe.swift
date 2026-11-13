// The #1462 suite's assistive client and keyboard on the real app, from outside its process. Built from #1459's probe
// (identifiers, each text kept apart) and #1454's (`key`, `front`, `place`), with what this issue reads: the menu bar
// and the status item's menu as the Accessibility API gives them, the element that holds the keyboard as VoiceOver and
// Full Keyboard Access follow it, and typed text, all posted to one PID so nothing lands in the app you are using.
//
//   probe access                  {"ax": bool, "screen": bool, "locked": bool}
//   probe windows <pid>           the process's windows the Accessibility API lists: [{"id", "frame": [x, y, w, h]}]
//   probe tree <pid>              [{"frame", "tree"}], one per window; a node is {"role", "title", "description",
//                                 "value", "identifier", "frame", "children"}, each text null when the client gets none
//   probe place <pid> <w> <h>     moves the process's largest window to the top left and sets its size, in points
//   probe front <pid>             brings the process and its windows forward
//   probe key <pid> <keycode> [cmd] [shift] [alt] [ctrl]   one key, down and up, posted to that process alone
//   probe type <pid> <text>       each character as a key down and up carrying it, posted to that process alone
//   probe focused <pid>           the application's AXFocusedUIElement as a node without children, or null
//   probe menubar <pid>           the app's menu bar: [{"title", "items": [{"title", "char", "mods", "virtual", "glyph",
//                                 "enabled", "items"}]}], read without opening a menu
//   probe openmenu <pid> <title>  opens the menu bar's menu titled <title>: {"found", "frame", "items"}; `cancel` closes it
//   probe status <pid>            the status items the process put in the menu bar: [{"title", "opened", "items"}], each
//                                 item's menu read, opened with the press a screen reader sends if it shows none, then closed;
//                                 found in the process's AXExtrasMenuBar, else at its status-layer windows
//   probe cancel <pid>            closes any menu of the process that is open
//   probe pressid <pid> <id>      the press a screen reader sends, to the first node whose identifier is <id>
//
// Compiled by helpers.ts with swiftc into the run's temp folder. It starts nothing and stops nothing.
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
  let kids = !deep || depth > 40 ? [] : children(element)
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

/// A menu's items: each one's title, its key equivalent as AppKit keeps it, whether it is enabled, and its submenu's.
func items(_ menu: AXUIElement, _ depth: Int) -> [[String: Any]] {
  children(menu).compactMap { item -> [String: Any]? in
    guard string(item, kAXRoleAttribute) == "AXMenuItem" else { return nil }
    let title = string(item, kAXTitleAttribute) ?? ""
    if title.isEmpty { return nil } // a separator
    let sub = depth > 3 ? [] : children(item).filter { string($0, kAXRoleAttribute) == "AXMenu" }.flatMap { items($0, depth + 1) }
    return [
      "title": title,
      "char": text(item, "AXMenuItemCmdChar"),
      "mods": (attribute(item, "AXMenuItemCmdModifiers") as? NSNumber)?.intValue ?? 0,
      "virtual": (attribute(item, "AXMenuItemCmdVirtualKey") as? NSNumber)?.intValue ?? NSNull(),
      "glyph": (attribute(item, "AXMenuItemCmdGlyph") as? NSNumber)?.intValue ?? NSNull(),
      "enabled": (attribute(item, kAXEnabledAttribute) as? Bool) ?? false,
      "items": sub,
    ]
  }
}
func menuOf(_ barItem: AXUIElement) -> AXUIElement? { children(barItem).first { string($0, kAXRoleAttribute) == "AXMenu" } }
func barItems(_ pid: pid_t, _ bar: String) -> [AXUIElement] {
  guard let value = attribute(app(pid), bar), CFGetTypeID(value) == AXUIElementGetTypeID() else { return [] }
  return children(value as! AXUIElement)
}
func post(_ pid: pid_t, _ code: CGKeyCode, _ flags: CGEventFlags, _ unicode: [UniChar]? = nil) {
  let source = CGEventSource(stateID: .privateState)
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { die("no key event") }
    event.flags = flags
    if let unicode = unicode { event.keyboardSetUnicodeString(stringLength: unicode.count, unicodeString: unicode) }
    event.postToPid(pid)
    usleep(25_000)
  }
}
func cancelMenus(_ pid: pid_t) {
  for bar in [kAXMenuBarAttribute as String, "AXExtrasMenuBar"] {
    for item in barItems(pid, bar) {
      if let menu = menuOf(item), (attribute(menu, kAXVisibleChildrenAttribute) as? [AXUIElement])?.isEmpty == false || frame(menu)[3] > 0 {
        AXUIElementPerformAction(menu, kAXCancelAction as CFString)
      }
    }
  }
  post(pid, 53, [])
}

// Each character's key on a US keyboard, so the event carries a real key as well as the character.
let KEYS: [Character: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
  "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27,
  "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
  "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, " ": 49, "`": 50,
]

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <access|windows|tree|place|front|key|type|focused|menubar|openmenu|status|cancel|pressid> ...") }
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
case "windows":
  let own = windows(pid(2)).map(frame)
  emit(windowList(pid(2)).filter { w in
    let f = w["frame"] as! [Double]
    return own.contains { a in zip(a, f).allSatisfy { abs($0 - $1) < 2 } }
  })
case "tree":
  emit(windows(pid(2)).map { ["frame": frame($0), "tree": node($0, 0)] as [String: Any] })
case "place":
  let largest = windows(pid(2)).max { a, b in
    let (x, y) = (frame(a), frame(b))
    return x[2] * x[3] < y[2] * y[3]
  }
  guard let window = largest else { die("no window to place") }
  var at = CGPoint(x: 0, y: 40)
  var size = CGSize(width: number(3), height: number(4))
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!)
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
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
  post(pid(2), CGKeyCode(number(3)), flags)
  emit(true)
case "type":
  guard args.count > 3 else { die("type takes a pid and text") }
  for character in args[3] {
    let lower = Character(character.lowercased())
    let shifted = character.isUppercase
    post(pid(2), KEYS[lower] ?? 0, shifted ? .maskShift : [], Array(String(character).utf16))
  }
  emit(true)
case "focused":
  if let value = attribute(app(pid(2)), kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() {
    emit(node(value as! AXUIElement, 0, deep: false))
  } else {
    emit(NSNull())
  }
case "menubar":
  emit(barItems(pid(2), kAXMenuBarAttribute as String).map { item -> [String: Any] in
    ["title": text(item, kAXTitleAttribute), "items": menuOf(item).map { items($0, 0) } ?? []]
  })
case "openmenu":
  guard args.count > 3 else { die("openmenu takes a pid and a menu's title") }
  guard let item = barItems(pid(2), kAXMenuBarAttribute as String).first(where: { string($0, kAXTitleAttribute) == args[3] }) else {
    emit(["found": false]); break
  }
  AXUIElementPerformAction(item, kAXPressAction as CFString)
  usleep(500_000)
  let menu = menuOf(item)
  emit(["found": true, "frame": menu.map(frame) ?? [], "items": menu.map { items($0, 0) } ?? []] as [String: Any])
case "status":
  // The process's status items as its AXExtrasMenuBar lists them; where that list is empty, the element an assistive
  // client finds at the center of each status-layer window the process owns (kCGStatusWindowLevel, 25), if it is the
  // process's own.
  var found = barItems(pid(2), "AXExtrasMenuBar")
  if found.isEmpty {
    let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    for w in info where (w[kCGWindowOwnerPID as String] as? pid_t) == pid(2) && (w[kCGWindowLayer as String] as? Int) == 25 {
      guard let b = w[kCGWindowBounds as String] as? [String: Double], let x = b["X"], let y = b["Y"], let wd = b["Width"], let h = b["Height"] else { continue }
      var element: AXUIElement?
      var owner: pid_t = 0
      if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(x + wd / 2), Float(y + h / 2), &element) == .success,
        let e = element, AXUIElementGetPid(e, &owner) == .success, owner == pid(2) { found.append(e) }
    }
  }
  emit(found.map { item -> [String: Any] in
    let named = string(item, kAXTitleAttribute) ?? string(item, kAXDescriptionAttribute) ?? string(item, kAXValueAttribute)
    let title: Any = named.map { $0 as Any } ?? NSNull()
    var menu = menuOf(item)
    var opened = false
    if menu == nil || items(menu!, 0).isEmpty {
      AXUIElementPerformAction(item, kAXPressAction as CFString)
      usleep(500_000)
      menu = menuOf(item)
      opened = true
    }
    let read = menu.map { items($0, 0) } ?? []
    if opened { cancelMenus(pid(2)) }
    return ["title": title, "opened": opened, "items": read]
  })
case "cancel":
  cancelMenus(pid(2))
  emit(true)
case "pressid":
  guard args.count > 3 else { die("pressid takes a pid and an identifier") }
  func find(_ element: AXUIElement, _ depth: Int) -> AXUIElement? {
    if string(element, kAXIdentifierAttribute) == args[3] { return element }
    if depth > 40 { return nil }
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
default:
  die("unknown command \(args[1])")
}
