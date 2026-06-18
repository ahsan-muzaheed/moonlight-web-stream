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
import { BaseCanvasVideoRenderer } from "../video/canvas.js";
import { addPipePassthrough } from "./pipes.js";
class WorkerReceiverPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: true
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.implementationName = `worker_recv -> ${base.implementationName}`;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.base = base;
        addPipePassthrough(this, ["setup", "cleanup", "submitFrame", "submitPacket", "setTrack", "submitDecodeUnit"]);
    }
    onWorkerMessage(message) {
        if ("call" in message && message.call == "cleanup") {
            this.cleanup();
        }
        else if ("videoSetup" in message) {
            this.setup(message.videoSetup);
        }
        else if ("videoFrame" in message) {
            this.submitFrame(message.videoFrame);
        }
        else if ("data" in message) {
            this.submitPacket(message.data);
        }
        else if ("track" in message) {
            this.setTrack(message.track);
        }
        else if ("videoData" in message) {
            this.submitDecodeUnit(message.videoData);
        }
    }
    getBase() {
        return this.base;
    }
    // -- Only definition look addPipePassthrough
    setup(_setup) { }
    cleanup() { }
    submitFrame(_frame) { }
    submitPacket(_buffer) { }
    setTrack(_track) { }
    submitDecodeUnit(_unit) { }
}
WorkerReceiverPipe.type = "workeroutput";
export class WorkerVideoFrameReceivePipe extends WorkerReceiverPipe {
}
WorkerVideoFrameReceivePipe.baseType = "videoframe";
export class WorkerDataReceivePipe extends WorkerReceiverPipe {
}
WorkerDataReceivePipe.baseType = "data";
export class WorkerVideoDataReceivePipe extends WorkerReceiverPipe {
}
WorkerVideoDataReceivePipe.baseType = "videodata";
export class WorkerVideoTrackReceivePipe extends WorkerReceiverPipe {
}
WorkerVideoTrackReceivePipe.baseType = "videotrack";
class WorkerSenderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: true
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.implementationName = `worker_send -> ${base.implementationName}`;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.base = base;
        addPipePassthrough(this);
    }
    getBase() {
        return this.base;
    }
    setup(setup) {
        this.getBase().onWorkerMessage({ videoSetup: setup });
    }
    submitFrame(videoFrame) {
        this.getBase().onWorkerMessage({ videoFrame }, [videoFrame]);
    }
    submitPacket(data) {
        // we don't know if we own this data, so we cannot transfer
        this.getBase().onWorkerMessage({ data });
    }
    setTrack(track) {
        this.getBase().onWorkerMessage({ track }, [track]);
    }
    submitDecodeUnit(unit) {
        this.getBase().onWorkerMessage({ videoData: unit });
    }
}
WorkerSenderPipe.baseType = "workerinput";
export class WorkerVideoFrameSendPipe extends WorkerSenderPipe {
}
WorkerVideoFrameSendPipe.type = "videoframe";
export class WorkerDataSendPipe extends WorkerSenderPipe {
}
WorkerDataSendPipe.type = "data";
export class WorkerVideoDataSendPipe extends WorkerSenderPipe {
}
WorkerVideoDataSendPipe.type = "videodata";
export class WorkerVideoTrackSendPipe extends WorkerSenderPipe {
}
WorkerVideoTrackSendPipe.type = "videotrack";
export class WorkerOffscreenCanvasSendPipe extends WorkerSenderPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "OffscreenCanvasRenderingContext2D" in globalObject()
            };
        });
    }
    constructor(base, logger) {
        super(base, logger);
        this.implementationName = "offscreen_canvas_send";
        this.renderer = new BaseCanvasVideoRenderer("offscreen_canvas", {
            drawOnSubmit: true
        });
        addPipePassthrough(this);
    }
    setContext(canvas) {
        // This is called from the WorkerPipe
        this.renderer.setCanvas(canvas);
    }
    useCanvasContext(type) {
        // @ts-ignore
        return this.renderer.useCanvasContext(type);
    }
    setCanvasSize(width, height) {
        this.renderer.setCanvasSize(width, height);
    }
    commitFrame() {
        this.renderer.commitFrame();
    }
}
WorkerOffscreenCanvasSendPipe.baseType = "workerinput";
WorkerOffscreenCanvasSendPipe.type = "canvas";
