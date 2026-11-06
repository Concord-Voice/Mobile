import CryptoKit
import Foundation
import ImageIO
import Security

/// In-memory key handles. JavaScript only ever holds an opaque handle string; key bytes stay
/// native. Wrong-kind and unknown handles fail closed.
public final class ConcordKeyStore {
  enum Entry {
    case symmetric(SymmetricKey)
    case rsaPrivate(SecKey)
  }

  private var entries: [String: Entry] = [:]
  private let lock = NSLock()

  public init() {}

  func add(_ entry: Entry) -> String {
    let handle = UUID().uuidString
    lock.lock()
    defer { lock.unlock() }
    entries[handle] = entry
    return handle
  }

  func symmetric(_ handle: String) throws -> SymmetricKey {
    guard case .symmetric(let key) = try entry(handle) else {
      throw ConcordCryptoError.wrongKeyKind
    }
    return key
  }

  func rsaPrivate(_ handle: String) throws -> SecKey {
    guard case .rsaPrivate(let key) = try entry(handle) else {
      throw ConcordCryptoError.wrongKeyKind
    }
    return key
  }

  public func release(_ handle: String) {
    lock.lock()
    defer { lock.unlock() }
    entries.removeValue(forKey: handle)
  }

  public func releaseAll() {
    lock.lock()
    defer { lock.unlock() }
    entries.removeAll()
  }

  public var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return entries.count
  }

  private func entry(_ handle: String) throws -> Entry {
    lock.lock()
    defer { lock.unlock() }
    guard let entry = entries[handle] else { throw ConcordCryptoError.unknownHandle }
    return entry
  }
}

/// The operations JavaScript can call, in base64 and handles. Shared by the React Native
/// module and the tests, so the tests exercise the same surface the app uses.
public struct ConcordCryptoService {
  public let store: ConcordKeyStore
  public let keychain: ConcordKeychain
  public let attachments: ConcordAttachmentFiles

  public init(
    store: ConcordKeyStore = ConcordKeyStore(), keychain: ConcordKeychain = ConcordKeychain(),
    attachments: ConcordAttachmentFiles = ConcordAttachmentFiles()
  ) {
    self.store = store
    self.keychain = keychain
    self.attachments = attachments
  }

  /// Decrypts a downloaded attachment with a channel key handle; returns its file URL and size.
  public func decryptAttachment(id: String, channelKeyHandle: String, fileExtension: String) throws
    -> [String: Any]
  {
    try attachments.decrypt(
      id: id, key: try store.symmetric(channelKeyHandle), fileExtension: fileExtension)
  }

  /// Login: derive the Argon2id key, unwrap the identity key, keep only the private handle.
  public func unlockIdentity(password: String, saltBase64: String, wrappedPrivateKeyBase64: String)
    throws -> String
  {
    let wrappingKey = try ConcordCrypto.deriveArgon2id(
      password: password, salt: try decode(saltBase64))
    let privateKey = try ConcordCrypto.unwrapPrivateKey(
      try decode(wrappedPrivateKeyBase64), wrappingKey: wrappingKey)
    return store.add(.rsaPrivate(privateKey))
  }

  /// Registration: a new RSA-4096 identity wrapped exactly as crypto.ts generateRegistrationKeys.
  public func createIdentity(password: String) throws -> [String: String] {
    var salt = Data(count: 16)
    let status = salt.withUnsafeMutableBytes { buffer -> OSStatus in
      guard let base = buffer.baseAddress else { return errSecAllocate }
      return SecRandomCopyBytes(kSecRandomDefault, buffer.count, base)
    }
    guard status == errSecSuccess else { throw ConcordCryptoError.keyDerivationFailed }
    let wrappingKey = try ConcordCrypto.deriveArgon2id(password: password, salt: salt)
    let pair = try ConcordCrypto.generateRSAKeyPair()
    // Everything that can throw runs first, so a failure never strands a private key in the store.
    let spki = try ConcordCrypto.spki(publicKey: pair.publicKey)
    let wrapped = try ConcordCrypto.wrapPrivateKey(pair.privateKey, wrappingKey: wrappingKey)
    return [
      "privateKeyHandle": store.add(.rsaPrivate(pair.privateKey)),
      "publicKeySpkiBase64": spki.base64EncodedString(),
      "wrappedPrivateKeyBase64": wrapped.base64EncodedString(),
      "keyDerivationSalt": salt.base64EncodedString(),
      "keyDerivationAlg": "argon2id",
    ]
  }

  /// Face ID / Touch ID persistence of an unlocked identity; see ConcordKeychain.
  public func persistIdentity(privateKeyHandle: String, account: String) throws {
    try keychain.save(try store.rsaPrivate(privateKeyHandle), account: account)
  }

  public func loadIdentity(account: String, reason: String, allowUI: Bool) throws -> String {
    store.add(.rsaPrivate(try keychain.load(account: account, reason: reason, allowUI: allowUI)))
  }

  public func generateChannelKey() -> String {
    store.add(.symmetric(SymmetricKey(size: .bits256)))
  }

  public func unwrapChannelKey(wrappedKeyBase64: String, privateKeyHandle: String) throws -> String {
    let key = try ConcordCrypto.unwrapChannelKey(
      try decode(wrappedKeyBase64), privateKey: try store.rsaPrivate(privateKeyHandle))
    return store.add(.symmetric(key))
  }

  public func wrapChannelKey(channelKeyHandle: String, publicKeySpkiBase64: String) throws -> String {
    let publicKey = try ConcordCrypto.publicKey(spki: try decode(publicKeySpkiBase64))
    return try ConcordCrypto.wrapChannelKey(
      try store.symmetric(channelKeyHandle), publicKey: publicKey
    ).base64EncodedString()
  }

  public func encryptMessage(_ plaintext: String, channelKeyHandle: String) throws -> String {
    try ConcordCrypto.encryptMessage(plaintext, channelKey: try store.symmetric(channelKeyHandle))
      .base64EncodedString()
  }

  public func decryptMessage(_ ciphertextBase64: String, channelKeyHandle: String) throws -> String {
    try ConcordCrypto.decryptMessage(
      try decode(ciphertextBase64), channelKey: try store.symmetric(channelKeyHandle))
  }

  private func decode(_ base64: String) throws -> Data {
    guard let data = Data(base64Encoded: base64) else { throw ConcordCryptoError.invalidInput }
    return data
  }
}

/// Attachment files: downloaded ciphertext and decrypted plaintext, in one cache folder that is
/// emptied at sign-out and at every launch. Ciphertext never reaches JavaScript, and plaintext
/// only as a file URL. Files are NSFileProtectionComplete: unreadable while the phone is locked.
public final class ConcordAttachmentFiles {
  public let directory: URL
  private let configuration: URLSessionConfiguration
  private let lock = NSLock()
  private var running: URLSessionTask?

  public init(
    directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("concord-attachments", isDirectory: true),
    configuration: URLSessionConfiguration = .ephemeral
  ) {
    self.directory = directory
    // Ephemeral: nothing about the request or the response is cached or kept.
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    // A server that trickles bytes cannot hold the attachment queue for days.
    configuration.timeoutIntervalForResource = 30 * 60
    self.configuration = configuration
  }

  /// Downloads https `url` with `headers` into a new ciphertext file. Refuses redirects (the
  /// headers carry the session), any status but 200, and more than `maxBytes`.
  public func download(url: String, headers: [String: String], maxBytes: Int64) throws
    -> [String: Any]
  {
    guard let target = URL(string: url), target.scheme == "https", target.host?.isEmpty == false,
      target.user == nil, target.password == nil, maxBytes > 0
    else { throw ConcordCryptoError.invalidInput }
    try prepare()
    let id = UUID().uuidString
    let file = directory.appendingPathComponent("\(id).enc")
    guard
      FileManager.default.createFile(
        atPath: file.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete])
    else { throw ConcordCryptoError.network }
    var request = URLRequest(url: target)
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    let download = Download(handle: try FileHandle(forWritingTo: file), limit: maxBytes)
    let session = URLSession(configuration: configuration, delegate: download, delegateQueue: nil)
    let task = session.dataTask(with: request)
    lock.lock()
    running = task
    lock.unlock()
    task.resume()
    session.finishTasksAndInvalidate()
    download.done.wait()
    lock.lock()
    running = nil
    lock.unlock()
    try? download.handle.close()
    guard download.failure == nil, let response = download.response else {
      try? FileManager.default.removeItem(at: file)
      throw download.failure ?? ConcordCryptoError.network
    }
    return [
      "id": id,
      "size": NSNumber(value: download.written),
      "mimeType": response.value(forHTTPHeaderField: "X-File-Mime-Type") ?? NSNull(),
      "keyVersion": response.value(forHTTPHeaderField: "X-File-Key-Version") ?? NSNull(),
    ]
  }

  /// Decrypts download `id` to `<id>.<fileExtension>`. The ciphertext is removed either way.
  public func decrypt(id: String, key: SymmetricKey, fileExtension: String) throws -> [String: Any] {
    // Both name files, so both are checked strictly: no path can be smuggled in.
    guard UUID(uuidString: id)?.uuidString == id,
      fileExtension.range(of: "^[a-z0-9]{1,8}\\z", options: .regularExpression) != nil
    else { throw ConcordCryptoError.invalidInput }
    let input = directory.appendingPathComponent("\(id).enc")
    defer { try? FileManager.default.removeItem(at: input) }
    guard FileManager.default.fileExists(atPath: input.path) else {
      throw ConcordCryptoError.notFound
    }
    let output = directory.appendingPathComponent("\(id).\(fileExtension)")
    try ConcordAttachment.decrypt(at: input, to: output, key: key)
    let size = try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber
    return ["uri": output.absoluteString, "size": size ?? NSNumber(value: 0)]
  }

  /// Deletes every attachment file, ciphertext and plaintext.
  public func clear() {
    try? FileManager.default.removeItem(at: directory)
  }

  /// Stops the running download, if any; it then fails and leaves nothing behind. Callable from
  /// any thread, so sign-out need not wait for a large download before it clears the folder.
  public func cancel() {
    lock.lock()
    running?.cancel()
    lock.unlock()
  }

  /// A decrypted image's pixel size, read from its header without decoding it; zero when the
  /// file is not an image.
  public func imageSize(uri: String) throws -> [String: Any] {
    let source = CGImageSourceCreateWithURL(try plaintext(uri) as CFURL, nil)
    let properties =
      source.flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) } as? [CFString: Any]
    return [
      "width": properties?[kCGImagePropertyPixelWidth] as? Int ?? 0,
      "height": properties?[kCGImagePropertyPixelHeight] as? Int ?? 0,
    ]
  }

  /// Deletes one decrypted file.
  public func delete(uri: String) throws {
    // Validate outside try?, which would swallow the refusal along with a missing file.
    let file = try plaintext(uri)
    try? FileManager.default.removeItem(at: file)
  }

  /// The plaintext file behind a URI `decrypt` returned; anything else is refused.
  private func plaintext(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL, url.pathExtension != "enc" else {
      throw ConcordCryptoError.invalidInput
    }
    let file = url.standardizedFileURL
    guard file.deletingLastPathComponent().path == directory.standardizedFileURL.path else {
      throw ConcordCryptoError.invalidInput
    }
    return file
  }

  private func prepare() throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
  }
}

/// One capped download into a file. URLSession calls it on its own serial delegate queue.
private final class Download: NSObject, URLSessionDataDelegate {
  let handle: FileHandle
  let limit: Int64
  let done = DispatchSemaphore(value: 0)
  private(set) var written: Int64 = 0
  private(set) var response: HTTPURLResponse?
  private(set) var failure: ConcordCryptoError?

  init(handle: FileHandle, limit: Int64) {
    self.handle = handle
    self.limit = limit
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      failure = .network
      return completionHandler(.cancel)
    }
    // Content-Length is only a hint (-1 when absent); the byte count below is the real cap.
    guard http.expectedContentLength <= limit else {
      failure = .tooLarge
      return completionHandler(.cancel)
    }
    self.response = http
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil else { return }
    written += Int64(data.count)
    guard written <= limit else {
      failure = .tooLarge
      return dataTask.cancel()
    }
    do {
      try handle.write(contentsOf: data)
    } catch {
      failure = .network
      dataTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if error != nil, failure == nil { failure = .network }
    done.signal()
  }
}
