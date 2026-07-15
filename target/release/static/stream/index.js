var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { TransportChannelId } from "../api_bindings.js";
import { showNotification } from "../component/notification.js";
import { buildAudioPipeline } from "./audio/pipeline.js";
import { BIG_BUFFER, ByteBuffer } from "./buffer.js";
import { defaultStreamInputConfig, StreamInput } from "./input.js";
import { Logger } from "./log.js";
import { gatherPipeInfo } from "./pipeline/index.js";
import { StreamStats } from "./stats.js";
import { WebSocketTransport } from "./transport/web_socket.js";
import { WebRTCTransport } from "./transport/webrtc.js";
import { allVideoCodecs, andVideoCodecs, createSupportedVideoFormatsBits, emptyVideoCodecs, getSelectedVideoCodec, hasAnyCodec } from "./video.js";
import { buildVideoPipeline } from "./video/pipeline.js";
export function getStreamerSize(settings, viewerScreenSize) {
    let width, height;
    if (settings.videoSize == "720p") {
        width = 1280;
        height = 720;
    }
    else if (settings.videoSize == "1080p") {
        width = 1920;
        height = 1080;
    }
    else if (settings.videoSize == "1440p") {
        width = 2560;
        height = 1440;
    }
    else if (settings.videoSize == "4k") {
        width = 3840;
        height = 2160;
    }
    else if (settings.videoSize == "custom") {
        width = settings.videoSizeCustom.width;
        height = settings.videoSizeCustom.height;
    }
    else { // native
        width = viewerScreenSize[0];
        height = viewerScreenSize[1];
    }
    return [width, height];
}
function getVideoCodecHint(settings) {
    let videoCodecHint = emptyVideoCodecs();
    if (settings.videoCodec == "h264") {
        videoCodecHint.H264 = true;
        videoCodecHint.H264_HIGH8_444 = true;
    }
    else if (settings.videoCodec == "h265") {
        videoCodecHint.H265 = true;
        videoCodecHint.H265_MAIN10 = true;
        videoCodecHint.H265_REXT8_444 = true;
        videoCodecHint.H265_REXT10_444 = true;
    }
    else if (settings.videoCodec == "av1") {
        videoCodecHint.AV1_MAIN8 = true;
        videoCodecHint.AV1_MAIN10 = true;
        videoCodecHint.AV1_HIGH8_444 = true;
        videoCodecHint.AV1_HIGH10_444 = true;
    }
    else if (settings.videoCodec == "auto") {
        videoCodecHint = allVideoCodecs();
    }
    if (isFirefox()) {
        videoCodecHint.AV1_MAIN10 = false;
        videoCodecHint.AV1_HIGH10_444 = false;
    }
    return videoCodecHint;
}
function isFirefox() {
    return navigator.userAgent.includes("Firefox/");
}
const WEBRTC_CONNECT_TIMEOUT_MS = 15000;
const FALLBACK_RECONNECT_DELAY_MS = 500;
export class Stream {
    constructor(api, hostId, appId, settings, viewerScreenSize, permissions) {
        this.logger = new Logger();
        this.divElement = document.createElement("div");
        this.eventTarget = new EventTarget();
        this.iceServers = null;
        this.transportOverride = null;
        this.videoRenderer = null;
        this.audioPlayer = null;
        this.hasConnectionComplete = false;
        this.hasVideoReady = false;
        this.hasDispatchedVideoReady = false;
        this.transport = null;
        // -- Raw Web Socket stuff
        this.wsSendBuffer = [];
        this.logger.addInfoListener((info, type) => {
            this.debugLog(info, { type: type !== null && type !== void 0 ? type : undefined });
        });
        this.api = api;
        this.hostId = hostId;
        this.appId = appId;
        this.permissions = permissions;
        this.settings = settings;
        this.streamerSize = getStreamerSize(settings, viewerScreenSize);
        this.ws = this.createControlWebSocket();
        this.sendInitMessage();
        // Stream Input
        const streamInputConfig = defaultStreamInputConfig();
        Object.assign(streamInputConfig, {
            mouseMode: this.settings.mouseMode,
            mouseScrollMode: this.settings.mouseScrollMode,
            touchMode: this.settings.touchMode,
            localCursorSensitivity: this.settings.localCursorSensitivity,
            controllerConfig: this.settings.controllerConfig
        });
        this.input = new StreamInput(streamInputConfig);
        // Stream Stats
        this.stats = new StreamStats(this.logger);
    }
    debugLog(message, additional) {
        for (const line of message.split("\n")) {
            const event = new CustomEvent("stream-info", {
                detail: { type: "addDebugLine", line, additional }
            });
            this.eventTarget.dispatchEvent(event);
        }
    }
    resetVideoReadyState() {
        this.hasConnectionComplete = false;
        this.hasVideoReady = false;
        this.hasDispatchedVideoReady = false;
    }
    markConnectionComplete() {
        this.hasConnectionComplete = true;
        this.tryDispatchVideoReady();
    }
    markVideoReady() {
        this.hasVideoReady = true;
        this.tryDispatchVideoReady();
    }
    tryDispatchVideoReady() {
        if (!this.hasConnectionComplete || !this.hasVideoReady || this.hasDispatchedVideoReady) {
            return;
        }
        this.hasDispatchedVideoReady = true;
        const event = new CustomEvent("stream-info", {
            detail: { type: "videoReady" }
        });
        this.eventTarget.dispatchEvent(event);
    }
    onMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if ("DebugLog" in message) {
                const debugLog = message.DebugLog;
                this.debugLog(debugLog.message, {
                    type: (_a = debugLog.ty) !== null && _a !== void 0 ? _a : undefined
                });
            }
            else if ("UpdateApp" in message) {
                const event = new CustomEvent("stream-info", {
                    detail: { type: "app", app: message.UpdateApp.app }
                });
                this.eventTarget.dispatchEvent(event);
            }
            else if ("ConnectionComplete" in message) {
                const capabilities = message.ConnectionComplete.capabilities;
                const formatRaw = message.ConnectionComplete.format;
                const width = message.ConnectionComplete.width;
                const height = message.ConnectionComplete.height;
                const fps = message.ConnectionComplete.fps;
                const audioSampleRate = message.ConnectionComplete.audio_sample_rate;
                const audioChannelCount = message.ConnectionComplete.audio_channel_count;
                const audioStreams = message.ConnectionComplete.audio_streams;
                const audioCoupledStreams = message.ConnectionComplete.audio_coupled_streams;
                const audioSamplesPerFrame = message.ConnectionComplete.audio_samples_per_frame;
                const audioMapping = message.ConnectionComplete.audio_mapping;
                const format = getSelectedVideoCodec(formatRaw);
                if (format == null) {
                    this.debugLog(`Video Format ${formatRaw} was not found! Couldn't start stream!`, { type: "fatal" });
                    return;
                }
                const event = new CustomEvent("stream-info", {
                    detail: { type: "connectionComplete", capabilities }
                });
                this.eventTarget.dispatchEvent(event);
                this.input.onStreamStart(capabilities, [width, height]);
                this.stats.setVideoInfo(format !== null && format !== void 0 ? format : "Unknown", width, height, fps);
                // HDR state will be set when server sends HdrModeUpdate message
                // Don't initialize from settings.hdr because that's just the user's preference,
                // not the actual HDR state (which depends on host support, display, and codec)
                if (this.settings.hdr) {
                    this.debugLog("HDR requested by user, waiting for host confirmation...");
                }
                // we should allow streaming without audio
                if (!this.audioPlayer) {
                    showNotification("Failed to find supported audio player -> audio is missing.");
                }
                if (!this.videoRenderer || !this.audioPlayer) {
                    throw "Video renderer or audio player not initialized!";
                }
                yield Promise.all([
                    this.videoRenderer.setup({
                        codec: format,
                        fps,
                        width,
                        height,
                    }),
                    this.audioPlayer.setup({
                        sampleRate: audioSampleRate,
                        channels: audioChannelCount,
                        streams: audioStreams,
                        coupledStreams: audioCoupledStreams,
                        samplesPerFrame: audioSamplesPerFrame,
                        mapping: audioMapping,
                    })
                ]);
                this.markConnectionComplete();
            }
            else if ("ConnectionTerminated" in message) {
                const code = message.ConnectionTerminated.error_code;
                this.debugLog(`ConnectionTerminated with code ${code}`, { type: "fatalDescription" });
            }
            // -- WebRTC Config
            else if ("Setup" in message) {
                const iceServers = message.Setup.ice_servers;
                this.iceServers = iceServers;
                this.debugLog(`window.isSecureContext: ${window.isSecureContext}`);
                this.debugLog(`Using WebRTC Ice Servers: ${createPrettyList(iceServers.map(server => server.urls).reduce((list, url) => list.concat(url), []))}`);
                yield this.startConnection();
            }
            // -- WebRTC
            else if ("WebRtc" in message) {
                const webrtcMessage = message.WebRtc;
                if (this.transport instanceof WebRTCTransport) {
                    this.transport.onReceiveMessage(webrtcMessage);
                }
                else {
                    this.debugLog(`Received WebRTC message but transport is currently ${(_b = this.transport) === null || _b === void 0 ? void 0 : _b.implementationName}`);
                }
            }
        });
    }
    startConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            this.debugLog(`Permissions: ${JSON.stringify(this.permissions)}`);
            const desiredTransport = (_a = this.transportOverride) !== null && _a !== void 0 ? _a : this.settings.dataTransport;
            this.debugLog(`Using transport: ${desiredTransport}`);
            if (desiredTransport == "auto") {
                let shutdownReason = yield this.tryWebRTCTransport();
                if (shutdownReason == "failednoconnect") {
                    this.debugLog("Failed to establish WebRTC connection. Falling back to Web Socket transport.", { type: "ifErrorDescription" });
                    yield this.restartWithFreshTransportFallback("websocket");
                    return;
                }
            }
            else if (desiredTransport == "webrtc") {
                yield this.tryWebRTCTransport();
            }
            else if (desiredTransport == "websocket") {
                yield this.tryWebSocketTransport();
            }
            this.debugLog("Tried all configured transport options but no connection was possible", { type: "fatal" });
        });
    }
    createControlWebSocket() {
        const wsApiHost = this.api.host_url.replace(/^http(s)?:/, "ws$1:");
        const ws = new WebSocket(`${wsApiHost}/host/stream`);
        ws.addEventListener("error", (event) => {
            if (this.ws !== ws) {
                return;
            }
            this.onError(event);
        });
        ws.addEventListener("open", () => {
            if (this.ws !== ws) {
                return;
            }
            this.onWsOpen();
        });
        ws.addEventListener("close", () => {
            if (this.ws !== ws) {
                return;
            }
            this.onWsClose();
        });
        ws.addEventListener("message", (event) => {
            if (this.ws !== ws) {
                return;
            }
            this.onRawWsMessage(event);
        });
        return ws;
    }
    sendInitMessage() {
        this.sendWsMessage({
            Init: {
                host_id: this.hostId,
                app_id: this.appId,
                video_frame_queue_size: this.settings.videoFrameQueueSize,
                audio_sample_queue_size: this.settings.audioSampleQueueSize,
            }
        });
    }
    restartWithFreshTransportFallback(transport) {
        return __awaiter(this, void 0, void 0, function* () {
            this.transportOverride = transport;
            this.resetVideoReadyState();
            if (this.transport) {
                yield this.transport.close();
                this.transport = null;
            }
            this.wsSendBuffer.length = 0;
            const oldWs = this.ws;
            if (oldWs.readyState == WebSocket.OPEN || oldWs.readyState == WebSocket.CONNECTING) {
                oldWs.close();
                yield new Promise((resolve) => {
                    const timeout = window.setTimeout(() => resolve(), 1000);
                    oldWs.addEventListener("close", () => {
                        window.clearTimeout(timeout);
                        resolve();
                    }, { once: true });
                });
            }
            yield new Promise((resolve) => window.setTimeout(resolve, FALLBACK_RECONNECT_DELAY_MS));
            this.ws = this.createControlWebSocket();
            this.sendInitMessage();
        });
    }
    setTransport(transport) {
        if (this.transport) {
            this.transport.close();
        }
        this.transport = transport;
        this.input.setTransport(this.transport);
        this.stats.setTransport(this.transport);
        const rtt = this.transport.getChannel(TransportChannelId.RTT);
        if (rtt.type == "data") {
            rtt.addReceiveListener((data) => {
                const buffer = new ByteBuffer(data.byteLength);
                buffer.putU8Array(new Uint8Array(data));
                buffer.flip();
                const ty = buffer.getU8();
                if (ty == 0) {
                    rtt.send(data);
                }
            });
        }
        else {
            this.debugLog("Failed to get rtt as data transport channel. Cannot respond to rtt packets");
        }
        // Setup GENERAL channel listener for HDR mode updates
        const generalChannel = this.transport.getChannel(TransportChannelId.GENERAL);
        this.debugLog(`[GENERAL] Setting up GENERAL channel listener, type=${generalChannel.type}`);
        if (generalChannel.type === "data") {
            generalChannel.addReceiveListener((data) => {
                this.onGeneralChannelMessage(data);
            });
            this.debugLog(`[GENERAL] GENERAL channel listener registered`);
        }
        else {
            this.debugLog(`[GENERAL] Cannot register listener, channel type is not 'data'`);
        }
    }
    onGeneralChannelMessage(data) {
        this.debugLog(`[GENERAL] Received message on GENERAL channel, size=${data.byteLength}`);
        const buffer = new Uint8Array(data);
        if (buffer.length < 2) {
            this.debugLog(`[GENERAL] Message too short: ${buffer.length} bytes`);
            return;
        }
        const textLength = (buffer[0] << 8) | buffer[1];
        if (buffer.length < 2 + textLength) {
            this.debugLog(`[GENERAL] Message incomplete: expected ${2 + textLength} bytes, got ${buffer.length}`);
            return;
        }
        const text = new TextDecoder().decode(buffer.slice(2, 2 + textLength));
        this.debugLog(`[GENERAL] Parsed message: ${text}`);
        try {
            const message = JSON.parse(text);
            this.handleGeneralMessage(message);
        }
        catch (err) {
            this.debugLog(`Failed to parse general message: ${err}`);
        }
    }
    handleGeneralMessage(message) {
        if ("HdrModeUpdate" in message) {
            const hdrUpdate = message.HdrModeUpdate;
            if (hdrUpdate) {
                const enabled = hdrUpdate.enabled;
                this.debugLog(`HDR mode ${enabled ? "enabled" : "disabled"}`);
                this.setHdrMode(enabled);
            }
        }
        else if ("ConnectionStatusUpdate" in message) {
            const statusUpdate = message.ConnectionStatusUpdate;
            if (statusUpdate) {
                const status = statusUpdate.status;
                const event = new CustomEvent("stream-info", {
                    detail: { type: "connectionStatus", status }
                });
                this.eventTarget.dispatchEvent(event);
            }
        }
    }
    setHdrMode(enabled) {
        this.stats.setHdrEnabled(enabled);
        if (this.videoRenderer) {
            if ("setHdrMode" in this.videoRenderer && typeof this.videoRenderer.setHdrMode === "function") {
                this.videoRenderer.setHdrMode(enabled);
            }
        }
    }
    sendGeneralMessage(message) {
        var _a;
        const general = (_a = this.transport) === null || _a === void 0 ? void 0 : _a.getChannel(TransportChannelId.GENERAL);
        if (!general || general.type != "data") {
            return false;
        }
        const text = JSON.stringify(message);
        const buffer = BIG_BUFFER;
        buffer.reset();
        buffer.putU16(text.length);
        buffer.putUtf8Raw(text);
        buffer.flip();
        general.send(buffer.getRemainingBuffer().buffer);
        return true;
    }
    tryWebRTCTransport() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.permissions.allow_transport_webrtc) {
                this.debugLog("Not trying WebRTC transport because permissions disallow it");
                return "failednoconnect";
            }
            this.debugLog("Trying WebRTC transport");
            this.sendWsMessage({
                SetTransport: "WebRTC"
            });
            if (!this.iceServers) {
                this.debugLog(`Failed to try WebRTC Transport: no ice servers available`);
                return "failednoconnect";
            }
            const transport = new WebRTCTransport(this.logger);
            transport.onsendmessage = (message) => this.sendWsMessage({ WebRtc: message });
            transport.initPeer({
                iceServers: this.iceServers
            });
            this.setTransport(transport);
            const videoCodecSupport = yield this.createPipelines();
            if (!videoCodecSupport) {
                this.debugLog("No video pipeline was found for the codec that was specified. If you're unsure which codecs are supported use H264.", { type: "fatalDescription" });
                yield transport.close();
                return "failednoconnect";
            }
            // Starting the stream will start negotiation
            yield this.startStream(videoCodecSupport);
            // Wait for negotiation, but don't let a stuck ICE check block fallback forever.
            const result = yield new Promise((resolve) => {
                const timeout = window.setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    this.debugLog(`WebRTC negotiation timed out after ${WEBRTC_CONNECT_TIMEOUT_MS}ms`);
                    transport.onconnect = null;
                    transport.onclose = null;
                    yield transport.close();
                    resolve(false);
                }), WEBRTC_CONNECT_TIMEOUT_MS);
                transport.onconnect = () => {
                    window.clearTimeout(timeout);
                    resolve(true);
                };
                transport.onclose = () => {
                    window.clearTimeout(timeout);
                    resolve(false);
                };
            });
            this.debugLog(`WebRTC negotiation success: ${result}`);
            if (!result) {
                return "failednoconnect";
            }
            return new Promise((resolve) => {
                transport.onclose = (shutdown) => {
                    resolve(shutdown);
                };
            });
        });
    }
    tryWebSocketTransport() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.permissions.allow_transport_websockets) {
                this.debugLog("Not trying WebSocket transport becaues permissions disallow it");
                return;
            }
            this.debugLog("Trying Web Socket transport");
            this.sendWsMessage({
                SetTransport: "WebSocket"
            });
            const transport = new WebSocketTransport(this.ws, BIG_BUFFER, this.logger);
            this.setTransport(transport);
            const videoCodecSupport = yield this.createPipelines();
            if (!videoCodecSupport) {
                this.debugLog("Failed to start stream because no video pipeline with support for the specified codec was found!", { type: "fatalDescription" });
                return;
            }
            yield this.startStream(videoCodecSupport);
            return new Promise((resolve) => {
                transport.onclose = (shutdown) => {
                    resolve(shutdown);
                };
            });
        });
    }
    createPipelines() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // Print supported pipes
            const pipesInfo = yield gatherPipeInfo();
            this.logger.debug(`Supported Pipes: {`);
            let isFirst = true;
            for (const [pipe, info] of pipesInfo) {
                this.logger.debug(`${isFirst ? "" : ","}"${pipe.name}": ${JSON.stringify(info)}`);
                isFirst = false;
            }
            this.logger.debug(`}`);
            // Create pipelines
            const [supportedVideoCodecs] = yield Promise.all([this.createVideoRenderer(), this.createAudioPlayer()]);
            const videoPipelineName = `${(_a = this.transport) === null || _a === void 0 ? void 0 : _a.getChannel(TransportChannelId.HOST_VIDEO).type} (transport) -> ${(_b = this.videoRenderer) === null || _b === void 0 ? void 0 : _b.implementationName} (renderer)`;
            this.debugLog(`Using video pipeline: ${videoPipelineName}`);
            const audioPipelineName = `${(_c = this.transport) === null || _c === void 0 ? void 0 : _c.getChannel(TransportChannelId.HOST_AUDIO).type} (transport) -> ${(_d = this.audioPlayer) === null || _d === void 0 ? void 0 : _d.implementationName} (player)`;
            this.debugLog(`Using audio pipeline: ${audioPipelineName}`);
            this.stats.setVideoPipeline(videoPipelineName, this.videoRenderer);
            this.stats.setAudioPipeline(audioPipelineName, this.audioPlayer);
            return supportedVideoCodecs;
        });
    }
    createVideoRenderer() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.videoRenderer) {
                this.debugLog("Found an old video renderer -> cleaning it up");
                this.videoRenderer.unmount(this.divElement);
                this.videoRenderer.cleanup();
                this.videoRenderer = null;
            }
            if (!this.transport) {
                this.debugLog("Failed to setup video without transport");
                return null;
            }
            const codecHint = getVideoCodecHint(this.settings);
            this.debugLog(`Codec Hint by the user: ${JSON.stringify(codecHint)}`);
            if (!hasAnyCodec(codecHint)) {
                this.debugLog("Couldn't find any supported video format. Change the codec option to H264 in the settings if you're unsure which codecs are supported.", { type: "fatalDescription" });
                return null;
            }
            const transportCodecSupport = yield this.transport.setupHostVideo({
                type: ["videotrack", "data"]
            });
            this.debugLog(`Transport supports these video codecs: ${JSON.stringify(transportCodecSupport)}`);
            const videoSettings = {
                supportedVideoCodecs: andVideoCodecs(codecHint, transportCodecSupport),
                canvasRenderer: this.settings.canvasRenderer,
                forceVideoElementRenderer: this.settings.forceVideoElementRenderer,
                canvasVsync: this.settings.canvasVsync
            };
            let pipelineCodecSupport;
            const video = this.transport.getChannel(TransportChannelId.HOST_VIDEO);
            if (video.type == "videotrack") {
                const { videoRenderer, supportedCodecs, error } = yield buildVideoPipeline("videotrack", videoSettings, this.logger);
                if (error) {
                    return null;
                }
                pipelineCodecSupport = supportedCodecs;
                videoRenderer.mount(this.divElement);
                video.addTrackListener((track) => {
                    this.markVideoReady();
                    videoRenderer.setTrack(track);
                });
                this.videoRenderer = videoRenderer;
            }
            else if (video.type == "data") {
                const { videoRenderer, supportedCodecs, error } = yield buildVideoPipeline("data", videoSettings, this.logger);
                if (error) {
                    return null;
                }
                pipelineCodecSupport = supportedCodecs;
                videoRenderer.mount(this.divElement);
                video.addReceiveListener((data) => {
                    this.markVideoReady();
                    videoRenderer.submitPacket(data);
                    // data pipeline support requesting idrs over video channel
                    if (videoRenderer.pollRequestIdr()) {
                        const buffer = new ByteBuffer(1);
                        buffer.putU8(0);
                        buffer.flip();
                        video.send(buffer.getRemainingBuffer().buffer);
                    }
                });
                this.videoRenderer = videoRenderer;
            }
            else {
                this.debugLog(`Failed to create video pipeline with transport channel of type ${video.type} (${this.transport.implementationName})`);
                return null;
            }
            return pipelineCodecSupport;
        });
    }
    createAudioPlayer() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this.audioPlayer) {
                this.debugLog("Found an old audio player -> cleaning it up");
                this.audioPlayer.unmount(this.divElement);
                this.audioPlayer.cleanup();
                this.audioPlayer = null;
            }
            if (!this.transport) {
                this.debugLog("Failed to setup audio without transport");
                return false;
            }
            this.transport.setupHostAudio({
                type: ["audiotrack", "data"]
            });
            const audio = (_a = this.transport) === null || _a === void 0 ? void 0 : _a.getChannel(TransportChannelId.HOST_AUDIO);
            if (audio.type == "audiotrack") {
                const { audioPlayer, error } = yield buildAudioPipeline("audiotrack", this.settings, this.logger);
                if (error) {
                    return false;
                }
                audioPlayer.mount(this.divElement);
                audio.addTrackListener((track) => audioPlayer.setTrack(track));
                this.audioPlayer = audioPlayer;
            }
            else if (audio.type == "data") {
                const { audioPlayer, error } = yield buildAudioPipeline("data", this.settings, this.logger);
                if (error) {
                    return false;
                }
                audioPlayer.mount(this.divElement);
                audio.addReceiveListener((data) => {
                    audioPlayer.submitPacket(data);
                });
                this.audioPlayer = audioPlayer;
            }
            else {
                this.debugLog(`Cannot find audio pipeline for transport type "${audio.type}"`);
                return false;
            }
            return true;
        });
    }
    startStream(videoCodecSupport) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const settings = {
                bitrate_kbps: this.settings.bitrate,
                fps: this.settings.fps,
                width: this.streamerSize[0],
                height: this.streamerSize[1],
                play_audio_local: this.settings.playAudioLocal,
                supported_codecs: createSupportedVideoFormatsBits(videoCodecSupport),
                hdr: (_a = this.settings.hdr) !== null && _a !== void 0 ? _a : false,
            };
            const message = {
                StartStream: {
                    settings
                }
            };
            this.debugLog(`Starting stream with info: ${JSON.stringify(message)}`);
            this.debugLog(`Stream video codec info: ${JSON.stringify(videoCodecSupport)}`);
            // Log HDR requirements if HDR is requested
            if (this.settings.hdr) {
                const hasHdrCodec = videoCodecSupport.H265_MAIN10 || videoCodecSupport.AV1_MAIN10;
                if (!hasHdrCodec) {
                    this.debugLog(`Warning: HDR requested but no 10-bit codec available. HDR requires H265_MAIN10 or AV1_MAIN10 support.`);
                }
                else {
                    this.debugLog(`HDR codec available: H265_MAIN10=${videoCodecSupport.H265_MAIN10}, AV1_MAIN10=${videoCodecSupport.AV1_MAIN10}`);
                }
            }
            this.sendWsMessage(message);
        });
    }
    mount(parent) {
        parent.appendChild(this.divElement);
    }
    unmount(parent) {
        parent.removeChild(this.divElement);
    }
    getVideoRenderer() {
        return this.videoRenderer;
    }
    getAudioPlayer() {
        return this.audioPlayer;
    }
    onWsOpen() {
        this.debugLog(`Web Socket Open`);
        for (const raw of this.wsSendBuffer.splice(0)) {
            this.ws.send(raw);
        }
    }
    onWsClose() {
        this.debugLog(`Web Socket Closed`);
    }
    onError(event) {
        this.debugLog(`Web Socket or WebRtcPeer Error`);
        console.error(`Web Socket or WebRtcPeer Error`, event);
    }
    sendWsMessage(message) {
        const raw = JSON.stringify(message);
        if (this.ws.readyState == WebSocket.OPEN) {
            this.ws.send(raw);
        }
        else {
            this.wsSendBuffer.push(raw);
        }
    }
    onRawWsMessage(event) {
        const message = event.data;
        if (typeof message == "string") {
            const json = JSON.parse(message);
            this.onMessage(json);
        }
    }
    stop() {
        if (!this.sendGeneralMessage("Stop")) {
            return Promise.resolve(false);
        }
        // Wait for the message to get sent
        return new Promise((resolve, _reject) => {
            setTimeout(() => resolve(true), 100);
        });
    }
    // -- Class Api
    addInfoListener(listener) {
        this.eventTarget.addEventListener("stream-info", listener);
    }
    removeInfoListener(listener) {
        this.eventTarget.removeEventListener("stream-info", listener);
    }
    getInput() {
        return this.input;
    }
    getStats() {
        return this.stats;
    }
    getStreamerSize() {
        return this.streamerSize;
    }
}
function createPrettyList(list) {
    return `[${list.join(", ")}]`;
}
