# Architecture

## Current behavior (V1.3.1)

This repository contains one standard SillyTavern browser extension. It adds a play/stop button beside the `未曾说出口` or `耳语情话` label inside the supplied `.cx-card` markup, then maps that element to the matching message in the active chat. It reads only the matching field (`<未言>` or `<情话>`) inside that message's `<帘隙>` block. A button is added only while that raw field is nonempty; repeated scans are idempotent and remove a stale button if an edited message clears its field. It does not rewrite status markup, regex output, world info, saved messages, SillyTavern core, or ordinary chat TTS.

Per-user settings are stored in SillyTavern extension settings: MiniMax API Key, voice ID, Speech 2.8 HD/Turbo model, language boost, speed, and region. New installs default to domestic region, HD, automatic language, and 1.0× speed.

On an explicit click, browser Fetch sends a request only to the selected fixed MiniMax endpoint. The request carries the Key in the Authorization header and includes language, model, voice, and speed. No dedicated server route, proxy fallback, or arbitrary URL setting exists. Browser CORS policy may prevent direct playback.

A single extension playback controller cancels generation or playback when the active button is clicked again, another field/floor is selected, or the chat changes. Playback scopes include chat, message, and field; cache identity remains based on exact text and speech settings, allowing safe reuse when the content and settings are identical. A bounded in-memory cache stores up to 24 audio entries and distinguishes exact text, voice, model, language, speed, region, and format. It clears on page reload. The extension does not join SillyTavern's ordinary TTS queue.

Message scanning is limited to affected floors. When a chat opens, the extension inspects the latest five message bodies and the currently visible message bodies. DOM updates inside a message schedule a scan for that message only; newly added messages are observed for visibility. A batch of more than five simultaneous message changes is treated as history loading and reduced to the latest five plus currently visible floors. Older hidden message bodies are inspected only as they enter the chat viewport. The visibility observer tracks message containers, not their card contents, and repeated scans are idempotent.

## Security and compatibility

The user-entered Key is accessible to scripts running in the same Tavern and is less isolated than server-side secret storage. The settings UI supports changing and clearing it. The extension sends requests only to the two fixed MiniMax official endpoints and omits cookies/referrer; user-facing errors do not expose upstream response bodies.

Windows browser behavior has been verified. Android/Termux has not been physically tested; compatibility depends on browser Fetch/Audio support and endpoint CORS. Automated tests mock Fetch and do not establish real account acceptance or audio generation. Scanning tests use 2,000 synthetic message containers and do not measure live browser performance.

## Version relationship

V1.3.0 replaces the earlier paired client/server runtime with one independent client extension. The prior V1.2.0 rollback artifacts remain separate. This repository starts with a clean Git history and contains no server-plugin runtime.

The `<情话>` playback action is included alongside the existing `<未言>` action. The earlier History entry records that it was initially a local update; it is present in the current public source. V1.3.1 changes only floor scanning and documentation/version metadata, with no change to the SillyTavern status-bar regex or user settings.
