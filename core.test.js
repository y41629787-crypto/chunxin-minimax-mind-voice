import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from './core.js';
import {
    extractVoiceText,
    createVoiceScope,
    buildGenerationPayload,
    addVoiceButtonsToMessage,
    createVoicePlaybackController,
    extractUnspoken,
    findVoiceLabels,
    requestMiniMaxAudio,
} from './core.js';

const message = (inner) => `正文\n<帘隙><日期>2026.10.23</日期><未言>${inner}</未言></帘隙>`;

test('schedules a chat scan when a status card is inserted after extension initialization', async () => {
    assert.equal(typeof core.observeChatUpdates, 'function');
    let observerCallback;
    let observerOptions;
    let disconnected = false;
    let scanCount = 0;
    class TestMutationObserver {
        constructor(callback) { observerCallback = callback; }
        observe(root, options) { observerOptions = { root, options }; }
        disconnect() { disconnected = true; }
    }

    const chatRoot = {};
    const dispose = core.observeChatUpdates(chatRoot, () => scanCount++, TestMutationObserver);
    assert.deepEqual(observerOptions, {
        root: chatRoot,
        options: { childList: true, subtree: true, characterData: true },
    });
    observerCallback([]);
    observerCallback([]);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(scanCount, 1);
    dispose();
    assert.equal(disconnected, true);
});

test('extracts only the current message status-bar 未言 value', () => {
    assert.equal(extractUnspoken(`<未言>正文里同名标签</未言>${message('藏在心底的话')}`), '藏在心底的话');
    assert.equal(extractUnspoken(message('  ')), '');
    assert.equal(extractUnspoken('<未言>没有帘隙边界</未言>'), '');
});

test('extracts 未言 and 情话 independently from the current message status block', () => {
    const source = '<帘隙><未言>心里的话</未言><情话>悄悄说给你</情话></帘隙>';
    assert.equal(extractVoiceText(source, 'unspoken'), '心里的话');
    assert.equal(extractVoiceText(source, 'love'), '悄悄说给你');
    assert.equal(extractVoiceText('<情话>边界外</情话>' + source, 'love'), '悄悄说给你');
    assert.equal(extractVoiceText('<帘隙><未言>只有旧字段</未言></帘隙>', 'love'), '');
    assert.equal(extractVoiceText('<帘隙><情话>   </情话></帘隙>', 'love'), '');
});

test('keeps voice playback scopes separate by chat, message, and field', () => {
    assert.notEqual(createVoiceScope('chat-a', 4, 'unspoken'), createVoiceScope('chat-a', 4, 'love'));
    assert.notEqual(createVoiceScope('chat-a', 4, 'love'), createVoiceScope('chat-a', 5, 'love'));
    assert.notEqual(createVoiceScope('chat-a', 4, 'love'), createVoiceScope('chat-b', 4, 'love'));
});

test('locates the dedicated label inside the frosted status card only', () => {
    const makeLabel = text => ({
        textContent: text,
        parentElement: { querySelector: () => null },
    });
    const target = makeLabel('未曾说出口');
    const unrelated = makeLabel('表面言行');
    const card = {
        querySelectorAll: () => [unrelated, target],
    };
    const message = {
        querySelectorAll: selector => selector === '.cx-card, .custom-cx-card' ? [card] : [],
    };

    assert.deepEqual(findVoiceLabels(message), [target]);
});

test('matches the sanitized custom-cx classes in the supplied regex output', () => {
    const target = { textContent: '未曾说出口', className: 'custom-cx-key' };
    const card = {
        querySelectorAll: selector => selector === '[class~="cx-key"], [class~="custom-cx-key"]' ? [target] : [],
    };
    const message = {
        querySelectorAll: selector => selector === '.cx-card, .custom-cx-card' ? [card] : [],
    };

    assert.deepEqual(findVoiceLabels(message), [target]);
});

test('inserts one button per nonempty voice field, keeps legacy messages compatible, and avoids duplicates', () => {
    const buttons = [];
    const makeLabel = text => ({
        textContent: text,
        querySelector(selector) {
            return selector === '.cx-mind-voice-button'
                ? buttons.find(button => button.parent === this) ?? null
                : null;
        },
        append(button) {
            button.parent = this;
            button.remove = () => buttons.splice(buttons.indexOf(button), 1);
            buttons.push(button);
        },
    });
    const unspoken = makeLabel('未曾说出口');
    const loveLabel = makeLabel('耳语情话');
    const labels = [unspoken, loveLabel];
    const card = { querySelectorAll: () => labels };
    const message = { querySelectorAll: selector => selector === '.cx-card, .custom-cx-card' ? [card] : [] };
    const documentImpl = {
        createElement: tag => ({ tag, attributes: {}, dataset: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
    };

    assert.equal(addVoiceButtonsToMessage(message, documentImpl, 'cx-mind-voice-button', '<帘隙><未言>旧消息内容</未言></帘隙>'), 1);
    assert.equal(buttons[0].type, 'button');
    assert.equal(buttons[0].textContent, '▶');
    assert.equal(buttons[0].attributes['aria-label'], '朗读未曾说出口');
    assert.equal(buttons[0].dataset.cxVoiceField, 'unspoken');
    assert.equal(addVoiceButtonsToMessage(message, documentImpl, 'cx-mind-voice-button', '<帘隙><未言>旧消息内容</未言></帘隙>'), 0);
    assert.equal(buttons.length, 1);

    assert.equal(addVoiceButtonsToMessage(message, documentImpl, 'cx-mind-voice-button', '<帘隙><未言>新消息</未言><情话>只读情话</情话></帘隙>'), 1);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[1].dataset.cxVoiceField, 'love');
    assert.equal(buttons[1].attributes['aria-label'], '朗读耳语情话');
    assert.equal(addVoiceButtonsToMessage(message, documentImpl, 'cx-mind-voice-button', '<帘隙><未言>新消息</未言><情话>只读情话</情话></帘隙>'), 0);
    assert.equal(addVoiceButtonsToMessage(message, documentImpl, 'cx-mind-voice-button', '<帘隙><未言>新消息</未言><情话> </情话></帘隙>'), 0);
    assert.equal(buttons.some(button => button.dataset.cxVoiceField === 'love'), false);
    assert.equal(buttons.length, 1);
});

test('defaults new installs to domestic and migrates existing MiniMax hosts by region', () => {
    assert.equal(core.resolveApiRegion({}), 'domestic');
    assert.equal(core.resolveApiRegion({ hasLegacySettings: true, legacyApiHost: 'https://api.minimax.chat' }), 'domestic');
    assert.equal(core.resolveApiRegion({ hasLegacySettings: true, legacyApiHost: 'https://api.minimaxi.chat' }), 'international');
    assert.equal(core.resolveApiRegion({ hasLegacySettings: true, legacyApiHost: 'https://api.minimax.io' }), 'international');
    assert.equal(core.resolveApiRegion({ apiRegion: 'domestic', hasLegacySettings: true, legacyApiHost: 'https://api.minimax.io' }), 'domestic');
});

test('defaults to speech-2.8-hd and supports either MiniMax model', () => {
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a' }, '心声').model, 'speech-2.8-hd');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', model: 'speech-2.8-hd' }, '心声').model, 'speech-2.8-hd');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', model: 'speech-2.8-turbo' }, '心声').model, 'speech-2.8-turbo');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', model: 'unsupported' }, '心声').model, 'speech-2.8-hd');
});

test('builds a region-only payload with domestic as the new-install default', () => {
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a' }, '心声').apiRegion, 'domestic');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', apiRegion: 'international' }, '心声').apiRegion, 'international');
    assert.equal('apiHost' in buildGenerationPayload({ voiceId: 'voice-a', apiRegion: 'international' }, '心声'), false);
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', apiRegion: 'https://attacker.example' }, '心声').apiRegion, 'domestic');
});

test('defaults speech speed to 1 and clamps it to the MiniMax supported range', () => {
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a' }, '心声').speed, 1);
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', speed: 1.7 }, '心声').speed, 1.7);
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', speed: 0.4 }, '心声').speed, 0.5);
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', speed: 2.1 }, '心声').speed, 2);
});

test('defaults language to auto and supports each MiniMax language boost', () => {
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a' }, '心声').languageBoost, 'auto');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', languageBoost: 'Chinese' }, '心声').languageBoost, 'Chinese');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', languageBoost: 'Chinese,Yue' }, '心声').languageBoost, 'Chinese,Yue');
    assert.equal(buildGenerationPayload({ voiceId: 'voice-a', languageBoost: 'invalid' }, '心声').languageBoost, 'auto');
});

test('sends the selected voice, language, and model to the fixed regional MiniMax API with the user key only in Authorization', async () => {
    let request;
    const result = await requestMiniMaxAudio({
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ data: { audio: '67656e657261746564' } }) };
        },
        apiKey: 'TEST_ONLY_USER_KEY',
        payload: buildGenerationPayload({ voiceId: 'voice-123', model: 'speech-2.8-turbo', languageBoost: 'Chinese,Yue', speed: 1.4, apiRegion: 'international' }, '本楼层心声'),
        signal: new AbortController().signal,
    });

    assert.equal(request.url, 'https://api.minimax.io/v1/t2a_v2');
    assert.equal(request.options.headers.Authorization, 'Bearer TEST_ONLY_USER_KEY');
    const body = JSON.parse(request.options.body);
    assert.equal(body.text, '本楼层心声');
    assert.equal(body.voice_setting.voice_id, 'voice-123');
    assert.equal(body.model, 'speech-2.8-turbo');
    assert.equal(body.voice_setting.speed, 1.4);
    assert.equal(body.language_boost, 'Chinese,Yue');
    assert.equal('apiKey' in body, false);
    assert.equal(request.options.mode, 'cors');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.referrerPolicy, 'no-referrer');
    assert.equal(await result.text(), 'generated');
});

test('browser requests can only target the fixed domestic or international MiniMax URLs', async () => {
    const requests = [];
    for (const apiRegion of ['domestic', 'international', 'https://attacker.example']) {
        await requestMiniMaxAudio({
            apiKey: 'TEST_ONLY_USER_KEY',
            payload: buildGenerationPayload({ voiceId: 'voice-a', apiRegion }, '心声'),
            fetchImpl: async (url, options) => {
                requests.push({ url, body: JSON.parse(options.body) });
                return { ok: true, json: async () => ({ data: { audio: '617564696f' } }) };
            },
        });
    }
    assert.deepEqual(requests.map(request => request.url), [
        'https://api.minimaxi.com/v1/t2a_v2',
        'https://api.minimax.io/v1/t2a_v2',
        'https://api.minimaxi.com/v1/t2a_v2',
    ]);
});

test('does not make a network request when the user key is empty', async () => {
    let requestCount = 0;
    await assert.rejects(() => requestMiniMaxAudio({
        apiKey: '  ',
        payload: buildGenerationPayload({ voiceId: 'voice-a' }, '心声'),
        fetchImpl: async () => { requestCount++; },
    }), /API Key/);
    assert.equal(requestCount, 0);
});

test('does not expose upstream error response text in user-facing errors', async () => {
    await assert.rejects(() => requestMiniMaxAudio({
        apiKey: 'TEST_ONLY_USER_KEY',
        payload: buildGenerationPayload({ voiceId: 'voice-a' }, '心声'),
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            json: async () => ({ error: 'TEST_ONLY_USER_KEY leaked by upstream' }),
        }),
    }), error => !error.message.includes('TEST_ONLY_USER_KEY'));
});

test('does not reuse cached audio when language, model, voice, or speed differs', async () => {
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop() {} }),
    });
    const request = {
        scope: 'chat-a:1', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd',
        speed: 1, languageBoost: 'auto',
    };

    await controller.toggle(request);
    await controller.toggle({ ...request, scope: 'chat-a:2', languageBoost: 'Chinese' });
    await controller.toggle({ ...request, scope: 'chat-a:3', languageBoost: 'Chinese,Yue' });
    await controller.toggle({ ...request, scope: 'chat-a:4', model: 'speech-2.8-turbo' });
    await controller.toggle({ ...request, scope: 'chat-a:5', voiceId: 'voice-b' });
    await controller.toggle({ ...request, scope: 'chat-a:6', speed: 1.4 });

    assert.equal(synthesizeCount, 6);
});

test('does not reuse cached audio when speech speed differs', async () => {
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop() {} }),
    });
    const request = { scope: 'chat-a:4', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd', speed: 1 };

    await controller.toggle(request);
    await controller.toggle(request);
    await controller.toggle({ ...request, scope: 'chat-a:5', speed: 1.4 });

    assert.equal(synthesizeCount, 2);
});

test('does not reuse cached audio across API regions', async () => {
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop() {} }),
    });
    const request = { scope: 'chat-a:1', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd', apiRegion: 'domestic' };

    await controller.toggle(request);
    await controller.toggle({ ...request, scope: 'chat-a:2', apiRegion: 'international' });

    assert.equal(synthesizeCount, 2);
});

test('a second click on the same floor stops its active audio', async () => {
    let stopCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => new Blob(['audio']),
        play: async () => ({ stop: () => stopCount++ }),
    });
    const request = { scope: 'chat-a:4', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd' };

    await controller.toggle(request);
    assert.equal(controller.isActive(request.scope), true);
    await controller.toggle({ scope: request.scope });

    assert.equal(stopCount, 1);
    assert.equal(controller.isActive(request.scope), false);
});

test('switching between voice fields stops the previous field and toggles the selected one', async () => {
    let stopCount = 0;
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop: () => stopCount++ }),
    });
    const unspokenScope = createVoiceScope('chat-a', 4, 'unspoken');
    const loveScope = createVoiceScope('chat-a', 4, 'love');

    await controller.toggle({ scope: unspokenScope, text: '原来的心声', voiceId: 'v' });
    await controller.toggle({ scope: loveScope, text: '对应的情话', voiceId: 'v' });
    assert.equal(controller.isActive(unspokenScope), false);
    assert.equal(controller.isActive(loveScope), true);
    assert.equal(stopCount, 1);
    await controller.toggle({ scope: loveScope });
    assert.equal(controller.isActive(loveScope), false);
    assert.equal(stopCount, 2);
    assert.equal(synthesizeCount, 2);
});

test('a second click cancels a synthesis request that has not returned yet', async () => {
    let requestSignal;
    let resolveSynthesis;
    const controller = createVoicePlaybackController({
        synthesize: ({ signal }) => {
            requestSignal = signal;
            return new Promise(resolve => { resolveSynthesis = resolve; });
        },
        play: async () => ({ stop() {} }),
    });
    const request = { scope: 'chat-a:4', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd' };

    const pending = controller.toggle(request);
    await controller.toggle(request);
    resolveSynthesis(new Blob(['discarded']));
    await pending;

    assert.equal(requestSignal.aborted, true);
});

test('reuses cached audio for identical content and settings across floors', async () => {
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop() {} }),
    });
    const request = { scope: 'chat-a:4', text: '心声', voiceId: 'voice-a', model: 'speech-2.8-hd' };

    await controller.toggle(request);
    await controller.toggle(request);
    await controller.toggle(request);
    await controller.toggle({ ...request, scope: 'chat-b:9' });

    assert.equal(synthesizeCount, 1);
});

test('does not reuse cached audio when the text changes', async () => {
    let synthesizeCount = 0;
    const controller = createVoicePlaybackController({
        synthesize: async () => {
            synthesizeCount++;
            return new Blob(['audio']);
        },
        play: async () => ({ stop() {} }),
    });
    const request = { scope: 'chat-a:1', text: '第一句心声', voiceId: 'voice-a', model: 'speech-2.8-hd' };

    await controller.toggle(request);
    await controller.toggle({ ...request, scope: 'chat-a:2', text: '第二句心声' });

    assert.equal(synthesizeCount, 2);
});

test('a late result from another floor cannot replace the selected floor audio', async () => {
    let resolveFirst;
    const played = [];
    const controller = createVoicePlaybackController({
        synthesize: ({ text }) => text === '旧楼层'
            ? new Promise(resolve => { resolveFirst = resolve; })
            : Promise.resolve(new Blob(['new audio'])),
        play: async (blob, { scope }) => {
            played.push(scope);
            return { stop() {} };
        },
    });

    const first = controller.toggle({ scope: 'chat-a:2', text: '旧楼层', voiceId: 'v', model: 'speech-2.8-hd' });
    await controller.toggle({ scope: 'chat-a:3', text: '新楼层', voiceId: 'v', model: 'speech-2.8-hd' });
    resolveFirst(new Blob(['old audio']));
    await first;

    assert.deepEqual(played, ['chat-a:3']);
});
