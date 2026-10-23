export const DEFAULT_MODEL = 'speech-2.8-hd';
export const SUPPORTED_MODELS = Object.freeze(['speech-2.8-hd', 'speech-2.8-turbo']);
export const SUPPORTED_LANGUAGES = Object.freeze(['auto', 'Chinese', 'Chinese,Yue']);
export const DEFAULT_API_REGION = 'domestic';
export const SUPPORTED_API_REGIONS = Object.freeze(['domestic', 'international']);
export const MINIMAX_ENDPOINTS = Object.freeze({
    domestic: 'https://api.minimaxi.com/v1/t2a_v2',
    international: 'https://api.minimax.io/v1/t2a_v2',
});
const MAX_CACHE_ENTRIES = 24;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;

/** Extract the unspoken field from the status block in one raw chat message. */
export function extractUnspoken(messageText) {
    if (typeof messageText !== 'string') return '';

    const status = messageText.match(/<帘隙\s*>([\s\S]*?)<\/帘隙\s*>/i)?.[1];
    if (!status) return '';

    return status.match(/<未言\s*>([\s\S]*?)<\/未言\s*>/i)?.[1]?.trim() ?? '';
}

export function findVoiceLabels(messageElement) {
    const cards = [...messageElement.querySelectorAll('.cx-card, .custom-cx-card')];
    const labels = [];
    for (const card of cards) {
        const candidates = card.querySelectorAll('[class~="cx-key"], [class~="custom-cx-key"]');
        for (const label of candidates) {
            if (label.textContent.trim() === '未曾说出口') labels.push(label);
        }
    }
    return labels;
}

/** Insert one idempotent play/stop button at each matching label. */
export function addVoiceButtonsToMessage(messageElement, documentImpl = globalThis.document, buttonClass = 'cx-mind-voice-button') {
    let inserted = 0;
    for (const label of findVoiceLabels(messageElement)) {
        if (label.querySelector(`.${buttonClass}`)) continue;
        const button = documentImpl.createElement('button');
        button.type = 'button';
        button.className = buttonClass;
        button.textContent = '▶';
        button.title = '朗读未曾说出口';
        button.setAttribute('aria-label', button.title);
        label.append(button);
        inserted++;
    }
    return inserted;
}

/** Keep an existing user's configured MiniMax region when upgrading from V1.1. */
export function resolveApiRegion({ apiRegion, hasLegacySettings = false, legacyApiHost } = {}) {
    if (SUPPORTED_API_REGIONS.includes(apiRegion)) return apiRegion;
    if (!hasLegacySettings) return DEFAULT_API_REGION;
    if (legacyApiHost === 'https://api.minimax.chat') return 'domestic';
    return 'international';
}

/** Re-scan chat markup after a status card is rendered or replaced asynchronously. */
export function observeChatUpdates(root, onUpdate, MutationObserverImpl = globalThis.MutationObserver) {
    if (!root || typeof MutationObserverImpl !== 'function') return () => {};

    let scanQueued = false;
    const observer = new MutationObserverImpl(() => {
        if (scanQueued) return;
        scanQueued = true;
        queueMicrotask(() => {
            scanQueued = false;
            onUpdate();
        });
    });

    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
}

/** Build normalized speech settings; endpoint selection is restricted to official MiniMax hosts. */
export function buildGenerationPayload(settings, text) {
    const model = SUPPORTED_MODELS.includes(settings?.model) ? settings.model : DEFAULT_MODEL;
    const apiRegion = resolveApiRegion({ apiRegion: settings?.apiRegion });
    const rawSpeed = Number(settings?.speed);
    const boundedSpeed = Number.isFinite(rawSpeed) && rawSpeed !== 0
        ? Math.min(Math.max(rawSpeed, MIN_SPEED), MAX_SPEED)
        : 1;
    const speed = Math.round((boundedSpeed + Number.EPSILON) * 10) / 10;
    return {
        text,
        voiceId: String(settings?.voiceId ?? '').trim(),
        apiRegion,
        model,
        languageBoost: SUPPORTED_LANGUAGES.includes(settings?.languageBoost) ? settings.languageBoost : 'auto',
        speed,
        volume: 1,
        pitch: 0,
        audioSampleRate: 32000,
        bitrate: 128000,
        format: 'mp3',
    };
}

export function buildMiniMaxRequest(payload, apiKey) {
    const key = String(apiKey ?? '').trim();
    if (!key) throw new Error('请先在扩展设置中填写 MiniMax API Key。');

    const normalized = buildGenerationPayload(payload, payload?.text);
    const url = MINIMAX_ENDPOINTS[normalized.apiRegion] ?? MINIMAX_ENDPOINTS.domestic;
    return {
        url,
        options: {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: normalized.model,
                text: String(normalized.text ?? '').trim(),
                stream: false,
                voice_setting: {
                    voice_id: normalized.voiceId,
                    speed: normalized.speed,
                    vol: normalized.volume,
                    pitch: normalized.pitch,
                },
                audio_setting: {
                    sample_rate: normalized.audioSampleRate,
                    bitrate: normalized.bitrate,
                    format: normalized.format,
                    channel: 1,
                },
                output_format: 'hex',
                language_boost: normalized.languageBoost,
            }),
        },
    };
}

function createCacheKey({ text, voiceId, model, apiRegion, format, speed, languageBoost }) {
    return JSON.stringify([text, voiceId, model, apiRegion || DEFAULT_API_REGION, format || 'mp3', speed ?? 1, languageBoost || 'auto']);
}

export async function requestMiniMaxAudio({ fetchImpl = fetch, apiKey, payload, signal }) {
    const { url, options } = buildMiniMaxRequest(payload, apiKey);
    let response;
    try {
        response = await fetchImpl(url, { ...options, signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error('无法连接 MiniMax。请检查网络或浏览器跨域访问是否受限。');
    }

    if (!response.ok) {
        throw new Error(`MiniMax 请求失败（HTTP ${response.status}）。请检查 API Key、地区、音色与账户状态。`);
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error('MiniMax 返回内容无法识别。');
    }
    const statusCode = Number(result?.base_resp?.status_code ?? 0);
    if (statusCode !== 0) {
        throw new Error(`MiniMax 未能生成语音（错误码 ${statusCode}）。请检查模型、音色和账户状态。`);
    }

    const audioHex = result?.data?.audio;
    if (typeof audioHex !== 'string' || !/^(?:[\da-f]{2})+$/i.test(audioHex)) {
        throw new Error('MiniMax 返回的音频数据无效。');
    }
    const bytes = new Uint8Array(audioHex.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
    return new Blob([bytes], { type: 'audio/mpeg' });
}

/** Playback state machine shared by the browser adapter and unit tests. */
export function createVoicePlaybackController({
    synthesize,
    play,
    cache = new Map(),
    onStateChange = () => {},
    onError = () => {},
}) {
    let active = null;

    function notify(scope, state) {
        try {
            onStateChange(scope, state);
        } catch (error) {
            console.warn('Voice UI state update failed', error);
        }
    }

    function finish(operation) {
        if (active !== operation) return;
        active = null;
        notify(operation.scope, 'idle');
    }

    function stop() {
        if (!active) return false;
        const operation = active;
        active = null;
        operation.abortController.abort();
        operation.playback?.stop?.();
        notify(operation.scope, 'idle');
        return true;
    }

    async function toggle(request) {
        const normalized = {
            ...request,
            scope: String(request?.scope ?? ''),
            text: String(request?.text ?? '').trim(),
            voiceId: String(request?.voiceId ?? '').trim(),
            model: SUPPORTED_MODELS.includes(request?.model) ? request.model : DEFAULT_MODEL,
            languageBoost: SUPPORTED_LANGUAGES.includes(request?.languageBoost) ? request.languageBoost : 'auto',
            apiRegion: resolveApiRegion({ apiRegion: request?.apiRegion }),
            speed: buildGenerationPayload({ speed: request?.speed }, '').speed,
        };

        if (active?.scope === normalized.scope) {
            stop();
            return;
        }
        stop();

        if (!normalized.text || !normalized.voiceId) return;

        const operation = {
            scope: normalized.scope,
            abortController: new AbortController(),
            playback: null,
        };
        active = operation;
        notify(operation.scope, 'loading');

        try {
            const key = createCacheKey(normalized);
            let audio = cache.get(key);
            if (audio) {
                cache.delete(key);
                cache.set(key, audio);
            } else {
                audio = await synthesize({ ...normalized, signal: operation.abortController.signal });
                if (active !== operation) return;
                cache.set(key, audio);
                while (cache.size > MAX_CACHE_ENTRIES) {
                    cache.delete(cache.keys().next().value);
                }
            }

            if (active !== operation) return;
            notify(operation.scope, 'playing');
            operation.playback = await play(audio, {
                scope: operation.scope,
                onEnded: () => finish(operation),
            });
            if (active !== operation) operation.playback?.stop?.();
        } catch (error) {
            if (active === operation) finish(operation);
            if (error?.name !== 'AbortError') onError(error, operation.scope);
        }
    }

    return { toggle, stop, isActive: scope => active?.scope === String(scope ?? '') };
}
