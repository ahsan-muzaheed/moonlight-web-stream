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
import { getStreamRectCorrected } from "./index.js";
function getColorSpace(hdrEnabled) {
    return hdrEnabled ? "rec2020-pq" : "srgb";
}
export class BaseCanvasVideoRenderer {
    static createMainCanvas() {
        const canvas = document.createElement("canvas");
        canvas.classList.add("video-stream");
        return canvas;
    }
    constructor(implementationName, options) {
        this.div = ("document" in globalObject()) ? globalObject().document.createElement("div") : null;
        this.canvas = null;
        this.isTransferred = false;
        this.context = null;
        this.hdrEnabled = false;
        this.videoSize = null;
        this.options = null;
        this.implementationName = implementationName;
        this.options = options !== null && options !== void 0 ? options : null;
    }
    setCanvas(canvas, isTransferred) {
        this.isTransferred = isTransferred !== null && isTransferred !== void 0 ? isTransferred : false;
        this.canvas = canvas;
        if (this.div && canvas instanceof HTMLCanvasElement) {
            this.div.appendChild(canvas);
        }
    }
    setHdrMode(enabled) {
        this.hdrEnabled = enabled;
        // Update existing context
        if (this.context) {
            // Set HDR color space and transfer function
            if ("colorSpace" in this.context) {
                try {
                    this.context.colorSpace = getColorSpace(enabled);
                }
                catch (err) {
                    console.warn("Failed to set canvas colorSpace:", err);
                }
            }
        }
    }
    useCanvasContext(type) {
        var _a;
        if (!this.canvas) {
            return {
                context: null,
                error: "noCanvas",
            };
        }
        if (!this.context) {
            const options = {
                colorSpace: getColorSpace(this.hdrEnabled),
                // https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/getContext#desynchronized
                desynchronized: (_a = this.options) === null || _a === void 0 ? void 0 : _a.drawOnSubmit
            };
            if (type == "webgl") {
                this.context = this.canvas.getContext("webgl", options);
            }
            else if (type == "webgl2") {
                this.context = this.canvas.getContext("webgl2", options);
            }
            else if (type == "2d") {
                this.context = this.canvas.getContext("2d", options);
            }
            if (!this.context) {
                return {
                    context: null,
                    error: "creationFailed",
                };
            }
        }
        if (type == "webgl" && (this.context instanceof WebGLRenderingContext)) {
            return {
                error: null,
                context: this.context
            };
        }
        else if (type == "webgl2" && this.context instanceof WebGL2RenderingContext) {
            return {
                error: null,
                context: this.context
            };
        }
        else if (type == "2d" && (this.context instanceof OffscreenCanvasRenderingContext2D || this.context instanceof CanvasRenderingContext2D)) {
            return {
                error: null,
                context: this.context
            };
        }
        return {
            context: null,
            error: "otherContextInUse"
        };
    }
    setCanvasSize(width, height) {
        if (this.canvas && !this.isTransferred) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }
    commitFrame() {
        if (this.canvas && "commit" in this.canvas && typeof this.canvas.commit == "function") {
            // Signal finished, not supported in all browsers
            this.canvas.commit();
        }
    }
    setup(setup) {
        return __awaiter(this, void 0, void 0, function* () {
            this.videoSize = [setup.width, setup.height];
            this.setCanvasSize(setup.width, setup.height);
        });
    }
    cleanup() { }
    pollRequestIdr() {
        return false;
    }
    onUserInteraction() {
        // Nothing
    }
    mount(parent) {
        if (!this.div) {
            throw "Cannot mount div inside a worker!";
        }
        parent.appendChild(this.div);
    }
    unmount(parent) {
        if (!this.div) {
            throw "Cannot unmount div inside a worker!";
        }
        parent.removeChild(this.div);
    }
    getStreamRect() {
        if (!this.videoSize || !this.canvas) {
            return new DOMRect();
        }
        if (!(this.canvas instanceof HTMLCanvasElement)) {
            throw "Cannot get client bounding rect of OffscreenCanvas!";
        }
        return getStreamRectCorrected(this.canvas.getBoundingClientRect(), this.videoSize);
    }
    getBase() {
        return null;
    }
}
export class MainCanvasRenderer extends BaseCanvasVideoRenderer {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: "HTMLCanvasElement" in globalObject() && "CanvasRenderingContext2D" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(logger, options) {
        super("canvas", options);
        logger === null || logger === void 0 ? void 0 : logger.debug(`Applying canvas options: ${JSON.stringify(options)}`);
        this.setCanvas(BaseCanvasVideoRenderer.createMainCanvas());
        addPipePassthrough(this);
    }
    setup(setup) {
        const _super = Object.create(null, {
            setup: { get: () => super.setup }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.setup.call(this, setup);
        });
    }
    cleanup() {
        super.cleanup();
    }
    mount(parent) {
        super.mount(parent);
    }
}
MainCanvasRenderer.type = "canvas";
