var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { addPipePassthrough } from "../pipeline/pipes.js";
export class Yuv420ToRgbaFramePipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: true,
            };
        });
    }
    constructor(base) {
        this.buffer = new Uint8ClampedArray(0);
        this.base = base;
        this.implementationName = `yuv420_to_rgba_frame -> ${this.base.implementationName}`;
        addPipePassthrough(this);
    }
    submitRawFrame(frame) {
        const bufferSize = frame.width * frame.height * 4;
        if (this.buffer.length < bufferSize) {
            this.buffer = new Uint8ClampedArray(bufferSize);
        }
        let rgbaIndex = 0;
        for (let y = 0; y < frame.height; y++) {
            const yRow = y * frame.yStride;
            const uvRow = (y >> 1) * frame.uvStride;
            for (let x = 0; x < frame.width; x++) {
                const yValue = frame.yPlane[yRow + x];
                const uvIndex = uvRow + (x >> 1);
                const uValue = frame.uPlane[uvIndex] - 128;
                const vValue = frame.vPlane[uvIndex] - 128;
                // BT.601 conversion
                let r = yValue + 1.402 * vValue;
                let g = yValue - 0.344136 * uValue - 0.714136 * vValue;
                let b = yValue + 1.772 * uValue;
                this.buffer[rgbaIndex++] = Math.max(0, Math.min(255, r));
                this.buffer[rgbaIndex++] = Math.max(0, Math.min(255, g));
                this.buffer[rgbaIndex++] = Math.max(0, Math.min(255, b));
                this.buffer[rgbaIndex++] = 255;
            }
        }
        this.base.submitRawFrame({
            buffer: this.buffer.subarray(0, bufferSize),
            width: frame.width,
            height: frame.height,
            timestampMicroseconds: frame.timestampMicroseconds,
            durationMicroseconds: frame.durationMicroseconds,
        });
    }
    getBase() {
        return this.base;
    }
}
Yuv420ToRgbaFramePipe.baseType = "rgbavideoframe";
Yuv420ToRgbaFramePipe.type = "yuv420videoframe";
