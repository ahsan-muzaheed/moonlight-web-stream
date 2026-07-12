var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { addPipePassthrough } from "../pipeline/pipes.js";
export class AudioContextBasePipe {
    constructor(implementationName, base, logger) {
        this.logger = null;
        this.audioContext = null;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.implementationName = implementationName;
        this.base = base;
    }
    addPipePassthrough() {
        addPipePassthrough(this, ["mount", "unmount"]);
    }
    setup(setup) {
        var _a;
        try {
            this.audioContext = new AudioContext({
                latencyHint: "interactive",
                sampleRate: setup.sampleRate
            });
        }
        catch (e) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Failed to setup audio node with latency hint "interactive". Trying to setup without latency hint. ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`);
        }
        if (!this.audioContext) {
            this.audioContext = new AudioContext({
                sampleRate: setup.sampleRate
            });
        }
        if (this.base && "setup" in this.base && typeof this.base.setup == "function") {
            return this.base.setup(...arguments);
        }
    }
    cleanup() {
        var _a;
        (_a = this.audioContext) === null || _a === void 0 ? void 0 : _a.close();
    }
    onUserInteraction() {
        if (this.base && "onUserInteraction" in this.base && typeof this.base.onUserInteraction == "function") {
            return this.base.onUserInteraction(...arguments);
        }
    }
    reportStats(statsObject) {
        var arguments_1 = arguments;
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            // Both values are in secs -> we convert into ms
            if ((_a = this.audioContext) === null || _a === void 0 ? void 0 : _a.baseLatency) {
                statsObject.audioContextBaseLatencyMs = this.audioContext.baseLatency * 100;
            }
            else {
                statsObject.audioContextBaseLatencyMs = "null";
            }
            if ((_b = this.audioContext) === null || _b === void 0 ? void 0 : _b.outputLatency) {
                statsObject.audioContextOutputLatencyMs = this.audioContext.outputLatency * 100;
            }
            else {
                statsObject.audioContextOutputLatencyMs = "null";
            }
            if (this.base && "reportStats" in this.base && typeof this.base.reportStats == "function") {
                // @ts-ignore
                return yield this.base.reportStats(...arguments_1);
            }
        });
    }
    getAudioContext() {
        var _a;
        if (!this.audioContext) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to get audio context", { type: "fatal" });
            throw "Failed to get audio context.";
        }
        return this.audioContext;
    }
    getBase() {
        return this.base;
    }
    // -- Only definition look addPipePassthrough
    mount(_parent) { }
    unmount(_parent) { }
}
