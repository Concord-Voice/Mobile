#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ConcordCryptoModule, NSObject)

RCT_EXTERN_METHOD(unlockIdentity:(NSString *)password
                  saltBase64:(NSString *)saltBase64
                  wrappedPrivateKeyBase64:(NSString *)wrappedPrivateKeyBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(createIdentity:(NSString *)password
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generateChannelKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(unwrapChannelKey:(NSString *)wrappedKeyBase64
                  privateKeyHandle:(NSString *)privateKeyHandle
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(wrapChannelKey:(NSString *)channelKeyHandle
                  publicKeySpkiBase64:(NSString *)publicKeySpkiBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(encryptMessage:(NSString *)plaintext
                  channelKeyHandle:(NSString *)channelKeyHandle
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(decryptMessage:(NSString *)ciphertextBase64
                  channelKeyHandle:(NSString *)channelKeyHandle
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(releaseKey:(NSString *)handle
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(releaseAll:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(persistIdentity:(NSString *)privateKeyHandle
                  account:(NSString *)account
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(loadIdentity:(NSString *)account
                  reason:(NSString *)reason
                  allowUI:(BOOL)allowUI
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deleteIdentity:(NSString *)account
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(saveSession:(NSString *)record
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(loadSession:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deleteSession:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(randomId:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(downloadAttachment:(NSString *)url
                  headers:(NSDictionary *)headers
                  maxBytes:(double)maxBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(decryptAttachment:(NSString *)fileId
                  channelKeyHandle:(NSString *)channelKeyHandle
                  fileExtension:(NSString *)fileExtension
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readAttachmentText:(NSString *)uri
                  maxBytes:(double)maxBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearAttachments:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(attachmentImageSize:(NSString *)uri
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(previewAttachment:(NSString *)uri
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deleteAttachment:(NSString *)uri
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
