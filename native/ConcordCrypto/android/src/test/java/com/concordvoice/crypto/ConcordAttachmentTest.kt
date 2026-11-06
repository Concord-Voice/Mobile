package com.concordvoice.crypto

import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM port of Tests/ConcordAttachmentTests.swift, against the same attachment-vectors.json that
 * desktop's own attachmentChunkedCrypto.ts wrote. Every case expects the outcome desktop reached on
 * the same bytes. Synthetic keys only.
 */
class ConcordAttachmentTest {
  private val folder: File = Files.createTempDirectory("attachments").toFile()

  @After fun cleanUp() {
    folder.deleteRecursively()
  }

  /** The fixture's flat objects, field by field. A JSON library would be Android's stub here. */
  private class Vectors(text: String) {
    val fields = Regex("""\{[^{}]*\}""").findAll(text).map { block ->
      Regex(""""(\w+)":\s*("([^"]*)"|\d+)""").findAll(block.value).associate {
        it.groupValues[1] to (it.groupValues[3].ifEmpty { it.groupValues[2] })
      }
    }.toList()
    // The generator's synthetic keys, rebuilt from its formulas rather than stored in the fixture.
    val key = ByteArray(32) { ((it * 7 + 3) and 0xff).toByte() }
    val wrongKey = ByteArray(32) { ((it * 13 + 5) and 0xff).toByte() }
    val cases = fields.filter { "blobBase64" in it }
    val twoChunk = fields.filter { "blobSha256" in it }
  }

  private companion object {
    // Gradle runs unit tests from the module folder, native/ConcordCrypto/android.
    val vectors = Vectors(File("../Tests/attachment-vectors.json").readText())

    fun decode(base64: String): ByteArray = Base64.getDecoder().decode(base64)
  }

  private fun expect(failure: Failure, body: () -> Unit) {
    try {
      body()
    } catch (e: ConcordCryptoException) {
      assertEquals(failure, e.failure)
      return
    }
    fail("expected $failure")
  }

  /** Decrypts [blob] through the same file service the app uses. */
  private fun decryptBlob(blob: ByteArray, key: ByteArray): ByteArray {
    val files = ConcordAttachmentFiles(folder)
    val id = java.util.UUID.randomUUID().toString().uppercase()
    val input = File(folder, "$id.enc").apply { writeBytes(blob) }
    val output = File(folder, "$id.bin")
    try {
      val result = files.decrypt(id, key, "bin")
      assertEquals("file://${output.absolutePath}", result["uri"])
      return output.readBytes()
    } catch (e: ConcordCryptoException) {
      // Plaintext only survives success.
      assertFalse(output.exists())
      throw e
    } finally {
      // The ciphertext is always removed.
      assertFalse(input.exists())
    }
  }

  @Test fun everyDesktopVectorReachesDesktopsOutcome() {
    assertTrue(vectors.cases.size >= 20)
    for (c in vectors.cases) {
      val key = if (c["key"] == "right") vectors.key else vectors.wrongKey
      val blob = decode(c.getValue("blobBase64"))
      when (c["expect"]) {
        "ok" -> assertArrayEquals(c["id"], decode(c.getValue("plaintextBase64")), decryptBlob(blob, key))
        "integrity" -> expect(Failure.AUTHENTICATIONFAILED) { decryptBlob(blob, key) }
        "unsupported" -> expect(Failure.UNSUPPORTEDFORMAT) { decryptBlob(blob, key) }
        else -> fail("unknown expectation in ${c["id"]}")
      }
    }
  }

  /**
   * Two-chunk files are too big to commit, so each is rebuilt from its recipe. Matching desktop's
   * SHA-256 proves the header, chunk framing and AAD are byte-for-byte desktop's.
   */
  @Test fun twoChunkFilesMatchDesktopBytesAndDecrypt() {
    assertEquals(listOf("2", "3"), vectors.twoChunk.map { it["version"] })
    for (recipe in vectors.twoChunk) {
      val version = recipe.getValue("version").toInt()
      val plaintext = ByteArray(recipe.getValue("plaintextLength").toInt()) { (it % 251).toByte() }
      val nonce = recipe.getValue("nonceHex").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      val header = ConcordAttachment.Header(version, 0, ConcordAttachment.CHUNK_SIZE, 2, nonce)
      val first = ConcordAttachment.budget(version, ConcordAttachment.CHUNK_SIZE, 0).toInt()
      var blob = byteArrayOf(0x43, 0x56, version.toByte(), 0, 0x00, 0x80.toByte(), 0, 0, 0, 0, 0, 2) + nonce
      listOf(plaintext.copyOfRange(0, first), plaintext.copyOfRange(first, plaintext.size)).forEachIndexed { i, part ->
        val iv = ByteArray(12) { (0x10 + i).toByte() }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(vectors.key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(ConcordAttachment.aad(header, i.toLong()))
        blob += iv + cipher.doFinal(part)
      }
      assertEquals(recipe.getValue("blobLength").toInt(), blob.size)
      val digest = MessageDigest.getInstance("SHA-256").digest(blob).joinToString("") { "%02x".format(it) }
      assertEquals("v$version", recipe["blobSha256"], digest)
      assertArrayEquals(plaintext, decryptBlob(blob, vectors.key))

      // Dropping the last chunk breaks the length arithmetic: it reads as a legacy blob, which
      // cannot authenticate.
      expect(Failure.AUTHENTICATIONFAILED) { decryptBlob(blob.copyOfRange(0, 28 + 12 + first + 16), vectors.key) }
    }
  }

  @Test fun rejectsBadNamesAndMissingDownloads() {
    val files = ConcordAttachmentFiles(folder)
    val id = java.util.UUID.randomUUID().toString().uppercase()
    for ((badId, ext) in listOf("../x" to "bin", id.lowercase() to "bin", id to "../a", id to "BIN", id to "")) {
      expect(Failure.INVALIDINPUT) { files.decrypt(badId, ByteArray(32), ext) }
    }
    expect(Failure.NOTFOUND) { files.decrypt(id, ByteArray(32), "png") }
    // Only plaintext files in the folder can be shared.
    File(folder, "$id.png").writeBytes(ByteArray(1))
    File(folder, "$id.enc").writeBytes(ByteArray(1))
    assertEquals(File(folder, "$id.png").canonicalFile, files.fileFor("file://${folder.absolutePath}/$id.png"))
    for (uri in listOf("file://${folder.absolutePath}/$id.enc", "file://${folder.absolutePath}/../x", "https://h/a")) {
      assertEquals(null, files.fileFor(uri))
      expect(Failure.INVALIDINPUT) { files.delete(uri) }
    }
    // delete removes one plaintext file and leaves the rest.
    files.delete("file://${folder.absolutePath}/$id.png")
    assertFalse(File(folder, "$id.png").exists())
    assertTrue(File(folder, "$id.enc").exists())
  }

  @Test fun legacyBlobsOverTheCapAreRefused() {
    expect(Failure.TOOLARGE) { decryptBlob(ByteArray(ConcordAttachment.MAX_LEGACY_BYTES.toInt() + 1), ByteArray(32)) }
  }

  // MARK: Download, against canned responses; no network.

  /** One canned response. It records the request headers and whether redirects were allowed. */
  private class Canned(url: URL, val status: Int, val fields: Map<String, String>, val body: ByteArray) :
    HttpURLConnection(url) {
    val sent = mutableMapOf<String, String>()

    override fun connect() {}

    override fun disconnect() {}

    override fun usingProxy() = false

    override fun setRequestProperty(key: String, value: String) {
      sent[key] = value
    }

    override fun getResponseCode() = status

    override fun getContentLengthLong() = body.size.toLong()

    override fun getHeaderField(name: String): String? = fields[name]

    override fun getInputStream(): InputStream = body.inputStream()
  }

  private val connections = mutableListOf<Canned>()

  private fun serve(status: Int, fields: Map<String, String>, body: ByteArray) =
    ConcordAttachmentFiles(folder) { url -> Canned(url, status, fields, body).also { connections += it } }

  @Test fun downloadsWithHeadersAndReportsTheEpoch() {
    val files = serve(200, mapOf("X-File-Key-Version" to "3", "X-File-Mime-Type" to "image/png"), ByteArray(40))
    val result = files.download("https://api.example.test/api/v1/media/attachments/x", mapOf("Authorization" to "Bearer t"), 40)
    assertEquals("Bearer t", connections.single().sent["Authorization"])
    assertEquals("3", result["keyVersion"])
    assertEquals("image/png", result["mimeType"])
    assertEquals(40.0, result["size"])
    assertEquals(40L, File(folder, "${result["id"]}.enc").length())
    files.clear()
    assertFalse(folder.exists())
  }

  @Test fun downloadRefusesOversizeRedirectsAndPlainHttp() {
    expect(Failure.TOOLARGE) { serve(200, emptyMap(), ByteArray(41)).download("https://h.test/a", emptyMap(), 40) }
    val redirect = serve(302, mapOf("Location" to "https://elsewhere.test/"), ByteArray(0))
    expect(Failure.NETWORK) { redirect.download("https://h.test/a", emptyMap(), 40) }
    // The session headers never follow a redirect.
    assertFalse(connections.last().instanceFollowRedirects)
    for (url in listOf("http://h.test/a", "https://user:pw@h.test/a", "not a url")) { // pragma: allowlist secret
      expect(Failure.INVALIDINPUT) { redirect.download(url, emptyMap(), 40) }
    }
    // Nothing is left behind by a refused download.
    assertEquals(emptyList<String>(), folder.list()?.toList() ?: emptyList<String>())
  }
}
