import CryptoKit
import DeviceCheck
import Foundation
import Security

public enum ConcordAttestError: Error, Equatable {
  case unsupported
  case invalidInput
  /// Apple no longer accepts this key: discard it and attest a new one.
  case invalidKey
  case failed
  case keychainFailure
}

/// Apple App Attest for the control plane's iOS attestation (ADR-0010 D17). The key itself
/// stays in the Secure Enclave; only its public identifier is stored here, device-only.
public struct ConcordAttest {
  let service: String
  let account = "app-attest-key-id"

  public init(service: String = "com.concordvoice.attest") {
    self.service = service
  }

  /// False on the simulator and on devices without a Secure Enclave.
  public static var isSupported: Bool { DCAppAttestService.shared.isSupported }

  /// "1.0.0(5)": marketing version plus build. Signed into each proof, used for revocation.
  public static var appVersion: String {
    let info = Bundle.main.infoDictionary ?? [:]
    let version = info["CFBundleShortVersionString"] as? String ?? "0"
    let build = info["CFBundleVersion"] as? String ?? "0"
    return "\(version)(\(build))"
  }

  /// SHA-256("concord-appattest-v1" ‖ 0 ‖ challenge ‖ 0 ‖ version), which the server
  /// recomputes. Signing the version stops a proxy from claiming an unrevoked one.
  public static func clientDataHash(challengeBase64: String, version: String = appVersion)
    throws -> Data
  {
    guard let challenge = Data(base64Encoded: challengeBase64), !challenge.isEmpty else {
      throw ConcordAttestError.invalidInput
    }
    var input = Data("concord-appattest-v1".utf8)
    input.append(0)
    input.append(challenge)
    input.append(0)
    input.append(Data(version.utf8))
    return Data(SHA256.hash(data: input))
  }

  public func storedKeyId() throws -> String? {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecReturnData: true,
      ] as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let keyId = String(data: data, encoding: .utf8)
    else { throw ConcordAttestError.keychainFailure }
    return keyId
  }

  /// Generates a new Secure Enclave key and remembers its id, replacing any previous one.
  public func generateKey() async throws -> String {
    guard Self.isSupported else { throw ConcordAttestError.unsupported }
    let keyId = try await Self.call { try await DCAppAttestService.shared.generateKey() }
    try forgetKey()
    let status = SecItemAdd(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        kSecValueData: Data(keyId.utf8),
      ] as CFDictionary, nil)
    guard status == errSecSuccess else { throw ConcordAttestError.keychainFailure }
    return keyId
  }

  public func forgetKey() throws {
    let status = SecItemDelete(
      [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
        as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw ConcordAttestError.keychainFailure
    }
  }

  public func attestKey(_ keyId: String, challengeBase64: String) async throws -> String {
    let hash = try Self.clientDataHash(challengeBase64: challengeBase64)
    return try await Self.call {
      try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: hash)
    }.base64EncodedString()
  }

  public func generateAssertion(_ keyId: String, challengeBase64: String) async throws -> String {
    let hash = try Self.clientDataHash(challengeBase64: challengeBase64)
    return try await Self.call {
      try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: hash)
    }.base64EncodedString()
  }

  /// Maps DeviceCheck errors to the few outcomes callers act on.
  static func call<T>(_ body: () async throws -> T) async throws -> T {
    do {
      return try await body()
    } catch let error as DCError where error.code == .invalidKey {
      throw ConcordAttestError.invalidKey
    } catch let error as DCError where error.code == .featureUnsupported {
      throw ConcordAttestError.unsupported
    } catch let error as ConcordAttestError {
      throw error
    } catch {
      throw ConcordAttestError.failed
    }
  }
}
