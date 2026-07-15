var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ByteBuffer } from "../buffer.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { allVideoCodecs } from "../video.js";
export class DepacketizeVideoPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: true,
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base, logger) {
        this.lastTimestampMicroseconds = 0;
        this.buffer = new ByteBuffer(5);
        this.implementationName = `depacketize_video -> ${base.implementationName}`;
        this.base = base;
        addPipePassthrough(this);
    }
    submitPacket(buffer) {
        const array = new Uint8Array(buffer);
        this.buffer.reset();
        this.buffer.putU8Array(array.slice(0, 5));
        this.buffer.flip();
        const frameType = this.buffer.getU8();
        const timestamp = this.buffer.getU32();
        const duration = timestamp - this.lastTimestampMicroseconds;
        this.base.submitDecodeUnit({
            type: frameType == 0 ? "delta" : "key",
            data: array.slice(5).buffer,
            durationMicroseconds: duration,
            timestampMicroseconds: timestamp,
        });
        this.lastTimestampMicroseconds = timestamp;
        addPipePassthrough(this);
    }
    setup(setup) {
        if ("setup" in this.base && typeof this.base.setup == "function") {
            return this.base.setup(...arguments);
        }
    }
    getBase() {
        return this.base;
    }
}
DepacketizeVideoPipe.baseType = "videodata";
DepacketizeVideoPipe.type = "wsdata";
