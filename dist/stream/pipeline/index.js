var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { AudioBufferPipe } from "../audio/audio_buffer_pipe.js";
import { AudioContextTrackPipe } from "../audio/audio_context_track_pipe.js";
import { OpusAudioDecoderPipe } from "../audio/opus_decoder_pipe.js";
import { AudioDecoderPipe } from "../audio/audio_decoder_pipe.js";
import { DepacketizeAudioPipe } from "../audio/depacketize_pipe.js";
import { AudioMediaStreamTrackGeneratorPipe } from "../audio/media_stream_track_generator_pipe.js";
import { OpenH264DecoderPipe } from "../video/openh264_decoder_pipe.js";
import { CanvasFrameDrawPipe, CanvasRgbaFrameDrawPipe, CanvasYuv420FrameDrawPipe } from "../video/canvas_frame.js";
import { DepacketizeVideoPipe } from "../video/depackitize_pipe.js";
import { VideoMediaStreamTrackGeneratorPipe } from "../video/media_stream_track_generator_pipe.js";
import { VideoMediaStreamTrackProcessorPipe } from "../video/media_stream_track_processor_pipe.js";
import { WorkerDataToCanvasGlRenderOpenH264Pipe, WorkerDataToVideoTrackPipe, WorkerVideoMediaStreamProcessorCanvasPipe, WorkerVideoMediaStreamProcessorPipe } from "../video/pipeline.js";
import { VideoDecoderPipe } from "../video/video_decoder_pipe.js";
import { VideoTrackGeneratorPipe } from "../video/video_track_generator.js";
import { WorkerDataReceivePipe, WorkerDataSendPipe, WorkerOffscreenCanvasSendPipe, WorkerVideoDataReceivePipe, WorkerVideoDataSendPipe, WorkerVideoFrameReceivePipe, WorkerVideoFrameSendPipe, WorkerVideoTrackReceivePipe, WorkerVideoTrackSendPipe } from "./worker_io.js";
import { Yuv420ToRgbaFramePipe } from "../video/video_frame.js";
import { MediaSourceDecoder } from "../video/media_source_decoder.js";
export function pipelineToString(pipeline) {
    return pipeline.pipes.map(pipe => pipeName(pipe)).join(" -> ");
}
export function pipeName(pipe) {
    if (typeof pipe == "string") {
        return pipe;
    }
    else {
        return pipe.name;
    }
}
export function getPipe(pipe) {
    if (typeof pipe == "string") {
        const foundPipe = pipes().find(check => check.name == pipe);
        return foundPipe !== null && foundPipe !== void 0 ? foundPipe : null;
    }
    else {
        return pipe;
    }
}
export function buildPipeline(base, pipeline, logger, rendererOptions) {
    let previousPipeStatic = base;
    let pipe = new base(logger, rendererOptions);
    for (let index = pipeline.pipes.length - 1; index >= 0; index--) {
        const currentPipeValue = pipeline.pipes[index];
        const currentPipe = getPipe(currentPipeValue);
        if (!currentPipe) {
            logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to construct pipe because it isn't registered: ${pipeName(currentPipeValue)}`);
            return null;
        }
        if (previousPipeStatic && currentPipe.baseType != previousPipeStatic.type) {
            logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to create pipeline "${pipelineToString(pipeline)}" because baseType of "${currentPipe.name}" is "${currentPipe.baseType}", but it's trying to connect with "${previousPipeStatic.type}"`);
            return null;
        }
        previousPipeStatic = currentPipe;
        pipe = new currentPipe(pipe, logger);
    }
    return pipe;
}
let PIPE_INFO;
export function gatherPipeInfo() {
    if (PIPE_INFO) {
        return PIPE_INFO;
    }
    else {
        PIPE_INFO = gatherPipeInfoInternal();
        return PIPE_INFO;
    }
}
function gatherPipeInfoInternal() {
    return __awaiter(this, void 0, void 0, function* () {
        const map = new Map();
        const promises = [];
        const all = pipes();
        for (const pipe of all) {
            promises.push(pipe.getInfo().then(info => {
                map.set(pipe, info);
            }));
        }
        yield Promise.all(promises);
        return map;
    });
}
export function pipes() {
    return [
        // Worker
        WorkerVideoFrameSendPipe,
        WorkerVideoFrameReceivePipe,
        WorkerDataSendPipe,
        WorkerDataReceivePipe,
        WorkerVideoTrackSendPipe,
        WorkerVideoTrackReceivePipe,
        WorkerVideoDataSendPipe,
        WorkerVideoDataReceivePipe,
        // Video
        DepacketizeVideoPipe,
        VideoMediaStreamTrackGeneratorPipe,
        VideoMediaStreamTrackProcessorPipe,
        VideoDecoderPipe,
        OpenH264DecoderPipe,
        Yuv420ToRgbaFramePipe,
        MediaSourceDecoder,
        VideoTrackGeneratorPipe,
        CanvasFrameDrawPipe,
        CanvasYuv420FrameDrawPipe,
        CanvasRgbaFrameDrawPipe,
        // Video Worker pipes
        WorkerVideoMediaStreamProcessorPipe,
        WorkerOffscreenCanvasSendPipe,
        WorkerVideoMediaStreamProcessorCanvasPipe,
        WorkerDataToVideoTrackPipe,
        WorkerDataToCanvasGlRenderOpenH264Pipe,
        // Audio
        DepacketizeAudioPipe,
        AudioMediaStreamTrackGeneratorPipe,
        AudioDecoderPipe,
        OpusAudioDecoderPipe,
        AudioBufferPipe,
        AudioContextTrackPipe,
    ];
}
