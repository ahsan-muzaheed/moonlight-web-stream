var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { OpusMultistreamDecoder } from "../../libopus/index.js";
import loadOpus from "../../libopus/libopus.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
// TODO: use AudioWorklets? https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet
export class OpusAudioDecoderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: true
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.errored = false;
        this.decoder = null;
        this.opusModule = null;
        this.setupData = null;
        this.buffer = new Float32Array([]);
        this.channelBuffers = [];
        loadOpus().then(module => this.opusModule = module);
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.implementationName = `opus_decode -> ${base.implementationName}`;
        this.base = base;
        addPipePassthrough(this);
    }
    setup(setup) {
        this.setupData = setup;
        if ("setup" in this.base && typeof this.base.setup == "function") {
            return this.base.setup(...arguments);
        }
    }
    decodeAndPlay(unit) {
        var _a, _b, _c;
        if (this.errored) {
            return;
        }
        if (!this.setupData) {
            this.errored = true;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to play audio sample because audio player is not initialized");
            return;
        }
        if (!this.decoder) {
            if (!this.opusModule) {
                return;
            }
            try {
                this.decoder = new OpusMultistreamDecoder(this.opusModule, this.setupData.sampleRate, this.setupData.channels, this.setupData.streams, this.setupData.coupledStreams, this.setupData.mapping);
            }
            catch (e) {
                this.errored = true;
                const message = `Failed to initialize opus decoder: ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`;
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(message, { type: "informError" });
                return;
            }
            this.buffer = new Float32Array(this.setupData.samplesPerFrame * this.setupData.channels);
        }
        // -- Decode samples
        let samplesDecoded;
        try {
            samplesDecoded = this.decoder.decodeFloat(unit.data, this.buffer, this.setupData.samplesPerFrame, false);
        }
        catch (e) {
            this.errored = true;
            const message = `Failed to decode audio sample: ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`;
            (_c = this.logger) === null || _c === void 0 ? void 0 : _c.debug(message, { type: "informError" });
            return;
        }
        // -- De-interleave interleaved PCM
        // Initialize channel arrays
        const channels = this.setupData.channels;
        if (this.channelBuffers.length != channels) {
            this.channelBuffers = new Array(channels);
            for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
                this.channelBuffers[channelIndex] = new Float32Array(samplesDecoded);
            }
        }
        for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
            if (this.channelBuffers[channelIndex].byteLength < samplesDecoded) {
                this.channelBuffers[channelIndex] = new Float32Array(samplesDecoded);
            }
            for (let sample = 0; sample < samplesDecoded; sample++) {
                this.channelBuffers[channelIndex][sample] = this.buffer[(sample * channels) + channelIndex];
            }
        }
        // -- Pass data to next decoder
        this.base.playPcm({
            durationMicroseconds: unit.durationMicroseconds,
            timestampMicroseconds: unit.timestampMicroseconds,
            channelData: this.channelBuffers
        });
    }
    cleanup() {
        var _a;
        (_a = this.decoder) === null || _a === void 0 ? void 0 : _a.destroy();
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            return this.base.cleanup(...arguments);
        }
    }
    getBase() {
        return this.base;
    }
}
OpusAudioDecoderPipe.baseType = "audiopcm";
OpusAudioDecoderPipe.type = "audiodata";
