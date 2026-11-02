# DREAM Browser

DREAM is a Chromium-based browser with flat styling, animated tabs, a private Ghost window, and an optional assistant. This repository contains the Windows desktop app; Android is being developed separately.

## Desktop

The Windows app provides navigation, tabs, bookmarks, settings, downloads, session restoration, and Chrome Web Store installation within DREAM. Its extension compatibility layer supports many extension APIs, but compatibility with every Chrome extension is not guaranteed. Extensions are disabled in Ghost windows.

Ghost windows use separate, temporary browser sessions with no DREAM AI, bookmarks, extensions, session restoration, or downloads. Ghost does not make browsing anonymous to websites or networks.

The optional assistant tries a local Ollama model first. OpenRouter cloud use is disabled until explicitly enabled, and an API key is stored using OS-backed encryption. Responses stream into the panel; Stop cancels the request. Conversations are held in memory. Page text is attached only through a user action or after confirmation. You can type `@ai` in the address bar, use Ctrl+Shift+J (Cmd+Shift+J on macOS), or select text and use the context menu. A small set of explicit tab, bookmark, and history commands runs locally.

Economy, Balanced, and Quality use low-cost catalog models and simple name-based capability hints; these hints cannot guarantee answer quality. The local per-request, daily, and monthly caps reserve a conservative estimated maximum, including for failed or canceled requests. These are not a provider-enforced spending cap: pricing, provider fees, and use of the same key elsewhere are outside DREAM's control. Set a provider-side spending limit too. Multi-tab context is limited to four open pages, and richer tab organization remains in progress.

## Android

The Android source and build are not finished. A Chromium-based extension implementation is being evaluated. There is currently no DREAM Android APK.

## Build

Install Node 24 and pnpm 11, then run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm dist` on Windows. `pnpm test:e2e` exercises browser behavior in isolated profiles. No real AI account or paid request is used in the tests. The Windows installer is unsigned.

The extension integration libraries are MIT licensed. macOS and Linux packaging has not yet been verified. Automatic browser security updates, DRM, a password manager, sync, and full Chrome extension API compatibility have not been completed.
