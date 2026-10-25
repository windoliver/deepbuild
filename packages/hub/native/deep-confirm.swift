// deep-confirm (#24): the OS confirming you, for the hub. It shows LocalAuthentication's prompt (Touch ID, or your
// password) with the reason the hub passes as its one argument, and exits 0 only when you confirmed: 1 when you
// cancelled or it failed, 3 when this Mac can't ask (no password set, say). It reads nothing else and writes only
// why it didn't confirm, to stderr.
import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count == 2 ? CommandLine.arguments[1] : ""
if reason.isEmpty {
  FileHandle.standardError.write("usage: deep-confirm <reason>\n".data(using: .utf8)!)
  exit(2)
}
let context = LAContext()
var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
  FileHandle.standardError.write("this Mac can't confirm you: \(error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
  exit(3)
}
let done = DispatchSemaphore(value: 0)
var confirmed = false
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, failure in
  confirmed = success
  if !success { FileHandle.standardError.write("\(failure?.localizedDescription ?? "not confirmed")\n".data(using: .utf8)!) }
  done.signal()
}
done.wait()
exit(confirmed ? 0 : 1)
