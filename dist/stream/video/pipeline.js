var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { UrlVideoElementRenderer, VideoElementRenderer } from "./video_element.js";
import { VideoMediaStreamTrackProcessorPipe } from "./media_stream_track_processor_pipe.js";
import { VideoDecoderPipe } from "./video_decoder_pipe.js";
import { DepacketizeVideoPipe } from "./depackitize_pipe.js";
import { andVideoCodecs, hasAnyCodec } from "../video.js";
import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js";
import { workerPipe } from "../pipeline/worker_pipe.js";
import { WorkerVideoDataSendPipe, WorkerVideoFrameReceivePipe, WorkerVideoTrackReceivePipe, WorkerVideoTrackSendPipe } from "../pipeline/worker_io.js";
import { OffscreenCanvasRenderer } from "./offscreen_canvas.js";
import { MainCanvasRenderer } from "./canvas.js";
import { CanvasFrameDrawPipe, CanvasRgbaFrameDrawPipe, CanvasYuv420FrameDrawPipe as CanvasYuv420FrameDrawPipe } from "./canvas_frame.js";
import { globalObject } from "../../util.js";
import { OpenH264DecoderPipe } from "./openh264_decoder_pipe.js";
import { VideoMediaStreamTrackGeneratorPipe } from "./media_stream_track_generator_pipe.js";
import { Yuv420ToRgbaFramePipe } from "./video_frame.js";
import { MediaSourceDecoder } from "./media_source_decoder.js";
const VIDEO_RENDERERS = [
    VideoElementRenderer,
    UrlVideoElementRenderer,
    MainCanvasRenderer,
    OffscreenCanvasRenderer,
];
export const WorkerVideoMediaStreamProcessorPipe = workerPipe("WorkerVideoMediaStreamProcessorPipe", { pipes: ["WorkerVideoTrackReceivePipe", "VideoMediaStreamTrackProcessorPipe", "WorkerVideoFrameSendPipe"] });
export const WorkerVideoMediaStreamProcessorCanvasPipe = workerPipe("WorkerVideoMediaStreamProcessorCanvasPipe", { pipes: ["WorkerVideoTrackReceivePipe", "VideoMediaStreamTrackProcessorPipe", "CanvasFrameDrawPipe", "WorkerOffscreenCanvasSendPipe"] });
export const WorkerDataToVideoTrackPipe = workerPipe("WorkerVideoFrameToTrackPipe", { pipes: ["WorkerVideoDataReceivePipe", "VideoDecoderPipe", "VideoTrackGeneratorPipe", "WorkerVideoTrackSendPipe"] });
export const WorkerDataToCanvasGlRenderOpenH264Pipe = workerPipe("WorkerDataToCanvasGlRenderOpenH264Pipe", { pipes: ["WorkerVideoDataReceivePipe", "OpenH264DecoderPipe", "CanvasYuv420FrameDrawPipe", "WorkerOffscreenCanvasSendPipe"] });
const PIPELINES = [
    // -- track
    // Convert track -> video element, Default (should be supported everywhere)
    { input: "videotrack", pipes: [], renderer: VideoElementRenderer },
    // Convert track -> video frame -> canvas, Chromium
    { input: "videotrack", pipes: [VideoMediaStreamTrackProcessorPipe, CanvasFrameDrawPipe], renderer: MainCanvasRenderer },
    // Convert track -> video frame (in worker) -> canvas (in worker), Safari
    { input: "videotrack", pipes: [WorkerVideoTrackSendPipe, WorkerVideoMediaStreamProcessorCanvasPipe], renderer: OffscreenCanvasRenderer },
    // Convert track -> video frame (in worker) -> canvas, Safari
    { input: "videotrack", pipes: [WorkerVideoTrackSendPipe, WorkerVideoMediaStreamProcessorPipe, WorkerVideoFrameReceivePipe], renderer: MainCanvasRenderer },
    // -- data
    // - VideoDecoder
    // Convert data -> video frame (in worker) -> track (in worker, VideoTrackGenerator) -> video element, Safari
    { input: "data", pipes: [DepacketizeVideoPipe, WorkerVideoDataSendPipe, WorkerDataToVideoTrackPipe, WorkerVideoTrackReceivePipe], renderer: VideoElementRenderer },
    // Convert data -> video frame -> track (MediaStreamTrackGenerator) -> video element, Chromium
    { input: "data", pipes: [DepacketizeVideoPipe, VideoDecoderPipe, VideoMediaStreamTrackGeneratorPipe], renderer: VideoElementRenderer },
    // Convert data -> video frame -> canvas, Default (Secure Context), Firefox
    { input: "data", pipes: [DepacketizeVideoPipe, VideoDecoderPipe, CanvasFrameDrawPipe], renderer: MainCanvasRenderer },
    // - OpenH264 Decoder
    // Convert data -> decode -> draw using webgl (in worker) -> canvas
    { input: "data", pipes: [DepacketizeVideoPipe, WorkerVideoDataSendPipe, WorkerDataToCanvasGlRenderOpenH264Pipe], renderer: OffscreenCanvasRenderer },
    // Convert data -> decode -> draw using webgl -> canvas
    { input: "data", pipes: [DepacketizeVideoPipe, OpenH264DecoderPipe, CanvasYuv420FrameDrawPipe], renderer: MainCanvasRenderer },
    // Convert data -> decode -> draw using image -> canvas
    { input: "data", pipes: [DepacketizeVideoPipe, OpenH264DecoderPipe, Yuv420ToRgbaFramePipe, CanvasRgbaFrameDrawPipe], renderer: MainCanvasRenderer },
    // - MediaSourceDecoder
    // Convert data -> MediaSourceDecoder -> video element, Default (should be supported everywhere)
    { input: "data", pipes: [DepacketizeVideoPipe, MediaSourceDecoder], renderer: UrlVideoElementRenderer },
];
const FORCE_CANVAS_PIPELINES = PIPELINES.filter(pipeline => pipeline.renderer.name.includes("Canvas"));
export function buildVideoPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const pipesInfo = yield gatherPipeInfo();
        if (logger) {
            // Print supported pipes
            const videoRendererInfoPromises = [];
            for (const videoRenderer of VIDEO_RENDERERS) {
                videoRendererInfoPromises.push(videoRenderer.getInfo().then(info => [videoRenderer.name, info]));
            }
            const videoRendererInfo = yield Promise.all(videoRendererInfoPromises);
            logger.debug(`Supported Video Renderers: {`);
            let isFirst = true;
            for (const [name, info] of videoRendererInfo) {
                logger.debug(`${isFirst ? "" : ","}"${name}": ${JSON.stringify(info)}`);
                isFirst = false;
            }
            logger.debug(`}`);
        }
        logger === null || logger === void 0 ? void 0 : logger.debug(`Building video pipeline with output "${type}"`);
        let pipelines = [];
        // Forced renderer
        if (settings.forceVideoElementRenderer) {
            logger === null || logger === void 0 ? void 0 : logger.debug("Forcing Video Element Renderer");
            if (type != "videotrack") {
                logger === null || logger === void 0 ? void 0 : logger.debug("The option Force Video Element Renderer is currently only supported with WebRTC", { type: "fatalDescription" });
                return { videoRenderer: null, supportedCodecs: null, error: true };
            }
            // H264 is assumed universal, if we don't currently support something force it!
            if (!hasAnyCodec(settings.supportedVideoCodecs)) {
                logger === null || logger === void 0 ? void 0 : logger.debug("No codec currently found. Setting H264 as supported even though the browser says it is not supported");
                settings.supportedVideoCodecs.H264 = true;
            }
            return { videoRenderer: new VideoElementRenderer(), supportedCodecs: settings.supportedVideoCodecs, error: false };
        }
        if (settings.canvasRenderer) {
            logger === null || logger === void 0 ? void 0 : logger.debug("Forcing canvas renderer");
            pipelines = FORCE_CANVAS_PIPELINES;
        }
        else {
            logger === null || logger === void 0 ? void 0 : logger.debug("Selecting pipeline automatically");
            pipelines = PIPELINES;
        }
        pipelineLoop: for (const pipeline of pipelines) {
            if (pipeline.input != type) {
                continue;
            }
            // Check if supported and contains codecs
            let supportedCodecs = settings.supportedVideoCodecs;
            for (const pipe of pipeline.pipes) {
                const pipeInfo = pipesInfo.get(pipe);
                if (!pipeInfo) {
                    logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to query info for video pipe ${pipe.name}`);
                    continue pipelineLoop;
                }
                if (!pipeInfo.environmentSupported) {
                    continue pipelineLoop;
                }
                if (pipeInfo.supportedVideoCodecs) {
                    supportedCodecs = andVideoCodecs(supportedCodecs, pipeInfo.supportedVideoCodecs);
                }
            }
            const rendererInfo = yield pipeline.renderer.getInfo();
            if (!rendererInfo) {
                logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to query info for video renderer ${pipeline.renderer.name}`);
                continue pipelineLoop;
            }
            if (!rendererInfo.environmentSupported) {
                continue pipelineLoop;
            }
            if (rendererInfo.supportedVideoCodecs) {
                supportedCodecs = andVideoCodecs(supportedCodecs, rendererInfo.supportedVideoCodecs);
            }
            if (!hasAnyCodec(supportedCodecs)) {
                logger === null || logger === void 0 ? void 0 : logger.debug(`Not using pipe ${pipeline.pipes.map(pipe => pipe.name).join(" -> ")} -> ${pipeline.renderer.name} (renderer) because it doesn't support any codec the user wants`);
                continue pipelineLoop;
            }
            // Build that pipeline
            logger === null || logger === void 0 ? void 0 : logger.debug(`Trying to build pipeline: ${pipeline.pipes.map(pipe => pipe.name).join(" -> ")} -> ${pipeline.renderer.name} (renderer)`);
            const rendererOptions = { drawOnSubmit: !settings.canvasVsync };
            const videoRenderer = buildPipeline(pipeline.renderer, { pipes: pipeline.pipes }, logger, rendererOptions);
            if (!videoRenderer) {
                logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to build video pipeline: ${pipeline.pipes.map(pipe => pipe.name).join(" -> ")} -> ${pipeline.renderer.name} (renderer)`);
                continue pipelineLoop;
            }
            logger === null || logger === void 0 ? void 0 : logger.debug(`Successfully built video pipeline: ${pipeline.pipes.map(pipe => pipe.name).join(" -> ")} -> ${pipeline.renderer.name} (renderer)`);
            return { videoRenderer: videoRenderer, supportedCodecs, error: false };
        }
        let message = "No supported video renderer found! Tried all available pipelines.";
        const globalObj = globalObject();
        if (type == "data" && "isSecureContext" in globalObj && !globalObj.isSecureContext) {
            message += " If you want to stream using Web Sockets the website must be in a Secure Context!";
        }
        logger === null || logger === void 0 ? void 0 : logger.debug(message);
        return { videoRenderer: null, supportedCodecs: null, error: true };
    });
}
