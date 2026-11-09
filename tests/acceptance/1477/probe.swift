// The #1477 suite's screen reader: it reads a process's row nodes through the Accessibility API, from outside that
// process, as VoiceOver does. It starts nothing, stops nothing and posts no input.
//
//   probe access        {"ax": bool}: whether this process may read other processes' accessibility trees
//   probe rows <pid>    {"rows": [{"index": n | null, "frame": [x, y, w, h], "cells": [text, ...]}]}: every node of role
//                       AXRow in the process's windows, its AXIndex, and the text of each child (its value, title or
//                       description, else its first descendant's)
//
// Compiled by built.test.ts with swiftc into the run's temp folder.
import AppKit
import ApplicationServices
import Foundation

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
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
func children(_ element: AXUIElement) -> [AXUIElement] {
  attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}
func frame(_ element: AXUIElement) -> [Double] {
  var point = CGPoint.zero
  var size = CGSize.zero
  if let v = attribute(element, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &point) }
  if let v = attribute(element, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &size) }
  return [point.x, point.y, size.width, size.height].map(Double.init)
}
func cellText(_ element: AXUIElement, _ depth: Int = 0) -> String {
  if let s = text(element, kAXValueAttribute) ?? text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute) { return s }
  if depth > 8 { return "" }
  for child in children(element) {
    let s = cellText(child, depth + 1)
    if !s.isEmpty { return s }
  }
  return ""
}
func rows(_ element: AXUIElement, _ depth: Int, _ out: inout [[String: Any]]) {
  if text(element, kAXRoleAttribute) == kAXRowRole {
    let index = (attribute(element, "AXIndex") as? NSNumber).map { $0.intValue as Any } ?? NSNull()
    out.append(["index": index, "frame": frame(element), "cells": children(element).map { cellText($0) }])
    return
  }
  if depth > 60 { return }
  for child in children(element) { rows(child, depth + 1, &out) }
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "access":
  emit(["ax": AXIsProcessTrusted()])
case "rows" where args.count == 3:
  guard let pid = Int32(args[2]) else { exit(2) }
  let app = AXUIElementCreateApplication(pid)
  var out: [[String: Any]] = []
  for window in attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] { rows(window, 0, &out) }
  emit(["rows": out])
default:
  FileHandle.standardError.write(Data("usage: probe access | probe rows <pid>\n".utf8))
  exit(2)
}
