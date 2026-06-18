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
import { getStreamRectCorrected } from "./index.js";
const VIDEO_DECODER_CODECS = {
    "H264": "avc1.42E01E",
    "H264_HIGH8_444": "avc1.640032",
    "H265": "hvc1.1.6.L93.B0",
    "H265_MAIN10": "hvc1.2.4.L120.90",
    "H265_REXT8_444": "hvc1.6.6.L93.90",
    "H265_REXT10_444": "hvc1.6.10.L120.90",
    "AV1_MAIN8": "av01.0.04M.08",
    "AV1_MAIN10": "av01.0.04M.10",
    "AV1_HIGH8_444": "av01.0.08M.08",
    "AV1_HIGH10_444": "av01.0.08M.10"
};
function detectCodecs() {
    if (!("canPlayType" in HTMLVideoElement.prototype)) {
        return maybeVideoCodecs();
    }
    const codecs = emptyVideoCodecs();
    const testElement = document.createElement("video");
    for (const codec in codecs) {
        const supported = testElement.canPlayType(`video/mp4; codecs=${VIDEO_DECODER_CODECS[codec]}`);
        if (supported == "probably") {
            codecs[codec] = true;
        }
        else if (supported == "maybe") {
            codecs[codec] = "maybe";
        }
        else {
            // unsupported
            codecs[codec] = false;
        }
    }
    return codecs;
}
export class VideoElementRenderer {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            const supported = "HTMLVideoElement" in globalObject() && "srcObject" in HTMLVideoElement.prototype;
            return {
                environmentSupported: supported,
                supportedVideoCodecs: supported ? detectCodecs() : emptyVideoCodecs()
            };
        });
    }
    constructor() {
        this.implementationName = "video_element";
        this.videoElement = document.createElement("video");
        this.oldTrack = null;
        this.stream = new MediaStream();
        this.size = null;
        this.hdrEnabled = false;
        this.videoElement.classList.add("video-stream");
        this.videoElement.preload = "none";
        this.videoElement.controls = false;
        this.videoElement.autoplay = true;
        this.videoElement.disablePictureInPicture = true;
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        if ("srcObject" in this.videoElement) {
            try {
                this.videoElement.srcObject = this.stream;
            }
            catch (err) {
                if (err.name !== "TypeError") {
                    throw err;
                }
                console.error(err);
                throw `video_element renderer not supported: ${err}`;
            }
        }
        addPipePassthrough(this);
    }
    setup(setup) {
        return __awaiter(this, void 0, void 0, function* () {
            this.size = [setup.width, setup.height];
        });
    }
    cleanup() {
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack);
        }
        this.videoElement.srcObject = null;
    }
    setTrack(track) {
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack);
        }
        this.stream.addTrack(track);
        this.oldTrack = track;
    }
    pollRequestIdr() {
        return false;
    }
    mount(parent) {
        parent.appendChild(this.videoElement);
    }
    unmount(parent) {
        parent.removeChild(this.videoElement);
    }
    onUserInteraction() {
        if (this.videoElement.paused) {
            this.videoElement.play().then(() => {
                // Playing
            }).catch(error => {
                console.error(`Failed to play videoElement: ${error.message || error}`);
            });
        }
    }
    getEffectiveVideoSize() {
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;
        if (width > 0 && height > 0) {
            return [width, height];
        }
        return this.size;
    }
    getStreamRect() {
        const effectiveSize = this.getEffectiveVideoSize();
        if (!effectiveSize) {
            return new DOMRect();
        }
        return getStreamRectCorrected(this.videoElement.getBoundingClientRect(), effectiveSize);
    }
    getBase() {
        return null;
    }
    setHdrMode(enabled) {
        this.hdrEnabled = enabled;
        // Request HDR display mode if supported
        if (enabled && "requestHDR" in this.videoElement) {
            try {
                this.videoElement.requestHDR();
            }
            catch (err) {
                console.warn("Failed to request HDR mode:", err);
            }
        }
        // Set color space attributes for HDR
        if (enabled) {
            this.videoElement.setAttribute("color-gamut", "rec2020");
            this.videoElement.setAttribute("transfer-function", "pq");
        }
        else {
            this.videoElement.removeAttribute("color-gamut");
            this.videoElement.removeAttribute("transfer-function");
        }
    }
}
VideoElementRenderer.type = "videotrack";
export class UrlVideoElementRenderer {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            const supported = "HTMLVideoElement" in globalObject() && "src" in HTMLVideoElement.prototype;
            return {
                environmentSupported: supported,
                supportedVideoCodecs: supported ? detectCodecs() : emptyVideoCodecs()
            };
        });
    }
    constructor() {
        this.implementationName = "video_element";
        this.videoElement = document.createElement("video");
        this.size = null;
        this.videoElement.classList.add("video-stream");
        this.videoElement.preload = "none";
        this.videoElement.controls = false;
        this.videoElement.autoplay = true;
        this.videoElement.disablePictureInPicture = true;
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        addPipePassthrough(this);
    }
    setup(setup) {
        return __awaiter(this, void 0, void 0, function* () {
            this.size = [setup.width, setup.height];
        });
    }
    cleanup() { }
    setUrl(src) {
        this.videoElement.src = src;
    }
    pollRequestIdr() {
        return false;
    }
    mount(parent) {
        parent.appendChild(this.videoElement);
    }
    unmount(parent) {
        parent.removeChild(this.videoElement);
    }
    onUserInteraction() {
        if (this.videoElement.paused) {
            this.videoElement.play().then(() => {
                // Playing
            }).catch(error => {
                console.error(`Failed to play videoElement: ${error.message || error}`);
            });
        }
    }
    getEffectiveVideoSize() {
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;
        if (width > 0 && height > 0) {
            return [width, height];
        }
        return this.size;
    }
    getStreamRect() {
        const effectiveSize = this.getEffectiveVideoSize();
        if (!effectiveSize) {
            return new DOMRect();
        }
        return getStreamRectCorrected(this.videoElement.getBoundingClientRect(), effectiveSize);
    }
    getBase() {
        return null;
    }
    setHdrMode(enabled) {
        // Request HDR display mode if supported
        if (enabled && "requestHDR" in this.videoElement) {
            try {
                this.videoElement.requestHDR();
            }
            catch (err) {
                console.warn("Failed to request HDR mode:", err);
            }
        }
        // Set color space attributes for HDR
        if (enabled) {
            this.videoElement.setAttribute("color-gamut", "rec2020");
            this.videoElement.setAttribute("transfer-function", "pq");
        }
        else {
            this.videoElement.removeAttribute("color-gamut");
            this.videoElement.removeAttribute("transfer-function");
        }
    }
}
UrlVideoElementRenderer.type = "videourl";
