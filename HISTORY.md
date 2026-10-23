# History

## Local update — add 「耳语情话」 playback

- Added an independent play/stop button for the current floor's `<情话>` field beside the rendered `耳语情话` label. The existing `<未言>` button remains and both buttons use the same MiniMax settings, playback controller, and cache.
- Button discovery matches the rendered label within `.cx-card` and sanitized `custom-cx-*` classes; raw text is resolved from the matching active-chat message by `mesid`. Empty or missing fields do not get buttons, and edits that clear a field remove its stale button.
- Playback scope now includes chat, message, and field. Selecting the other field stops the current playback; repeated rendering does not duplicate buttons.
- No regex, status-bar styling, world info, character card, SillyTavern core, server plugin, or API key was changed.
- Tests: 25 Node tests pass with mocked DOM/fetch. A local copy was placed in the isolated Tavern extension folder, but UI verification could not run because the isolated server's configuration files contain unresolved Git merge markers and fail YAML parsing. No paid MiniMax request was made; no GitHub push, tag, or release has occurred.

## V1.3.0 — standalone browser client

- Replaces the earlier paired client/server runtime with a single SillyTavern client extension. The extension does not require or call a dedicated server plugin.
- Preserves current-floor `<未言>` extraction, explicit play/stop, cache separation, and floor/chat playback cancellation.
- Adds direct browser requests to fixed domestic/international MiniMax endpoints with the user's selected language boost, model, voice, and speed. The API Key is user-configured in extension settings; no developer key is included.
- The V1.2.0 dual-component version remains a separate rollback artifact. No earlier Git commit history is copied into this repository.
- Verification: 22 Node tests passed with mocked Fetch. No real API Key was read and no paid audio request was made. Android/Termux has not been physically tested; direct API use remains subject to browser CORS.
- Publication status: source migration only; no formal V1.3.0 release is included in this history entry.
