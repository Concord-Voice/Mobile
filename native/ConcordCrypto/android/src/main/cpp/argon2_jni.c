#include <jni.h>
#include <stdlib.h>
#include "argon2.h"
#include "core.h"

/* Argon2id raw hash for ConcordCrypto.deriveArgon2id. Returns NULL on any failure, so the
 * caller fails closed. Native copies of the password and output are wiped before return. */
/* No JNIEXPORT/JNICALL: on Android they are default visibility (the build's default) and
 * nothing, and spelling them out stops the SAST scanners from parsing this file. */
jbyteArray Java_com_concordvoice_crypto_Argon2_hash(JNIEnv *env, jclass cls, jint t, jint m, jint p,
                                         jbyteArray password, jbyteArray salt, jint outLen) {
  (void)cls;
  if (t <= 0 || m <= 0 || p <= 0 || outLen <= 0 || outLen > 64) return NULL;
  jsize pwdLen = (*env)->GetArrayLength(env, password);
  jsize saltLen = (*env)->GetArrayLength(env, salt);
  unsigned char *pwd = malloc(pwdLen > 0 ? (size_t)pwdLen : 1);
  unsigned char *saltBytes = malloc(saltLen > 0 ? (size_t)saltLen : 1);
  unsigned char out[64];
  jbyteArray result = NULL;
  if (pwd != NULL && saltBytes != NULL) {
    (*env)->GetByteArrayRegion(env, password, 0, pwdLen, (jbyte *)pwd);
    (*env)->GetByteArrayRegion(env, salt, 0, saltLen, (jbyte *)saltBytes);
    if (argon2id_hash_raw((uint32_t)t, (uint32_t)m, (uint32_t)p, pwd, (size_t)pwdLen,
                          saltBytes, (size_t)saltLen, out, (size_t)outLen) == ARGON2_OK) {
      result = (*env)->NewByteArray(env, outLen);
      if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, outLen, (jbyte *)out);
    }
  }
  secure_wipe_memory(out, sizeof out);
  if (pwd != NULL) secure_wipe_memory(pwd, pwdLen > 0 ? (size_t)pwdLen : 1);
  free(pwd);
  free(saltBytes);
  return result;
}
