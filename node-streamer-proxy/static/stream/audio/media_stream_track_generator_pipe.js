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
export class AudioMediaStreamTrackGeneratorPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "MediaStreamTrackGenerator" in globalObject()
            };
        });
    }
    constructor(base) {
        this.isFirstSample = true;
        this.implementationName = `audio_media_stream_track_generator -> ${base.implementationName}`;
        this.base = base;
        this.trackGenerator = new MediaStreamTrackGenerator({ kind: "audio" });
        this.writer = this.trackGenerator.writable.getWriter();
        addPipePassthrough(this);
    }
    submitSample(sample) {
        if (this.isFirstSample) {
            this.isFirstSample = false;
            this.base.setTrack(this.trackGenerator);
        }
        this.writer.write(sample);
    }
    getBase() {
        return this.base;
    }
}
AudioMediaStreamTrackGeneratorPipe.baseType = "audiotrack";
AudioMediaStreamTrackGeneratorPipe.type = "audiosample";
