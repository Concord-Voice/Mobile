# Attachments: view in the app, hold to share or save (#64)

Approved by Mark on 2026-11-06, as recommended in the design doc
(https://claude.ai/artifact/5Vf7C6Lwr54vcFKMeeeJC2). The shared display policy is unchanged:
nothing downloads until asked, except photos, GIFs, videos up to 64 MiB and text previews.

## Why

On TestFlight 0.1.0 (6), small videos showed only a file card, and tapping any card opened the
share sheet, which offered to save the file. `VideoView` swaps itself for `FileCard` whenever
the player fails, and the iPhone player cannot read WebM on any iOS version.

## Decisions

| # | Decision | Choice |
| --- | --- | --- |
| D1 | How to share or save | Long press an attachment |
| D2 | WebM on iPhone | A small in-app web view for `video/webm` on iOS (PR 2) |
| D3 | Tapping a document | iPhone: the system previewer inside the app. Android: "No preview on Android yet. Hold to share or save" |

## Behaviour

A tap shows the attachment in the app or says why it can't. It never opens the share sheet.

| Attachment | Tap on iPhone | Tap on Android |
| --- | --- | --- |
| Photo, GIF | Shows inline, unchanged | Same |
| Video up to 64 MiB | Preloads into a paused player box | Same |
| Video 64–256 MiB | "Large video, 70.0 MB. Tap to play", then plays in the box | Same |
| Text, Markdown | Preview with Expand; tapping the label expands it | Same |
| PDF, Office and other documents | The system previewer opens inside the app | "No preview on Android yet. Hold to share or save" |
| A file the previewer can't show | "Can't preview this file. Hold to share or save" | As above |
| Over 256 MiB | "Too large to open on this phone" | Same |

Holding any attachment for half a second (photos, GIF attachments, videos, text previews, file
cards; not KLIPY GIFs) shares or saves it. This and the iPhone previewer's own share button are
the only ways a file leaves the app.

- iPhone: the hold opens the system share sheet (Save Image, Save Video, Save to Files, AirDrop).
  `NSPhotoLibraryAddUsageDescription` is added, so saving to Photos no longer crashes the app.
- Android: the hold opens a menu with "Share…" (today's chooser) and "Save to phone…" (the system
  "save as" picker, which needs no storage permission).
- A file not yet downloaded is downloaded and decrypted first, up to 256 MiB.
- Each attachment has a "Share or save" screen-reader action. File cards show the hint
  "Hold to share or save".
- A video the phone can't play says "This phone can't play this video (WEBM)", naming the
  file's format, plus the hold hint. It never turns into a share card.
- The extension map gains `video/x-m4v` → `m4v`, `video/3gpp` → `3gp` and
  `video/x-matroska` → `mkv`, so a playable file is not named `.bin`.

Both the iPhone previewer call and the Android save call accept only files in the app's
attachment folder, through the same check that text reads and deletes use.

## Out of scope

A full-screen photo viewer, an Android PDF viewer, inline audio, desktop changes, and other
message actions in the hold menu.
