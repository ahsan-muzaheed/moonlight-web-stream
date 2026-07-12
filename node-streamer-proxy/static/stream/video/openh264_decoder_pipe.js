var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { OpenH264Decoder } from "../../libopenh264/index.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { emptyVideoCodecs } from "../video.js";
/// A fallback for the normal VideoDecoder that only works in a secure context
export class OpenH264DecoderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            const videoCodecs = emptyVideoCodecs();
            videoCodecs.H264 = true;
            let environmentSupported = false;
            try {
                yield import("../../libopenh264/decoder.js");
                environmentSupported = true;
            }
            catch (e) { }
            // no link
            return {
                environmentSupported,
                supportedVideoCodecs: videoCodecs
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.isReady = false;
        this.decoder = null;
        this.errored = false;
        this.lastTimestamp = 0;
        this.lastDuration = 0;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.implementationName = `openh264_decode -> ${base.implementationName}`;
        this.base = base;
        const createOpenH264Module = () => __awaiter(this, void 0, void 0, function* () {
            const module = yield import("../../libopenh264/decoder.js");
            return yield module.default();
        });
        this.onReady = createOpenH264Module().then(module => {
            this.decoder = new OpenH264Decoder(module, {
                onFrame: this.onFrame.bind(this)
            });
            this.isReady = true;
        });
        addPipePassthrough(this);
    }
    setup() {
        var arguments_1 = arguments;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isReady) {
                yield this.onReady;
            }
            if ("setup" in this.base && typeof this.base.setup == "function") {
                return yield this.base.setup(...arguments_1);
            }
        });
    }
    submitDecodeUnit(unit) {
        var _a, _b;
        if (this.errored) {
            return;
        }
        // TODO: add this into the decoder api
        this.lastTimestamp = unit.timestampMicroseconds;
        this.lastDuration = unit.timestampMicroseconds;
        try {
            (_a = this.decoder) === null || _a === void 0 ? void 0 : _a.decode(new Uint8Array(unit.data));
        }
        catch (e) {
            console.error(e);
            (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Error whilst decoding frame using h264: ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`, { type: "fatalDescription" });
            this.errored = true;
        }
    }
    onFrame(buffers, stride, width, height) {
        this.base.submitRawFrame({
            yPlane: buffers[0],
            uPlane: buffers[1],
            vPlane: buffers[2],
            yStride: stride[0],
            uvStride: stride[1],
            width,
            height,
            timestampMicroseconds: this.lastTimestamp,
            durationMicroseconds: this.lastDuration,
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
OpenH264DecoderPipe.baseType = "yuv420videoframe";
OpenH264DecoderPipe.type = "videodata";
