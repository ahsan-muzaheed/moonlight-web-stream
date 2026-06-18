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
import { allVideoCodecs } from "../video.js";
function wait(time) {
    return new Promise((resolve, _reject) => {
        setTimeout(resolve, time);
    });
}
export class VideoMediaStreamTrackProcessorPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor
            return {
                environmentSupported: "MediaStreamTrackProcessor" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base) {
        this.running = false;
        this.newProcessor = false;
        this.trackProcessor = null;
        this.implementationName = `media_stream_track_processor -> ${base.implementationName}`;
        this.base = base;
        addPipePassthrough(this);
    }
    setTrack(track) {
        this.trackProcessor = new MediaStreamTrackProcessor({ track });
        this.newProcessor = true;
    }
    readTrack() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            let reader = null;
            while (this.running) {
                if (!reader || this.newProcessor) {
                    this.newProcessor = false;
                    if ((_a = this.trackProcessor) === null || _a === void 0 ? void 0 : _a.readable.locked) {
                        // Shouldn't happen
                        throw "Canvas video track processor is locked";
                    }
                    const newReader = (_b = this.trackProcessor) === null || _b === void 0 ? void 0 : _b.readable.getReader();
                    if (newReader) {
                        reader = newReader;
                    }
                    yield wait(100);
                    continue;
                }
                // TODO: byob?
                const { done, value } = yield reader.read();
                if (done) {
                    console.error("Track Processor is done!");
                    return;
                }
                this.base.submitFrame(value);
            }
        });
    }
    setup(setup) {
        this.running = true;
        this.readTrack();
        if ("setup" in this.base && typeof this.base.setup == "function") {
            return this.base.setup(setup);
        }
    }
    cleanup() {
        this.running = false;
        try {
            if (this.trackProcessor) {
                this.trackProcessor.readable.cancel();
            }
        }
        catch (e) {
            console.error(e);
        }
        this.trackProcessor = null;
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            return this.base.cleanup(...arguments);
        }
    }
    getBase() {
        return this.base;
    }
}
VideoMediaStreamTrackProcessorPipe.baseType = "videoframe";
VideoMediaStreamTrackProcessorPipe.type = "videotrack";
