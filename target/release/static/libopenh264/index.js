// See https://github.com/MrCreativ3001/openh264-js
const PTR_SIZE = 4;
export class OpenH264Decoder {
    constructor(module, options) {
        this.pDecoder = 0;
        this.module = module;
        this.options = options;
        const stack = this.module.stackSave();
        const ppDecoder = this.module.stackAlloc(PTR_SIZE);
        const error = this.module._openh264_decoder_create(ppDecoder);
        if (error != 0) {
            this.module.stackRestore(stack);
            throw "Failed to initialize OpenH264 decoder!";
        }
        this.pDecoder = this.module.getValue(ppDecoder, "*");
        this.module.stackRestore(stack);
    }
    decode(frame) {
        this.checkPtr();
        const stack = this.module.stackSave();
        // TODO: optimize this, no reallocations?
        const frameBuffer = this.module._malloc(frame.byteLength);
        this.module.writeArrayToMemory(frame, frameBuffer);
        const pOutput = this.module.stackAlloc(PTR_SIZE * 3);
        const pWidth = this.module.stackAlloc(4);
        const pHeight = this.module.stackAlloc(4);
        const pStride = this.module.stackAlloc(8);
        const pFrameReady = this.module.stackAlloc(4);
        const error = this.module._openh264_decoder_decode(this.pDecoder, frameBuffer, frame.byteLength, pOutput, pWidth, pHeight, pStride, pFrameReady);
        this.module._free(frameBuffer);
        if (error != 0) {
            this.module.stackRestore(stack);
            throw `Failed to decode frame ${error}`;
        }
        const frameReady = this.module.getValue(pFrameReady, "i32");
        const width = this.module.getValue(pWidth, "i32");
        const height = this.module.getValue(pHeight, "i32");
        const stride1 = this.module.getValue(pStride, "i32");
        const stride2 = this.module.getValue(pStride + 4, "i32");
        const pY = this.module.getValue(pOutput + PTR_SIZE * 0, "*");
        const pU = this.module.getValue(pOutput + PTR_SIZE * 1, "*");
        const pV = this.module.getValue(pOutput + PTR_SIZE * 2, "*");
        if (frameReady && pY != 0 && pU != 0 && pV != 0) {
            // https://github.com/cisco/openh264/issues/2379
            const y = this.module.HEAPU8.subarray(pY, pY + (height * stride1));
            const u = this.module.HEAPU8.subarray(pU, pU + (height / 2) * stride2);
            const v = this.module.HEAPU8.subarray(pV, pV + (height / 2) * stride2);
            this.options.onFrame([y, u, v], [stride1, stride2], width, height);
        }
        this.module.stackRestore(stack);
    }
    checkPtr() {
        if (!this.pDecoder) {
            throw "Decoder was already destroyed!";
        }
    }
    destroy() {
        this.checkPtr();
        this.module._openh264_decoder_destroy(this.pDecoder);
        this.pDecoder = 0;
    }
}
export function yuvBufferSize(width, height) {
    const ySize = width * height;
    const uvWidth = width >> 1;
    const uvHeight = height >> 1;
    const uvSize = uvWidth * uvHeight;
    return ySize + uvSize * 2;
}
export function copyIntoYuv(buffers, stride, width, height, outBuffer) {
    const [yPlane, uPlane, vPlane] = buffers;
    const [yStride, uvStride] = stride;
    const ySize = width * height;
    const uvWidth = width >> 1;
    const uvHeight = height >> 1;
    const uvSize = uvWidth * uvHeight;
    const bufferSize = ySize + uvSize * 2;
    if (outBuffer.length < bufferSize) {
        throw "Yuv output buffer too small!";
    }
    let offset = 0;
    // Copy Y plane
    for (let y = 0; y < height; y++) {
        const srcStart = y * yStride;
        const srcEnd = srcStart + width;
        outBuffer.set(yPlane.subarray(srcStart, srcEnd), offset);
        offset += width;
    }
    // Copy U plane
    for (let y = 0; y < uvHeight; y++) {
        const srcStart = y * uvStride;
        const srcEnd = srcStart + uvWidth;
        outBuffer.set(uPlane.subarray(srcStart, srcEnd), offset);
        offset += uvWidth;
    }
    // Copy V plane
    for (let y = 0; y < uvHeight; y++) {
        const srcStart = y * uvStride;
        const srcEnd = srcStart + uvWidth;
        outBuffer.set(vPlane.subarray(srcStart, srcEnd), offset);
        offset += uvWidth;
    }
    return outBuffer;
}
