// Because ios devices suck, they can't make a right click when holding a touch.
// This script will hook into the touch apis to simulate a right click when needed
const RIGHT_CLICK_TIME_MS = 400;
const RIGHT_CLICK_MAX_MOVE = 40;
let rightClickEnabled = false;
let timer;
/// This might or might not disable all touch events and will likely simulate click / contextmenu events
export function setTouchContextMenuEnabled(enabled) {
    if ((navigator === null || navigator === void 0 ? void 0 : navigator.vendor) == "Apple Computer, Inc.") {
        rightClickEnabled = enabled;
    }
}
const touchTracker = new Map();
function onTouchStart(event) {
    var _a;
    if (!rightClickEnabled) {
        return;
    }
    for (const touch of event.changedTouches) {
        touchTracker.set(touch.identifier, {
            originX: touch.clientX,
            originY: touch.clientY,
            startTime: Date.now(),
            startTarget: (_a = touch === null || touch === void 0 ? void 0 : touch.target) !== null && _a !== void 0 ? _a : null,
            oldX: touch.clientX,
            oldY: touch.clientY
        });
        const eventInit = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            force: touch.force,
            pageX: touch.pageX,
            pageY: touch.pageY,
            radiusX: touch.radiusX,
            radiusY: touch.radiusY,
            rotationAngle: touch.rotationAngle,
            screenX: touch.screenX,
            screenY: touch.screenY,
            target: touch.target,
            // Other
            bubbles: true,
            cancellable: true
        };
        const contextMenuEvent = new MouseEvent("contextmenu", eventInit);
        timer = setTimeout(() => {
            touch === null || touch === void 0 ? void 0 : touch.target.dispatchEvent(contextMenuEvent);
        }, RIGHT_CLICK_TIME_MS);
    }
}
function onTouchMove(event) {
    if (!rightClickEnabled) {
        return;
    }
    clearTimeout(timer);
}
function onTouchEnd(event) {
    if (!rightClickEnabled) {
        removeTouch(event);
        return;
    }
    clearTimeout(timer);
    event.stopImmediatePropagation();
    for (const touch of event.changedTouches) {
        const touchStart = touchTracker.get(touch.identifier);
        if (!touchStart) {
            continue;
        }
        const timeDiff = Date.now() - touchStart.startTime;
        const eventInit = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            force: touch.force,
            pageX: touch.pageX,
            pageY: touch.pageY,
            radiusX: touch.radiusX,
            radiusY: touch.radiusY,
            rotationAngle: touch.rotationAngle,
            screenX: touch.screenX,
            screenY: touch.screenY,
            target: touch.target,
            // Other
            bubbles: true,
            cancellable: true
        };
        if (Math.abs(touch.clientX - touchStart.originX) < RIGHT_CLICK_MAX_MOVE
            && Math.abs(touch.clientY - touchStart.originY) < RIGHT_CLICK_MAX_MOVE) {
            if (timeDiff > RIGHT_CLICK_TIME_MS) {
                // dispatch fake context menu event
                const contextMenuEvent = new MouseEvent("contextmenu", eventInit);
                touch === null || touch === void 0 ? void 0 : touch.target.dispatchEvent(contextMenuEvent);
            }
        }
    }
    removeTouch(event);
}
function removeTouch(event) {
    for (const touch of event.changedTouches) {
        touchTracker.delete(touch.identifier);
    }
    if (!rightClickEnabled) {
        return;
    }
    event.stopImmediatePropagation();
}
window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
window.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
window.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: false });
