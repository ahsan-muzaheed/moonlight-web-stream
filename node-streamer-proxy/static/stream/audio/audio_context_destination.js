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
import { AudioContextBasePipe } from "./audio_context_base.js";
export class ContextDestinationNodeAudioPlayer extends AudioContextBasePipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return {
                environmentSupported: "AudioContext" in globalObject()
            };
        });
    }
    constructor(logger) {
        super("node_audio_element", null, logger);
        this.destination = null;
        this.currentSource = null;
        this.addPipePassthrough();
    }
    setup(setup) {
        const result = super.setup(setup);
        this.destination = this.getAudioContext().destination;
        if (this.currentSource) {
            this.currentSource.connect(this.destination);
        }
        return result;
    }
    setSource(source) {
        if (this.currentSource && this.destination) {
            this.currentSource.disconnect(this.destination);
        }
        this.currentSource = source;
        if (this.destination) {
            source.connect(this.destination);
        }
    }
    mount(_parent) { }
    unmount(_parent) { }
}
ContextDestinationNodeAudioPlayer.type = "audionode";
