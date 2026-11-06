import Foundation
import QuickLook
import React

/// React Native bridge for ConcordCryptoService. Errors reject with a stable code only, never
/// with key material, plaintext or an underlying system message.
@objc(ConcordCryptoModule)
final class ConcordCryptoModule: NSObject {
  private let service = ConcordCryptoService()
  // Argon2id holds 64 MiB for a few hundred milliseconds; keep it off the JS and main threads.
  private let queue = DispatchQueue(label: "com.concordvoice.mobile.crypto")
  // Attachments get their own serial queue: one download or decrypt at a time, and a large
  // file never holds up message crypto.
  private let attachmentQueue = DispatchQueue(label: "com.concordvoice.mobile.attachments")
  // The previewer on screen and its data source, kept alive while it shows; main queue only.
  private weak var shown: QLPreviewController?
  private var preview: AttachmentPreview?

  override init() {
    super.init()
    // Plaintext from an earlier run (a crash, a kill) never outlives a launch.
    let attachments = service.attachments
    attachmentQueue.async { attachments.clear() }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func run(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
    on queue: DispatchQueue? = nil, _ body: @escaping () throws -> Any
  ) {
    (queue ?? self.queue).async {
      do {
        resolve(try body())
      } catch let error as ConcordCryptoError {
        reject("E_CONCORD_CRYPTO_\(String(describing: error).uppercased())", "Crypto operation failed", nil)
      } catch {
        reject("E_CONCORD_CRYPTO", "Crypto operation failed", nil)
      }
    }
  }

  @objc func unlockIdentity(
    _ password: String, saltBase64: String, wrappedPrivateKeyBase64: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.unlockIdentity(
        password: password, saltBase64: saltBase64,
        wrappedPrivateKeyBase64: wrappedPrivateKeyBase64)
    }
  }

  @objc func createIdentity(
    _ password: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { try self.service.createIdentity(password: password) }
  }

  @objc func generateChannelKey(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { self.service.generateChannelKey() }
  }

  @objc func unwrapChannelKey(
    _ wrappedKeyBase64: String, privateKeyHandle: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.unwrapChannelKey(
        wrappedKeyBase64: wrappedKeyBase64, privateKeyHandle: privateKeyHandle)
    }
  }

  @objc func wrapChannelKey(
    _ channelKeyHandle: String, publicKeySpkiBase64: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.wrapChannelKey(
        channelKeyHandle: channelKeyHandle, publicKeySpkiBase64: publicKeySpkiBase64)
    }
  }

  @objc func encryptMessage(
    _ plaintext: String, channelKeyHandle: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.encryptMessage(plaintext, channelKeyHandle: channelKeyHandle)
    }
  }

  @objc func decryptMessage(
    _ ciphertextBase64: String, channelKeyHandle: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.decryptMessage(ciphertextBase64, channelKeyHandle: channelKeyHandle)
    }
  }

  @objc func releaseKey(
    _ handle: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      self.service.store.release(handle)
      return NSNull()
    }
  }

  @objc func releaseAll(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      self.service.store.releaseAll()
      return NSNull()
    }
  }

  @objc func persistIdentity(
    _ privateKeyHandle: String, account: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.persistIdentity(privateKeyHandle: privateKeyHandle, account: account)
      return NSNull()
    }
  }

  // Runs on the crypto queue: SecItemCopyMatching blocks while the Face ID sheet is up.
  @objc func loadIdentity(
    _ account: String, reason: String, allowUI: Bool,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.loadIdentity(account: account, reason: reason, allowUI: allowUI)
    }
  }

  @objc func deleteIdentity(
    _ account: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.service.keychain.delete(account: account)
      return NSNull()
    }
  }

  private let sessions = ConcordSessionKeychain()

  @objc func saveSession(
    _ record: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.sessions.save(record)
      return NSNull()
    }
  }

  @objc func loadSession(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      guard let record = try self.sessions.load() else { return NSNull() }
      return record
    }
  }

  @objc func deleteSession(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      try self.sessions.delete()
      return NSNull()
    }
  }

  @objc func downloadAttachment(
    _ url: String, headers: NSDictionary, maxBytes: Double,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject, on: attachmentQueue) {
      // Int64(exactly:) refuses fractions, infinities and 2^63, which Int64() would trap on.
      guard let headers = headers as? [String: String], let cap = Int64(exactly: maxBytes),
        cap >= 1
      else { throw ConcordCryptoError.invalidInput }
      return try self.service.attachments.download(url: url, headers: headers, maxBytes: cap)
    }
  }

  @objc func decryptAttachment(
    _ id: String, channelKeyHandle: String, fileExtension: String,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject, on: attachmentQueue) {
      try self.service.decryptAttachment(
        id: id, channelKeyHandle: channelKeyHandle, fileExtension: fileExtension)
    }
  }

  @objc func readAttachmentText(
    _ uri: String, maxBytes: Double,
    resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject, on: attachmentQueue) {
      // Double(Int64.max) rounds up to 2^63, so a range check would still let Int64() trap.
      guard let cap = Int64(exactly: maxBytes), cap >= 0 else { throw ConcordCryptoError.invalidInput }
      return try self.service.attachments.readText(uri: uri, maxBytes: cap)
    }
  }

  @objc func clearAttachments(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    // Cancelled first, off the queue: a running download would otherwise hold the clear back.
    service.attachments.cancel()
    // At sign-out the previewer goes too, so no file it already loaded stays on screen.
    DispatchQueue.main.async { self.shown?.dismiss(animated: false) }
    run(resolve, reject, on: attachmentQueue) {
      self.service.attachments.clear()
      return NSNull()
    }
  }

  @objc func attachmentImageSize(
    _ uri: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject, on: attachmentQueue) { try self.service.attachments.imageSize(uri: uri) }
  }

  /// Shows a decrypted attachment in the system previewer, inside the app, at the user's tap.
  /// Resolves false only when the file can't be previewed. True otherwise: once it is on screen,
  /// or when nothing can show it now (a previewer is already open, or the screen is changing),
  /// so the card goes back to its hint and a later tap can try again.
  @objc func previewAttachment(
    _ uri: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // The same check as reads and deletes: only a file this module decrypted.
    guard let file = try? service.attachments.plaintext(uri) else {
      return reject("E_CONCORD_CRYPTO_INVALIDINPUT", "Crypto operation failed", nil)
    }
    DispatchQueue.main.async {
      guard QLPreviewController.canPreview(file as NSURL) else { return resolve(false) }
      // UIKit drops a presentation from a controller that is leaving or already presenting,
      // without calling back, so those cases resolve here instead.
      guard self.shown == nil, let host = RCTPresentedViewController(),
        host.viewIfLoaded?.window != nil, !host.isBeingDismissed, host.presentedViewController == nil
      else { return resolve(true) }
      // ponytail: nothing holds the file in the app's cache while it shows; hold it from JS until
      // the previewer closes if 256 MiB of other opens behind it ever evict one.
      let preview = AttachmentPreview(file) { [weak self] in self?.preview = nil }
      self.preview = preview
      let controller = QLPreviewController()
      controller.dataSource = preview
      controller.delegate = preview
      self.shown = controller
      host.present(controller, animated: true)
      resolve(true)
    }
  }

  @objc func deleteAttachment(
    _ uri: String, resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject, on: attachmentQueue) {
      try self.service.attachments.delete(uri: uri)
      return NSNull()
    }
  }

  /// UUID() draws from the system CSPRNG.
  @objc func randomId(
    _ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(UUID().uuidString.lowercased())
  }
}

/// The previewer's one item. It drops itself once the previewer closes.
private final class AttachmentPreview: NSObject, QLPreviewControllerDataSource,
  QLPreviewControllerDelegate
{
  private let file: URL
  private let closed: () -> Void

  init(_ file: URL, closed: @escaping () -> Void) {
    self.file = file
    self.closed = closed
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int)
    -> QLPreviewItem
  { file as NSURL }

  func previewControllerDidDismiss(_ controller: QLPreviewController) { closed() }
}
