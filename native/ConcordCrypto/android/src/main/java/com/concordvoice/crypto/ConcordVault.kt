package com.concordvoice.crypto

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

private const val KEYSTORE = "AndroidKeyStore"
private const val AES_GCM = "AES/GCM/NoPadding"

private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

private fun keystoreCall(body: () -> Unit) {
  try {
    body()
  } catch (e: ConcordCryptoException) {
    throw e
  } catch (_: Exception) {
    fail(Failure.KEYCHAINFAILURE)
  }
}

/**
 * Keeps the unlocked identity key behind a strong biometric, the Android counterpart of
 * ConcordKeychain.swift. The PKCS#8 bytes are AES-GCM-encrypted under a Keystore key that never
 * leaves the TEE or StrongBox, needs a fresh strong biometric for every use, and is destroyed when
 * a fingerprint or face is enrolled. The blob lives in noBackupFilesDir, so it never leaves the
 * device. A key that is not in secure hardware is refused (NOSECUREHARDWARE): no software fallback.
 *
 * Unlike the iOS Keychain write, saving also prompts, because Keystore gates encryption with an
 * auth-bound AES key as well as decryption.
 */
class ConcordIdentityVault(
  private val dir: File,
  private val strongBox: Boolean,
  /** Shows BiometricPrompt with the cipher as its CryptoObject; returns the unlocked cipher. */
  private val prompt: (Cipher, String) -> Cipher,
) {
  fun save(privateKey: PrivateKey, account: String, reason: String) {
    delete(account)
    val name = name(account)
    lateinit var cipher: Cipher
    keystoreCall {
      val key = generate(name)
      if (!inSecureHardware(key)) {
        keyStore().deleteEntry(name)
        fail(Failure.NOSECUREHARDWARE)
      }
      cipher = Cipher.getInstance(AES_GCM).apply { init(Cipher.ENCRYPT_MODE, key) }
    }
    val unlocked = prompt(cipher, reason)
    val pkcs8 = ConcordCrypto.pkcs8(privateKey)
    try {
      // Keystore picks the IV (randomized encryption); store it in front, as the message framing.
      keystoreCall { write(file(name), unlocked.iv + unlocked.doFinal(pkcs8)) }
    } finally {
      pkcs8.fill(0)
    }
  }

  /** With allowUI false the read must fail rather than prompt (INTERACTIONNOTALLOWED). */
  fun load(account: String, reason: String, allowUI: Boolean): PrivateKey {
    val name = name(account)
    val file = file(name)
    if (!file.exists()) fail(Failure.NOTFOUND)
    lateinit var blob: ByteArray
    lateinit var cipher: Cipher
    keystoreCall {
      blob = AtomicFile(file).readFully()
      val key = keyStore().getKey(name, null) as? SecretKey ?: fail(Failure.NOTFOUND)
      if (blob.size < ConcordCrypto.IV_LENGTH + ConcordCrypto.TAG_LENGTH) fail(Failure.KEYCHAINFAILURE)
      cipher = Cipher.getInstance(AES_GCM)
      try {
        cipher.init(
          Cipher.DECRYPT_MODE, key, GCMParameterSpec(ConcordCrypto.TAG_LENGTH * 8, blob, 0, ConcordCrypto.IV_LENGTH))
      } catch (_: KeyPermanentlyInvalidatedException) {
        // A biometric was enrolled since: the key is gone for good, so is the saved identity.
        delete(account)
        fail(Failure.NOTFOUND)
      }
    }
    val unlocked = if (allowUI) prompt(cipher, reason) else cipher
    val pkcs8 =
      try {
        unlocked.doFinal(blob, ConcordCrypto.IV_LENGTH, blob.size - ConcordCrypto.IV_LENGTH)
      } catch (_: Exception) {
        // Without the prompt Keystore refuses the auth-bound key: that is the silent-read proof.
        fail(if (allowUI) Failure.AUTHENTICATIONFAILED else Failure.INTERACTIONNOTALLOWED)
      }
    try {
      return ConcordCrypto.privateKey(pkcs8)
    } finally {
      pkcs8.fill(0)
    }
  }

  fun delete(account: String) {
    val name = name(account)
    keystoreCall {
      AtomicFile(file(name)).delete()
      keyStore().deleteEntry(name)
    }
  }

  private fun file(name: String) = File(dir.apply { mkdirs() }, "$name.bin")

  private fun generate(name: String): SecretKey {
    fun spec(strong: Boolean) =
      KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        .setInvalidatedByBiometricEnrollment(true)
        .apply {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
          } else {
            @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(-1)
          }
          if (strong && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
        }
        .build()
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    return try {
      generator.apply { init(spec(strongBox)) }.generateKey()
    } catch (e: Exception) {
      // StrongBox is preferred; the TEE is the floor.
      if (!strongBox || Build.VERSION.SDK_INT < Build.VERSION_CODES.P || e !is StrongBoxUnavailableException) throw e
      generator.apply { init(spec(false)) }.generateKey()
    }
  }

  private fun inSecureHardware(key: SecretKey): Boolean {
    val info = SecretKeyFactory.getInstance(key.algorithm, KEYSTORE).getKeySpec(key, KeyInfo::class.java) as KeyInfo
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      info.securityLevel in
        setOf(
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT,
          KeyProperties.SECURITY_LEVEL_STRONGBOX,
          KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE)
    } else {
      @Suppress("DEPRECATION") info.isInsideSecureHardware
    }
  }

  /** Keystore alias and file name; hashed so any account string is a safe file name. */
  private fun name(account: String): String =
    "com.concordvoice.identity." +
      MessageDigest.getInstance("SHA-256").digest(account.toByteArray(Charsets.UTF_8)).joinToString("") {
        "%02x".format(it)
      }
}

/**
 * Keeps the signed-in session record so the app resumes after a relaunch, like
 * ConcordSessionKeychain.swift: device-only (noBackupFilesDir) and readable without a prompt. The
 * record alone opens no messages, because the identity key stays behind the biometric.
 */
class ConcordSessionVault(private val file: File) {
  private val alias = "com.concordvoice.session"

  /** AtomicFile: a failed write leaves the previous record rather than none. */
  fun save(record: String) = keystoreCall {
    val cipher = Cipher.getInstance(AES_GCM).apply { init(Cipher.ENCRYPT_MODE, key()) }
    write(file, cipher.iv + cipher.doFinal(record.toByteArray(Charsets.UTF_8)))
  }

  /** Null when nothing is stored. */
  fun load(): String? {
    if (!file.exists()) return null
    var record: String? = null
    keystoreCall {
      val blob = AtomicFile(file).readFully()
      val key = keyStore().getKey(alias, null) as? SecretKey ?: fail(Failure.KEYCHAINFAILURE)
      if (blob.size < ConcordCrypto.IV_LENGTH + ConcordCrypto.TAG_LENGTH) fail(Failure.KEYCHAINFAILURE)
      val cipher = Cipher.getInstance(AES_GCM)
      cipher.init(
        Cipher.DECRYPT_MODE, key, GCMParameterSpec(ConcordCrypto.TAG_LENGTH * 8, blob, 0, ConcordCrypto.IV_LENGTH))
      record = String(cipher.doFinal(blob, ConcordCrypto.IV_LENGTH, blob.size - ConcordCrypto.IV_LENGTH), Charsets.UTF_8)
    }
    return record
  }

  fun delete() = keystoreCall { AtomicFile(file).delete() }

  private fun key(): SecretKey =
    keyStore().getKey(alias, null) as? SecretKey
      ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        .apply {
          init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .build())
        }
        .generateKey()
}

private fun write(file: File, bytes: ByteArray) {
  file.parentFile?.mkdirs()
  val atomic = AtomicFile(file)
  val out = atomic.startWrite()
  try {
    out.write(bytes)
    atomic.finishWrite(out)
  } catch (e: Exception) {
    atomic.failWrite(out)
    throw e
  }
}
