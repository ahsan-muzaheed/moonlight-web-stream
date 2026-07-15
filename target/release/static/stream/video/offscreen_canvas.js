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
import { BaseCanvasVideoRenderer } from "./canvas.js";
export class OffscreenCanvasRenderer extends BaseCanvasVideoRenderer {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "HTMLCanvasElement" in globalObject() && "transferControlToOffscreen" in HTMLCanvasElement.prototype
            };
        });
    }
    constructor() {
        super("offscreen_canvas", {
        // This won't make any difference because the rendering is done offscreen
        // drawOnSubmit: true
        });
        this.mainCanvas = BaseCanvasVideoRenderer.createMainCanvas();
        this.transferred = false;
        this.offscreen = null;
        this.setCanvas(this.mainCanvas, true);
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
    mount(parent) {
        super.mount(parent);
        if (!this.offscreen && !this.transferred) {
            this.offscreen = this.mainCanvas.transferControlToOffscreen();
            // The transfer happens in the WorkerPipe
        }
    }
    onWorkerMessage(message) {
        if ("videoSetup" in message) {
            this.setup(message.videoSetup);
        }
    }
}
OffscreenCanvasRenderer.type = "workeroutput";
