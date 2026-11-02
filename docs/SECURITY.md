# Security notes

Remote tabs run without Node integration in sandboxed, context-isolated renderer processes. DREAM's interface uses a separate trusted origin and validates its IPC calls. Ghost uses a unique in-memory session and disables AI, extensions, downloads, bookmarks and session restoration.

Chrome Web Store extensions receive the permissions approved by the user and can access data allowed by those permissions. Some Chrome APIs are unsupported. No security audit or anonymity guarantee has been completed. The OpenRouter key is encrypted using Electron safe storage; local spending reservations are estimates rather than provider-side billing limits.

The Android application has not been completed or security reviewed. See the Android README for the provenance of its Chromium patch series.
