// The #2569 suite's cover: it puts an opaque window over another process's window, as a person's own window does when
// the Mac is in use, so macOS stops giving the covered window frames. It reads no pixels, posts no input and needs no
// permission: the window list gives a window's owner and bounds to any process.
//
//   cover <pid> <after_s> <hold_s>
//
// Prints one JSON line when the process's window is first on screen, {"window": [x, y, w, h]} in global display points
// from the top left, or {"window": null} and exit 3 when none shows in 60 s. <after_s> seconds later it covers that
// window, 40 pt past each edge, with a black borderless window above every other, and prints {"covered": true,
// "frame": [x, y, w, h]}; or {"covered": false, "reason": "..."} and exit 4 when the window left the screen first.
// It takes its cover away and exits 0 after <hold_s> seconds, or as soon as its stdin closes, so it never outlives the
// test that started it.
//
// Compiled by deadline.test.ts with swiftc into the run's temp folder.
import AppKit
import CoreGraphics
import Foundation

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

/// The process's largest window on screen at the normal window layer, in global display points from the top left.
func windowOf(_ pid: Int32) -> CGRect? {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
  var best: CGRect? = nil
  for entry in list {
    guard (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
          (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
          let bounds = entry[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
          rect.width >= 200, rect.height >= 200 else { continue }
    if best == nil || rect.width * rect.height > best!.width * best!.height { best = rect }
  }
  return best
}

let args = CommandLine.arguments
guard args.count == 4, let pid = Int32(args[1]), let after = Double(args[2]), let hold = Double(args[3]), after >= 0, hold > 0 else {
  FileHandle.standardError.write(Data("usage: cover <pid> <after_s> <hold_s>\n".utf8))
  exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// The test holds this process's stdin open; when it closes, the test has ended or died.
Thread.detachNewThread {
  while !FileHandle.standardInput.availableData.isEmpty {}
  exit(0)
}

let started = Date()
var found: Date? = nil
var cover: NSWindow? = nil
let timer = Timer(timeInterval: 0.1, repeats: true) { _ in
  if cover != nil { return }
  guard let rect = windowOf(pid) else {
    if found != nil {
      emit(["covered": false, "reason": "the window left the screen before it was covered"])
      exit(4)
    }
    if Date().timeIntervalSince(started) > 60 {
      emit(["window": NSNull()])
      exit(3)
    }
    return
  }
  if found == nil {
    found = Date()
    emit(["window": [rect.minX, rect.minY, rect.width, rect.height].map(Double.init)])
  }
  if Date().timeIntervalSince(found!) < after { return }
  // AppKit counts from the bottom of the first screen, the window list from its top.
  let top = NSScreen.screens.first?.frame.height ?? 0
  let grown = rect.insetBy(dx: -40, dy: -40)
  let frame = NSRect(x: grown.minX, y: top - grown.maxY, width: grown.width, height: grown.height)
  let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
  window.isReleasedWhenClosed = false
  window.isOpaque = true
  window.alphaValue = 1
  window.backgroundColor = .black
  window.hasShadow = false
  window.ignoresMouseEvents = true
  window.level = .screenSaver
  window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
  window.setFrame(frame, display: true)
  window.orderFrontRegardless()
  cover = window
  emit(["covered": true, "frame": [grown.minX, grown.minY, grown.width, grown.height].map(Double.init)])
  DispatchQueue.main.asyncAfter(deadline: .now() + hold) { exit(0) }
}
RunLoop.main.add(timer, forMode: .common)
app.run()
