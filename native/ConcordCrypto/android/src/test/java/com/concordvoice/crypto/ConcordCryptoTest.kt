package com.concordvoice.crypto

import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM port of Tests/ConcordCryptoTests.swift. Argon2id is native (JNI), so these swap in a
 * deterministic stand-in KDF; the real Argon2id and the desktop vectors run on a device
 * (src/androidTest) and in the runtime probe.
 */
class ConcordCryptoTest {
  private companion object {
    val pair = ConcordCrypto.generateRSAKeyPair()
    val salt16: String = Base64.getEncoder().encodeToString(ByteArray(16) { 9 })

    // Stand-in for Argon2id: a 32-byte password-and-salt-dependent key. Never used outside tests.
    fun fakeDerive(password: String, salt: ByteArray): ByteArray =
      MessageDigest.getInstance("SHA-256").digest(password.toByteArray() + salt)
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

  private fun service() = ConcordCryptoService(derive = ::fakeDerive)

  private fun key() = ConcordCrypto.randomBytes(32)

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  @Test
  fun argon2idRejectsShortSaltBeforeNativeCode() {
    expect(Failure.INVALIDINPUT) { ConcordCrypto.deriveArgon2id("p", ByteArray(7)) }
  }

  @Test
  fun sealUsesDesktopFramingAndRoundTrips() {
    val key = key()
    val blob = ConcordCrypto.seal("hello".toByteArray(), key)
    assertEquals(12 + 5 + 16, blob.size)
    assertArrayEquals("hello".toByteArray(), ConcordCrypto.open(blob, key))
    assertNotEquals(hex(ConcordCrypto.seal(ByteArray(0), key)), hex(ConcordCrypto.seal(ByteArray(0), key)))
  }

  @Test
  fun openRejectsTamperingTruncationAndWrongKey() {
    val key = key()
    val blob = ConcordCrypto.seal("hello".toByteArray(), key)
    for (index in listOf(0, 12, blob.size - 1)) {
      val tampered = blob.copyOf().also { it[index] = (it[index].toInt() xor 1).toByte() }
      expect(Failure.AUTHENTICATIONFAILED) { ConcordCrypto.open(tampered, key) }
    }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.open(blob.copyOf(27), key) }
    expect(Failure.AUTHENTICATIONFAILED) { ConcordCrypto.open(blob, key()) }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.seal(ByteArray(0), ByteArray(16)) }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.open(blob, ByteArray(16)) }
  }

  @Test
  fun decryptMessageRejectsInvalidUtf8() {
    val key = key()
    val blob = ConcordCrypto.seal(byteArrayOf(0xff.toByte(), 0xfe.toByte()), key)
    expect(Failure.INVALIDINPUT) { ConcordCrypto.decryptMessage(blob, key) }
    val text = "Synthetic: Grüße, 漢字, 👋"
    assertEquals(text, ConcordCrypto.decryptMessage(ConcordCrypto.encryptMessage(text, key), key))
  }

  @Test
  fun spkiAndPkcs8RoundTripWithWebCryptoPrefixes() {
    val spki = ConcordCrypto.spki(pair.public)
    val pkcs8 = ConcordCrypto.pkcs8(pair.private)
    // Prefixes WebCrypto emits for 4096-bit rsaEncryption keys.
    assertEquals("30820222300d06092a864886f70d0101010500", hex(spki.copyOf(19))) // pragma: allowlist secret (synthetic test value)
    assertEquals("3082", hex(pkcs8.copyOf(2)))
    assertEquals("020100300d06092a864886f70d0101010500", hex(pkcs8.copyOfRange(4, 22)))
    val secret = ByteArray(32) { 0x42 }
    val sealed = ConcordCrypto.rsaEncrypt(secret, ConcordCrypto.publicKey(spki))
    assertArrayEquals(secret, ConcordCrypto.rsaDecrypt(sealed, ConcordCrypto.privateKey(pkcs8)))
  }

  @Test
  fun oaepUsesMgf1Sha256() {
    // A ciphertext made with MGF1-SHA-1 (the provider default for the named transformation) must not
    // decrypt: WebCrypto's RSA-OAEP with SHA-256 uses MGF1-SHA-256.
    val sha1Mgf =
      javax.crypto.Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").run { // pragma: allowlist secret (algorithm name, not a secret)
        init(
          javax.crypto.Cipher.ENCRYPT_MODE,
          pair.public,
          javax.crypto.spec.OAEPParameterSpec(
            "SHA-256", "MGF1", java.security.spec.MGF1ParameterSpec.SHA1, javax.crypto.spec.PSource.PSpecified.DEFAULT))
        doFinal(ByteArray(32))
      }
    expect(Failure.RSAFAILURE) { ConcordCrypto.rsaDecrypt(sha1Mgf, pair.private) }
  }

  @Test
  fun keyParsersRejectMalformedDer() {
    val spki = ConcordCrypto.spki(pair.public)
    val pkcs8 = ConcordCrypto.pkcs8(pair.private)
    val wrongOid = spki.copyOf().also { it[14] = (it[14].toInt() xor 1).toByte() }
    val malformed =
      listOf(
        spki + byteArrayOf(0), // trailing byte
        spki.copyOf(spki.size - 1), // truncated
        wrongOid,
        byteArrayOf(0x30, 0x81.toByte(), 0x01, 0x00, 0x00), // non-minimal length
        ByteArray(0),
      )
    for (input in malformed) expect(Failure.INVALIDINPUT) { ConcordCrypto.publicKey(input) }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.privateKey(spki) }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.publicKey(pkcs8) }
    expect(Failure.INVALIDINPUT) { ConcordCrypto.privateKey(pkcs8 + byteArrayOf(0)) }
  }

  @Test
  fun rejectsRsaKeysThatAreNot4096Bits() {
    val small = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    expect(Failure.INVALIDINPUT) { ConcordCrypto.privateKey(small.private.encoded) }
    // A 2048-bit public key from the server must be refused before any channel key is wrapped to it.
    val service = service()
    val channel = service.generateChannelKey()
    expect(Failure.INVALIDINPUT) {
      service.wrapChannelKey(channel, Base64.getEncoder().encodeToString(small.public.encoded))
    }
  }

  @Test
  fun channelKeyRejectsWrongLengthPlaintext() {
    val sealed = ConcordCrypto.rsaEncrypt(ByteArray(16), pair.public)
    expect(Failure.INVALIDINPUT) { ConcordCrypto.unwrapChannelKey(sealed, pair.private) }
  }

  private fun wrappedIdentity(): String =
    Base64.getEncoder()
      .encodeToString(ConcordCrypto.wrapPrivateKey(pair.private, fakeDerive("synthetic-native", ByteArray(16) { 9 })))

  @Test
  fun serviceFailsClosedOnUnknownAndWrongKindHandles() {
    val service = service()
    val channel = service.generateChannelKey()
    assert(Regex("^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$").matches(channel))
    expect(Failure.UNKNOWNHANDLE) { service.encryptMessage("x", "missing") }
    expect(Failure.WRONGKEYKIND) { service.unwrapChannelKey("AA==", channel) }
    expect(Failure.INVALIDINPUT) { service.decryptMessage("not base64!", channel) }
    val identity = service.unlockIdentity("synthetic-native", salt16, wrappedIdentity())
    val validSpki = Base64.getEncoder().encodeToString(ConcordCrypto.spki(pair.public))
    expect(Failure.WRONGKEYKIND) { service.encryptMessage("x", identity) }
    expect(Failure.WRONGKEYKIND) { service.wrapChannelKey(identity, validSpki) }
    service.store.release(identity)
    val blob = service.encryptMessage("round trip", channel)
    assertEquals("round trip", service.decryptMessage(blob, channel))
    service.store.release(channel)
    assertEquals(0, service.store.count)
    expect(Failure.UNKNOWNHANDLE) { service.decryptMessage(blob, channel) }
  }

  @Test
  fun channelKeyRoundTripsBetweenTwoIdentities() {
    val service = service()
    val sender = service.createIdentity("synthetic-native")
    val recipient = service.unlockIdentity("synthetic-native", salt16, wrappedIdentity())
    val recipientSpki = Base64.getEncoder().encodeToString(ConcordCrypto.spki(pair.public))
    val channel = service.generateChannelKey()
    val wrapped = service.wrapChannelKey(channel, recipientSpki)
    val unwrapped = service.unwrapChannelKey(wrapped, recipient)
    val blob = service.encryptMessage("across handles", channel)
    assertEquals("across handles", service.decryptMessage(blob, unwrapped))
    // The sender's own identity cannot open a key wrapped to someone else.
    expect(Failure.RSAFAILURE) { service.unwrapChannelKey(wrapped, sender.getValue("privateKeyHandle")) }
  }

  @Test
  fun createIdentityUnlocksWithItsOwnPasswordOnly() {
    val service = service()
    val identity = service.createIdentity("synthetic-native")
    val salt = identity.getValue("keyDerivationSalt")
    val wrapped = identity.getValue("wrappedPrivateKeyBase64")
    assertEquals("argon2id", identity["keyDerivationAlg"])
    assertEquals(16, Base64.getDecoder().decode(salt).size)
    service.unlockIdentity("synthetic-native", salt, wrapped)
    expect(Failure.AUTHENTICATIONFAILED) { service.unlockIdentity("synthetic-other", salt, wrapped) }
    val tampered = Base64.getDecoder().decode(wrapped).also { it[20] = (it[20].toInt() xor 1).toByte() }
    expect(Failure.AUTHENTICATIONFAILED) {
      service.unlockIdentity("synthetic-native", salt, Base64.getEncoder().encodeToString(tampered))
    }
    // The created identity and the one unlock that succeeded.
    assertEquals(2, service.store.count)
    val created = identity.getValue("privateKeyHandle")
    service.store.releaseAll()
    assertEquals(0, service.store.count)
    expect(Failure.UNKNOWNHANDLE) { service.unwrapChannelKey("AA==", created) }
  }

  @Test
  fun releaseWipesSymmetricKeyBytes() {
    val store = ConcordKeyStore()
    val one = ByteArray(32) { 7 }
    val two = ByteArray(32) { 9 }
    store.release(store.add(ConcordKeyStore.Entry.Symmetric(one)))
    store.add(ConcordKeyStore.Entry.Symmetric(two))
    store.releaseAll()
    assertArrayEquals(ByteArray(32), one)
    assertArrayEquals(ByteArray(32), two)
  }
}
