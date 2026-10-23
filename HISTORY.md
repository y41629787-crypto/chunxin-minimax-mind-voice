# History

## V1.3.0 — standalone browser client

- Replaces the earlier paired client/server runtime with a single SillyTavern client extension. The extension does not require or call a dedicated server plugin.
- Preserves current-floor `<未言>` extraction, explicit play/stop, cache separation, and floor/chat playback cancellation.
- Adds direct browser requests to fixed domestic/international MiniMax endpoints with the user's selected language boost, model, voice, and speed. The API Key is user-configured in extension settings; no developer key is included.
- The V1.2.0 dual-component version remains a separate rollback artifact. No earlier Git commit history is copied into this repository.
- Verification: 22 Node tests passed with mocked Fetch. No real API Key was read and no paid audio request was made. Android/Termux has not been physically tested; direct API use remains subject to browser CORS.
- Publication status: source migration only; no formal V1.3.0 release is included in this history entry.
