var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Logger } from "../log.js";
import { andVideoCodecs } from "../video.js";
import { buildPipeline, getPipe, pipeName } from "./index.js";
import { WorkerOffscreenCanvasSendPipe } from "./worker_io.js";
// Configure logger
const logger = new Logger();
function onLog(text, type) {
    const message = {
        log: text,
        info: { type: type !== null && type !== void 0 ? type : undefined }
    };
    postMessage(message);
}
logger === null || logger === void 0 ? void 0 : logger.addInfoListener(onLog);
let pipelineErrored = false;
let currentPipeline = null;
let canvasPipe = null;
class WorkerMessageSender {
    constructor(logger) {
        this.implementationName = "worker_output";
    }
    onWorkerMessage(output) {
        const message = { output };
        postMessage(message);
    }
    getBase() {
        return null;
    }
}
WorkerMessageSender.type = "workerinput";
function onMessage(message) {
    return __awaiter(this, void 0, void 0, function* () {
        if ("checkSupport" in message) {
            const pipeline = message.checkSupport;
            const pipelineInfo = {
                environmentSupported: true
            };
            for (const pipeRaw of pipeline.pipes) {
                const pipe = getPipe(pipeRaw);
                if (!pipe) {
                    logger.debug(`Failed to find pipe "${pipeName(pipeRaw)}"`);
                    pipelineInfo.environmentSupported = false;
                    break;
                }
                const pipeInfo = yield pipe.getInfo();
                if (!pipeInfo.environmentSupported) {
                    pipelineInfo.environmentSupported = false;
                    break;
                }
                if ("supportedVideoCodecs" in pipeInfo && pipeInfo.supportedVideoCodecs) {
                    if (pipelineInfo.supportedVideoCodecs) {
                        pipelineInfo.supportedVideoCodecs = andVideoCodecs(pipelineInfo.supportedVideoCodecs, pipeInfo.supportedVideoCodecs);
                    }
                    else {
                        pipelineInfo.supportedVideoCodecs = pipeInfo.supportedVideoCodecs;
                    }
                }
            }
            const response = {
                checkSupport: pipelineInfo
            };
            postMessage(response);
        }
        else if ("createPipeline" in message) {
            logger.debug(`Trying to build pipeline in worker, Pipes: ${JSON.stringify(message.createPipeline.pipes)}`);
            const pipeline = message.createPipeline;
            const newPipeline = buildPipeline(WorkerMessageSender, pipeline, logger);
            if (newPipeline && "onWorkerMessage" in newPipeline && typeof newPipeline.onWorkerMessage == "function") {
                currentPipeline = newPipeline;
            }
            else {
                logger.debug("Failed to build worker pipeline!", { type: "fatal" });
            }
            logger.debug(`Successfully build pipeline in worker: ${currentPipeline === null || currentPipeline === void 0 ? void 0 : currentPipeline.implementationName}`);
            let base = newPipeline;
            let newBase = newPipeline === null || newPipeline === void 0 ? void 0 : newPipeline.getBase();
            while ((newBase = base === null || base === void 0 ? void 0 : base.getBase()) && !(newBase instanceof WorkerMessageSender)) {
                base = newBase;
            }
            if (base && base instanceof WorkerOffscreenCanvasSendPipe) {
                canvasPipe = base;
                logger.debug("Found WorkerOffscreenCanvasSendPipe in worker pipeline");
            }
        }
        else if ("input" in message) {
            if (pipelineErrored) {
                return;
            }
            if ("canvas" in message.input) {
                // Filter out the canvas, the last pipe needs that
                if (canvasPipe) {
                    logger.debug("Received OffscreenCanvas in worker");
                    canvasPipe.setContext(message.input.canvas);
                }
                else {
                    pipelineErrored = true;
                    logger.debug("Failed to set OffscreenCanvas in the worker because the worker doesn't contain a compatible pipe at the end of the pipeline!", { type: "fatal" });
                }
            }
            else {
                if (currentPipeline) {
                    currentPipeline.onWorkerMessage(message.input);
                }
                else {
                    pipelineErrored = true;
                    logger.debug(`Failed to submit worker pipe input because the worker wasn't assigned a pipeline! Message: ${JSON.stringify(message)}`);
                }
            }
        }
    });
}
onmessage = (event) => {
    const message = event.data;
    onMessage(message);
};
