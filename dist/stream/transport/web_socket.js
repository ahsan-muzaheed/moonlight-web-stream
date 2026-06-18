var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { TransportChannelId } from "../../api_bindings.js";
import { allVideoCodecs } from "../video.js";
export class WebSocketTransport {
    constructor(ws, buffer, logger) {
        this.implementationName = "web_socket";
        this.logger = null;
        this.channels = [];
        this.onclose = null;
        if (logger) {
            this.logger = logger;
        }
        this.ws = ws;
        this.buffer = buffer;
        // Very important, set the binary type to arraybuffer
        this.ws.binaryType = "arraybuffer";
        this.ws.addEventListener("close", this.onWsClose.bind(this));
        for (const keyRaw in TransportChannelId) {
            const key = keyRaw;
            const id = TransportChannelId[key];
            this.channels[id] = new WebSocketDataTransportChannel(this.ws, id, this.buffer);
        }
    }
    getChannel(id) {
        return this.channels[id];
    }
    setupHostVideo(setup) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (setup.type.indexOf("data") == -1) {
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Cannot use Web Socket Transport: Found no supported video pipeline");
                throw "Cannot use Web Socket Transport: Found no supported video pipeline";
            }
            return allVideoCodecs();
        });
    }
    setupHostAudio(setup) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (setup.type.indexOf("data") == -1) {
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Cannot use Web Socket Transport: Found no supported audio pipeline");
                throw "Cannot use Web Socket Transport: Found no supported audio pipeline";
            }
        });
    }
    onWsClose(event) {
        if (this.onclose) {
            this.onclose(event.wasClean ? "disconnect" : "failed");
        }
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // do nothing, we don't own this ws, the stream owns the ws
            // -> maybe we changed protocol
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Web Socket transport close called, not closing Web Socket because it might still be needed");
        });
    }
    getStats() {
        return __awaiter(this, void 0, void 0, function* () {
            return {};
        });
    }
}
class WebSocketDataTransportChannel {
    constructor(ws, id, buffer) {
        this.type = "data";
        this.canReceive = true;
        this.canSend = true;
        this.receiveListeners = [];
        this.ws = ws;
        this.id = id;
        this.buffer = buffer;
        this.ws.addEventListener("message", this.onMessage.bind(this));
    }
    addReceiveListener(listener) {
        this.receiveListeners.push(listener);
    }
    removeReceiveListener(listener) {
        const index = this.receiveListeners.indexOf(listener);
        if (index != -1) {
            this.receiveListeners.splice(index, 1);
        }
    }
    onMessage(event) {
        const data = event.data;
        if (!(data instanceof ArrayBuffer)) {
            return;
        }
        this.buffer.reset();
        this.buffer.putU8Array(new Uint8Array(data));
        this.buffer.flip();
        const id = this.buffer.getU8();
        if (id != this.id) {
            return;
        }
        const buffer = this.buffer.getRemainingBuffer();
        for (const listener of this.receiveListeners) {
            listener(buffer.buffer);
        }
    }
    send(message) {
        this.buffer.reset();
        this.buffer.putU8(this.id);
        this.buffer.putU8Array(new Uint8Array(message));
        this.buffer.flip();
        this.ws.send(this.buffer.getRemainingBuffer());
    }
    estimatedBufferedBytes() {
        return null;
    }
    close() {
        this.ws.removeEventListener("message", this.onMessage.bind(this));
    }
}
