package com.concordvoice.crypto

import java.security.PrivateKey
import java.util.Base64
import java.util.UUID

/**
 * In-memory key handles. JavaScript only ever holds an opaque handle string; key bytes stay
 * native. Wrong-kind and unknown handles fail closed.
 */
class ConcordKeyStore {
  sealed interface Entry {
    class Symmetric(val key: ByteArray) : Entry

    class RsaPrivate(val key: PrivateKey) : Entry
  }

  private val entries = HashMap<String, Entry>()

  // Uppercase, like Swift's UUID().uuidString: the JS HANDLE pattern accepts only [0-9A-F].
  @Synchronized
  fun add(entry: Entry): String = UUID.randomUUID().toString().uppercase().also { entries[it] = entry }

  fun symmetric(handle: String): ByteArray =
    (entry(handle) as? Entry.Symmetric)?.key ?: fail(Failure.WRONGKEYKIND)

  fun rsaPrivate(handle: String): PrivateKey =
    (entry(handle) as? Entry.RsaPrivate)?.key ?: fail(Failure.WRONGKEYKIND)

  @Synchronized
  fun release(handle: String) {
    (entries.remove(handle) as? Entry.Symmetric)?.key?.fill(0)
  }

  @Synchronized
  fun releaseAll() {
    entries.values.forEach { (it as? Entry.Symmetric)?.key?.fill(0) }
    entries.clear()
  }

  val count: Int
    @Synchronized get() = entries.size

  @Synchronized private fun entry(handle: String): Entry = entries[handle] ?: fail(Failure.UNKNOWNHANDLE)
}

/**
 * The operations JavaScript can call, in base64 and handles. Shared by the React Native module and
 * the tests, so the tests exercise the same surface the app uses. [derive] is Argon2id; the JVM
 * unit tests swap it because the JNI library only exists in an Android build.
 */
class ConcordCryptoService(
  val store: ConcordKeyStore = ConcordKeyStore(),
  private val derive: (String, ByteArray) -> ByteArray = ConcordCrypto::deriveArgon2id,
) {
  /** Login: derive the Argon2id key, unwrap the identity key, keep only the private handle. */
  fun unlockIdentity(password: String, saltBase64: String, wrappedPrivateKeyBase64: String): String {
    val wrappingKey = derive(password, decode(saltBase64))
    try {
      val privateKey = ConcordCrypto.unwrapPrivateKey(decode(wrappedPrivateKeyBase64), wrappingKey)
      return store.add(ConcordKeyStore.Entry.RsaPrivate(privateKey))
    } finally {
      wrappingKey.fill(0)
    }
  }

  /** Registration: a new RSA-4096 identity wrapped exactly as crypto.ts generateRegistrationKeys. */
  fun createIdentity(password: String): Map<String, String> {
    val salt = ConcordCrypto.randomBytes(16)
    val wrappingKey = derive(password, salt)
    try {
      val pair = ConcordCrypto.generateRSAKeyPair()
      // Everything that can throw runs first, so a failure never strands a private key in the store.
      val spki = ConcordCrypto.spki(pair.public)
      val wrapped = ConcordCrypto.wrapPrivateKey(pair.private, wrappingKey)
      return mapOf(
        "privateKeyHandle" to store.add(ConcordKeyStore.Entry.RsaPrivate(pair.private)),
        "publicKeySpkiBase64" to encode(spki),
        "wrappedPrivateKeyBase64" to encode(wrapped),
        "keyDerivationSalt" to encode(salt),
        "keyDerivationAlg" to "argon2id",
      )
    } finally {
      wrappingKey.fill(0)
    }
  }

  fun generateChannelKey(): String =
    store.add(ConcordKeyStore.Entry.Symmetric(ConcordCrypto.randomBytes(ConcordCrypto.KEY_LENGTH)))

  fun unwrapChannelKey(wrappedKeyBase64: String, privateKeyHandle: String): String {
    val key = ConcordCrypto.unwrapChannelKey(decode(wrappedKeyBase64), store.rsaPrivate(privateKeyHandle))
    return store.add(ConcordKeyStore.Entry.Symmetric(key))
  }

  fun wrapChannelKey(channelKeyHandle: String, publicKeySpkiBase64: String): String {
    val publicKey = ConcordCrypto.publicKey(decode(publicKeySpkiBase64))
    return encode(ConcordCrypto.wrapChannelKey(store.symmetric(channelKeyHandle), publicKey))
  }

  fun encryptMessage(plaintext: String, channelKeyHandle: String): String =
    encode(ConcordCrypto.encryptMessage(plaintext, store.symmetric(channelKeyHandle)))

  fun decryptMessage(ciphertextBase64: String, channelKeyHandle: String): String =
    ConcordCrypto.decryptMessage(decode(ciphertextBase64), store.symmetric(channelKeyHandle))

  private fun encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

  private fun decode(base64: String): ByteArray =
    try {
      Base64.getDecoder().decode(base64)
    } catch (_: IllegalArgumentException) {
      fail(Failure.INVALIDINPUT)
    }
}
