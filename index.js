import { eventSource, event_types, getCurrentChatId, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { addVoiceButtonsToMessage, buildGenerationPayload, createVoicePlaybackController, createVoiceScope, DEFAULT_API_REGION, extractVoiceText, observeChatUpdates, observeVisibleChatMessages, requestMiniMaxAudio, resolveApiRegion, selectMessagesToScan, SUPPORTED_API_REGIONS } from './core.js';

const MODULE_NAME = 'third-party/chunxin-minimax-mind-voice';
const SETTINGS_KEY = 'chunxinMindVoice';
const BUTTON_CLASS = 'cx-mind-voice-button';
const DEFAULT_SETTINGS = Object.freeze({ apiKey: '', voiceId: '', model: 'speech-2.8-hd', languageBoost: 'auto', speed: 1, apiRegion: DEFAULT_API_REGION });

let playback;
let initialized = false;
let stopObservingChat;
let messageVisibility;
let scanTimer;
const eventListeners = [];

function listen(event, callback) {
    eventSource.on(event, callback);
    eventListeners.push([event, callback]);
}

function getSettings() {
    const hasPreviousSettings = Boolean(extension_settings[SETTINGS_KEY]);
    extension_settings[SETTINGS_KEY] ??= { ...DEFAULT_SETTINGS };
    const settings = extension_settings[SETTINGS_KEY];
    if (!SUPPORTED_API_REGIONS.includes(settings.apiRegion)) {
        settings.apiRegion = resolveApiRegion({
            apiRegion: settings.apiRegion,
            hasLegacySettings: hasPreviousSettings,
            legacyApiHost: extension_settings.tts?.MiniMax?.apiHost,
        });
        if (hasPreviousSettings) saveSettingsDebounced();
    }
    if (!settings.model) settings.model = DEFAULT_SETTINGS.model;
    if (typeof settings.apiKey !== 'string') settings.apiKey = '';
    if (!['auto', 'Chinese', 'Chinese,Yue'].includes(settings.languageBoost)) settings.languageBoost = DEFAULT_SETTINGS.languageBoost;
    if (typeof settings.voiceId !== 'string') settings.voiceId = '';
    const speed = Number(settings.speed);
    settings.speed = Number.isFinite(speed) && speed !== 0
        ? Math.round((Math.min(Math.max(speed, 0.5), 2) + Number.EPSILON) * 10) / 10
        : DEFAULT_SETTINGS.speed;
    return settings;
}

function setButtonState(scope, state) {
    const button = [...document.querySelectorAll(`.${BUTTON_CLASS}`)].find(element => element.dataset.cxVoiceScope === scope);
    if (!button) return;
    const label = button.dataset.cxVoiceField === 'love' ? '耳语情话' : '未曾说出口';
    button.disabled = false;
    button.textContent = state === 'loading' ? '…' : state === 'playing' ? '■' : '▶';
    button.setAttribute('aria-busy', String(state === 'loading'));
    button.title = state === 'loading' ? '点击取消生成' : state === 'playing' ? '点击停止' : `朗读${label}`;
    button.setAttribute('aria-label', button.title);
}

function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (globalThis.toastr?.error) {
        globalThis.toastr.error(message, '心声语音');
    } else {
        console.error('Chunxin Mind Voice:', message);
    }
}

async function synthesize({ text, apiKey, voiceId, model, languageBoost, speed, apiRegion, signal }) {
    const requestBody = buildGenerationPayload({ voiceId, model, languageBoost, speed, apiRegion }, text);
    return requestMiniMaxAudio({
        apiKey,
        payload: requestBody,
        signal,
    });
}

async function playBlob(blob, { onEnded }) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        URL.revokeObjectURL(url);
    };
    audio.addEventListener('ended', () => {
        release();
        onEnded();
    }, { once: true });
    audio.addEventListener('error', release, { once: true });

    try {
        await audio.play();
    } catch (error) {
        release();
        throw error;
    }

    return {
        stop() {
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
            release();
        },
    };
}

function scanMessage(messageElement) {
    if (messageElement?.isConnected === false) return;
    const messageBody = messageElement.querySelector('.mes_text') ?? messageElement;
    const messageId = Number(messageElement.closest('.mes')?.getAttribute('mesid'));
    const rawMessage = Number.isInteger(messageId) ? getContext().chat?.[messageId]?.mes ?? '' : '';
    addVoiceButtonsToMessage(messageBody, document, BUTTON_CLASS, rawMessage);
}

function scanMessages(messages) {
    for (const message of new Set(messages ?? [])) scanMessage(message);
}

function scanCurrentMessages() {
    if (!messageVisibility) return;
    scanMessages([...messageVisibility.getRecent(5), ...messageVisibility.getVisible()]);
}

function queueCurrentMessageScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanCurrentMessages, 100);
}

function handleChatMutations({ changedMessages = [], addedMessages = [], removedMessages = [] } = {}) {
    messageVisibility?.unobserve(removedMessages);
    messageVisibility?.observe(addedMessages);
    scanMessages(selectMessagesToScan({
        changedMessages,
        addedMessages,
        recentMessages: messageVisibility?.getRecent(5),
        visibleMessages: messageVisibility?.getVisible(),
    }));
}

function startMessageScanning() {
    const chatRoot = document.getElementById('chat') ?? document.body;
    messageVisibility = observeVisibleChatMessages(chatRoot, scanMessages);
    stopObservingChat = observeChatUpdates(chatRoot, handleChatMutations);
    scanCurrentMessages();
}

function stopMessageScanning() {
    stopObservingChat?.();
    stopObservingChat = undefined;
    messageVisibility?.disconnect();
    messageVisibility = undefined;
    clearTimeout(scanTimer);
    scanTimer = undefined;
}

function messageScope(messageId, field = 'unspoken') {
    return createVoiceScope(getCurrentChatId(), messageId, field);
}

async function onVoiceButtonClick(event) {
    const button = event.target.closest(`.${BUTTON_CLASS}`);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const messageElement = button.closest('.mes');
    const messageId = Number(messageElement?.getAttribute('mesid'));
    const field = button.dataset.cxVoiceField === 'love' ? 'love' : 'unspoken';
    if (Number.isInteger(messageId)) {
        const scope = messageScope(messageId, field);
        if (playback.isActive(scope)) {
            await playback.toggle({ scope });
            return;
        }
    }
    const message = Number.isInteger(messageId) ? getContext().chat?.[messageId] : null;
    if (!message) {
        showError(new Error('无法定位此楼层的消息。'));
        return;
    }

    const text = extractVoiceText(message.mes, field);
    if (!text) {
        const label = field === 'love' ? '耳语情话' : '未曾说出口';
        globalThis.toastr?.info?.(`当前楼层没有可朗读的「${label}」内容。`, '心声语音');
        return;
    }

    const settings = getSettings();
    if (!settings.apiKey.trim()) {
        globalThis.toastr?.info?.('请先在扩展设置中填写 MiniMax API Key。', '心声语音');
        return;
    }
    if (!settings.voiceId.trim()) {
        globalThis.toastr?.info?.('请先在扩展设置中填写 MiniMax 音色 ID。', '心声语音');
        return;
    }

    const scope = messageScope(messageId);
    button.dataset.cxVoiceScope = scope;
    await playback.toggle({
        scope,
        text,
        apiKey: settings.apiKey,
        voiceId: settings.voiceId,
        model: settings.model,
        languageBoost: settings.languageBoost,
        speed: settings.speed,
        apiRegion: settings.apiRegion,
        format: 'mp3',
    });
}

function syncSettingsToForm() {
    const settings = getSettings();
    const apiKey = document.getElementById('chunxin-mind-voice-api-key');
    const voice = document.getElementById('chunxin-mind-voice-id');
    const model = document.getElementById('chunxin-mind-voice-model');
    const language = document.getElementById('chunxin-mind-voice-language');
    const speed = document.getElementById('chunxin-mind-voice-speed');
    const speedOutput = document.getElementById('chunxin-mind-voice-speed-value');
    const region = document.getElementById('chunxin-mind-voice-region');
    if (apiKey) apiKey.value = settings.apiKey;
    if (voice) voice.value = settings.voiceId;
    if (model) model.value = settings.model;
    if (language) language.value = settings.languageBoost;
    if (speed) speed.value = String(settings.speed);
    if (speedOutput) speedOutput.textContent = `${settings.speed.toFixed(1)}×`;
    if (region) region.value = settings.apiRegion;
}

function bindSettings() {
    const apiKeyInput = document.getElementById('chunxin-mind-voice-api-key');
    const clearApiKeyButton = document.getElementById('chunxin-mind-voice-clear-api-key');
    const voiceInput = document.getElementById('chunxin-mind-voice-id');
    const modelSelect = document.getElementById('chunxin-mind-voice-model');
    const languageSelect = document.getElementById('chunxin-mind-voice-language');
    const speedInput = document.getElementById('chunxin-mind-voice-speed');
    const speedOutput = document.getElementById('chunxin-mind-voice-speed-value');
    const regionSelect = document.getElementById('chunxin-mind-voice-region');
    if (apiKeyInput) apiKeyInput.oninput = event => {
        getSettings().apiKey = event.currentTarget.value;
        saveSettingsDebounced();
    };
    if (clearApiKeyButton) clearApiKeyButton.onclick = () => {
        if (apiKeyInput) apiKeyInput.value = '';
        getSettings().apiKey = '';
        saveSettingsDebounced();
    };
    if (voiceInput) voiceInput.oninput = event => {
        getSettings().voiceId = event.currentTarget.value.trim();
        saveSettingsDebounced();
    };
    if (modelSelect) modelSelect.onchange = event => {
        getSettings().model = event.currentTarget.value;
        saveSettingsDebounced();
    };
    if (languageSelect) languageSelect.onchange = event => {
        getSettings().languageBoost = ['auto', 'Chinese', 'Chinese,Yue'].includes(event.currentTarget.value)
            ? event.currentTarget.value
            : DEFAULT_SETTINGS.languageBoost;
        saveSettingsDebounced();
    };
    if (speedInput) speedInput.oninput = event => {
        const value = Number(event.currentTarget.value);
        getSettings().speed = Number.isFinite(value) ? value : DEFAULT_SETTINGS.speed;
        if (speedOutput) speedOutput.textContent = `${getSettings().speed.toFixed(1)}×`;
        saveSettingsDebounced();
    };
    if (regionSelect) regionSelect.onchange = event => {
        getSettings().apiRegion = SUPPORTED_API_REGIONS.includes(event.currentTarget.value)
            ? event.currentTarget.value
            : DEFAULT_API_REGION;
        saveSettingsDebounced();
    };
}

export async function init() {
    if (initialized) return;
    initialized = true;
    getSettings();
    const settingsRoot = document.getElementById('extensions_settings');
    if (settingsRoot && !document.getElementById('chunxin-mind-voice-settings')) {
        const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
        settingsRoot.insertAdjacentHTML('beforeend', html);
    }
    syncSettingsToForm();
    bindSettings();

    playback = createVoicePlaybackController({
        synthesize,
        play: playBlob,
        onStateChange: setButtonState,
        onError: showError,
    });

    startMessageScanning();

    document.addEventListener('click', onVoiceButtonClick);
    listen(event_types.CHAT_CHANGED, () => {
        playback.stop();
        queueCurrentMessageScan();
    });
}

export function dispose() {
    if (!initialized) return;
    initialized = false;
    playback?.stop();
    playback = undefined;
    stopMessageScanning();
    document.removeEventListener('click', onVoiceButtonClick);
    for (const [event, callback] of eventListeners.splice(0)) {
        eventSource.removeListener(event, callback);
    }
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => button.remove());
}
