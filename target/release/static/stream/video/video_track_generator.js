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
export class VideoTrackGeneratorPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // https://developer.mozilla.org/en-US/docs/Web/API/VideoTrackGenerator
            return {
                environmentSupported: "VideoTrackGenerator" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base) {
        this.isFirstSample = true;
        this.implementationName = `video_track_generator -> ${base.implementationName}`;
        this.base = base;
        this.trackGenerator = new VideoTrackGenerator();
        this.writer = this.trackGenerator.writable.getWriter();
        addPipePassthrough(this);
    }
    submitFrame(frame) {
        if (this.isFirstSample) {
            this.isFirstSample = false;
            this.base.setTrack(this.trackGenerator.track);
        }
        this.writer.write(frame);
    }
    getBase() {
        return this.base;
    }
}
VideoTrackGeneratorPipe.baseType = "videotrack";
VideoTrackGeneratorPipe.type = "videoframe";
