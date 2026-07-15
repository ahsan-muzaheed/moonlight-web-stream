export function requestKeyboardLock(keys) {
    var _a, _b;
    const topWindow = window.top;
    let lockerFunc;
    if (window.self === topWindow) {
        if ((_a = navigator.keyboard) === null || _a === void 0 ? void 0 : _a.lock) {
            lockerFunc = navigator.keyboard.lock.bind(navigator.keyboard);
        }
    }
    else if (topWindow) {
        let sameOrigin = false;
        try {
            sameOrigin = window.location.origin === topWindow.location.origin;
        }
        catch (e) {
            sameOrigin = false;
        }
        if (sameOrigin) {
            if ((_b = topWindow.navigator.keyboard) === null || _b === void 0 ? void 0 : _b.lock) {
                lockerFunc = topWindow.navigator.keyboard.lock.bind(topWindow.navigator.keyboard);
            }
        }
        else {
            lockerFunc = (k) => {
                const requestId = Math.random().toString(36).substring(2, 9);
                window.parent.postMessage({ type: "REQUEST_KEYBOARD_LOCK", requestId, keys: k }, "*");
                return Promise.resolve();
            };
        }
    }
    if (!lockerFunc) {
        return Promise.resolve();
    }
    return lockerFunc(keys);
}
