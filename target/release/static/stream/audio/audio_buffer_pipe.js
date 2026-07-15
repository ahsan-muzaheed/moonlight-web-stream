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
export class AudioBufferPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "AudioBufferSourceNode" in globalObject()
            };
        });
    }
    constructor(base) {
        this.channels = -1;
        this.sampleRate = -1;
        this.node = null;
        this.hadUserInteraction = false;
        this.nextAudioPlayTime = null;
        this.implementationName = `audio_pcm_buffer -> ${base.implementationName}`;
        this.base = base;
        addPipePassthrough(this);
    }
    setup(setup) {
        this.channels = setup.channels;
        this.sampleRate = setup.sampleRate;
        let result;
        if ("setup" in this.base && typeof this.base.setup == "function") {
            this.base.setup(...arguments);
        }
        this.node = this.base.getAudioContext().createGain();
        this.base.setSource(this.node);
        return result;
    }
    onUserInteraction() {
        this.hadUserInteraction = true;
        if ("onUserInteraction" in this.base && typeof this.base.onUserInteraction == "function") {
            return this.base.onUserInteraction(...arguments);
        }
    }
    playPcm(unit) {
        if (!this.node) {
            return;
        }
        if (!this.hadUserInteraction) {
            return;
        }
        const TARGET_LATENCY_SECS = 0.12;
        const MAX_LATENCY_SECS = 0.25;
        const now = this.base.getAudioContext().currentTime;
        if (this.nextAudioPlayTime == null) {
            this.nextAudioPlayTime = now + TARGET_LATENCY_SECS;
        }
        let ahead = this.nextAudioPlayTime - this.base.getAudioContext().currentTime;
        // Too far ahead -> gently pull back audio
        if (ahead > MAX_LATENCY_SECS) {
            console.debug("Audio too far ahead, trimming latency");
            this.nextAudioPlayTime = now + TARGET_LATENCY_SECS;
            ahead = TARGET_LATENCY_SECS;
        }
        // Underrun -> jump forward
        if (ahead < 0) {
            console.debug("Audio underrun");
            // We are behind (underrun), jump to current time + small buffer
            this.nextAudioPlayTime = now + TARGET_LATENCY_SECS;
        }
        const context = this.base.getAudioContext();
        const buffer = context.createBuffer(this.channels, unit.channelData[0].length, this.sampleRate);
        for (let channel = 0; channel < this.channels; channel++) {
            const channelPcm = unit.channelData[channel];
            buffer.copyToChannel(channelPcm, channel);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.node);
        source.start(this.nextAudioPlayTime);
        this.nextAudioPlayTime += buffer.duration;
        source.onended = () => source.disconnect();
    }
    getBase() {
        return this.base;
    }
}
AudioBufferPipe.baseType = "audionode";
AudioBufferPipe.type = "audiopcm";
