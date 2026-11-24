// The assistive client of this suite (README: The client): a window read and heard from outside its process, as
// VoiceOver reads and hears it. It presses nothing, types nothing, raises nothing, starts and stops no process.
//
//   client gates
//       {"trusted", "locked", "asleep"}: whether the Accessibility API serves this process, whether the login session's
//       screen is locked (or no session is on the console), whether the main display is asleep.
//   client read <pid> <identifier> <expect> <least s> <most s> <quiet s>
//       Takes the app's announcement requests from as early as its Accessibility server answers, waits for the first
//       window AppKit lists, reads its tree, and listens: at least <least> seconds from the listing, then until
//       <expect> announcements came and none for <quiet> seconds, and never past <most>, or the window going. One JSON
//       line at each step:
//         {"event": "attached"}
//         {"event": "listed"}
//         {"event": "identified", "ms"}          the first read that holds an element whose AXIdentifier is <identifier>
//         {"event": "done", "ended": "heard" | "cap" | "gone", "ms", "elements": [{"identifier", "role", "title",
//          "description", "value"}], "said": [text], "at": [ms], "locked", "asleep", "hidden"}
//       `said` is each announcement the app asked for, in order, and `at` when each came, from the listing (0 before
//       it). `elements` is every element with an AXIdentifier, from the last read that held <identifier> (or any read, when
//       none did); texts are as the element gives them, null when it gives none. `locked` and `asleep` say whether a
//       sample, four a second, ever found the screen locked or the display asleep. `hidden` is each stretch [from, to],
//       in ms from the listing, in which two samples in a row or more found the window, once shown, off the screen or
//       wholly behind other windows, where nothing redraws it; the whole run when no sample found it shown.
//
// Announcements are taken on a thread of their own, so a slow tree read never holds one up.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let out = NSLock()
func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  out.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  out.unlock()
}
func die(_ text: String) -> Never {
  FileHandle.standardError.write(Data("client: \(text)\n".utf8))
  exit(2)
}
func now() -> Double { ProcessInfo.processInfo.systemUptime }
func alive(_ pid: pid_t) -> Bool { kill(pid, 0) == 0 }

func screen() -> (locked: Bool, asleep: Bool) {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  let onConsole = session?[kCGSessionOnConsoleKey as String] as? Bool ?? false
  let locked = session?["CGSSessionScreenIsLocked"] as? Bool ?? false
  return (locked || !onConsole, CGDisplayIsAsleep(CGMainDisplayID()) != 0)
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> Any {
  guard let value = attribute(element, name) else { return NSNull() }
  if let s = value as? String { return s }
  if let n = value as? NSNumber { return n.stringValue }
  return NSNull()
}
func windows(_ app: AXUIElement) -> [AXUIElement] { attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] }
/// The app answers that it has no window; an app too busy to answer doesn't say so.
func windowless(_ app: AXUIElement) -> Bool {
  var value: AnyObject?
  let r = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value)
  return r == .invalidUIElement || (r == .success && (value as? [AXUIElement] ?? []).isEmpty)
}

/// Every element with an identifier, in the tree's order.
func elements(_ app: AXUIElement) -> [[String: Any]] {
  var found: [[String: Any]] = []
  var seen = 0
  func walk(_ element: AXUIElement, _ depth: Int) {
    seen += 1
    if seen > 4000 || depth > 40 { return }
    if let id = text(element, kAXIdentifierAttribute) as? String, !id.isEmpty {
      found.append([
        "identifier": id, "role": text(element, kAXRoleAttribute), "title": text(element, kAXTitleAttribute),
        "description": text(element, kAXDescriptionAttribute), "value": text(element, kAXValueAttribute),
      ])
    }
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(child, depth + 1) }
  }
  for window in windows(app) { walk(window, 0) }
  return found
}

/// The process has no window on the screen, or other windows cover every one of 12 × 12 points of its front one.
func hidden(_ pid: pid_t) -> Bool {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  var above: [CGRect] = []
  for w in list {
    guard let b = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b) else { continue }
    if (w[kCGWindowOwnerPID as String] as? pid_t) == pid {
      for i in 0..<12 {
        for j in 0..<12 {
          let p = CGPoint(x: r.minX + r.width * (Double(i) + 0.5) / 12, y: r.minY + r.height * (Double(j) + 0.5) / 12)
          if !above.contains(where: { $0.contains(p) }) { return false }
        }
      }
      return true
    }
    // Only an ordinary, opaque window counts: the layers above hold see-through overlays the size of the screen.
    if (w[kCGWindowLayer as String] as? Int) == 0, (w[kCGWindowAlpha as String] as? Double ?? 1) >= 1 { above.append(r) }
  }
  return true
}

// What the app asked to be announced, in order, with when each came.
let heardLock = NSLock()
var heard: [(text: String, at: Double)] = []
func said() -> [(text: String, at: Double)] {
  heardLock.lock()
  defer { heardLock.unlock() }
  return heard
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: client <gates | read ...>") }
switch args[1] {
case "gates":
  let s = screen()
  emit(["trusted": AXIsProcessTrusted(), "locked": s.locked, "asleep": s.asleep])
case "read":
  guard args.count == 8, let pid = pid_t(args[2]), let expect = Int(args[4]), let least = Double(args[5]), let most = Double(args[6]),
    let quiet = Double(args[7]) else { die("usage: client read <pid> <identifier> <expect> <least> <most> <quiet>") }
  let identifier = args[3]
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 5)

  var observer: AXObserver?
  let made = AXObserverCreateWithInfoCallback(pid, { _, _, _, info, _ in
    let text = (info as NSDictionary)["AXAnnouncementKey"] as? String ?? ""
    heardLock.lock()
    heard.append((text, now()))
    heardLock.unlock()
  }, &observer)
  guard made == .success, let observer else { die("no observer for pid \(pid): \(made.rawValue)") }
  Thread.detachNewThread {
    CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
    // A port of its own keeps the loop running between announcements.
    RunLoop.current.add(NSMachPort(), forMode: .default)
    while true { RunLoop.current.run(mode: .default, before: .distantFuture) }
  }

  var locked = false, asleep = false
  var samples = 0, behind = 0
  var shownAt: Double?
  var stretches: [[Double]] = []
  var last: [[String: Any]] = []
  var identified = false
  var listedAt = Double.infinity
  func ms(_ t: Double) -> Double { max(0, (t - listedAt) * 1000).rounded() }
  func finish(_ ended: String) -> Never {
    let s = screen()
    emit(["event": "done", "ended": ended, "ms": ms(now()), "elements": last, "said": said().map { $0.text }, "at": said().map { ms($0.at) },
      "locked": locked || s.locked, "asleep": asleep || s.asleep, "hidden": samples >= 2 && shownAt == nil ? [[0, ms(now())]] : stretches])
    exit(0)
  }
  func read() {
    let found = elements(app)
    let holds = found.contains { $0["identifier"] as? String == identifier }
    if holds && !identified { emit(["event": "identified", "ms": ms(now())]) }
    if holds || !identified { last = found }
    identified = identified || holds
  }

  // From launch: the app's Accessibility server answers only once its run loop does.
  while true {
    let r = AXObserverAddNotification(observer, app, kAXAnnouncementRequestedNotification as CFString, nil)
    if r == .success || r == .notificationAlreadyRegistered { break }
    if !alive(pid) { finish("gone") }
    usleep(20_000)
  }
  emit(["event": "attached"])
  while windows(app).isEmpty {
    if !alive(pid) { finish("gone") }
    usleep(20_000)
  }
  listedAt = now()
  emit(["event": "listed"])

  // Reading the tree is also what makes the window build it. Once it holds the identifier, it's read again at the end only.
  var missing = 0
  var sampled = 0.0
  while true {
    let elapsed = now() - listedAt
    if now() - sampled >= 0.25 {
      sampled = now()
      let s = screen()
      locked = locked || s.locked
      asleep = asleep || s.asleep
      samples += 1
      behind = hidden(pid) ? behind + 1 : 0
      if let since = shownAt {
        // From the last sample that found it shown to the latest one, as long as it stays hidden.
        if behind == 2 { stretches.append([ms(since), ms(sampled)]) }
        if behind > 2 { stretches[stretches.count - 1][1] = ms(sampled) }
        if behind == 0, let i = stretches.indices.last, stretches[i][0] == ms(since) { stretches[i][1] = ms(sampled) }
      }
      if behind == 0 { shownAt = sampled }
      if !identified { read() }
      // The window going (closed, or its process ended) ends the run, once two samples in a row find it gone.
      missing = !alive(pid) || windowless(app) ? missing + 1 : 0
      if missing >= 2 { finish("gone") }
    }
    let so = said()
    if elapsed >= least && so.count >= expect && now() - max(so.last?.at ?? 0, listedAt) >= quiet { read(); finish("heard") }
    if elapsed >= most { read(); finish("cap") }
    usleep(50_000)
  }
default:
  die("unknown command \(args[1])")
}
