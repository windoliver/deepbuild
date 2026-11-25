// The stand-in of client.test.ts (README: The stand-in), never shipped: an AppKit app with one small window that gives an
// assistive client what a window drawn through vendor/accesskit_macos gives it. The content view's accessibilityChildren
// is one root group whose children are NSAccessibilityElements with a role, a title, a value and, for the item, an
// identifier (node.rs). Nothing is built or said until a client first asks for the children (adapter.rs), and each
// announcement is an announcement request posted on the window with its text and the medium priority (event.rs, raise).
//
//   standin <json>   {"window": bool, "identifier": string | null, "value": string, "lines": [string], "gapMs": int,
//                     "lifeMs": int}
//
// It prints {"ok": true} once its window is open, then says `lines`, one every gapMs from the first read on, and exits
// after lifeMs. It never becomes the active app, and its window floats above the ordinary ones, so nothing on the
// person's screen covers it while it's read.
import AppKit

struct Spec: Decodable {
  let window: Bool
  let identifier: String?
  let value: String
  let lines: [String]
  let gapMs: Int
  let lifeMs: Int
}
let spec = try! JSONDecoder().decode(Spec.self, from: Data(CommandLine.arguments[1].utf8))

final class Node: NSAccessibilityElement {
  var axRole = NSAccessibility.Role.group
  var axIdentifier: String?
  var axTitle: String?
  var axValue: String?
  var kids: [Node] = []
  weak var up: Node?
  weak var view: NSView?
  override func accessibilityRole() -> NSAccessibility.Role? { axRole }
  override func accessibilityIdentifier() -> String? { axIdentifier }
  override func accessibilityTitle() -> String? { axTitle }
  override func accessibilityValue() -> Any? { axValue }
  override func accessibilityChildren() -> [Any]? { kids }
  override func accessibilityParent() -> Any? { up ?? view?.accessibilityParent() }
  override func accessibilityWindow() -> Any? { view?.accessibilityParent() }
  override func accessibilityTopLevelUIElement() -> Any? { view?.accessibilityParent() }
  override func accessibilityFrame() -> NSRect { view.map { $0.window?.convertToScreen($0.convert($0.bounds, to: nil)) ?? .zero } ?? .zero }
  override func isAccessibilityElement() -> Bool { true }
}

final class Content: NSView {
  var root: Node!
  var first: (() -> Void)?
  override func accessibilityChildren() -> [Any]? {
    first?()
    first = nil
    return [root!]
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let view = Content(frame: NSRect(x: 0, y: 0, width: 220, height: 90))
let root = Node()
let caption = Node()
caption.axRole = .staticText
caption.axTitle = "A caption no one gave an identifier"
let item = Node()
item.axRole = .image
item.axIdentifier = spec.identifier
item.axTitle = "The chart"
item.axValue = spec.value
for node in [root, caption, item] { node.view = view }
for node in [caption, item] { node.up = root }
root.kids = [caption, item]
view.root = root
let window = NSWindow(contentRect: NSRect(x: 40, y: 200, width: 220, height: 90), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "AX stand-in"
window.contentView = view
window.isReleasedWhenClosed = false
window.level = .floating
view.first = {
  for (k, line) in spec.lines.enumerated() {
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(spec.gapMs * (k + 1))) {
      NSAccessibility.post(element: window, notification: .announcementRequested, userInfo: [
        .announcement: line, .priority: NSAccessibilityPriorityLevel.medium.rawValue,
      ])
    }
  }
}
if spec.window { window.orderFrontRegardless() }
DispatchQueue.main.async {
  FileHandle.standardOutput.write(Data("{\"ok\": true}\n".utf8))
}
DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(spec.lifeMs)) { exit(0) }
app.run()
