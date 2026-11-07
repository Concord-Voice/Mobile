package com.concordvoice.crypto

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.crypto.Cipher

/**
 * React Native bridge for ConcordCryptoService, the same surface as ConcordCryptoModule.swift.
 * Errors reject with a stable code only, never with key material, plaintext or a system message.
 */
class ConcordCryptoModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val service = ConcordCryptoService()
  // One thread: Argon2id holds 64 MiB for a few hundred milliseconds, and the biometric prompt
  // blocks it; both stay off the JS and main threads. It also serialises every handle operation.
  private val executor = Executors.newSingleThreadExecutor()
  private val identities =
    ConcordIdentityVault(
      File(context.noBackupFilesDir, "concord-identity"),
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE),
      ::authenticate)
  private val sessions = ConcordSessionVault(File(context.noBackupFilesDir, "concord-session.bin"))
  private val attachments = ConcordAttachmentFiles(File(context.cacheDir, "concord-attachments"))
  // Attachments get their own thread: one download or decrypt at a time, and a large file never
  // holds up message crypto.
  private val attachmentExecutor = Executors.newSingleThreadExecutor()

  // The file a "save as" picker is open for, and the call waiting on it; main thread only.
  private var saving: Pair<File, Promise>? = null

  init {
    // Plaintext from an earlier run (a crash, a kill) never outlives a launch.
    attachmentExecutor.execute { attachments.clear() }
    context.addActivityEventListener(
      object : BaseActivityEventListener() {
        override fun onActivityResult(
          activity: Activity,
          requestCode: Int,
          resultCode: Int,
          data: Intent?,
        ) {
          if (requestCode != SAVE_REQUEST) return
          val (file, promise) = saving ?: return
          saving = null
          val target = data?.data
          if (resultCode != Activity.RESULT_OK || target == null) return promise.resolve(false)
          // Only a document a documents provider made: never a file:// path, nor this app's own
          // FileProvider, which an app answering the picker intent could name.
          if (!DocumentsContract.isDocumentUri(context, target)) {
            return promise.reject("E_CONCORD_CRYPTO_INVALIDINPUT", "Crypto operation failed")
          }
          run(promise, attachmentExecutor) {
            val output = context.contentResolver.openOutputStream(target) ?: fail(Failure.NOTFOUND)
            output.use { out -> file.inputStream().use { it.copyTo(out) } }
            true
          }
        }
      })
  }

  override fun getName() = "ConcordCryptoModule"

  /**
   * A JS reload or teardown drops every key handle and stops the crypto thread. A save still
   * waiting on the picker settles as cancelled, since its result would reach no one; on the
   * main thread, like every other use of `saving`.
   */
  override fun invalidate() {
    UiThreadUtil.runOnUiThread {
      saving?.second?.resolve(false)
      saving = null
    }
    executor.shutdownNow()
    attachmentExecutor.shutdownNow()
    service.store.releaseAll()
    super.invalidate()
  }

  private fun run(promise: Promise, on: ExecutorService = executor, body: () -> Any?) =
    on.execute {
      try {
        promise.resolve(body())
      } catch (e: ConcordCryptoException) {
        promise.reject("E_CONCORD_CRYPTO_${e.failure.name}", "Crypto operation failed")
      } catch (_: Throwable) {
        promise.reject("E_CONCORD_CRYPTO", "Crypto operation failed")
      }
    }

  @ReactMethod
  fun unlockIdentity(password: String, saltBase64: String, wrappedPrivateKeyBase64: String, promise: Promise) =
    run(promise) { service.unlockIdentity(password, saltBase64, wrappedPrivateKeyBase64) }

  @ReactMethod
  fun createIdentity(password: String, promise: Promise) =
    run(promise) {
      Arguments.createMap().apply { service.createIdentity(password).forEach { (k, v) -> putString(k, v) } }
    }

  @ReactMethod fun generateChannelKey(promise: Promise) = run(promise) { service.generateChannelKey() }

  @ReactMethod
  fun unwrapChannelKey(wrappedKeyBase64: String, privateKeyHandle: String, promise: Promise) =
    run(promise) { service.unwrapChannelKey(wrappedKeyBase64, privateKeyHandle) }

  @ReactMethod
  fun wrapChannelKey(channelKeyHandle: String, publicKeySpkiBase64: String, promise: Promise) =
    run(promise) { service.wrapChannelKey(channelKeyHandle, publicKeySpkiBase64) }

  @ReactMethod
  fun encryptMessage(plaintext: String, channelKeyHandle: String, promise: Promise) =
    run(promise) { service.encryptMessage(plaintext, channelKeyHandle) }

  @ReactMethod
  fun decryptMessage(ciphertextBase64: String, channelKeyHandle: String, promise: Promise) =
    run(promise) { service.decryptMessage(ciphertextBase64, channelKeyHandle) }

  @ReactMethod fun releaseKey(handle: String, promise: Promise) = run(promise) { service.store.release(handle) ; null }

  @ReactMethod fun releaseAll(promise: Promise) = run(promise) { service.store.releaseAll(); null }

  @ReactMethod
  fun persistIdentity(privateKeyHandle: String, account: String, promise: Promise) =
    run(promise) {
      // The vault key needs a strong biometric; say which case it is rather than a Keystore fault.
      when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS -> Unit
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> fail(Failure.NOBIOMETRICS)
        else -> fail(Failure.NOSECUREHARDWARE)
      }
      identities.save(service.store.rsaPrivate(privateKeyHandle), account, "Turn on biometric unlock")
      null
    }

  @ReactMethod
  fun loadIdentity(account: String, reason: String, allowUI: Boolean, promise: Promise) =
    run(promise) {
      service.store.add(ConcordKeyStore.Entry.RsaPrivate(identities.load(account, reason, allowUI)))
    }

  @ReactMethod
  fun deleteIdentity(account: String, promise: Promise) =
    run(promise) {
      identities.delete(account)
      null
    }

  @ReactMethod
  fun saveSession(record: String, promise: Promise) =
    run(promise) {
      sessions.save(record)
      null
    }

  @ReactMethod fun loadSession(promise: Promise) = run(promise) { sessions.load() }

  @ReactMethod
  fun deleteSession(promise: Promise) =
    run(promise) {
      sessions.delete()
      null
    }

  @ReactMethod
  fun downloadAttachment(url: String, headers: ReadableMap, maxBytes: Double, promise: Promise) =
    run(promise, attachmentExecutor) {
      val named = headers.toHashMap().mapValues { it.value as? String ?: fail(Failure.INVALIDINPUT) }
      val result = attachments.download(url, named, byteCap(maxBytes, 1))
      Arguments.createMap().apply {
        putString("id", result["id"] as String)
        putString("mimeType", result["mimeType"] as String?)
        putString("keyVersion", result["keyVersion"] as String?)
      }
    }

  @ReactMethod
  fun decryptAttachment(id: String, channelKeyHandle: String, fileExtension: String, promise: Promise) =
    run(promise, attachmentExecutor) {
      // A copy: a release on the crypto thread zeroes the stored key, which must not race this.
      val key = service.store.symmetricCopy(channelKeyHandle)
      try {
        val result = attachments.decrypt(id, key, fileExtension)
        Arguments.createMap().apply {
          putString("uri", result["uri"] as String)
          putDouble("size", result["size"] as Double)
        }
      } finally {
        key.fill(0)
      }
    }

  @ReactMethod
  fun readAttachmentText(uri: String, maxBytes: Double, promise: Promise) =
    run(promise, attachmentExecutor) {
      attachments.readText(uri, byteCap(maxBytes, 0))
    }

  @ReactMethod
  fun clearAttachments(promise: Promise) {
    // Cancelled first, off the thread: a running download would otherwise hold the clear back.
    attachments.cancel()
    run(promise, attachmentExecutor) {
      attachments.clear()
      null
    }
  }

  /** A decrypted image's pixel size, read from its header without decoding it; zero otherwise. */
  @ReactMethod
  fun attachmentImageSize(uri: String, promise: Promise) =
    run(promise, attachmentExecutor) {
      val file = attachments.fileFor(uri) ?: fail(Failure.INVALIDINPUT)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      Arguments.createMap().apply {
        putInt("width", maxOf(bounds.outWidth, 0))
        putInt("height", maxOf(bounds.outHeight, 0))
      }
    }

  @ReactMethod
  fun deleteAttachment(uri: String, promise: Promise) =
    run(promise, attachmentExecutor) {
      attachments.delete(uri)
      null
    }

  /** Opens the share sheet for a decrypted attachment, at the user's request. */
  @ReactMethod
  fun shareAttachment(uri: String, promise: Promise) =
    run(promise, attachmentExecutor) {
      val file = attachments.fileFor(uri) ?: fail(Failure.INVALIDINPUT)
      val activity = context.currentActivity ?: fail(Failure.INTERACTIONNOTALLOWED)
      val content = FileProvider.getUriForFile(context, "${context.packageName}.concordattachments", file)
      // The type follows the app's own extension, as on iOS, not the sender's declared type.
      val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension)
      val send =
        Intent(Intent.ACTION_SEND)
          .setType(type ?: "application/octet-stream")
          .putExtra(Intent.EXTRA_STREAM, content)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // The chooser passes the read grant on only through ClipData.
      send.clipData = ClipData.newRawUri(null, content)
      activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, null)) }
      null
    }

  /**
   * Opens the system "save as" picker for a decrypted attachment, at the user's request, and
   * copies the file to where they choose. Resolves true once written, false when cancelled.
   */
  @ReactMethod
  fun saveAttachment(uri: String, promise: Promise) {
    // The same check as reads and deletes: only a file this module decrypted.
    val file =
      attachments.fileFor(uri)
        ?: return promise.reject("E_CONCORD_CRYPTO_INVALIDINPUT", "Crypto operation failed")
    val activity =
      context.currentActivity
        ?: return promise.reject("E_CONCORD_CRYPTO_INTERACTIONNOTALLOWED", "Crypto operation failed")
    val pick =
      Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension) ?: "application/octet-stream")
        .putExtra(Intent.EXTRA_TITLE, "Concord attachment.${file.extension}")
    activity.runOnUiThread {
      // One picker at a time, as iOS shows one previewer: a second save is refused.
      if (saving != null) return@runOnUiThread promise.resolve(false)
      saving = file to promise
      try {
        activity.startActivityForResult(pick, SAVE_REQUEST)
      } catch (_: ActivityNotFoundException) {
        // No documents app on this phone, e.g. one a device manager disabled.
        saving = null
        promise.reject("E_CONCORD_CRYPTO_INTERACTIONNOTALLOWED", "Crypto operation failed")
      }
    }
  }

  /** UUID.randomUUID draws from SecureRandom. */
  @ReactMethod fun randomId(promise: Promise) = promise.resolve(UUID.randomUUID().toString())

  /** Runs on the executor and blocks it until the prompt finishes. Strong biometrics only. */
  private fun authenticate(cipher: Cipher, title: String): Cipher {
    val activity = context.currentActivity as? FragmentActivity ?: fail(Failure.INTERACTIONNOTALLOWED)
    val result = CompletableFuture<Cipher>()
    var prompt: BiometricPrompt? = null
    activity.runOnUiThread {
      // BiometricPrompt silently drops authenticate() once the activity has saved its state
      // (app backgrounded), so the callback would never run: refuse instead of waiting forever.
      if (activity.isFinishing || activity.supportFragmentManager.isStateSaved) {
        result.completeExceptionally(ConcordCryptoException(Failure.INTERACTIONNOTALLOWED))
        return@runOnUiThread
      }
      val callback =
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(outcome: BiometricPrompt.AuthenticationResult) {
            val unlocked = outcome.cryptoObject?.cipher
            if (unlocked != null) result.complete(unlocked)
            else result.completeExceptionally(ConcordCryptoException(Failure.AUTHENTICATIONFAILED))
          }

          override fun onAuthenticationError(code: Int, message: CharSequence) {
            val cancelled =
              code == BiometricPrompt.ERROR_USER_CANCELED ||
                code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                code == BiometricPrompt.ERROR_CANCELED
            result.completeExceptionally(
              ConcordCryptoException(if (cancelled) Failure.USERCANCELLED else Failure.AUTHENTICATIONFAILED))
          }
          // onAuthenticationFailed is one rejected attempt; the prompt stays up for another.
        }
      val info =
        BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setNegativeButtonText("Cancel")
          .setAllowedAuthenticators(BIOMETRIC_STRONG)
          .build()
      try {
        prompt =
          BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).apply {
            authenticate(info, BiometricPrompt.CryptoObject(cipher))
          }
      } catch (_: Exception) {
        result.completeExceptionally(ConcordCryptoException(Failure.INTERACTIONNOTALLOWED))
      }
    }
    return try {
      // ponytail: fixed ceiling so a lost callback cannot block the crypto thread for good.
      result.get(PROMPT_TIMEOUT_MINUTES, TimeUnit.MINUTES)
    } catch (_: TimeoutException) {
      activity.runOnUiThread { prompt?.cancelAuthentication() }
      throw ConcordCryptoException(Failure.INTERACTIONNOTALLOWED)
    } catch (e: ExecutionException) {
      throw e.cause as? ConcordCryptoException ?: ConcordCryptoException(Failure.AUTHENTICATIONFAILED)
    }
  }

  private companion object {
    const val PROMPT_TIMEOUT_MINUTES = 5L
    /** Marks the "save as" picker's result among the activity's results. */
    const val SAVE_REQUEST = 0x5A7E
  }
}
