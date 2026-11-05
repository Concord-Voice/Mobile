package com.concordvoice.crypto

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.RSAPrivateKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.RSAKeyGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** The same cases as the Swift ConcordCryptoError; JS sees E_CONCORD_CRYPTO_<name>. */
enum class Failure {
  INVALIDINPUT,
  KEYDERIVATIONFAILED,
  AUTHENTICATIONFAILED,
  RSAFAILURE,
  UNKNOWNHANDLE,
  WRONGKEYKIND,
  NOTFOUND,
  USERCANCELLED,
  INTERACTIONNOTALLOWED,
  KEYCHAINFAILURE,
  /** Android only: no TEE or StrongBox, so the identity is not persisted (password each time). */
  NOSECUREHARDWARE,
  /** Android only: secure hardware is there but no strong biometric (fingerprint) is enrolled. */
  NOBIOMETRICS,
}

/** Carries only the case: never a cause, key material or a system message. */
class ConcordCryptoException(val failure: Failure) : Exception(failure.name)

internal fun fail(failure: Failure): Nothing = throw ConcordCryptoException(failure)

/** Argon2id reference C (Vendor/argon2) over JNI; see src/main/cpp/argon2_jni.c. */
internal object Argon2 {
  init {
    System.loadLibrary("concordargon2")
  }

  @JvmStatic
  external fun hash(t: Int, m: Int, p: Int, password: ByteArray, salt: ByteArray, outLen: Int): ByteArray?
}

/**
 * Desktop-compatible message crypto, matching client/desktop/src/renderer/utils/crypto/crypto.ts
 * and the iOS ConcordCrypto.swift byte for byte. Every failure throws; no path returns partial
 * output or falls back to another algorithm. Zeroing is best-effort: JVM Strings and the copies
 * SecretKeySpec and the providers keep cannot be wiped.
 */
object ConcordCrypto {
  const val IV_LENGTH = 12
  const val TAG_LENGTH = 16
  const val KEY_LENGTH = 32
  const val RSA_BITS = 4096
  // Argon2id parameters, the same as crypto.ts deriveKeyArgon2id and the server's DefaultParams.
  const val ARGON2_ITERATIONS = 3
  const val ARGON2_MEMORY_KIB = 64 * 1024
  const val ARGON2_LANES = 4
  const val ARGON2_MIN_SALT_LENGTH = 8

  private val random = SecureRandom()

  // Explicit on purpose: the transformation name alone ("OAEPWithSHA-256AndMGF1Padding") gives
  // MGF1-SHA-1 on Android's provider, which WebCrypto cannot decrypt.
  private val oaep =
    OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)

  // MARK: Argon2id

  fun deriveArgon2id(password: String, salt: ByteArray): ByteArray {
    if (salt.size < ARGON2_MIN_SALT_LENGTH) fail(Failure.INVALIDINPUT)
    val passwordBytes = password.toByteArray(Charsets.UTF_8)
    try {
      val key =
        Argon2.hash(
          ARGON2_ITERATIONS, ARGON2_MEMORY_KIB, ARGON2_LANES, passwordBytes, salt, KEY_LENGTH)
      if (key == null || key.size != KEY_LENGTH) fail(Failure.KEYDERIVATIONFAILED)
      return key
    } finally {
      passwordBytes.fill(0)
    }
  }

  fun randomBytes(count: Int): ByteArray = ByteArray(count).also(random::nextBytes)

  // MARK: AES-256-GCM, framed as 12-byte IV || ciphertext || 16-byte tag

  fun seal(plaintext: ByteArray, key: ByteArray): ByteArray {
    if (key.size != KEY_LENGTH) fail(Failure.INVALIDINPUT)
    val iv = randomBytes(IV_LENGTH)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_LENGTH * 8, iv))
    // Java appends the tag to the ciphertext, so IV || output is the desktop framing.
    val sealed = iv + cipher.doFinal(plaintext)
    if (sealed.size != IV_LENGTH + plaintext.size + TAG_LENGTH) fail(Failure.INVALIDINPUT)
    return sealed
  }

  fun open(blob: ByteArray, key: ByteArray): ByteArray {
    if (key.size != KEY_LENGTH || blob.size < IV_LENGTH + TAG_LENGTH) fail(Failure.INVALIDINPUT)
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        SecretKeySpec(key, "AES"),
        GCMParameterSpec(TAG_LENGTH * 8, blob, 0, IV_LENGTH))
      return cipher.doFinal(blob, IV_LENGTH, blob.size - IV_LENGTH)
    } catch (_: GeneralSecurityException) {
      fail(Failure.AUTHENTICATIONFAILED)
    }
  }

  // MARK: RSA-OAEP-4096 / SHA-256 (MGF1-SHA-256), as WebCrypto

  fun generateRSAKeyPair(): KeyPair =
    try {
      KeyPairGenerator.getInstance("RSA")
        .apply { initialize(RSAKeyGenParameterSpec(RSA_BITS, RSAKeyGenParameterSpec.F4), random) }
        .generateKeyPair()
    } catch (_: GeneralSecurityException) {
      fail(Failure.RSAFAILURE)
    }

  fun rsaEncrypt(data: ByteArray, publicKey: PublicKey): ByteArray = rsa(Cipher.ENCRYPT_MODE, publicKey, data)

  fun rsaDecrypt(data: ByteArray, privateKey: PrivateKey): ByteArray =
    rsa(Cipher.DECRYPT_MODE, privateKey, data)

  private fun rsa(mode: Int, key: java.security.Key, data: ByteArray): ByteArray =
    try {
      Cipher.getInstance("RSA/ECB/OAEPPadding").run {
        init(mode, key, oaep)
        doFinal(data)
      }
    } catch (_: GeneralSecurityException) {
      fail(Failure.RSAFAILURE)
    }

  // MARK: WebCrypto key encodings (SPKI public, PKCS#8 private)
  //
  // Java's KeyFactory speaks both natively. Strictness matches the Swift DER reader: the parsed key
  // must re-encode to exactly the input bytes (no trailing data, attributes or non-canonical DER),
  // and the modulus must be 4096 bits.

  fun spki(publicKey: PublicKey): ByteArray = publicKey.encoded ?: fail(Failure.RSAFAILURE)

  fun publicKey(spki: ByteArray): PublicKey {
    val key =
      try {
        KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(spki))
      } catch (_: GeneralSecurityException) {
        fail(Failure.INVALIDINPUT)
      }
    if (key !is RSAPublicKey || key.modulus.bitLength() != RSA_BITS || !key.encoded.contentEquals(spki)) {
      fail(Failure.INVALIDINPUT)
    }
    return key
  }

  fun pkcs8(privateKey: PrivateKey): ByteArray = privateKey.encoded ?: fail(Failure.RSAFAILURE)

  fun privateKey(pkcs8: ByteArray): PrivateKey {
    val key =
      try {
        KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(pkcs8))
      } catch (_: GeneralSecurityException) {
        fail(Failure.INVALIDINPUT)
      }
    val encoded = key.encoded
    try {
      if (key !is RSAPrivateKey || key.modulus.bitLength() != RSA_BITS || !encoded.contentEquals(pkcs8)) {
        fail(Failure.INVALIDINPUT)
      }
    } finally {
      encoded?.fill(0)
    }
    return key
  }

  // MARK: Desktop flows

  /** crypto.ts unwrapPrivateKey: AES-GCM-open the PKCS#8 blob with the Argon2id key. */
  fun unwrapPrivateKey(wrapped: ByteArray, wrappingKey: ByteArray): PrivateKey {
    val pkcs8 = open(wrapped, wrappingKey)
    try {
      return privateKey(pkcs8)
    } finally {
      pkcs8.fill(0)
    }
  }

  /** crypto.ts wrapPrivateKey. */
  fun wrapPrivateKey(privateKey: PrivateKey, wrappingKey: ByteArray): ByteArray {
    val pkcs8 = pkcs8(privateKey)
    try {
      return seal(pkcs8, wrappingKey)
    } finally {
      pkcs8.fill(0)
    }
  }

  /** crypto.ts unwrapChannelKey: RSA-OAEP-decrypt 32 raw AES key bytes. */
  fun unwrapChannelKey(wrapped: ByteArray, privateKey: PrivateKey): ByteArray {
    val raw = rsaDecrypt(wrapped, privateKey)
    if (raw.size != KEY_LENGTH) {
      raw.fill(0)
      fail(Failure.INVALIDINPUT)
    }
    return raw
  }

  /** crypto.ts wrapChannelKey. */
  fun wrapChannelKey(channelKey: ByteArray, publicKey: PublicKey): ByteArray {
    if (channelKey.size != KEY_LENGTH) fail(Failure.INVALIDINPUT)
    return rsaEncrypt(channelKey, publicKey)
  }

  /** crypto.ts encryptMessage / decryptMessage: UTF-8 text in the framed AES-GCM blob. */
  fun encryptMessage(plaintext: String, channelKey: ByteArray): ByteArray =
    seal(plaintext.toByteArray(Charsets.UTF_8), channelKey)

  fun decryptMessage(blob: ByteArray, channelKey: ByteArray): String {
    val plaintext = open(blob, channelKey)
    // TextDecoder replaces invalid UTF-8; authenticated desktop output is always valid UTF-8,
    // so anything else is rejected rather than silently repaired.
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(plaintext))
        .toString()
    } catch (_: CharacterCodingException) {
      fail(Failure.INVALIDINPUT)
    } finally {
      plaintext.fill(0)
    }
  }
}
