import Foundation
import React

/// React Native bridge for ConcordAttest. Errors reject with a stable code only.
@objc(ConcordAttestModule)
final class ConcordAttestModule: NSObject {
  private let attest = ConcordAttest()

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func run(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
    _ body: @escaping () async throws -> Any
  ) {
    Task {
      do {
        resolve(try await body())
      } catch let error as ConcordAttestError {
        reject("E_CONCORD_ATTEST_\(String(describing: error).uppercased())", "App Attest failed", nil)
      } catch {
        reject("E_CONCORD_ATTEST", "App Attest failed", nil)
      }
    }
  }

  @objc func info(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      let keyId: Any = try self.attest.storedKeyId().map { $0 as Any } ?? NSNull()
      return [
        "supported": ConcordAttest.isSupported,
        "version": ConcordAttest.appVersion,
        "keyId": keyId,
      ] as [String: Any]
    }
  }

  @objc func generateKey(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { try await self.attest.generateKey() }
  }

  @objc func forgetKey(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.attest.forgetKey()
      return NSNull()
    }
  }

  @objc func attestKey(
    _ keyId: String, challengeBase64: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try await self.attest.attestKey(keyId, challengeBase64: challengeBase64)
    }
  }

  @objc func generateAssertion(
    _ keyId: String, challengeBase64: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try await self.attest.generateAssertion(keyId, challengeBase64: challengeBase64)
    }
  }
}
