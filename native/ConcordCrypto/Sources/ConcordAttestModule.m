#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ConcordAttestModule, NSObject)

RCT_EXTERN_METHOD(info:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generateKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(forgetKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(attestKey:(NSString *)keyId
                  challengeBase64:(NSString *)challengeBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generateAssertion:(NSString *)keyId
                  challengeBase64:(NSString *)challengeBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
