import CryptoKit
import CoreFoundation
import Foundation
import XCTest

@testable import ConcordCrypto

/// Test-only ADR-0051 adapter. The production client does not read these formats yet.
final class NonmediaVectorTests: XCTestCase {
  private let pin = "bf003f83acfcc7afcca34b408a9960f4ffaaedcb3057aeba34b0878ffa6352b790ef7754f47ca0cd6fd7cf91087cf40d"
  private let generatorPin = "8ed4e8e461782a8119e81e9e62261b9e13a13ff365ed729d5d8666d45f3ea9b4cd0780d37f00196a5af0cf17f4924935"
  private let names: [String: [String]] = [
    "message-v1": ["realm", "scope", "scope_id", "message_id", "sender_id", "key_epoch", "content_kind"],
    "blob-v1": ["realm", "account_id", "blob_purpose", "schema_version"],
    "account-ek-wrap-v1": ["realm", "account_id", "key_purpose", "account_key_generation", "credential_generation"],
    "recovery-wrap-v1": ["realm", "account_id", "key_purpose", "recovery_purpose", "recovery_key_generation", "account_key_generation"],
    "recovery-prefs-wrap-v1": ["realm", "account_id", "key_purpose", "recovery_purpose", "recovery_key_generation", "credential_generation"],
    "attachment-v4": ["realm", "scope", "scope_id", "file_id", "uploader_id", "key_epoch", "file_nonce_b64", "flags", "chunk_index", "total_chunks", "chunk_size"],
    "channel-key-capsule-v1": ["realm", "scope", "scope_id", "key_epoch", "recipient_id", "recipient_key_generation", "distributor_id", "distributor_root_digest_b64"],
  ]
  private let formatTags = [
    "m1": "message-v1", "b1": "blob-v1", "ek1": "account-ek-wrap-v1",
    "rw1-private": "recovery-wrap-v1", "rw1-preferences": "recovery-prefs-wrap-v1",
    "attachment-v4": "attachment-v4",
  ]

  private enum CaseError: Error { case invalid }
  private func str(_ obj: [String: Any], _ key: String) throws -> String {
    guard let value = obj[key] as? String else { throw CaseError.invalid }
    return value
  }
  private func dict(_ obj: [String: Any], _ key: String) throws -> [String: Any] {
    guard let value = obj[key] as? [String: Any] else { throw CaseError.invalid }
    return value
  }
  private func base64(_ text: String) throws -> Data {
    guard let result = Data(base64Encoded: text), result.base64EncodedString() == text else { throw CaseError.invalid }
    return result
  }
  private func bytes(_ obj: [String: Any], _ key: String) throws -> Data { try base64(str(obj, key)) }
  private func sha384(_ bytes: Data) -> String { SHA384.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
  private func fixture() throws -> (Data, [[String: Any]]) {
    let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("nonmedia-e2ee-v1-vectors.json")
    let raw = try Data(contentsOf: file)
    guard sha384(raw) == pin else { throw CaseError.invalid }
    guard let root = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
      let vectors = root["vectors"] as? [[String: Any]],
      root["schema"] as? String == "concord-nonmedia-e2ee-vectors",
      root["version"] as? Int == 1,
      root["generator_sha384"] as? String == generatorPin,
      let bodyStart = raw.firstIndex(of: 10),
      let bodyPin = root["vectors_sha384"] as? String else { throw CaseError.invalid }
    guard sha384(Data(raw[(bodyStart + 1)...])) == bodyPin else { throw CaseError.invalid }
    XCTAssertEqual(vectors.count, 672)
    XCTAssertEqual(Set(vectors.compactMap { $0["name"] as? String }).count, vectors.count)
    return (raw, vectors)
  }
  private func encodedContext(_ tag: String, _ fields: [Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["concord-e2ee-context", 1, tag] + fields, options: [.withoutEscapingSlashes])
  }
  private func decodedContext(_ data: Data) throws -> (String, [Any]) {
    guard let values = try JSONSerialization.jsonObject(with: data) as? [Any],
      values.count >= 3, values[0] as? String == "concord-e2ee-context",
      values[1] as? Int == 1, let tag = values[2] as? String,
      let fields = names[tag], values.count == fields.count + 3 else { throw CaseError.invalid }
    let suffix = Array(values.dropFirst(3))
    guard try encodedContext(tag, suffix) == data else { throw CaseError.invalid }
    return (tag, suffix)
  }
  private func exactInt(_ value: Any) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite, number.doubleValue == Double(number.int64Value) else { return nil }
    return number.int64Value
  }
  private func canonicalUUID(_ value: Any) -> Bool {
    guard let id = value as? String else { return false }
    return id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil
  }
  private func wrongPurpose(_ tag: String, _ values: [Any]) -> Bool {
    guard let n = names[tag] else { return false }
    for purpose in ["key_purpose", "recovery_purpose"] {
      guard let index = n.firstIndex(of: purpose) else { continue }
      if purpose == "key_purpose", values[index] as? String != (tag == "recovery-prefs-wrap-v1" ? "preferences-aes256-gcm" : "account-rsa-oaep4096-pss-sha256") { return true }
      if purpose == "recovery_purpose", values[index] as? String != "user-account-recovery-key" { return true }
    }
    return false
  }
  private func validDescriptor(_ data: Data) -> [Any]? {
    guard data.count <= 256,
      let d = try? JSONSerialization.jsonObject(with: data) as? [Any], d.count == 8,
      d[0] as? String == "split-auth-wrap-v1", canonicalUUID(d[1]),
      let subjectText = d[2] as? String, let subject = try? base64(subjectText), subject.count == 32,
      let saltText = d[4] as? String, let salt = try? base64(saltText), salt.count == 16,
      let generation = exactInt(d[3]), (1...9_007_199_254_740_991).contains(generation),
      let canonical = try? JSONSerialization.data(withJSONObject: d, options: [.withoutEscapingSlashes]), canonical == data else { return nil }
    return d
  }
  private func validContext(_ tag: String, _ fields: [Any]) -> Bool {
    guard let fieldsNames = names[tag], fieldsNames.count == fields.count else { return false }
    for (index, name) in fieldsNames.enumerated() {
      let value = fields[index]
      switch name {
      case "scope": if !["channel", "dm"].contains(value as? String ?? "") { return false }
      case "content_kind": if value as? String != "message-body" { return false }
      case "blob_purpose": if !["preferences", "saved_gifs", "friend_organization", "presence_overrides"].contains(value as? String ?? "") { return false }
      case "key_purpose":
        if value as? String != (tag == "recovery-prefs-wrap-v1" ? "preferences-aes256-gcm" : "account-rsa-oaep4096-pss-sha256") { return false }
      case "recovery_purpose": if value as? String != "user-account-recovery-key" { return false }
      case "schema_version": if exactInt(value) != 1 { return false }
      case "flags": if exactInt(value) != 0 { return false }
      case "chunk_size": if exactInt(value) != 8_388_608 { return false }
      case "total_chunks": if !(1...10_000).contains(exactInt(value) ?? -1) { return false }
      case "chunk_index":
        let total = exactInt(fields[fieldsNames.firstIndex(of: "total_chunks")!]) ?? -1
        if !(0..<max(total, 0)).contains(exactInt(value) ?? -1) { return false }
      case "file_nonce_b64": if (try? base64(value as? String ?? ""))?.count != 16 { return false }
      case "distributor_root_digest_b64": if (try? base64(value as? String ?? ""))?.count != 48 { return false }
      default:
        if name == "key_epoch" || name.hasSuffix("generation") {
          guard let number = exactInt(value), number >= 1, number <= 9_007_199_254_740_991 else { return false }
        } else if ["realm", "account_id", "scope_id", "message_id", "sender_id", "file_id", "uploader_id", "recipient_id", "distributor_id"].contains(name) {
          guard let id = value as? String,
            id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return false }
        }
      }
    }
    return true
  }
  private func scalars(_ hex: String) -> String? {
    guard hex.count % 4 == 0, hex.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 || $0 >= 97 && $0 <= 102 }) else { return nil }
    let chars = Array(hex)
    var units: [UInt16] = []
    for start in stride(from: 0, to: chars.count, by: 4) {
      guard let n = UInt16(String(chars[start..<(start + 4)]), radix: 16) else { return nil }
      units.append(n)
    }
    var i = 0
    while i < units.count {
      if (0xD800...0xDBFF).contains(units[i]) {
        guard i + 1 < units.count, (0xDC00...0xDFFF).contains(units[i + 1]) else { return nil }
        i += 2
      } else if (0xDC00...0xDFFF).contains(units[i]) { return nil }
      else { i += 1 }
    }
    return String(utf16CodeUnits: units, count: units.count)
  }
  private func hmac(_ data: Data, key: Data) -> Data {
    Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
  }
  private func expand(_ prk: Data, _ label: String) -> Data { hmac(Data(label.utf8) + Data([0, 1]), key: prk) }
  private func seal(_ plain: Data, key: Data, nonce: Data, aad: Data) throws -> Data {
    let result = try AES.GCM.seal(plain, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
    return Data(result.ciphertext) + Data(result.tag)
  }
  private func open(_ sealed: Data, key: Data, nonce: Data, aad: Data) throws -> Data {
    guard sealed.count >= 16 else { throw CaseError.invalid }
    let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
    return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
  }
  private func wirePayload(_ format: String, _ wire: Data) throws -> (Data, Data) {
    let payload: Data
    if format == "attachment-v4" {
      guard wire.count >= 56, wire.prefix(2) == Data("CV".utf8), wire[2] == 4 else { throw CaseError.invalid }
      payload = Data(wire.dropFirst(28))
    } else {
      let prefix = format.hasPrefix("rw1-") ? "rw1:" : "\(format):"
      guard let text = String(data: wire, encoding: .ascii), text.hasPrefix(prefix) else { throw CaseError.invalid }
      payload = try base64(String(text.dropFirst(prefix.count)))
    }
    guard payload.count >= 28 else { throw CaseError.invalid }
    return (Data(payload.prefix(12)), Data(payload.dropFirst(12)))
  }
  private func wire(_ format: String, nonce: Data, sealed: Data, context: [Any]) throws -> Data {
    if format == "attachment-v4" {
      var header = Data(repeating: 0, count: 28)
      header.replaceSubrange(0..<2, with: Data("CV".utf8)); header[2] = 4
      header.replaceSubrange(4..<8, with: Data([0, 128, 0, 0])); header[11] = 1
      header.replaceSubrange(12..<28, with: try base64(context[6] as? String ?? ""))
      return header + nonce + sealed
    }
    let prefix = format.hasPrefix("rw1-") ? "rw1:" : "\(format):"
    return Data((prefix + (nonce + sealed).base64EncodedString()).utf8)
  }

  func testPinnedCorpusAndAllAcceptedCases() throws {
    let (_, vectors) = try fixture()
    var legacyMatrices = 0, upgradeMatrices = 0
    var uniform: [[String: Any]] = []
    for v in vectors where (try? str(dict(v, "expect"), "verdict")) == "accept" {
      let name = try str(v, "name"), suite = try str(v, "suite"), op = try str(v, "operation")
      let input = try dict(v, "input"), outputs = try dict(dict(v, "expect"), "outputs")
      switch (suite, op) {
      case ("credential", "password-scalars"):
        let result = try XCTUnwrap(scalars(str(input, "utf16_units_hex")), name)
        XCTAssertEqual(Data(result.utf8).base64EncodedString(), try str(outputs, "password_utf8_b64"), name)
      case ("credential", "derive"):
        let password = try XCTUnwrap(String(data: bytes(input, "password_utf8_b64"), encoding: .utf8), name)
        let salt = try bytes(input, "salt_b64")
        let root = try ConcordCrypto.deriveArgon2id(password: password, salt: salt).withUnsafeBytes { Data($0) }
        XCTAssertEqual(root.base64EncodedString(), try str(outputs, "root_b64"), name)
        var generation = (input["generation"] as? NSNumber)?.uint64Value.bigEndian ?? 0
        let bind = Data("concord-credential-bind-v1\0".utf8) + Data(try str(input, "realm").utf8) + (try bytes(input, "subject_b64")) + withUnsafeBytes(of: &generation) { Data($0) }
        let prk = hmac(root, key: bind)
        XCTAssertEqual(expand(prk, "concord-auth-secret-v1").base64URLEncodedWithoutPadding, try str(outputs, "auth_b64"), name)
        XCTAssertEqual(expand(prk, "concord-wrap-key-v1").base64EncodedString(), try str(outputs, "wrap_b64"), name)
        XCTAssertEqual(expand(prk, "concord-prefs-key-v1").base64EncodedString(), try str(outputs, "prefs_b64"), name)
      case ("credential", "descriptor"):
        let d = try XCTUnwrap(validDescriptor(bytes(input, "descriptor_b64")), name)
        XCTAssertEqual(d[1] as? String, outputs["realm"] as? String, name)
        XCTAssertEqual(d[2] as? String, outputs["subject_b64"] as? String, name)
        XCTAssertEqual(exactInt(d[3]), exactInt(outputs["generation"] as Any), name)
        XCTAssertEqual(d[4] as? String, outputs["salt_b64"] as? String, name)
        XCTAssertEqual(exactInt(d[5]), exactInt(outputs["m_kib"] as Any), name)
        XCTAssertEqual(exactInt(d[6]), exactInt(outputs["t"] as Any), name)
        XCTAssertEqual(exactInt(d[7]), exactInt(outputs["p"] as Any), name)
      case ("context", "encode"):
        let fields = try XCTUnwrap(input["context_fields"] as? [Any], name)
        let tag = try str(input, "tag")
        XCTAssertTrue(validContext(tag, fields), name)
        XCTAssertEqual(try encodedContext(tag, fields).base64EncodedString(), try str(outputs, "context_b64"), name)
      case ("context", "parse"):
        let (tag, fields) = try decodedContext(bytes(input, "context_b64"))
        XCTAssertTrue(validContext(tag, fields), name)
        XCTAssertEqual(tag, outputs["tag"] as? String, name)
        let expected = try XCTUnwrap(outputs["context_fields"] as? [Any], name)
        XCTAssertTrue(NSArray(array: fields).isEqual(to: expected), name)
      case ("rsa-label", "derive"):
        let fields = try XCTUnwrap(input["context_fields"] as? [Any], name)
        XCTAssertEqual(try encodedContext("channel-key-capsule-v1", fields).base64EncodedString(), try str(outputs, "label_b64"), name)
      case ("rsa-label", "verify"):
        let fields = try XCTUnwrap(input["context_fields"] as? [Any], name)
        XCTAssertEqual(try encodedContext("channel-key-capsule-v1", fields), try bytes(input, "candidate_label_b64"), name)
      case ("aead", "encrypt"):
        let format = try str(input, "format"), (tag, fields) = try decodedContext(bytes(input, "context_b64"))
        XCTAssertEqual(formatTags[format], tag, name)
        let sealed = try seal(bytes(input, "plaintext_b64"), key: bytes(input, "key_b64"), nonce: bytes(input, "nonce_b64"), aad: bytes(input, "context_b64"))
        XCTAssertEqual(try wire(format, nonce: bytes(input, "nonce_b64"), sealed: sealed, context: fields).base64EncodedString(), try str(outputs, "envelope_b64"), name)
      case ("aead", "decrypt"):
        let format = try str(input, "format"), (tag, _) = try decodedContext(bytes(input, "expected_context_b64"))
        XCTAssertEqual(formatTags[format], tag, name)
        let (nonce, sealed) = try wirePayload(format, bytes(input, "envelope_b64"))
        XCTAssertEqual(try open(sealed, key: bytes(input, "key_b64"), nonce: nonce, aad: bytes(input, "expected_context_b64")).base64EncodedString(), try str(outputs, "plaintext_b64"), name)
      case ("policy", "legacy-continuation"):
        XCTAssertEqual([outputs["decision"] as? String, outputs["reason"] as? String], legacyDecision(input).map(Optional.some), name)
        if name.contains("/matrix/") { legacyMatrices += 1 }
      case ("policy", "upgrade-outcome"):
        XCTAssertEqual([outputs["decision"] as? String, outputs["reason"] as? String], upgradeDecision(input).map(Optional.some), name)
        if name.contains("/matrix/") { upgradeMatrices += 1 }
      case ("policy", "descriptor-uniformity"):
        let d = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes(input, "descriptor_b64")) as? [Any], name)
        XCTAssertEqual(d.count, 8, name)
        XCTAssertEqual(d[5] as? Int, 65_536, name)
        XCTAssertFalse(try bytes(input, "descriptor_b64").contains(Data(str(input, "probe_public_account_uuid").utf8)), name)
        uniform.append(outputs)
      default: XCTFail("unknown operation \(suite)/\(op)")
      }
    }
    XCTAssertEqual(legacyMatrices, 384)
    XCTAssertEqual(upgradeMatrices, 96)
    XCTAssertEqual(uniform.count, 3)
    if uniform.count == 3 {
      XCTAssertTrue(NSDictionary(dictionary: uniform[0]).isEqual(to: uniform[1]))
      XCTAssertTrue(NSDictionary(dictionary: uniform[0]).isEqual(to: uniform[2]))
    }
  }

  private func legacyDecision(_ i: [String: Any]) -> [String] {
    if i["account_protocol"] as? String != "legacy" { return ["deny", "not-legacy"] }
    if i["authority_proof"] as? String == "absent" { return ["deny", "missing-authority-proof"] }
    if i["authority_proof"] as? String == "invalid" { return ["deny", "invalid-authority-proof"] }
    if i["freshness"] as? String != "current" { return ["deny", "stale-authority-proof"] }
    if i["account_match"] as? Bool != true { return ["deny", "wrong-account"] }
    if i["realm_match"] as? Bool != true { return ["deny", "wrong-realm"] }
    if i["not_expired"] as? Bool != true { return ["deny", "expired-proof"] }
    if i["control_plane_continuation"] as? Bool != true { return ["deny", "no-continuation"] }
    return ["submit-raw-password", "eligible"]
  }
  private func upgradeDecision(_ i: [String: Any]) -> [String] {
    if i["commit_state"] as? String == "ambiguous" { return ["reconcile", "ambiguous-commit"] }
    if i["mfa_complete"] as? Bool != true { return ["deny", "mfa-required"] }
    if i["commit_state"] as? String == "committed" {
      if i["prior_state"] as? String == "split", i["authorization_state"] as? String == "consumed" {
        return i["request_match"] as? Bool == true ? ["idempotent", "replay"] : ["conflict", "request-conflict"]
      }
      return ["reconcile", "ambiguous-commit"]
    }
    if i["prior_state"] as? String == "split" { return ["deny", "not-legacy"] }
    if i["authorization_state"] as? String == "consumed" { return ["reconcile", "ambiguous-commit"] }
    if i["authorization_state"] as? String == "expired" { return ["deny", "expired-authorization"] }
    if i["authorization_state"] as? String == "absent" { return ["deny", "missing-authorization"] }
    if i["request_match"] as? Bool != true { return ["conflict", "request-conflict"] }
    return ["commit", "fresh-authorization"]
  }

  private func classify(_ v: [String: Any]) throws -> String {
    let suite = try str(v, "suite"), op = try str(v, "operation")
    let input = try dict(v, "input"), name = try str(v, "name")
    switch (suite, op) {
    case ("credential", "password-scalars"):
      if try scalars(str(input, "utf16_units_hex")) == nil { return "validate/invalid_unicode" }
    case ("credential", "derive"):
      if try bytes(input, "subject_b64").count != 32 || bytes(input, "salt_b64").count != 16 || !canonicalUUID(input["realm"] as Any) || !(1...9_007_199_254_740_991).contains(exactInt(input["generation"] as Any) ?? -1) || String(data: bytes(input, "password_utf8_b64"), encoding: .utf8) == nil { return "validate/invalid_field" }
    case ("credential", "descriptor"):
      guard let d = validDescriptor(try bytes(input, "descriptor_b64")) else { return "parse/malformed_descriptor" }
      if d[5] as? Int != 65_536 || d[6] as? Int != 3 || d[7] as? Int != 4 { return "validate/weak_parameters" }
      if d[1] as? String != (try str(input, "authenticated_realm")) { return "validate/wrong_realm" }
    case ("context", "encode"):
      let tag = try str(input, "tag")
      guard let fields = input["context_fields"] as? [Any] else { throw CaseError.invalid }
      if names[tag] == nil { return "validate/unknown_tag" }
      if !validContext(tag, fields) { return wrongPurpose(tag, fields) ? "validate/invalid_purpose" : "validate/invalid_field" }
    case ("context", "parse"):
      let raw = try bytes(input, "context_b64")
      guard let value = try? JSONSerialization.jsonObject(with: raw) as? [Any], value.count >= 3,
        value[0] as? String == "concord-e2ee-context", value[1] as? Int == 1,
        let tag = value[2] as? String,
        let canonical = try? JSONSerialization.data(withJSONObject: value, options: [.withoutEscapingSlashes]), canonical == raw else { return "parse/malformed_context" }
      if names[tag] == nil { return "validate/unknown_tag" }
      let fields = Array(value.dropFirst(3))
      if !validContext(tag, fields) { return wrongPurpose(tag, fields) ? "validate/invalid_purpose" : "validate/invalid_field" }
    case ("rsa-label", "derive"):
      guard let fields = input["context_fields"] as? [Any] else { throw CaseError.invalid }
      if !validContext("channel-key-capsule-v1", fields) { return "validate/invalid_field" }
    case ("rsa-label", "verify"):
      guard let fields = input["context_fields"] as? [Any] else { throw CaseError.invalid }
      if !validContext("channel-key-capsule-v1", fields) { return "validate/invalid_field" }
      if try encodedContext("channel-key-capsule-v1", fields) != bytes(input, "candidate_label_b64") { return "authenticate/invalid_label" }
    case ("aead", "encrypt"):
      if try bytes(input, "key_b64").count != 32 || bytes(input, "nonce_b64").count != 12 { return "validate/invalid_field" }
      let (tag, fields) = try decodedContext(bytes(input, "context_b64"))
      if !validContext(tag, fields) { return "validate/invalid_field" }
      if formatTags[try str(input, "format")] != tag { return "validate/invalid_format_context" }
    case ("aead", "decrypt"):
      if try bytes(input, "key_b64").count != 32 { return "validate/invalid_field" }
      let (tag, fields) = try decodedContext(bytes(input, "expected_context_b64"))
      if !validContext(tag, fields) { return "validate/invalid_field" }
      let format = try str(input, "format")
      if formatTags[format] != tag { return "validate/invalid_format_context" }
      let wire = try bytes(input, "envelope_b64")
      if format == "attachment-v4", wire.count >= 28,
        (fields[9] as? Int != wire.uint32BE(at: 8) || wire[3] != 0 || wire.uint32BE(at: 4) != 8_388_608) {
        return "validate/invalid_field"
      }
      let nonce: Data, sealed: Data
      do { (nonce, sealed) = try wirePayload(format, wire) }
      catch { return "parse/bad_envelope" }
      var aad = try bytes(input, "expected_context_b64")
      if name.hasSuffix("/tamper-header") {
        var candidate = fields
        candidate[6] = Data(wire[12..<28]).base64EncodedString()
        aad = try encodedContext(tag, candidate)
      }
      do { _ = try open(sealed, key: bytes(input, "key_b64"), nonce: nonce, aad: aad) }
      catch { return "authenticate/aead_failure" }
    default: throw CaseError.invalid
    }
    XCTFail("\(name) did not reject")
    throw CaseError.invalid
  }

  func testEveryNegativeHasItsDeclaredStageAndReason() throws {
    let (_, vectors) = try fixture()
    let names = Set(vectors.compactMap { $0["name"] as? String })
    var negatives = 0
    for v in vectors where (try? str(dict(v, "expect"), "verdict")) == "reject" {
      let name = try str(v, "name"), expectation = try dict(v, "expect")
      XCTAssertTrue(names.contains(try str(v, "negative_of")), name)
      XCTAssertEqual(try classify(v), "\(try str(expectation, "stage"))/\(try str(expectation, "reason"))", name)
      negatives += 1
    }
    XCTAssertEqual(negatives, 132)
  }
}

private extension Data {
  var base64URLEncodedWithoutPadding: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  func contains(_ needle: Data) -> Bool { range(of: needle) != nil }
  func uint32BE(at offset: Int) -> Int {
    guard count >= offset + 4 else { return -1 }
    return self[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }
  }
}
