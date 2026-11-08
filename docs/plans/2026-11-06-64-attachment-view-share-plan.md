# Attachments: view in the app, hold to share or save — Implementation Plan (PR 1 of #64)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task by task.

**Goal:** a tap shows an attachment in the app, and a long press is the only way to share or save it.

**Architecture:** `src/ui/Chat.tsx` gets one hold handler shared by every attachment view. Two
native calls are added to the existing ConcordCrypto module: `previewAttachment` on iOS (the
system previewer) and `saveAttachment` on Android (the system "save as" picker). Both validate
the URI with the existing attachment-folder check.

**Tech Stack:** React Native 0.88, Jest, Swift (QuickLook), Kotlin (Storage Access Framework).

**Spec:** `docs/plans/2026-11-06-64-attachment-view-share-design.md`

## Global Constraints

- No new dependencies in this PR. The WebM web view is PR 2.
- The ConcordCrypto podspec stays unchanged, so `ios/Podfile.lock` does not change.
- Copy, exactly: "Hold to share or save", "No preview on Android yet. Hold to share or save",
  "Can't preview this file. Hold to share or save", "Large video, {size}. Tap to play",
  "This phone can't play this video ({EXT})", "Share…", "Save to phone…", "Share or save".
- Long press delay: 500 ms.
- No competitor names in any file (public repo).

## Review Focus

1. A hold on a file over 256 MiB: nothing is downloaded, and nothing opens.
2. A hold while the file is still downloading for its inline view must not start a second download.
   The cache's `openCached` already coalesces opens by attachment id; the test checks one open.
3. Two quick taps on an iOS document: one previewer only. Native code refuses a second one while
   one is showing, and the JS card is disabled while "Opening…".
4. Cancelling the Android "save as" picker resolves without error and shows nothing.
5. A KLIPY GIF has no hold action.

---

### Task 1: native calls

**Files:**
- Modify: `native/ConcordCrypto/Sources/ConcordKeyStore.swift` (`plaintext` becomes internal)
- Modify: `native/ConcordCrypto/Sources/ConcordCryptoModule.swift`, `ConcordCryptoModule.m`
- Modify: `native/ConcordCrypto/android/src/main/java/com/concordvoice/crypto/ConcordCryptoModule.kt`
- Modify: `src/ConcordCrypto.ts`

**Interfaces (produces):**
- `previewAttachment(uri: string): Promise<boolean>` (iOS). False only when the file can't be
  previewed; true once the previewer shows, or when none can show now (one is already open, or
  the screen is changing). It rejects
  `E_CONCORD_CRYPTO_INVALIDINPUT` for a URI outside the folder.
- `saveAttachment(uri: string): Promise<boolean>` (Android). True once written; false when cancelled
  or while another save picker is open. A picker result that is not a document URI rejects.
- Both are optional members of `NativeCrypto`, like `shareAttachment`. Each wrapper throws
  "… is not available" when its member is missing.

- Add the two calls. The iOS previewer is presented from `RCTPresentedViewController()` on the
  main queue. A retained data source releases itself in `previewControllerDidDismiss`. Android
  uses `ACTION_CREATE_DOCUMENT` with `CATEGORY_OPENABLE`, the type taken from the file's extension,
  the title "Concord attachment.<ext>" and an `ActivityEventListener`. The copy runs on the
  attachment executor.
- Run `npx tsc --noEmit`. Expected: no errors.

### Task 2: Chat attachment views

**Files:**
- Modify: `src/ui/Chat.tsx`, `src/state/conversation.ts` (extension map; export `extension`)
- Test: `__tests__/App.test.tsx`

**Interfaces (consumes):** Task 1's `previewAttachment` and `saveAttachment`; the existing
`shareAttachment` and `Share.share`.

- Rewrite the share-on-tap tests to the new behavior. The tests:
  - "views files in the app on a tap and shares only on a hold": iOS, PDF tap →
    `previewAttachment('file:///c/f1')`, `Share.share` not called. Hold → `Share.share({ url })`.
    Previewer false → "Can't preview this file. Hold to share or save". 300 MiB card hold → no open.
  - "offers share and save on a hold on Android": an `Alert.alert` spy, buttons "Share…" →
    `shareAttachment` and "Save to phone…" → `saveAttachment`. The card hint is
    "No preview on Android yet. Hold to share or save", and a tap opens nothing.
  - Video test: "Large video, 70.0 MB. Tap to play". `onError` →
    "This phone can't play this video (WEBM)|Hold to share or save". A hold on the label shares.
  - Text test: a tap on the label toggles Expand. A hold shares the decrypted copy without a
    second open.
  - The screen-reader action `share` on a photo calls `Share.share`. A KLIPY GIF has no
    `onLongPress`.
- Run `npx jest`. Expected: the new tests fail.
- Implement them in `Chat.tsx`:
  - a `holdProps(onHold?)` helper: `onLongPress`, `delayLongPress: 500`, `accessibilityActions` and
    `onAccessibilityAction`. It is spread on every attachment Pressable, and wraps the inline
    image and video;
  - `holdAction(attachment, openFile)`, which opens the file up to 256 MiB, holds it while
    sharing, runs one hold per attachment at a time, and on Android shows the two-item menu first;
  - `FileCard`, which previews on iOS and shows the hint on Android;
  - `VideoView`'s new failure text and prompt copy;
  - a `TextPreview` label that expands on a tap.
- Run `npx jest && npx tsc --noEmit && npx eslint src __tests__`. Expected: all pass, with no
  new lint findings.

### Task 3: iOS permission string, docs

**Files:** `ios/ConcordVoice/Info.plist`, `README.md`, `CHANGELOG.md`

- Add `NSPhotoLibraryAddUsageDescription` = "Saves the photos and videos you choose to your
  library."
- Update the README attachments paragraph and the CHANGELOG `[Prerelease]` entries to the spec's
  behavior.
- Commit: `feat: view attachments in the app and share or save them with a long press`.
