// deep-confirm (#24, #880): the OS confirming you, for the hub, as a signature only you can make. Its key lives in the
// Secure Enclave and signs only after Touch ID or your password; the hub counts the signature, never this exit code.
//
//   deep-confirm enroll   makes the key and prints {"public_key": <its X9.63 point, base64url>}; the enclave-wrapped
//                         key goes to $DEEP_CONFIRM_KEY, usable only by this Mac's enclave
//   deep-confirm sign     reads the hub's challenge, one line of JSON on stdin with the prompt's `words`, shows the
//                         prompt and, once you confirm, prints {"signed": <the challenge>, "signature": <ECDSA P-256
//                         over SHA-256 of the line's bytes, X9.62 DER, base64url>}; {"error": "cancelled"} when you
//                         cancel, {"error": <why>} when it can't
//
// The hub sends the challenge in its RFC 8785 bytes and verifies over the bytes it sent, so a line it didn't send
// signs nothing that counts. It reads nothing else and writes nothing else.
import CryptoKit
import Foundation
import LocalAuthentication

func reply(_ object: [String: Any], _ code: Int32) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{\"error\":\"unwritable reply\"}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
  exit(code)
}
func base64url(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}
func access() -> SecAccessControl {
  var error: Unmanaged<CFError>?
  guard let control = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &error) else {
    reply(["error": "no access control: \(error.map { String(describing: $0.takeRetainedValue()) } ?? "unknown")"], 3)
  }
  return control
}

let args = CommandLine.arguments
guard let keyFile = ProcessInfo.processInfo.environment["DEEP_CONFIRM_KEY"], args.count == 2 else {
  FileHandle.standardError.write(Data("usage: DEEP_CONFIRM_KEY=<file> deep-confirm enroll | sign\n".utf8))
  exit(2)
}
let keyURL = URL(fileURLWithPath: keyFile)

switch args[1] {
case "enroll":
  guard SecureEnclave.isAvailable else { reply(["error": "this Mac has no Secure Enclave"], 3) }
  do {
    let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access())
    try key.dataRepresentation.write(to: keyURL, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: keyFile)
    reply(["public_key": base64url(key.publicKey.x963Representation)], 0)
  } catch {
    reply(["error": "the Secure Enclave made no key: \(error.localizedDescription)"], 1)
  }
case "sign":
  guard let line = readLine(strippingNewline: true), let challenge = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
        let words = challenge["words"] as? String, !words.isEmpty else {
    reply(["error": "no challenge on stdin"], 2)
  }
  guard let wrapped = try? Data(contentsOf: keyURL) else { reply(["error": "no key at \(keyFile); deep setup sets one up"], 3) }
  let context = LAContext()
  let done = DispatchSemaphore(value: 0)
  var failure: Error?
  context.evaluateAccessControl(access(), operation: .useKeySign, localizedReason: words) { success, error in
    if !success { failure = error ?? LAError(.authenticationFailed) }
    done.signal()
  }
  done.wait()
  if let failure {
    let cancelled: Set<LAError.Code> = [.userCancel, .systemCancel, .appCancel]
    if let code = (failure as? LAError)?.code, cancelled.contains(code) { reply(["error": "cancelled"], 1) }
    reply(["error": failure.localizedDescription], 1)
  }
  do {
    // The context you just confirmed in: the enclave signs without asking again.
    let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: wrapped, authenticationContext: context)
    let signature = try key.signature(for: Data(line.utf8))
    reply(["signed": challenge, "signature": base64url(signature.derRepresentation)], 0)
  } catch {
    reply(["error": "the Secure Enclave didn't sign: \(error.localizedDescription)"], 1)
  }
default:
  FileHandle.standardError.write(Data("usage: DEEP_CONFIRM_KEY=<file> deep-confirm enroll | sign\n".utf8))
  exit(2)
}
