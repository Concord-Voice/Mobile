package com.concordvoice.crypto

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/** Test-only ADR-0051 adapter; runs with the actual vendored Argon2 JNI library on Android. */
@RunWith(AndroidJUnit4::class)
class NonmediaVectorInstrumentedTest {
  private val pin = "4a16bb107203d840152ce432bcbeda286c7ecb79b2b519713eebb2d3701589433f54fad511d0e52b439ea230d49833e2"
  private val generatorPin = "73594b0ff16df7b20976ce1e22cf7b6bb82a7ec0af783bfe896805e8b560339c600fa93a68eaa651874a8850ea0938bd"
  private val names = mapOf(
    "message-v1" to listOf("realm", "scope", "scope_id", "message_id", "sender_id", "key_epoch", "content_kind"),
    "blob-v1" to listOf("realm", "account_id", "blob_purpose", "schema_version"),
    "account-ek-wrap-v1" to listOf("realm", "account_id", "key_purpose", "account_key_generation", "credential_generation"),
    "recovery-wrap-v1" to listOf("realm", "account_id", "key_purpose", "recovery_purpose", "recovery_key_generation", "account_key_generation"),
    "recovery-prefs-wrap-v1" to listOf("realm", "account_id", "key_purpose", "recovery_purpose", "recovery_key_generation", "credential_generation"),
    "attachment-v4" to listOf("realm", "scope", "scope_id", "file_id", "uploader_id", "key_epoch", "file_nonce_b64", "flags", "chunk_index", "total_chunks", "chunk_size"),
    "channel-key-capsule-v1" to listOf("realm", "scope", "scope_id", "key_epoch", "recipient_id", "recipient_key_generation", "distributor_id", "distributor_root_digest_b64"),
  )
  private val formatTags = mapOf(
    "m1" to "message-v1", "b1" to "blob-v1", "ek1" to "account-ek-wrap-v1",
    "rw1-private" to "recovery-wrap-v1", "rw1-preferences" to "recovery-prefs-wrap-v1",
    "attachment-v4" to "attachment-v4",
  )
  private fun sha384(data: ByteArray) = MessageDigest.getInstance("SHA-384").digest(data).joinToString("") { "%02x".format(it) }
  private fun b64(data: ByteArray) = Base64.encodeToString(data, Base64.NO_WRAP)
  private fun unb64(text: String): ByteArray {
    val data = Base64.decode(text, Base64.DEFAULT)
    require(b64(data) == text) { "noncanonical base64" }
    return data
  }
  private fun bytes(o: JSONObject, key: String) = unb64(o.getString(key))
  private fun corpus(): Pair<ByteArray, JSONArray> {
    val data = InstrumentationRegistry.getInstrumentation().context.assets.open("nonmedia-e2ee-v1-vectors.json").use { it.readBytes() }
    assertEquals(pin, sha384(data))
    val root = JSONObject(String(data, Charsets.US_ASCII))
    assertEquals("concord-nonmedia-e2ee-vectors", root.getString("schema"))
    assertEquals(1, root.getInt("version"))
    assertEquals(generatorPin, root.getString("generator_sha384"))
    val boundary = data.indexOf(10.toByte())
    assertTrue(boundary >= 0)
    assertEquals(root.getString("vectors_sha384"), sha384(data.copyOfRange(boundary + 1, data.size)))
    val cases = root.getJSONArray("vectors")
    assertEquals(672, cases.length())
    return data to cases
  }
  private fun fields(a: JSONArray) = (0 until a.length()).map { a.get(it) }
  private fun context(tag: String, values: List<Any>): ByteArray {
    val array = JSONArray().put("concord-e2ee-context").put(1).put(tag)
    values.forEach(array::put)
    // Android's JSONStringer escapes '/', but the pinned wire format does not.
    return array.toString().replace("\\/", "/").toByteArray(Charsets.US_ASCII)
  }
  private fun parseContext(data: ByteArray): Pair<String, List<Any>> {
    val array = JSONArray(String(data, Charsets.UTF_8))
    require(array.getString(0) == "concord-e2ee-context" && array.getInt(1) == 1)
    val tag = array.getString(2)
    require(array.length() == (names[tag]?.size ?: -100) + 3)
    val values = (3 until array.length()).map { array.get(it) }
    require(context(tag, values).contentEquals(data))
    return tag to values
  }
  private fun exactInt(value: Any): Long? {
    val n = value as? Number ?: return null
    val d = n.toDouble()
    if (!d.isFinite() || d != n.toLong().toDouble()) return null
    return n.toLong()
  }
  private fun validContext(tag: String, values: List<Any>): Boolean {
    val fieldNames = names[tag] ?: return false
    if (fieldNames.size != values.size) return false
    fieldNames.forEachIndexed { index, name ->
      val value = values[index]
      if (name == "scope") {
        if (value !in listOf("channel", "dm")) return false
      } else if (name == "content_kind") {
        if (value != "message-body") return false
      } else if (name == "blob_purpose") {
        if (value !in listOf("preferences", "saved_gifs", "friend_organization", "presence_overrides")) return false
      } else if (name == "key_purpose") {
        val expected = if (tag == "recovery-prefs-wrap-v1") "preferences-aes256-gcm" else "account-rsa-oaep4096-pss-sha256"
        if (value != expected) return false
      } else if (name == "recovery_purpose") {
        if (value != "user-account-recovery-key") return false
      } else if (name == "schema_version") {
        if (exactInt(value) != 1L) return false
      } else if (name == "flags") {
        if (exactInt(value) != 0L) return false
      } else if (name == "chunk_size") {
        if (exactInt(value) != 8388608L) return false
      } else if (name == "total_chunks") {
        if ((exactInt(value) ?: -1L) !in 1L..10000L) return false
      } else if (name == "chunk_index") {
        if ((exactInt(value) ?: -1L) !in 0L until (exactInt(values[fieldNames.indexOf("total_chunks")]) ?: 0L)) return false
      } else if (name == "file_nonce_b64") {
        if (runCatching { unb64(value as String).size }.getOrNull() != 16) return false
      } else if (name == "distributor_root_digest_b64") {
        if (runCatching { unb64(value as String).size }.getOrNull() != 48) return false
      } else if (name == "key_epoch" || name.endsWith("generation")) {
        if ((exactInt(value) ?: -1L) !in 1L..9007199254740991L) return false
      } else if (name in listOf("realm", "account_id", "scope_id", "message_id", "sender_id", "file_id", "uploader_id", "recipient_id", "distributor_id")) {
        if (value !is String || !Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(value)) return false
      }
    }
    return true
  }
  private fun scalarString(hex: String): String? {
    if (hex.length % 4 != 0 || !Regex("^[0-9a-f]*$").matches(hex)) return null
    val units = hex.chunked(4).map { it.toInt(16).toChar() }
    var i = 0
    while (i < units.size) {
      if (Character.isHighSurrogate(units[i])) {
        if (i + 1 >= units.size || !Character.isLowSurrogate(units[i + 1])) return null
        i += 2
      } else if (Character.isLowSurrogate(units[i])) return null
      else i++
    }
    return String(units.toCharArray())
  }
  private fun hmac(data: ByteArray, key: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256")); doFinal(data)
  }
  private fun expand(prk: ByteArray, label: String) = hmac(label.toByteArray(Charsets.US_ASCII) + byteArrayOf(0, 1), prk)
  private fun seal(plain: ByteArray, key: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
    init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)); updateAAD(aad); doFinal(plain)
  }
  private fun openAead(sealed: ByteArray, key: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
    require(sealed.size >= 16 && nonce.size == 12 && key.size == 32)
    init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)); updateAAD(aad); doFinal(sealed)
  }
  private fun wire(format: String, nonce: ByteArray, sealed: ByteArray, fields: List<Any>): ByteArray {
    if (format == "attachment-v4") {
      val header = ByteArray(28); header[0] = 'C'.code.toByte(); header[1] = 'V'.code.toByte(); header[2] = 4
      ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN).putInt(4, 8388608).putInt(8, 1)
      unb64(fields[6] as String).copyInto(header, 12)
      return header + nonce + sealed
    }
    val prefix = if (format.startsWith("rw1-")) "rw1:" else "$format:"
    return (prefix + b64(nonce + sealed)).toByteArray(Charsets.US_ASCII)
  }
  private fun splitWire(format: String, wire: ByteArray): Pair<ByteArray, ByteArray> {
    val payload = if (format == "attachment-v4") {
      require(wire.size >= 56 && wire[0] == 'C'.code.toByte() && wire[1] == 'V'.code.toByte() && wire[2] == 4.toByte())
      wire.copyOfRange(28, wire.size)
    } else {
      val prefix = if (format.startsWith("rw1-")) "rw1:" else "$format:"
      val text = String(wire, Charsets.US_ASCII)
      require(text.startsWith(prefix)); unb64(text.substring(prefix.length))
    }
    require(payload.size >= 28)
    return payload.copyOfRange(0, 12) to payload.copyOfRange(12, payload.size)
  }

  @Test fun pinnedCorpusAndAllAcceptedCases() {
    assertEquals(
      "[\"concord-e2ee-context\",1,\"attachment-v4\",\"a/b\"]",
      String(context("attachment-v4", listOf("a/b")), Charsets.US_ASCII),
    )
    val (_, vectors) = corpus()
    val caseNames = (0 until vectors.length()).map { vectors.getJSONObject(it).getString("name") }
    assertEquals(vectors.length(), caseNames.toSet().size)
    var legacyMatrices = 0; var upgradeMatrices = 0
    val uniform = mutableListOf<String>()
    for (i in 0 until vectors.length()) {
      val v = vectors.getJSONObject(i); val expectation = v.getJSONObject("expect")
      if (expectation.getString("verdict") != "accept") continue
      val name = v.getString("name"); val input = v.getJSONObject("input"); val out = expectation.getJSONObject("outputs")
      when (v.getString("suite") to v.getString("operation")) {
        "credential" to "password-scalars" -> assertEquals(name, out.getString("password_utf8_b64"), b64(requireNotNull(scalarString(input.getString("utf16_units_hex"))).toByteArray(Charsets.UTF_8)))
        "credential" to "derive" -> {
          val password = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes(input, "password_utf8_b64"))).toString()
          val root = ConcordCrypto.deriveArgon2id(password, bytes(input, "salt_b64")) // real JNI, never a JVM stand-in
          assertEquals(name, out.getString("root_b64"), b64(root))
          val bind = "concord-credential-bind-v1\u0000".toByteArray(Charsets.US_ASCII) + input.getString("realm").toByteArray(Charsets.US_ASCII) + bytes(input, "subject_b64") + ByteBuffer.allocate(8).putLong(input.getLong("generation")).array()
          val prk = hmac(root, bind)
          assertEquals(name, out.getString("auth_b64"), Base64.encodeToString(expand(prk, "concord-auth-secret-v1"), Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING))
          assertEquals(name, out.getString("wrap_b64"), b64(expand(prk, "concord-wrap-key-v1")))
          assertEquals(name, out.getString("prefs_b64"), b64(expand(prk, "concord-prefs-key-v1")))
        }
        "credential" to "descriptor" -> {
          val d = JSONArray(String(bytes(input, "descriptor_b64"), Charsets.US_ASCII))
          assertEquals(name, "split-auth-wrap-v1", d.getString(0))
          assertEquals(name, out.getString("realm"), d.getString(1))
          assertEquals(name, out.getString("subject_b64"), d.getString(2))
          assertEquals(name, out.getLong("generation"), d.getLong(3))
          assertEquals(name, out.getString("salt_b64"), d.getString(4))
          assertEquals(name, out.getInt("m_kib"), d.getInt(5))
          assertEquals(name, out.getInt("t"), d.getInt(6))
          assertEquals(name, out.getInt("p"), d.getInt(7))
        }
        "context" to "encode" -> {
          val tag = input.getString("tag"); val values = fields(input.getJSONArray("context_fields"))
          assertTrue(name, validContext(tag, values)); assertEquals(name, out.getString("context_b64"), b64(context(tag, values)))
        }
        "context" to "parse" -> {
          val (tag, values) = parseContext(bytes(input, "context_b64"))
          assertTrue(name, validContext(tag, values)); assertEquals(name, out.getString("tag"), tag)
          assertEquals(name, out.getJSONArray("context_fields").toString(), JSONArray(values).toString())
        }
        "rsa-label" to "derive" -> assertEquals(name, out.getString("label_b64"), b64(context("channel-key-capsule-v1", fields(input.getJSONArray("context_fields")))))
        "rsa-label" to "verify" -> assertArrayEquals(name, context("channel-key-capsule-v1", fields(input.getJSONArray("context_fields"))), bytes(input, "candidate_label_b64"))
        "aead" to "encrypt" -> {
          val format = input.getString("format"); val (tag, values) = parseContext(bytes(input, "context_b64"))
          assertEquals(name, formatTags[format], tag)
          val sealed = seal(bytes(input, "plaintext_b64"), bytes(input, "key_b64"), bytes(input, "nonce_b64"), bytes(input, "context_b64"))
          assertEquals(name, out.getString("envelope_b64"), b64(wire(format, bytes(input, "nonce_b64"), sealed, values)))
        }
        "aead" to "decrypt" -> {
          val format = input.getString("format"); val (tag, _) = parseContext(bytes(input, "expected_context_b64"))
          assertEquals(name, formatTags[format], tag)
          val (nonce, sealed) = splitWire(format, bytes(input, "envelope_b64"))
          assertEquals(name, out.getString("plaintext_b64"), b64(openAead(sealed, bytes(input, "key_b64"), nonce, bytes(input, "expected_context_b64"))))
        }
        "policy" to "legacy-continuation" -> { assertEquals(name, legacyDecision(input), out.getString("decision") to out.getString("reason")); if (name.contains("/matrix/")) legacyMatrices++ }
        "policy" to "upgrade-outcome" -> { assertEquals(name, upgradeDecision(input), out.getString("decision") to out.getString("reason")); if (name.contains("/matrix/")) upgradeMatrices++ }
        "policy" to "descriptor-uniformity" -> {
          val descriptor = bytes(input, "descriptor_b64"); val d = JSONArray(String(descriptor, Charsets.US_ASCII))
          assertEquals(name, 8, d.length()); assertEquals(name, 65536, d.getInt(5))
          assertFalse(name, String(descriptor, Charsets.US_ASCII).contains(input.getString("probe_public_account_uuid")))
          uniform.add(out.toString())
        }
        else -> fail("unknown accepted case $name")
      }
    }
    assertEquals(384, legacyMatrices); assertEquals(96, upgradeMatrices)
    assertEquals(3, uniform.size); assertEquals(uniform[0], uniform[1]); assertEquals(uniform[0], uniform[2])
  }
  private fun legacyDecision(i: JSONObject): Pair<String, String> = when {
    i.getString("account_protocol") != "legacy" -> "deny" to "not-legacy"
    i.getString("authority_proof") == "absent" -> "deny" to "missing-authority-proof"
    i.getString("authority_proof") == "invalid" -> "deny" to "invalid-authority-proof"
    i.getString("freshness") != "current" -> "deny" to "stale-authority-proof"
    !i.getBoolean("account_match") -> "deny" to "wrong-account"
    !i.getBoolean("realm_match") -> "deny" to "wrong-realm"
    !i.getBoolean("not_expired") -> "deny" to "expired-proof"
    !i.getBoolean("control_plane_continuation") -> "deny" to "no-continuation"
    else -> "submit-raw-password" to "eligible"
  }
  private fun upgradeDecision(i: JSONObject): Pair<String, String> = when {
    i.getString("commit_state") == "ambiguous" -> "reconcile" to "ambiguous-commit"
    !i.getBoolean("mfa_complete") -> "deny" to "mfa-required"
    i.getString("commit_state") == "committed" -> if (i.getString("prior_state") == "split" && i.getString("authorization_state") == "consumed") {
      if (i.getBoolean("request_match")) "idempotent" to "replay" else "conflict" to "request-conflict"
    } else "reconcile" to "ambiguous-commit"
    i.getString("prior_state") == "split" -> "deny" to "not-legacy"
    i.getString("authorization_state") == "consumed" -> "reconcile" to "ambiguous-commit"
    i.getString("authorization_state") == "expired" -> "deny" to "expired-authorization"
    i.getString("authorization_state") == "absent" -> "deny" to "missing-authorization"
    !i.getBoolean("request_match") -> "conflict" to "request-conflict"
    else -> "commit" to "fresh-authorization"
  }

  private fun canonicalUUID(value: Any): Boolean = value is String && Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(value)
  private fun wrongPurpose(tag: String, values: List<Any>): Boolean {
    val registry = names[tag] ?: return false
    val key = registry.indexOf("key_purpose")
    val expected = if (tag == "recovery-prefs-wrap-v1") "preferences-aes256-gcm" else "account-rsa-oaep4096-pss-sha256"
    if (key >= 0 && values[key] != expected) return true
    val recovery = registry.indexOf("recovery_purpose")
    return recovery >= 0 && values[recovery] != "user-account-recovery-key"
  }
  private fun descriptorValid(data: ByteArray): JSONArray? = runCatching {
    if (data.size > 256) return null
    val d = JSONArray(String(data, Charsets.US_ASCII))
    if (d.length() != 8 || d.getString(0) != "split-auth-wrap-v1" || !canonicalUUID(d.get(1))) return null
    if (unb64(d.getString(2)).size != 32 || unb64(d.getString(4)).size != 16) return null
    if ((exactInt(d.get(3)) ?: -1L) !in 1L..9007199254740991L) return null
    if (!d.toString().toByteArray(Charsets.US_ASCII).contentEquals(data)) return null
    d
  }.getOrNull()
  private fun classify(v: JSONObject): String {
    val name = v.getString("name")
    val input = v.getJSONObject("input")
    when (v.getString("suite") to v.getString("operation")) {
      "credential" to "password-scalars" -> if (scalarString(input.getString("utf16_units_hex")) == null) return "validate/invalid_unicode"
      "credential" to "derive" -> {
        val password = bytes(input, "password_utf8_b64")
        val utf8Valid = runCatching { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(password)) }.isSuccess
        if (bytes(input, "subject_b64").size != 32 || bytes(input, "salt_b64").size != 16 || !canonicalUUID(input.get("realm")) || (exactInt(input.get("generation")) ?: -1L) !in 1L..9007199254740991L || !utf8Valid) return "validate/invalid_field"
      }
      "credential" to "descriptor" -> {
        val d = descriptorValid(bytes(input, "descriptor_b64")) ?: return "parse/malformed_descriptor"
        if (d.getInt(5) != 65536 || d.getInt(6) != 3 || d.getInt(7) != 4) return "validate/weak_parameters"
        if (d.getString(1) != input.getString("authenticated_realm")) return "validate/wrong_realm"
      }
      "context" to "encode" -> {
        val tag = input.getString("tag"); val values = fields(input.getJSONArray("context_fields"))
        if (names[tag] == null) return "validate/unknown_tag"
        if (!validContext(tag, values)) return if (wrongPurpose(tag, values)) "validate/invalid_purpose" else "validate/invalid_field"
      }
      "context" to "parse" -> {
        val raw = bytes(input, "context_b64")
        val a = runCatching { JSONArray(String(raw, Charsets.UTF_8)) }.getOrNull() ?: return "parse/malformed_context"
        if (a.length() < 3 || a.optString(0) != "concord-e2ee-context" || a.optInt(1) != 1 || !a.toString().toByteArray(Charsets.UTF_8).contentEquals(raw)) return "parse/malformed_context"
        val tag = a.getString(2)
        if (names[tag] == null) return "validate/unknown_tag"
        val values = (3 until a.length()).map { a.get(it) }
        if (!validContext(tag, values)) return if (wrongPurpose(tag, values)) "validate/invalid_purpose" else "validate/invalid_field"
      }
      "rsa-label" to "derive" -> if (!validContext("channel-key-capsule-v1", fields(input.getJSONArray("context_fields")))) return "validate/invalid_field"
      "rsa-label" to "verify" -> {
        val values = fields(input.getJSONArray("context_fields"))
        if (!validContext("channel-key-capsule-v1", values)) return "validate/invalid_field"
        if (!context("channel-key-capsule-v1", values).contentEquals(bytes(input, "candidate_label_b64"))) return "authenticate/invalid_label"
      }
      "aead" to "encrypt" -> {
        if (bytes(input, "key_b64").size != 32 || bytes(input, "nonce_b64").size != 12) return "validate/invalid_field"
        val (tag, values) = parseContext(bytes(input, "context_b64"))
        if (!validContext(tag, values)) return "validate/invalid_field"
        if (formatTags[input.getString("format")] != tag) return "validate/invalid_format_context"
      }
      "aead" to "decrypt" -> {
        val key = bytes(input, "key_b64")
        if (key.size != 32) return "validate/invalid_field"
        val (tag, values) = parseContext(bytes(input, "expected_context_b64"))
        if (!validContext(tag, values)) return "validate/invalid_field"
        val format = input.getString("format")
        if (formatTags[format] != tag) return "validate/invalid_format_context"
        val wire = bytes(input, "envelope_b64")
        if (format == "attachment-v4" && wire.size >= 28) {
          val header = ByteBuffer.wrap(wire).order(ByteOrder.BIG_ENDIAN)
          if ((wire[3].toInt() and 0xff) != 0 || header.getInt(4) != 8388608 || header.getInt(8) != (values[9] as Number).toInt()) return "validate/invalid_field"
        }
        val payload = runCatching { splitWire(format, wire) }.getOrNull() ?: return "parse/bad_envelope"
        val aad = if (name.endsWith("/tamper-header")) {
          val candidate = values.toMutableList(); candidate[6] = b64(wire.copyOfRange(12, 28)); context(tag, candidate)
        } else bytes(input, "expected_context_b64")
        val authentication = runCatching { openAead(payload.second, key, payload.first, aad) }
        if (authentication.isFailure) return "authenticate/aead_failure"
      }
      else -> error("unknown rejecting operation $name")
    }
    error("rejecting candidate did not reject: $name")
  }

  @Test fun everyNegativeHasItsDeclaredStageAndReason() {
    val (_, vectors) = corpus()
    val allNames = (0 until vectors.length()).map { vectors.getJSONObject(it).getString("name") }.toSet()
    var rejected = 0
    for (i in 0 until vectors.length()) {
      val v = vectors.getJSONObject(i); val expected = v.getJSONObject("expect")
      if (expected.getString("verdict") != "reject") continue
      val name = v.getString("name")
      assertTrue(name, allNames.contains(v.getString("negative_of")))
      assertEquals(name, "${expected.getString("stage")}/${expected.getString("reason")}", classify(v))
      rejected++
    }
    assertEquals(132, rejected)
  }
}
