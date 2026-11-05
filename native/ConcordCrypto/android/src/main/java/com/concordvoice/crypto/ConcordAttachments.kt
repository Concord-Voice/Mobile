package com.concordvoice.crypto

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.net.URLConnection
import java.security.GeneralSecurityException
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Desktop attachment files, matching client/desktop/src/renderer/utils/crypto/
 * attachmentChunkedCrypto.ts (v2 and v3 chunked envelopes) and attachmentCrypto.ts (legacy
 * single-shot blobs), and the iOS ConcordAttachment byte for byte. Decrypts file to file, one
 * chunk in memory at a time.
 */
object ConcordAttachment {
  const val HEADER_LENGTH = 28
  /** IV and tag around every chunk. */
  const val CHUNK_OVERHEAD = 28
  const val CHUNK_SIZE = 8_388_608L
  /** A legacy blob is one AES-GCM message, so it decrypts in memory; refuse very large ones. */
  const val MAX_LEGACY_BYTES = 32L * 1024 * 1024

  class Header(val version: Int, val flags: Int, val chunkSize: Long, val totalChunks: Long, val nonce: ByteArray)

  sealed interface Kind {
    object Legacy : Kind

    object Unsupported : Kind

    class Chunked(val header: Header) : Kind
  }

  /** v3's chunk 0 gives up the header's 28 bytes; that is the whole difference from v2. */
  fun budget(version: Int, chunkSize: Long, index: Long): Long =
    chunkSize - if (index == 0L && version == 3) HEADER_LENGTH.toLong() else 0L

  fun chunkCount(version: Int, chunkSize: Long, plaintext: Long): Long {
    val first = budget(version, chunkSize, 0)
    if (plaintext <= first) return 1
    return 1 + (plaintext - first + chunkSize - 1) / chunkSize
  }

  /**
   * classifyEnvelope: no trial decryption. The length arithmetic, not the "CV" magic, tells a
   * chunked envelope from a legacy blob whose random IV happens to start with "CV".
   */
  fun classify(head: ByteArray, total: Long): Kind {
    if (head.size < HEADER_LENGTH || head[0] != 0x43.toByte() || head[1] != 0x56.toByte()) return Kind.Legacy
    val version = head[2].toInt() and 0xff
    val flags = head[3].toInt() and 0xff
    val size = be32(head, 4)
    val chunks = be32(head, 8)
    if (size < 1 || chunks < 1) return Kind.Legacy
    val body = total - HEADER_LENGTH - CHUNK_OVERHEAD * chunks
    if (body < 1) return Kind.Legacy
    val supported = version == 2 || version == 3
    val families = if (supported) listOf(version) else listOf(2, 3)
    if (families.none { chunkCount(it, size, body) == chunks }) return Kind.Legacy
    if (!supported || flags != 0 || size != CHUNK_SIZE) return Kind.Unsupported
    return Kind.Chunked(Header(version, flags, size, chunks, head.copyOfRange(12, HEADER_LENGTH)))
  }

  /** buildChunkAad: "CVA2"/"CVA3", version, flags, nonce, chunk index, chunk count, chunk size. */
  fun aad(header: Header, index: Long): ByteArray =
    byteArrayOf(0x43, 0x56, 0x41, (0x30 + header.version).toByte(), header.version.toByte(), header.flags.toByte()) +
      header.nonce +
      be32(index) +
      be32(header.totalChunks) +
      be32(header.chunkSize)

  private fun be32(bytes: ByteArray, at: Int): Long =
    (0 until 4).fold(0L) { value, i -> (value shl 8) or (bytes[at + i].toLong() and 0xff) }

  private fun be32(value: Long): ByteArray = ByteArray(4) { i -> (value shr (24 - 8 * i)).toByte() }

  /**
   * decryptAttachmentBlob, file to file. Fails closed: any failure deletes the output, so no
   * unauthenticated plaintext is left behind. Tampering, truncation and a wrong key are all
   * AUTHENTICATIONFAILED; a newer format is UNSUPPORTEDFORMAT.
   */
  fun decrypt(input: File, output: File, key: ByteArray) {
    if (key.size != ConcordCrypto.KEY_LENGTH) fail(Failure.INVALIDINPUT)
    RandomAccessFile(input, "r").use { reader ->
      val total = reader.length()
      val head = ByteArray(minOf(total, HEADER_LENGTH.toLong()).toInt()).also(reader::readFully)
      val kind = classify(head, total)
      if (kind is Kind.Unsupported) fail(Failure.UNSUPPORTEDFORMAT)
      if (kind is Kind.Legacy && total > MAX_LEGACY_BYTES) fail(Failure.TOOLARGE)
      var finished = false
      try {
        FileOutputStream(output).use { writer ->
          when (kind) {
            is Kind.Chunked -> decryptChunks(reader, writer, kind.header, total, key)
            else -> {
              val blob = ByteArray(total.toInt())
              reader.seek(0)
              reader.readFully(blob)
              // A damaged chunked envelope also lands here; either way it fails authentication.
              if (blob.size < ConcordCrypto.IV_LENGTH + ConcordCrypto.TAG_LENGTH) fail(Failure.AUTHENTICATIONFAILED)
              val plaintext = ConcordCrypto.open(blob, key)
              try {
                writer.write(plaintext)
              } finally {
                plaintext.fill(0)
              }
            }
          }
        }
        finished = true
      } finally {
        if (!finished) output.delete()
      }
    }
  }

  private fun decryptChunks(reader: RandomAccessFile, writer: FileOutputStream, header: Header, total: Long, key: ByteArray) {
    var offset = HEADER_LENGTH.toLong()
    for (index in 0 until header.totalChunks) {
      val sealedLength =
        if (index == header.totalChunks - 1) total - offset - ConcordCrypto.IV_LENGTH
        else budget(header.version, header.chunkSize, index) + ConcordCrypto.TAG_LENGTH
      if (sealedLength < ConcordCrypto.TAG_LENGTH) fail(Failure.AUTHENTICATIONFAILED)
      val iv = ByteArray(ConcordCrypto.IV_LENGTH)
      val sealed = ByteArray(sealedLength.toInt())
      reader.seek(offset)
      reader.readFully(iv)
      reader.readFully(sealed)
      offset += ConcordCrypto.IV_LENGTH + sealedLength
      val plaintext =
        try {
          Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(ConcordCrypto.TAG_LENGTH * 8, iv))
            updateAAD(aad(header, index))
            doFinal(sealed)
          }
        } catch (_: GeneralSecurityException) {
          fail(Failure.AUTHENTICATIONFAILED)
        }
      try {
        writer.write(plaintext)
      } finally {
        plaintext.fill(0)
      }
    }
  }
}

/**
 * Attachment files: downloaded ciphertext and decrypted plaintext, in one cache folder that is
 * emptied at sign-out and at every launch. Ciphertext never reaches JavaScript, and plaintext only
 * as a file URI. [open] is swapped by the JVM tests, which serve plain http locally.
 */
class ConcordAttachmentFiles(
  val directory: File,
  private val open: (URL) -> URLConnection = { it.openConnection() },
) {
  /**
   * Downloads https [url] with [headers] into a new ciphertext file. Refuses redirects (the headers
   * carry the session), any status but 200, and more than [maxBytes].
   */
  fun download(url: String, headers: Map<String, String>, maxBytes: Long): Map<String, Any?> {
    val target =
      try {
        URL(url)
      } catch (_: MalformedURLException) {
        fail(Failure.INVALIDINPUT)
      }
    if (target.protocol != "https" || target.host.isNullOrEmpty() || target.userInfo != null || maxBytes < 1) {
      fail(Failure.INVALIDINPUT)
    }
    if (!directory.isDirectory && !directory.mkdirs()) fail(Failure.NETWORK)
    val id = UUID.randomUUID().toString().uppercase()
    val file = File(directory, "$id.enc")
    var finished = false
    val connection =
      try {
        open(target) as? HttpURLConnection ?: fail(Failure.INVALIDINPUT)
      } catch (_: IOException) {
        fail(Failure.NETWORK)
      }
    try {
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.connectTimeout = 15_000
      connection.readTimeout = 60_000
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (connection.responseCode != HttpURLConnection.HTTP_OK) fail(Failure.NETWORK)
      // Content-Length is only a hint (-1 when absent); the byte count below is the real cap.
      if (connection.contentLengthLong > maxBytes) fail(Failure.TOOLARGE)
      var written = 0L
      connection.inputStream.use { input ->
        FileOutputStream(file).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            written += read
            if (written > maxBytes) fail(Failure.TOOLARGE)
            output.write(buffer, 0, read)
          }
        }
      }
      finished = true
      return mapOf(
        "id" to id,
        "size" to written.toDouble(),
        "mimeType" to connection.getHeaderField("X-File-Mime-Type"),
        "keyVersion" to connection.getHeaderField("X-File-Key-Version"),
      )
    } catch (_: IOException) {
      fail(Failure.NETWORK)
    } finally {
      connection.disconnect()
      if (!finished) file.delete()
    }
  }

  /** Decrypts download [id] to `<id>.<fileExtension>`. The ciphertext is deleted either way. */
  fun decrypt(id: String, key: ByteArray, fileExtension: String): Map<String, Any> {
    // Both name files, so both are checked strictly: no path can be smuggled in.
    if (!UUID_PATTERN.matches(id) || !EXTENSION.matches(fileExtension)) fail(Failure.INVALIDINPUT)
    val input = File(directory, "$id.enc")
    try {
      if (!input.isFile) fail(Failure.NOTFOUND)
      val output = File(directory, "$id.$fileExtension")
      ConcordAttachment.decrypt(input, output, key)
      return mapOf("uri" to "file://${output.absolutePath}", "size" to output.length().toDouble())
    } finally {
      input.delete()
    }
  }

  /** Deletes every attachment file, ciphertext and plaintext. */
  fun clear() {
    directory.deleteRecursively()
  }

  /** The plaintext file behind a URI this class returned, or null for anything else. */
  fun fileFor(uri: String): File? {
    if (!uri.startsWith("file://")) return null
    val file = File(uri.removePrefix("file://")).canonicalFile
    return file.takeIf { it.parentFile == directory.canonicalFile && it.isFile && !it.name.endsWith(".enc") }
  }

  private companion object {
    val UUID_PATTERN = Regex("^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$")
    val EXTENSION = Regex("^[a-z0-9]{1,8}$")
  }
}
