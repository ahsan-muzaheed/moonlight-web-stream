var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { AudioDecoderPipe } from "./audio_decoder_pipe.js";
import { AudioElementPlayer } from "./audio_element.js";
import { AudioMediaStreamTrackGeneratorPipe } from "./media_stream_track_generator_pipe.js";
import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js";
import { OpusAudioDecoderPipe } from "./opus_decoder_pipe.js";
import { AudioBufferPipe as AudioPcmBufferPipe } from "./audio_buffer_pipe.js";
import { ContextDestinationNodeAudioPlayer } from "./audio_context_destination.js";
import { AudioContextTrackPipe } from "./audio_context_track_pipe.js";
import { DepacketizeAudioPipe } from "./depacketize_pipe.js";
const AUDIO_PLAYERS = [
    AudioElementPlayer,
    ContextDestinationNodeAudioPlayer
];
const PIPELINES = [
    // Convert track -> audio_element, All Browsers
    { input: "audiotrack", pipes: [], player: AudioElementPlayer },
    // Convert data -> audio_sample -> track (MediaStreamTrackGenerator) -> audio_element, Chromium
    { input: "data", pipes: [DepacketizeAudioPipe, AudioDecoderPipe, AudioMediaStreamTrackGeneratorPipe], player: AudioElementPlayer },
    // Convert data -> audio_sample -> audio_sample_pcm -> audio_context_element -> audio_element, Safari / Firefox
    { input: "data", pipes: [DepacketizeAudioPipe, OpusAudioDecoderPipe, AudioPcmBufferPipe, AudioContextTrackPipe], player: AudioElementPlayer },
    // Convert data -> audio_sample -> audio_sample_pcm -> audio_context_element -> audio_element, Safari / Firefox
    { input: "data", pipes: [DepacketizeAudioPipe, OpusAudioDecoderPipe, AudioPcmBufferPipe], player: ContextDestinationNodeAudioPlayer },
];
export function buildAudioPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const pipesInfo = yield gatherPipeInfo();
        if (logger) {
            // Print supported pipes
            const audioPlayerInfoPromises = [];
            for (const audioPlayer of AUDIO_PLAYERS) {
                audioPlayerInfoPromises.push(audioPlayer.getInfo().then(info => [audioPlayer.name, info]));
            }
            const audioPlayerInfo = yield Promise.all(audioPlayerInfoPromises);
            logger.debug(`Supported Audio Players: {`);
            let isFirst = true;
            for (const [name, info] of audioPlayerInfo) {
                logger.debug(`${isFirst ? "" : ","}"${name}": ${JSON.stringify(info)}`);
                isFirst = false;
            }
            logger.debug(`}`);
        }
        logger === null || logger === void 0 ? void 0 : logger.debug(`Building audio pipeline with output "${type}"`);
        let pipelines = PIPELINES;
        pipelineLoop: for (const pipeline of pipelines) {
            if (pipeline.input != type) {
                continue;
            }
            // Check if supported
            for (const pipe of pipeline.pipes) {
                const pipeInfo = pipesInfo.get(pipe);
                if (!pipeInfo) {
                    logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to query info for audio pipe ${pipe.name}`);
                    continue pipelineLoop;
                }
                if (!pipeInfo.environmentSupported) {
                    continue pipelineLoop;
                }
            }
            const playerInfo = yield pipeline.player.getInfo();
            if (!playerInfo) {
                logger === null || logger === void 0 ? void 0 : logger.debug(`Failed to query info for audio player ${pipeline.player.name}`);
                continue pipelineLoop;
            }
            if (!playerInfo.environmentSupported) {
                continue pipelineLoop;
            }
            // Build that pipeline
            const audioPlayer = buildPipeline(pipeline.player, { pipes: pipeline.pipes }, logger);
            if (!audioPlayer) {
                logger === null || logger === void 0 ? void 0 : logger.debug("Failed to build audio pipeline");
                return { audioPlayer: null, error: true };
            }
            return { audioPlayer: audioPlayer, error: false };
        }
        logger === null || logger === void 0 ? void 0 : logger.debug("No supported audio player found!");
        return { audioPlayer: null, error: true };
    });
}
