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
function detectCodec() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!("isConfigSupported" in AudioDecoder)) {
            // Opus is most likely supported
            return true;
        }
        const supported = yield AudioDecoder.isConfigSupported({
            codec: "opus",
            // normal Stereo configuration
            numberOfChannels: 2,
            sampleRate: 48000
        });
        return (_a = supported === null || supported === void 0 ? void 0 : supported.supported) !== null && _a !== void 0 ? _a : false;
    });
}
export class AudioDecoderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "AudioDecoder" in globalObject() && (yield detectCodec()),
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.errored = false;
        this.isFirstPacket = true;
        this.implementationName = `audio_decoder -> ${base.implementationName}`;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.base = base;
        this.decoder = new AudioDecoder({
            error: this.onError.bind(this),
            output: this.onOutput.bind(this)
        });
        addPipePassthrough(this);
    }
    onError(error) {
        var _a;
        this.errored = true;
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`AudioDecoder has an error ${"toString" in error ? error.toString() : `${error}`}`, { type: "fatal" });
        console.error(error);
    }
    onOutput(sample) {
        this.base.submitSample(sample);
    }
    setup(setup) {
        if ("setup" in this.base && typeof this.base.setup == "function") {
            this.base.setup(setup);
        }
        this.decoder.configure({
            codec: "opus",
            numberOfChannels: setup.channels,
            sampleRate: setup.sampleRate
        });
    }
    decodeAndPlay(unit) {
        if (this.errored) {
            console.debug("Cannot submit audio decode unit because the stream errored");
            return;
        }
        const chunk = new EncodedAudioChunk({
            type: this.isFirstPacket ? "key" : "delta",
            data: unit.data,
            timestamp: unit.timestampMicroseconds,
            duration: unit.durationMicroseconds,
        });
        this.isFirstPacket = false;
        this.decoder.decode(chunk);
    }
    cleanup() {
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            this.base.cleanup();
        }
        this.decoder.close();
    }
    getBase() {
        return this.base;
    }
}
AudioDecoderPipe.baseType = "audiosample";
AudioDecoderPipe.type = "audiodata";
