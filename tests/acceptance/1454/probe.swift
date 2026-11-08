// The #1454 suite's eyes and hands on the real app, from outside its process: what a screen reader and a person have.
// Copied from #1172's suite (tests/acceptance/1172/probe.swift), with `key` and `gif` added. It reads a process's windows
// from the window server, its accessibility tree and its menu-bar item through the Accessibility API, reads text off a
// picture with Vision, presses what a screen reader presses, and posts a keyboard chord to that one process, so the suite
// needs no seam in the app to see what a person sees.
//
//   probe access                  {"ax": bool, "screen": bool, "screens": [[w, h, scale], ...]}
//   probe windows <pid>           the process's windows, front first: [{"id", "frame": [x, y, w, h], "layer"}]
//   probe tree <pid>              {"t0", "t1", "windows": [{"frame", "tree"}], "menu": [title, ...], "menuFrames"}; a node is
//                                 {"role", "name", "frame", "children"}; `name` is its title, else description, else value
//   probe place <pid> <w> <h>     moves the process's largest window to the top left and sets its size, in points
//   probe front <pid>             brings the process and its windows forward
//   probe press <pid> <text> [role]  the first node whose name holds <text>, of that AX role if given, takes the press a
//                                 screen reader sends, which GPUI gives any element with a role and an on_click:
//                                 {"found", "pressed", "code", "role"}
//   probe ocr <png>               [{"text", "box": [x, y, w, h]}] in the picture's pixels, top left origin
//   probe key <pid> <keycode> [cmd]  one key, down and up, posted to that process alone, so it can never land in the app
//                                 you are using; a chord reaches the window that process has made key
//   probe gif <out> <ms> <width> <png>...  the frames as an animated GIF, <ms> a frame, scaled to <width> pixels
//
// Compiled by helpers.ts with swiftc into the run's temp folder. Screen points have their origin at the main display's
// top left, as the Accessibility API and CGWindowList give them. It starts nothing and stops nothing. A press, not a
// posted mouse event: GPUI drops a click posted to a process, and a click at the real cursor would land on whatever
// covers the window on a machine others are using.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
func die(_ text: String) -> Never {
  FileHandle.standardError.write(Data("probe: \(text)\n".utf8))
  exit(2)
}
func now() -> Double { Date().timeIntervalSince1970 * 1000 }

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) else { return nil }
  if let s = value as? String { return s.isEmpty ? nil : s }
  if let n = value as? NSNumber { return n.stringValue }
  return nil
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
    "role": text(element, kAXRoleAttribute) ?? "",
    "name": text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute) ?? text(element, kAXValueAttribute) ?? "",
    "frame": frame(element),
    "children": children.map { node($0, depth + 1) },
  ]
}
func app(_ pid: pid_t) -> AXUIElement {
  let element = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(element, 5)
  return element
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(app(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }

func windowList(_ pid: pid_t) -> [[String: Any]] {
  // Every window, not only those on screen: a person changing Space mustn't make the app's window leave the list.
  let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return info.compactMap { w in
    guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
      let b = w[kCGWindowBounds as String] as? [String: Double], b["Width"] != nil else { return nil }
    return ["id": w[kCGWindowNumber as String] as? Int ?? 0, "frame": [b["X"] ?? 0, b["Y"] ?? 0, b["Width"] ?? 0, b["Height"] ?? 0], "layer": 0]
  }
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <access|windows|tree|place|front|press|ocr|key|gif> ...") }
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
  emit(["ax": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess(),
    "screens": NSScreen.screens.map { [$0.frame.width, $0.frame.height, $0.backingScaleFactor] }] as [String: Any])
case "windows":
  // The app's own windows, as a person's tools list them: GPUI keeps a hidden helper window that the server lists too.
  let own = windows(pid(2)).map(frame)
  emit(windowList(pid(2)).filter { w in
    let f = w["frame"] as! [Double]
    return own.contains { a in zip(a, f).allSatisfy { abs($0 - $1) < 2 } }
  })
case "tree":
  let t0 = now()
  let shown = windows(pid(2)).map { ["frame": frame($0), "tree": node($0, 0)] as [String: Any] }
  var titles: [String] = []
  var frames: [[Double]] = []
  if let bar = attribute(app(pid(2)), "AXExtrasMenuBar"), CFGetTypeID(bar) == AXUIElementGetTypeID() {
    for item in attribute(bar as! AXUIElement, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
      titles.append(text(item, kAXTitleAttribute) ?? text(item, kAXValueAttribute) ?? text(item, kAXDescriptionAttribute) ?? "")
      frames.append(frame(item))
    }
  }
  emit(["t0": t0, "t1": now(), "windows": shown, "menu": titles, "menuFrames": frames] as [String: Any])
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
case "press":
  guard args.count > 3 else { die("press takes a pid and the text of a node's name") }
  let wanted = args.count > 4 ? args[4] : nil
  func find(_ element: AXUIElement, _ depth: Int) -> AXUIElement? {
    if let name = text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute) ?? text(element, kAXValueAttribute), name.contains(args[3]),
      wanted == nil || text(element, kAXRoleAttribute) == wanted { return element }
    if depth > 40 { return nil }
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
      if let found = find(child, depth + 1) { return found }
    }
    return nil
  }
  var pressed: [String: Any] = ["found": false]
  for window in windows(pid(2)) {
    guard let target = find(window, 0) else { continue }
    let result = AXUIElementPerformAction(target, kAXPressAction as CFString)
    pressed = ["found": true, "pressed": result == .success, "code": result.rawValue, "role": text(target, kAXRoleAttribute) ?? ""]
    break
  }
  emit(pressed)
case "ocr":
  guard args.count > 2, let image = NSImage(contentsOfFile: args[2]), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { die("ocr takes a picture") }
  let (w, h) = (Double(cg.width), Double(cg.height))
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  try! VNImageRequestHandler(cgImage: cg).perform([request])
  emit((request.results ?? []).compactMap { line -> [String: Any]? in
    guard let top = line.topCandidates(1).first else { return nil }
    let b = line.boundingBox
    return ["text": top.string, "box": [b.minX * w, (1 - b.maxY) * h, b.width * w, b.height * h]]
  })
case "key":
  let source = CGEventSource(stateID: .privateState)
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(number(3)), keyDown: down) else { die("no key event") }
    if args.contains("cmd") { event.flags = .maskCommand }
    event.postToPid(pid(2))
    usleep(30_000)
  }
  emit(true)
case "gif":
  guard args.count > 5 else { die("gif takes an output path, ms a frame, a width and frames") }
  let frames = Array(args[5...])
  guard let gif = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.gif.identifier as CFString, frames.count, nil) else { die("no GIF at \(args[2])") }
  CGImageDestinationSetProperties(gif, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
  let delay = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: number(3) / 1000]] as CFDictionary
  let width = Int(number(4))
  var written = 0
  for path in frames {
    guard let image = NSImage(contentsOfFile: path)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let height = image.height * width / image.width
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let scaled = context.makeImage() else { continue }
    CGImageDestinationAddImage(gif, scaled, delay)
    written += 1
  }
  guard CGImageDestinationFinalize(gif) else { die("the GIF wasn't written") }
  emit(["frames": written])
default:
  die("unknown command \(args[1])")
}
