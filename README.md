# DREAM Browser

DREAM is a Chromium-based browser with flat styling, animated tabs, a private Ghost window, and an optional assistant. This repository contains the Windows desktop app and work in progress for Android.

## Desktop

The Windows app provides navigation, tabs, bookmarks, settings, downloads, session restoration, and Chrome Web Store installation within DREAM. Its extension compatibility layer supports many extension APIs, but compatibility with every Chrome extension is not guaranteed. Extensions are disabled in Ghost windows.

Ghost windows use separate, temporary browser sessions with no DREAM AI, bookmarks, extensions, session restoration, or downloads. Ghost does not make browsing anonymous to websites or networks.

The optional assistant tries a local Ollama model first. OpenRouter cloud use is disabled until explicitly enabled, and an API key is stored using OS-backed encryption. Conversations are held in memory, and page text is attached only when requested. Cost limits are local estimates; set a provider-side spending limit as well.

## Android

The Android source and build are not finished. The `android/` folder documents the Chromium-based extension implementation being evaluated. There is currently no DREAM Android APK.

## Build

Install Node 24 and pnpm 11, then run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm dist` on Windows. `pnpm test:e2e` exercises browser behavior in isolated profiles. No real AI account or paid request is used in the tests. The Windows installer is unsigned.

The extension integration libraries are MIT licensed. The Android patch series retains its upstream BSD license and third-party notices under `android/`. macOS and Linux packaging has not yet been verified. Automatic browser security updates, DRM, a password manager, sync, and full Chrome extension API compatibility have not been completed.
