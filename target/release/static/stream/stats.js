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
import { BIG_BUFFER } from "./buffer.js";
function num(value, suffix) {
    if (value == null) {
        return null;
    }
    else {
        return `${value.toFixed(2)}${suffix !== null && suffix !== void 0 ? suffix : ""}`;
    }
}
export function streamStatsToText(statsData) {
    let text = `stats:
video information: ${statsData.videoCodec}, ${statsData.videoWidth}x${statsData.videoHeight}, ${statsData.videoFps} fps
HDR: ${statsData.hdrEnabled === true ? "Enabled" : statsData.hdrEnabled === false ? "Disabled" : "Unknown"}
video pipeline: ${statsData.videoPipeline}
audio pipeline: ${statsData.audioPipeline}
streamer round trip time: ${num(statsData.streamerRttMs, "ms")} (variance: ${num(statsData.streamerRttVarianceMs, "ms")})
host processing latency min/max/avg: ${num(statsData.minHostProcessingLatencyMs, "ms")} / ${num(statsData.maxHostProcessingLatencyMs, "ms")} / ${num(statsData.avgHostProcessingLatencyMs, "ms")}
streamer processing latency min/max/avg: ${num(statsData.minStreamerProcessingTimeMs, "ms")} / ${num(statsData.maxStreamerProcessingTimeMs, "ms")} / ${num(statsData.avgStreamerProcessingTimeMs, "ms")}
streamer to browser rtt (ws only): ${num(statsData.browserRtt, "ms")}
`;
    for (const key in statsData.transport) {
        const value = statsData.transport[key];
        let valuePretty = value;
        if (typeof value == "number" && key.endsWith("Ms")) {
            valuePretty = `${num(value, "ms")}`;
        }
        text += `${key}: ${valuePretty}\n`;
    }
    for (const key in statsData.video) {
        const value = statsData.video[key];
        let valuePretty = value;
        if (typeof value == "number" && key.endsWith("Ms")) {
            valuePretty = `${num(value, "ms")}`;
        }
        text += `${key}: ${valuePretty}\n`;
    }
    for (const key in statsData.audio) {
        const value = statsData.audio[key];
        let valuePretty = value;
        if (typeof value == "number" && key.endsWith("Ms")) {
            valuePretty = `${num(value, "ms")}`;
        }
        text += `${key}: ${valuePretty}\n`;
    }
    return text;
}
export class StreamStats {
    constructor(logger) {
        this.logger = null;
        this.enabled = false;
        this.transport = null;
        this.statsChannel = null;
        this.updateIntervalId = null;
        this.videoPipe = null;
        this.audioPipe = null;
        this.statsData = {
            videoCodec: null,
            videoWidth: null,
            videoHeight: null,
            videoFps: null,
            videoPipeline: null,
            audioPipeline: null,
            hdrEnabled: null,
            streamerRttMs: null,
            streamerRttVarianceMs: null,
            minHostProcessingLatencyMs: null,
            maxHostProcessingLatencyMs: null,
            avgHostProcessingLatencyMs: null,
            minStreamerProcessingTimeMs: null,
            maxStreamerProcessingTimeMs: null,
            avgStreamerProcessingTimeMs: null,
            browserRtt: null,
            transport: {},
            video: {},
            audio: {}
        };
        this.buffer = BIG_BUFFER;
        if (logger) {
            this.logger = logger;
        }
    }
    setTransport(transport) {
        this.transport = transport;
        this.checkEnabled();
    }
    checkEnabled() {
        var _a;
        if (this.enabled) {
            if (this.statsChannel) {
                this.statsChannel.removeReceiveListener(this.onRawData.bind(this));
                this.statsChannel = null;
            }
            if (!this.statsChannel && this.transport) {
                const channel = this.transport.getChannel(TransportChannelId.STATS);
                if (channel.type != "data") {
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Failed initialize debug transport channel because type is "${channel.type}" and not "data"`);
                    return;
                }
                channel.addReceiveListener(this.onRawData.bind(this));
                this.statsChannel = channel;
            }
            if (this.updateIntervalId == null) {
                this.updateIntervalId = setInterval(this.updateLocalStats.bind(this), 1000);
            }
        }
        else {
            if (this.updateIntervalId != null) {
                clearInterval(this.updateIntervalId);
                this.updateIntervalId = null;
            }
        }
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        this.checkEnabled();
    }
    isEnabled() {
        return this.enabled;
    }
    toggle() {
        this.setEnabled(!this.isEnabled());
    }
    onRawData(data) {
        this.buffer.reset();
        this.buffer.putU8Array(new Uint8Array(data));
        this.buffer.flip();
        const textLength = this.buffer.getU16();
        const text = this.buffer.getUtf8Raw(textLength);
        const json = JSON.parse(text);
        this.onMessage(json);
    }
    onMessage(msg) {
        if ("Rtt" in msg) {
            this.statsData.streamerRttMs = msg.Rtt.rtt_ms;
            this.statsData.streamerRttVarianceMs = msg.Rtt.rtt_variance_ms;
        }
        else if ("Video" in msg) {
            if (msg.Video.host_processing_latency) {
                this.statsData.minHostProcessingLatencyMs = msg.Video.host_processing_latency.min_host_processing_latency_ms;
                this.statsData.maxHostProcessingLatencyMs = msg.Video.host_processing_latency.max_host_processing_latency_ms;
                this.statsData.avgHostProcessingLatencyMs = msg.Video.host_processing_latency.avg_host_processing_latency_ms;
            }
            else {
                this.statsData.minHostProcessingLatencyMs = null;
                this.statsData.maxHostProcessingLatencyMs = null;
                this.statsData.avgHostProcessingLatencyMs = null;
            }
            this.statsData.minStreamerProcessingTimeMs = msg.Video.min_streamer_processing_time_ms;
            this.statsData.maxStreamerProcessingTimeMs = msg.Video.max_streamer_processing_time_ms;
            this.statsData.avgStreamerProcessingTimeMs = msg.Video.avg_streamer_processing_time_ms;
        }
        else if ("BrowserRtt" in msg) {
            this.statsData.browserRtt = msg.BrowserRtt.rtt_ms;
        }
    }
    updateLocalStats() {
        return __awaiter(this, void 0, void 0, function* () {
            Promise.all([
                this.updateTransportStats(),
                this.updateVideoStats(),
                this.updateAudioStats(),
            ]);
        });
    }
    updateTransportStats() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.transport) {
                console.debug("Cannot query stats without transport");
                return;
            }
            const stats = yield ((_a = this.transport) === null || _a === void 0 ? void 0 : _a.getStats());
            for (const key in stats) {
                const value = stats[key];
                this.statsData.transport[key] = value;
            }
        });
    }
    updateVideoStats() {
        return __awaiter(this, void 0, void 0, function* () {
            const stats = {};
            if (this.videoPipe && this.videoPipe.reportStats) {
                this.videoPipe.reportStats(stats);
            }
            this.statsData.video = stats;
        });
    }
    updateAudioStats() {
        return __awaiter(this, void 0, void 0, function* () {
            const stats = {};
            if (this.audioPipe && this.audioPipe.reportStats) {
                this.audioPipe.reportStats(stats);
            }
            this.statsData.audio = stats;
        });
    }
    setVideoInfo(codec, width, height, fps) {
        this.statsData.videoCodec = codec;
        this.statsData.videoWidth = width;
        this.statsData.videoHeight = height;
        this.statsData.videoFps = fps;
    }
    setVideoPipeline(name, pipe) {
        this.statsData.videoPipeline = name;
        this.videoPipe = pipe;
    }
    setAudioPipeline(name, pipe) {
        this.statsData.audioPipeline = name;
        this.audioPipe = pipe;
    }
    setHdrEnabled(enabled) {
        this.statsData.hdrEnabled = enabled;
    }
    getCurrentStats() {
        const data = {};
        Object.assign(data, this.statsData);
        return data;
    }
}
