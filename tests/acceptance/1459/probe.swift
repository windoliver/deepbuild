// The #1459 suite's assistive client: the real app read from outside its process, as VoiceOver and other assistive
// clients read it. Cut down from #1454's probe (tests/acceptance/1454/probe.swift), with each node's
// `accessibilityIdentifier` (AXIdentifier) and its title, description and value kept apart, since a screen reader speaks
// them in turn and an agent keys on the identifier.
//
//   probe access                  {"ax": bool, "screen": bool}
//   probe windows <pid>           the process's windows the Accessibility API lists: [{"id", "frame": [x, y, w, h]}]
//   probe tree <pid>              [{"frame", "tree"}], one per window; a node is {"role", "title", "description",
//                                 "value", "identifier", "frame", "children"}, each text null when the client gets none
//   probe place <pid> <w> <h>     moves the process's largest window to the top left and sets its size, in points
//   probe front <pid>             brings the process and its windows forward
//   probe ocr <png>               [{"text", "box": [x, y, w, h]}] in the picture's pixels, top left origin
//
// Compiled by helpers.ts with swiftc into the run's temp folder. It starts nothing, stops nothing and presses nothing.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
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
    "title": text(element, kAXTitleAttribute),
    "description": text(element, kAXDescriptionAttribute),
    "value": text(element, kAXValueAttribute),
    "identifier": text(element, kAXIdentifierAttribute),
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

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: probe <access|windows|tree|place|front|ocr> ...") }
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
  emit(["ax": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()] as [String: Any])
case "windows":
  // The window server's ids for the windows the Accessibility API lists: GPUI keeps a hidden helper window too.
  let own = windows(pid(2)).map(frame)
  let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  emit(info.compactMap { w -> [String: Any]? in
    guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid(2), (w[kCGWindowLayer as String] as? Int) == 0,
      let b = w[kCGWindowBounds as String] as? [String: Double] else { return nil }
    let f = [b["X"] ?? 0, b["Y"] ?? 0, b["Width"] ?? 0, b["Height"] ?? 0]
    guard own.contains(where: { a in zip(a, f).allSatisfy { abs($0 - $1) < 2 } }) else { return nil }
    return ["id": w[kCGWindowNumber as String] as? Int ?? 0, "frame": f]
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
default:
  die("unknown command \(args[1])")
}
