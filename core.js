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

const VOICE_FIELDS = Object.freeze({
    unspoken: Object.freeze({ tag: '未言', label: '未曾说出口' }),
    love: Object.freeze({ tag: '情话', label: '耳语情话' }),
});

/** Extract one supported voice field from the status block in one raw chat message. */
export function extractVoiceText(messageText, field = 'unspoken') {
    if (typeof messageText !== 'string') return '';
    const config = VOICE_FIELDS[field];
    if (!config) return '';

    const status = messageText.match(/<帘隙\s*>([\s\S]*?)<\/帘隙\s*>/i)?.[1];
    if (!status) return '';

    const escapedTag = config.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return status.match(new RegExp(`<${escapedTag}\\s*>([\\s\\S]*?)<\\/${escapedTag}\\s*>`, 'i'))?.[1]?.trim() ?? '';
}

/** Keep the original public helper compatible with existing callers. */
export function extractUnspoken(messageText) {
    return extractVoiceText(messageText, 'unspoken');
}

export function createVoiceScope(chatId, messageId, field = 'unspoken') {
    const safeField = Object.hasOwn(VOICE_FIELDS, field) ? field : 'unspoken';
    return `${chatId ?? 'unknown-chat'}:${messageId}:${safeField}`;
}

export function findVoiceLabels(messageElement) {
    const cards = [...messageElement.querySelectorAll('.cx-card, .custom-cx-card')];
    const labels = [];
    for (const card of cards) {
        const candidates = card.querySelectorAll('[class~="cx-key"], [class~="custom-cx-key"]');
        for (const label of candidates) {
            if (Object.values(VOICE_FIELDS).some(config => config.label === label.textContent.trim())) labels.push(label);
        }
    }
    return labels;
}

/** Insert one idempotent play/stop button at each matching label. */
export function addVoiceButtonsToMessage(messageElement, documentImpl = globalThis.document, buttonClass = 'cx-mind-voice-button', rawMessageText = '') {
    let inserted = 0;
    for (const label of findVoiceLabels(messageElement)) {
        const field = Object.entries(VOICE_FIELDS).find(([, config]) => config.label === label.textContent.trim())?.[0];
        if (!field) continue;
        const existingButton = label.querySelector(`.${buttonClass}`);
        if (!extractVoiceText(rawMessageText, field)) {
            existingButton?.remove();
            continue;
        }
        if (existingButton) continue;
        const button = documentImpl.createElement('button');
        button.type = 'button';
        button.className = buttonClass;
        button.dataset.cxVoiceField = field;
        button.textContent = '▶';
        button.title = `朗读${VOICE_FIELDS[field].label}`;
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

function collectMessageElements(node) {
    if (node?.nodeType !== 1) return [];
    if (node.matches?.('.mes')) return [node];
    return [...(node.querySelectorAll?.('.mes') ?? [])];
}

/** Return the latest N message elements without inspecting their card contents. */
export function getRecentMessages(rootOrMessages, count = 5) {
    const limit = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 5;
    if (limit === 0) return [];
    const messages = Array.isArray(rootOrMessages)
        ? rootOrMessages
        : [...(rootOrMessages?.querySelectorAll?.('.mes') ?? [])];
    return messages.slice(-limit);
}

/** Track message visibility so older floors are inspected only when they enter the chat viewport. */
export function observeVisibleChatMessages(root, onVisible = () => {}, IntersectionObserverImpl = globalThis.IntersectionObserver) {
    if (!root?.querySelectorAll) {
        return { getRecent: () => [], getVisible: () => [], observe: () => {}, unobserve: () => {}, disconnect: () => {} };
    }

    const messages = [...root.querySelectorAll('.mes')];
    const trackedMessages = new Set(messages);
    const visibleMessages = new Set();
    const observer = typeof IntersectionObserverImpl === 'function'
        ? new IntersectionObserverImpl(entries => {
            const entering = [];
            for (const entry of entries) {
                if (entry.isIntersecting && entry.target?.isConnected !== false) {
                    visibleMessages.add(entry.target);
                    entering.push(entry.target);
                } else {
                    visibleMessages.delete(entry.target);
                }
            }
            if (entering.length) onVisible(entering);
        }, { root })
        : null;

    for (const message of messages) observer?.observe(message);

    function compareMessages(left, right) {
        const position = left.compareDocumentPosition?.(right) ?? 0;
        if (position & 4) return -1;
        if (position & 2) return 1;
        return 0;
    }

    function observe(nodeOrNodes) {
        const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
        const incoming = new Set(nodes.flatMap(collectMessageElements));
        const fresh = [...incoming].filter(message => !trackedMessages.has(message));
        if (!fresh.length) return;

        if (fresh.length === 1) {
            const message = fresh[0];
            let low = 0;
            let high = messages.length;
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (compareMessages(messages[middle], message) <= 0) low = middle + 1;
                else high = middle;
            }
            messages.splice(low, 0, message);
        } else {
            fresh.sort(compareMessages);
            const merged = [];
            let existingIndex = 0;
            let incomingIndex = 0;
            while (existingIndex < messages.length && incomingIndex < fresh.length) {
                if (compareMessages(messages[existingIndex], fresh[incomingIndex]) <= 0) merged.push(messages[existingIndex++]);
                else merged.push(fresh[incomingIndex++]);
            }
            merged.push(...messages.slice(existingIndex), ...fresh.slice(incomingIndex));
            messages.length = 0;
            for (const message of merged) messages.push(message);
        }

        for (const message of fresh) {
            trackedMessages.add(message);
            observer?.observe(message);
        }
    }

    function unobserve(nodeOrNodes) {
        const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
        const removed = new Set(nodes.flatMap(collectMessageElements));
        if (!removed.size) return;
        for (const message of removed) {
            observer?.unobserve(message);
            trackedMessages.delete(message);
            visibleMessages.delete(message);
        }
        const remaining = messages.filter(message => !removed.has(message));
        messages.length = 0;
        for (const message of remaining) messages.push(message);
    }

    return {
        getRecent: count => getRecentMessages(messages, count),
        getVisible: () => [...visibleMessages],
        observe,
        unobserve,
        disconnect() {
            observer?.disconnect();
            trackedMessages.clear();
            visibleMessages.clear();
            messages.length = 0;
        },
    };
}

/** Select only changed floors; large history insertions are limited to recent and visible floors. */
export function selectMessagesToScan({ changedMessages = [], addedMessages = [], recentMessages = [], visibleMessages = [] } = {}) {
    const candidates = new Set([...changedMessages, ...addedMessages]);
    if (candidates.size <= 5) return [...candidates];

    const messages = new Set();
    for (const message of visibleMessages) messages.add(message);
    for (const message of recentMessages) messages.add(message);
    return [...messages];
}

/** Report only message elements affected by chat mutations, coalesced into one batch. */
export function observeChatUpdates(root, onUpdate, MutationObserverImpl = globalThis.MutationObserver) {
    if (!root || typeof MutationObserverImpl !== 'function') return () => {};

    let scanTimer;
    const changedMessages = new Set();
    const addedMessages = new Set();
    const removedMessages = new Set();
    const isVoiceButtonMutation = record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if (target?.closest?.('.cx-mind-voice-button')) return true;
        if (record.type !== 'childList') return false;
        const changedNodes = [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])];
        return changedNodes.length > 0 && changedNodes.every(node =>
            node.nodeType === 1 && node.matches?.('.cx-mind-voice-button'),
        );
    };
    const observer = new MutationObserverImpl(records => {
        if (!records?.length || records.every(isVoiceButtonMutation)) return;

        for (const record of records) {
            const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
            const changedMessage = target?.closest?.('.mes');
            if (changedMessage) changedMessages.add(changedMessage);

            if (record.type !== 'childList') continue;
            for (const node of record.addedNodes ?? []) {
                for (const message of collectMessageElements(node)) addedMessages.add(message);
            }
            for (const node of record.removedNodes ?? []) {
                for (const message of collectMessageElements(node)) removedMessages.add(message);
            }
        }

        if (!changedMessages.size && !addedMessages.size && !removedMessages.size) return;
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
            const removed = [...removedMessages];
            const added = [...addedMessages];
            const changed = [...changedMessages].filter(message => !removedMessages.has(message));
            changedMessages.clear();
            addedMessages.clear();
            removedMessages.clear();
            onUpdate({ changedMessages: changed, addedMessages: added, removedMessages: removed });
        }, 100);
    });

    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
        clearTimeout(scanTimer);
        changedMessages.clear();
        addedMessages.clear();
        removedMessages.clear();
        observer.disconnect();
    };
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
