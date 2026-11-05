import CryptoKit
import Foundation
import XCTest

@testable import ConcordCrypto

/// Attachment decryption against attachment-vectors.json, which desktop's own
/// attachmentChunkedCrypto.ts wrote (scripts/generate-attachment-vectors.mjs). Every case expects
/// the outcome desktop itself reached on the same bytes. Synthetic keys only.
final class ConcordAttachmentTests: XCTestCase {
  private struct Vectors: Decodable {
    struct Case: Decodable {
      let id: String
      let key: String
      let expect: String
      let blobBase64: String
      let plaintextBase64: String?
    }

    struct TwoChunk: Decodable {
      let version: UInt8
      let plaintextLength: Int
      let nonceHex: String
      let blobLength: Int
      let blobSha256: String
    }

    let cases: [Case]
    let twoChunk: [TwoChunk]
  }

  private var folder: URL!

  override func setUpWithError() throws {
    folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: folder)
  }

  private func vectors() throws -> Vectors {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("attachment-vectors.json")
    return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
  }

  /// The generator's synthetic keys, rebuilt from its formulas rather than stored in the fixture.
  private static let rightKey = SymmetricKey(data: Data((0..<32).map { UInt8(($0 * 7 + 3) & 0xff) }))
  private static let wrongKey = SymmetricKey(data: Data((0..<32).map { UInt8(($0 * 13 + 5) & 0xff) }))

  /// Decrypts `blob` through the same file service the app uses; returns plaintext or the error.
  private func open(_ blob: Data, key: SymmetricKey) -> Result<Data, Error> {
    let files = ConcordAttachmentFiles(directory: folder)
    let id = UUID().uuidString
    let input = folder.appendingPathComponent("\(id).enc")
    let output = folder.appendingPathComponent("\(id).bin")
    return Result {
      try blob.write(to: input)
      defer {
        // The ciphertext is always removed; plaintext only survives success.
        XCTAssertFalse(FileManager.default.fileExists(atPath: input.path))
      }
      do {
        let result = try files.decrypt(id: id, key: key, fileExtension: "bin")
        XCTAssertEqual(result["uri"] as? String, output.absoluteString)
        return try Data(contentsOf: output)
      } catch {
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
        throw error
      }
    }
  }

  func testEveryDesktopVectorReachesDesktopsOutcome() throws {
    let v = try vectors()
    XCTAssertGreaterThanOrEqual(v.cases.count, 20)
    for c in v.cases {
      let blob = try XCTUnwrap(Data(base64Encoded: c.blobBase64), c.id)
      let outcome = open(blob, key: c.key == "right" ? Self.rightKey : Self.wrongKey)
      switch (c.expect, outcome) {
      case ("ok", .success(let plaintext)):
        XCTAssertEqual(plaintext, Data(base64Encoded: c.plaintextBase64 ?? ""), c.id)
      case ("integrity", .failure(let error)):
        XCTAssertEqual(error as? ConcordCryptoError, .authenticationFailed, c.id)
      case ("unsupported", .failure(let error)):
        XCTAssertEqual(error as? ConcordCryptoError, .unsupportedFormat, c.id)
      default:
        XCTFail("\(c.id): expected \(c.expect), got \(outcome)")
      }
    }
  }

  /// Two-chunk files are too big to commit, so each is rebuilt here from its recipe. Matching
  /// desktop's SHA-256 proves the header, chunk framing and AAD are byte-for-byte desktop's.
  func testTwoChunkFilesMatchDesktopBytesAndDecrypt() throws {
    let v = try vectors()
    let key = Self.rightKey
    XCTAssertEqual(v.twoChunk.map(\.version), [2, 3])
    for recipe in v.twoChunk {
      let plaintext = Data((0..<recipe.plaintextLength).map { UInt8($0 % 251) })
      let nonce = Data(stride(from: 0, to: 32, by: 2).map {
        UInt8(recipe.nonceHex.dropFirst($0).prefix(2), radix: 16)!
      })
      let header = ConcordAttachment.Header(
        version: recipe.version, flags: 0, chunkSize: UInt32(ConcordAttachment.chunkSize),
        totalChunks: 2, nonce: nonce)
      var blob = Data([0x43, 0x56, recipe.version, 0, 0x00, 0x80, 0x00, 0x00, 0, 0, 0, 2]) + nonce
      let first = Int(
        ConcordAttachment.budget(
          version: recipe.version, chunkSize: ConcordAttachment.chunkSize, index: 0))
      for (index, part) in [plaintext.prefix(first), plaintext.dropFirst(first)].enumerated() {
        let iv = Data(repeating: 0x10 + UInt8(index), count: 12)
        let box = try AES.GCM.seal(
          part, using: key, nonce: AES.GCM.Nonce(data: iv),
          authenticating: ConcordAttachment.aad(header, index: UInt32(index)))
        blob += iv + box.ciphertext + box.tag
      }
      XCTAssertEqual(blob.count, recipe.blobLength)
      let digest = SHA256.hash(data: blob).map { String(format: "%02x", $0) }.joined()
      XCTAssertEqual(digest, recipe.blobSha256, "v\(recipe.version)")
      XCTAssertEqual(try open(blob, key: key).get(), plaintext, "v\(recipe.version)")

      // Dropping the last chunk breaks the length arithmetic: it reads as a legacy blob, which
      // cannot authenticate.
      let truncated = blob.prefix(28 + 12 + first + 16)
      XCTAssertThrowsError(try open(truncated, key: key).get()) {
        XCTAssertEqual($0 as? ConcordCryptoError, .authenticationFailed)
      }
    }
  }

  func testRejectsBadNamesAndMissingDownloads() throws {
    let files = ConcordAttachmentFiles(directory: folder)
    let key = SymmetricKey(size: .bits256)
    for (id, ext) in [
      ("../x", "bin"), (UUID().uuidString.lowercased(), "bin"), (UUID().uuidString, "../a"),
      (UUID().uuidString, "BIN"), (UUID().uuidString, ""),
    ] {
      XCTAssertThrowsError(try files.decrypt(id: id, key: key, fileExtension: ext)) {
        XCTAssertEqual($0 as? ConcordCryptoError, .invalidInput)
      }
    }
    XCTAssertThrowsError(try files.decrypt(id: UUID().uuidString, key: key, fileExtension: "png")) {
      XCTAssertEqual($0 as? ConcordCryptoError, .notFound)
    }
  }

  func testLegacyBlobsOverTheCapAreRefused() throws {
    let blob = Data(count: Int(ConcordAttachment.maxLegacyBytes) + 1)
    XCTAssertThrowsError(try open(blob, key: SymmetricKey(size: .bits256)).get()) {
      XCTAssertEqual($0 as? ConcordCryptoError, .tooLarge)
    }
  }

  // MARK: Download

  private func session(_ handler: @escaping (URLRequest) -> (Int, [String: String], Data))
    -> ConcordAttachmentFiles
  {
    StubProtocol.handler = handler
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return ConcordAttachmentFiles(directory: folder, configuration: configuration)
  }

  func testDownloadsWithHeadersAndReportsTheEpoch() throws {
    var seen: URLRequest?
    let files = session { request in
      seen = request
      return (200, ["X-File-Key-Version": "3", "X-File-Mime-Type": "image/png"], Data(count: 40))
    }
    let result = try files.download(
      url: "https://api.example.test/api/v1/media/attachments/x",
      headers: ["Authorization": "Bearer t"], maxBytes: 40)
    XCTAssertEqual(seen?.value(forHTTPHeaderField: "Authorization"), "Bearer t")
    XCTAssertEqual(result["keyVersion"] as? String, "3")
    XCTAssertEqual(result["mimeType"] as? String, "image/png")
    XCTAssertEqual((result["size"] as? NSNumber)?.int64Value, 40)
    let id = try XCTUnwrap(result["id"] as? String)
    let file = folder.appendingPathComponent("\(id).enc")
    XCTAssertEqual(try Data(contentsOf: file).count, 40)
    files.clear()
    XCTAssertFalse(FileManager.default.fileExists(atPath: folder.path))
  }

  func testDownloadRefusesOversizeBadStatusAndPlainHttp() throws {
    let big = session { _ in (200, [:], Data(count: 41)) }
    XCTAssertThrowsError(try big.download(url: "https://h.test/a", headers: [:], maxBytes: 40)) {
      XCTAssertEqual($0 as? ConcordCryptoError, .tooLarge)
    }
    let refused = session { _ in (302, ["Location": "https://elsewhere.test/"], Data()) }
    XCTAssertThrowsError(try refused.download(url: "https://h.test/a", headers: [:], maxBytes: 40)) {
      XCTAssertEqual($0 as? ConcordCryptoError, .network)
    }
    for url in ["http://h.test/a", "https://user:pw@h.test/a", "not a url"] {  // pragma: allowlist secret
      XCTAssertThrowsError(try refused.download(url: url, headers: [:], maxBytes: 40)) {
        XCTAssertEqual($0 as? ConcordCryptoError, .invalidInput)
      }
    }
    // Nothing is left behind by a refused download.
    let left = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    XCTAssertEqual(left, [])
  }
}

/// Serves canned responses to the download tests; no network.
private final class StubProtocol: URLProtocol {
  static var handler: ((URLRequest) -> (Int, [String: String], Data))?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let handler = Self.handler, let url = request.url else { return }
    let (status, headers, body) = handler(request)
    let response = HTTPURLResponse(
      url: url, statusCode: status, httpVersion: "HTTP/1.1",
      headerFields: headers.merging(["Content-Length": "\(body.count)"]) { a, _ in a })!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}
