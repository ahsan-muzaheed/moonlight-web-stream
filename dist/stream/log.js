export class Logger {
    constructor() {
        this.infoListeners = [];
    }
    debug(message, info) {
        this.callListeners(message, info === null || info === void 0 ? void 0 : info.type);
    }
    callListeners(message, type) {
        for (const listener of this.infoListeners) {
            listener(message, type !== null && type !== void 0 ? type : null);
        }
    }
    addInfoListener(listener) {
        this.infoListeners.push(listener);
    }
    removeInfoListener(listener) {
        const index = this.infoListeners.indexOf(listener);
        if (index != -1) {
            this.infoListeners.splice(index, 1);
        }
    }
}
