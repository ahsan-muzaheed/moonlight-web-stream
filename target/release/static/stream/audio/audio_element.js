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
export class AudioElementPlayer {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "HTMLAudioElement" in globalObject() && "srcObject" in HTMLAudioElement.prototype,
            };
        });
    }
    constructor() {
        this.implementationName = "audio_element";
        this.audioElement = document.createElement("audio");
        this.oldTrack = null;
        this.stream = new MediaStream();
        this.implementationName = "audio_element";
        this.audioElement.classList.add("audio-stream");
        this.audioElement.preload = "none";
        this.audioElement.controls = false;
        this.audioElement.autoplay = true;
        this.audioElement.muted = true;
        this.audioElement.srcObject = this.stream;
        addPipePassthrough(this);
    }
    setup(_setup) {
        return true;
    }
    cleanup() {
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack);
            this.oldTrack = null;
        }
        this.audioElement.srcObject = null;
    }
    setTrack(track) {
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack);
            this.oldTrack = null;
        }
        this.stream.addTrack(track);
        this.oldTrack = track;
    }
    onUserInteraction() {
        this.audioElement.muted = false;
    }
    mount(parent) {
        parent.appendChild(this.audioElement);
    }
    unmount(parent) {
        parent.removeChild(this.audioElement);
    }
    getBase() {
        return null;
    }
}
AudioElementPlayer.type = "audiotrack";
