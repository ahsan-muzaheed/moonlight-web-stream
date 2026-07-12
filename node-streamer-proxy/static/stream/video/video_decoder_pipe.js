var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { globalObject } from "../../util.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { emptyVideoCodecs, maybeVideoCodecs } from "../video.js";
import { H264StreamVideoTranslator, H265StreamVideoTranslator, VIDEO_DECODER_CODECS_OUT_OF_BAND } from "./annex_b_translator.js";
export const VIDEO_DECODER_CODECS_IN_BAND = {
    // avc1 = out of band config, avc3 = in band with sps, pps, idr
    "H264": "avc3.42E01E",
    "H264_HIGH8_444": "avc3.640032",
    // hvc1 = out of band config, hev1 = in band with sps, pps, idr
    "H265": "hev1.1.6.L93.B0",
    "H265_MAIN10": "hev1.2.4.L120.90",
    "H265_REXT8_444": "hev1.6.6.L93.90",
    "H265_REXT10_444": "hev1.6.10.L120.90",
    // av1 doesn't have in band and out of band distinction
    "AV1_MAIN8": "av01.0.04M.08",
    "AV1_MAIN10": "av01.0.04M.10",
    "AV1_HIGH8_444": "av01.0.08M.08",
    "AV1_HIGH10_444": "av01.0.08M.10"
};
function detectCodecs() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!("isConfigSupported" in VideoDecoder)) {
            return maybeVideoCodecs();
        }
        const codecs = emptyVideoCodecs();
        const promises = [];
        for (const codec in codecs) {
            promises.push((() => __awaiter(this, void 0, void 0, function* () {
                const supportedInBand = yield VideoDecoder.isConfigSupported({
                    codec: VIDEO_DECODER_CODECS_IN_BAND[codec]
                });
                const supportedOutOfBand = yield VideoDecoder.isConfigSupported({
                    codec: VIDEO_DECODER_CODECS_OUT_OF_BAND[codec]
                });
                codecs[codec] = supportedInBand.supported || supportedOutOfBand.supported ? true : false;
            }))());
        }
        yield Promise.all(promises);
        // TODO: Firefox, Safari say they can play this codec, but they can't
        codecs.H264_HIGH8_444 = false;
        return codecs;
    });
}
function getIfConfigSupported(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const supported = yield VideoDecoder.isConfigSupported(config);
        if (supported.supported) {
            return config;
        }
        return null;
    });
}
export class VideoDecoderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            const supported = "VideoDecoder" in globalObject();
            return {
                environmentSupported: supported,
                supportedVideoCodecs: supported ? yield detectCodecs() : emptyVideoCodecs()
            };
        });
    }
    constructor(base, logger) {
        this.fps = 0;
        this.errored = false;
        this.config = null;
        this.translator = null;
        this.decoderSetupFinished = false;
        this.requestedIdr = false;
        this.needsKeyFrame = true;
        this.bufferedUnits = [];
        this.implementationName = `video_decoder -> ${base.implementationName}`;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.base = base;
        this.decoder = new VideoDecoder({
            error: this.onError.bind(this),
            output: this.onOutput.bind(this)
        });
        addPipePassthrough(this);
    }
    onError(error) {
        var _a;
        this.errored = true;
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`VideoDecoder has an error ${"toString" in error ? error.toString() : `${error}`}`, { type: "fatal" });
        console.error(error);
    }
    onOutput(frame) {
        this.base.submitFrame(frame);
    }
    trySetConfig(codec) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config) {
                this.config = yield getIfConfigSupported({
                    codec,
                    hardwareAcceleration: "prefer-hardware",
                    optimizeForLatency: true
                });
            }
            if (!this.config) {
                this.config = yield getIfConfigSupported({
                    codec,
                    optimizeForLatency: true
                });
            }
            if (!this.config) {
                this.config = yield getIfConfigSupported({
                    codec,
                });
            }
        });
    }
    setup(setup) {
        var arguments_1 = arguments;
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            this.fps = setup.fps;
            const codec = VIDEO_DECODER_CODECS_IN_BAND[setup.codec];
            yield this.trySetConfig(codec);
            if (!this.config) {
                if (setup.codec == "H264" || setup.codec == "H264_HIGH8_444") {
                    this.translator = new H264StreamVideoTranslator((_a = this.logger) !== null && _a !== void 0 ? _a : undefined);
                    const codec = VIDEO_DECODER_CODECS_OUT_OF_BAND[setup.codec];
                    yield this.trySetConfig(codec);
                }
                else if (setup.codec == "H265" || setup.codec == "H265_MAIN10" || setup.codec == "H265_REXT8_444" || setup.codec == "H265_REXT10_444") {
                    this.translator = new H265StreamVideoTranslator((_b = this.logger) !== null && _b !== void 0 ? _b : undefined);
                    const codec = VIDEO_DECODER_CODECS_OUT_OF_BAND[setup.codec];
                    yield this.trySetConfig(codec);
                }
                else if (setup.codec == "AV1_MAIN8" || setup.codec == "AV1_MAIN10" || setup.codec == "AV1_HIGH8_444" || setup.codec == "AV1_HIGH10_444") {
                    this.errored = true;
                    (_c = this.logger) === null || _c === void 0 ? void 0 : _c.debug("Av1 stream translator is not implemented currently!", { type: "fatalDescription" });
                    return;
                }
                else {
                    this.errored = true;
                    (_d = this.logger) === null || _d === void 0 ? void 0 : _d.debug(`Failed to find stream translator for codec ${setup.codec}`);
                    return;
                }
            }
            if (!this.config) {
                this.errored = true;
                (_e = this.logger) === null || _e === void 0 ? void 0 : _e.debug(`Failed to setup VideoDecoder for codec ${setup.codec} because of missing config`);
                return;
            }
            (_f = this.translator) === null || _f === void 0 ? void 0 : _f.setBaseConfig(this.config);
            (_g = this.logger) === null || _g === void 0 ? void 0 : _g.debug(`VideoDecoder config: ${JSON.stringify(this.config)}`);
            this.reset();
            this.decoderSetupFinished = true;
            if ("setup" in this.base && typeof this.base.setup == "function") {
                return yield this.base.setup(...arguments_1);
            }
        });
    }
    submitDecodeUnit(unit) {
        var _a;
        if (this.errored) {
            console.debug("Cannot submit video decode unit because the stream errored");
            return;
        }
        if (!this.decoderSetupFinished) {
            this.bufferedUnits.push(unit);
            return;
        }
        if (this.bufferedUnits.length > 0) {
            const bufferedUnits = this.bufferedUnits.splice(0);
            for (const bufferedUnit of bufferedUnits) {
                this.submitDecodeUnit(bufferedUnit);
            }
        }
        if (this.translator) {
            const value = this.translator.submitDecodeUnit(unit);
            if (value.error) {
                this.errored = true;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("VideoDecoder has errored!");
                return;
            }
            const { configure, chunk } = value;
            if (!chunk) {
                console.debug("No chunk received!");
                return;
            }
            if (configure) {
                console.debug("Resetting video decoder config with", configure);
                this.decoder.reset();
                this.decoder.configure(configure);
                // This likely is an idr
                this.requestedIdr = false;
            }
            const encodedChunk = new EncodedVideoChunk({
                type: unit.type,
                timestamp: unit.timestampMicroseconds,
                duration: unit.durationMicroseconds,
                data: chunk,
            });
            this.decoder.decode(encodedChunk);
        }
        else {
            if (unit.type != "key" && this.needsKeyFrame) {
                return;
            }
            this.needsKeyFrame = false;
            this.requestedIdr = false;
            const chunk = new EncodedVideoChunk({
                type: unit.type,
                data: unit.data,
                timestamp: unit.timestampMicroseconds,
                duration: unit.durationMicroseconds
            });
            this.decoder.decode(chunk);
        }
    }
    reset() {
        var _a;
        if (!this.translator) {
            this.decoder.reset();
            this.needsKeyFrame = true;
            if (this.config) {
                this.decoder.configure(this.config);
            }
            else {
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to configure VideoDecoder because of missing config", { type: "fatal" });
            }
        }
        else if (this.config) {
            this.translator.setBaseConfig(this.config);
        }
    }
    pollRequestIdr() {
        let requestIdr = false;
        const estimatedQueueDelayMs = this.decoder.decodeQueueSize * 1000 / this.fps;
        if (estimatedQueueDelayMs > 200 && this.decoder.decodeQueueSize > 2) {
            // We have more than 200ms second backlog in the decoder
            // -> This decoder is ass, request idr, flush that decoder
            if (!this.requestedIdr) {
                requestIdr = true;
                this.reset();
            }
            console.debug(`Requesting idr because of decode queue size(${this.decoder.decodeQueueSize}) and estimated delay of the queue: ${estimatedQueueDelayMs}`);
        }
        if ("pollRequestIdr" in this.base && typeof this.base.pollRequestIdr == "function") {
            if (this.base.pollRequestIdr(...arguments)) {
                requestIdr = true;
            }
        }
        if (requestIdr) {
            this.requestedIdr = true;
        }
        return requestIdr;
    }
    cleanup() {
        this.decoder.close();
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            return this.base.cleanup(arguments);
        }
    }
    getBase() {
        return this.base;
    }
}
VideoDecoderPipe.baseType = "videoframe";
VideoDecoderPipe.type = "videodata";
