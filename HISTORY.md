# History

## V1.3.1 — bounded long-chat scanning

- Root cause found in code: V1.3.0 scheduled a query of every rendered message after any chat DOM mutation. In long chats, repeated renderer updates could cause repeated full-history scans and stall the interface; this exact user's freeze was not reproduced in a live Tavern session.
- Updated scanning so chat open checks the latest five floors and visible floors; changes within one message scan that message; older floors are checked when they enter the viewport. Large batches of more than five simultaneous message changes are limited to the latest five plus visible floors.
- The visibility observer registers message containers but does not inspect off-screen card contents. Existing `<未言>` and `<情话>` buttons, MiniMax settings, playback, cache, API region selection, and ordinary chat TTS behavior remain.
- Simplified the settings hint to mention both playback sections and current-floor-only reading.
- Correction to the earlier “Local update — add 「耳语情话」 playback” note: the current public `main` source already contains the `<情话>` playback implementation; this update preserves it.
- Tests: 28 Node tests pass, including simulated 2,000-floor visibility and bulk-change limits. These tests do not measure live SillyTavern browser performance. No real API Key was read and no paid MiniMax request was made.
- Formal GitHub Release and version tag: not created.

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
