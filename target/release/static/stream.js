var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "./polyfill/index.js";
import { apiGetRole, getApi } from "./api.js";
import { showNotification } from "./component/notification.js";
import { Stream } from "./stream/index.js";
import { getModalBackground, showMessage, showModal } from "./component/modal/index.js";
import { getSidebarRoot, setSidebar, setSidebarExtended, setSidebarStyle } from "./component/sidebar/index.js";
import { defaultStreamInputConfig } from "./stream/input.js";
import { getLocalStreamSettings } from "./component/settings_menu.js";
import { SelectComponent } from "./component/input.js";
import { StreamKeys } from "./api_bindings.js";
import { ScreenKeyboard } from "./screen_keyboard.js";
import { FormModal } from "./component/modal/form.js";
import { streamStatsToText } from "./stream/stats.js";
import { adoptRoleDefaultLanguage, getCurrentLanguage, getTranslations } from "./i18n.js";
import { requestKeyboardLock } from "./iframe.js";
let I = getTranslations(getCurrentLanguage());
function startApp() {
    return __awaiter(this, void 0, void 0, function* () {
        const api = yield getApi();
        const bootstrapRole = yield apiGetRole(api, { id: null });
        adoptRoleDefaultLanguage(bootstrapRole.role.default_settings);
        I = getTranslations(getCurrentLanguage());
        const rootElement = document.getElementById("root");
        if (rootElement == null) {
            showNotification(I.stream.rootNotFound, "error");
            return;
        }
        // Get Host and App via Query
        const queryParams = new URLSearchParams(location.search);
        const hostIdStr = queryParams.get("hostId");
        const appIdStr = queryParams.get("appId");
        if (hostIdStr == null || appIdStr == null) {
            yield showMessage(I.stream.missingHostOrApp);
            window.close();
            return;
        }
        const hostId = Number.parseInt(hostIdStr);
        const appId = Number.parseInt(appIdStr);
        // event propagation on overlays
        const sidebarRoot = getSidebarRoot();
        if (sidebarRoot) {
            stopPropagationOn(sidebarRoot);
        }
        const modalBackground = getModalBackground();
        if (modalBackground) {
            stopPropagationOn(modalBackground);
        }
        // Start and Mount App
        const app = new ViewerApp(api, hostId, appId, bootstrapRole.role);
        app.mount(rootElement);
        window["app"] = app;
    });
}
// Prevent starting transition
window.requestAnimationFrame(() => {
    var _a;
    // Note: elements is a live array
    const elements = document.getElementsByClassName("prevent-start-transition");
    while (elements.length > 0) {
        (_a = elements.item(0)) === null || _a === void 0 ? void 0 : _a.classList.remove("prevent-start-transition");
    }
});
startApp();
class ViewerApp {
    constructor(api, hostId, appId, bootstrapRole) {
        this.div = document.createElement("div");
        this.statsDiv = document.createElement("div");
        this.localTouchCursorDiv = document.createElement("div");
        this.inputConfig = defaultStreamInputConfig();
        this.autoEnterFullscreenOnStart = false;
        this.pendingAutoFullscreenPrompt = false;
        this.fullscreenPromptShown = false;
        this.fullscreenOnNextInteractionArmed = false;
        this.pendingAutoFullscreenTouchGesture = false;
        this.pendingAutoFullscreenMouseGesture = false;
        this.manualFullscreenExitRequested = false;
        this.toggleFullscreenWithKeybind = false;
        this.hasShownFullscreenEscapeWarning = false;
        this.keyboardViewportBaselineHeight = null;
        this.streamVideoTopOffsetPx = 0;
        this.isTogglingFullscreenWithKeybind = "none";
        this.api = api;
        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
        Object.assign(this.inputConfig, {
            mouseMode: settings.mouseMode,
            mouseScrollMode: settings.mouseScrollMode,
            touchMode: settings.touchMode,
            localCursorSensitivity: settings.localCursorSensitivity,
            controllerConfig: settings.controllerConfig
        });
        // Configure sidebar
        this.sidebar = new ViewerSidebar(this);
        setSidebar(this.sidebar);
        // Configure stats element
        this.statsDiv.hidden = true;
        this.statsDiv.classList.add("video-stats");
        this.localTouchCursorDiv.hidden = true;
        this.localTouchCursorDiv.classList.add("local-touch-cursor");
        setInterval(() => {
            var _a;
            // Update stats display every 100ms
            const stats = (_a = this.getStream()) === null || _a === void 0 ? void 0 : _a.getStats();
            if (stats && stats.isEnabled()) {
                this.statsDiv.hidden = false;
                const text = streamStatsToText(stats.getCurrentStats());
                this.statsDiv.innerText = text;
            }
            else {
                this.statsDiv.hidden = true;
            }
        }, 100);
        this.div.appendChild(this.statsDiv);
        this.div.appendChild(this.localTouchCursorDiv);
        // Configure stream
        this.previousMouseMode = this.inputConfig.mouseMode;
        const browserWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const browserHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        this.autoEnterFullscreenOnStart = settings.enterFullscreenOnStreamStart;
        this.toggleFullscreenWithKeybind = settings.toggleFullscreenWithKeybind;
        this.stream = new Stream(this.api, hostId, appId, settings, [browserWidth, browserHeight], bootstrapRole.permissions);
        this.startStream(hostId, appId, bootstrapRole.permissions, settings, [browserWidth, browserHeight]);
        // Configure input
        this.addListeners(document);
        this.addListeners(document.getElementById("input"));
        window.addEventListener("blur", () => {
            this.stream.getInput().raiseAllKeys();
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") {
                this.stream.getInput().raiseAllKeys();
            }
        });
        document.addEventListener("pointerlockchange", this.onPointerLockChange.bind(this));
        document.addEventListener("fullscreenchange", this.onFullscreenChange.bind(this));
        window.addEventListener("gamepadconnected", this.onGamepadConnect.bind(this));
        window.addEventListener("gamepaddisconnected", this.onGamepadDisconnect.bind(this));
        // Connect all gamepads
        for (const gamepad of navigator.getGamepads()) {
            if (gamepad != null) {
                this.onGamepadAdd(gamepad);
            }
        }
    }
    addListeners(element) {
        element.addEventListener("keydown", this.onKeyDown.bind(this), { passive: false });
        element.addEventListener("keyup", this.onKeyUp.bind(this), { passive: false });
        element.addEventListener("paste", this.onPaste.bind(this));
        element.addEventListener("mousedown", this.onMouseButtonDown.bind(this), { passive: false });
        element.addEventListener("mouseup", this.onMouseButtonUp.bind(this), { passive: false });
        element.addEventListener("mousemove", this.onMouseMove.bind(this), { passive: false });
        element.addEventListener("wheel", this.onMouseWheel.bind(this), { passive: false });
        element.addEventListener("contextmenu", this.onContextMenu.bind(this), { passive: false });
        element.addEventListener("touchstart", this.onTouchStart.bind(this), { passive: false });
        element.addEventListener("touchend", this.onTouchEnd.bind(this), { passive: false });
        element.addEventListener("touchcancel", this.onTouchCancel.bind(this), { passive: false });
        element.addEventListener("touchmove", this.onTouchMove.bind(this), { passive: false });
    }
    startStream(hostId, appId, permissions, settings, browserSize) {
        return __awaiter(this, void 0, void 0, function* () {
            setSidebarStyle({
                edge: settings.sidebarEdge,
            });
            // Add app info listener
            this.stream.addInfoListener(this.onInfo.bind(this));
            // Create connection info modal
            const connectionInfo = new ConnectionInfoModal();
            const connectionInfoListener = connectionInfo.onInfo.bind(connectionInfo);
            this.stream.addInfoListener(connectionInfoListener);
            void showModal(connectionInfo).then(() => __awaiter(this, void 0, void 0, function* () {
                this.stream.removeInfoListener(connectionInfoListener);
                if (this.autoEnterFullscreenOnStart && this.pendingAutoFullscreenPrompt && !this.fullscreenPromptShown && !this.isFullscreen()) {
                    this.fullscreenPromptShown = true;
                    this.pendingAutoFullscreenPrompt = false;
                    this.armFullscreenOnNextInteraction();
                }
            }));
            // Start animation frame loop
            this.onTouchUpdate();
            this.onGamepadUpdate();
            this.stream.getInput().addScreenKeyboardVisibleEvent(this.onScreenKeyboardSetVisible.bind(this));
            this.stream.mount(this.div);
            if (this.autoEnterFullscreenOnStart) {
                this.pendingAutoFullscreenPrompt = true;
            }
        });
    }
    onInfo(event) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = event.detail;
            if (data.type == "app") {
                const app = data.app;
                document.title = `Stream: ${app.title}`;
            }
            else if (data.type == "connectionComplete") {
                this.sidebar.onCapabilitiesChange(data.capabilities);
            }
        });
    }
    focusInput() {
        if (this.stream.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input");
            inputElement.focus();
        }
    }
    onUserInteraction() {
        var _a, _b;
        this.focusInput();
        (_a = this.stream.getVideoRenderer()) === null || _a === void 0 ? void 0 : _a.onUserInteraction();
        (_b = this.stream.getAudioPlayer()) === null || _b === void 0 ? void 0 : _b.onUserInteraction();
    }
    armFullscreenOnNextInteraction() {
        if (this.autoEnterFullscreenOnStart) {
            this.fullscreenOnNextInteractionArmed = true;
        }
    }
    consumeAutoFullscreenInteraction() {
        if (!this.fullscreenOnNextInteractionArmed || this.isFullscreen()) {
            return false;
        }
        this.fullscreenOnNextInteractionArmed = false;
        void this.requestFullscreen().then(() => {
            if (!this.isFullscreen()) {
                this.armFullscreenOnNextInteraction();
            }
        });
        return true;
    }
    beginAutoFullscreenTouchGesture() {
        if (!this.fullscreenOnNextInteractionArmed || this.isFullscreen()) {
            return false;
        }
        this.pendingAutoFullscreenTouchGesture = true;
        return true;
    }
    consumeAutoFullscreenTouchGesture() {
        if (!this.pendingAutoFullscreenTouchGesture) {
            return false;
        }
        this.pendingAutoFullscreenTouchGesture = false;
        return this.consumeAutoFullscreenInteraction();
    }
    onScreenKeyboardSetVisible(event) {
        console.info(event.detail);
        const screenKeyboard = this.sidebar.getScreenKeyboard();
        const newShown = event.detail.visible;
        if (newShown != screenKeyboard.isVisible()) {
            if (newShown) {
                screenKeyboard.show();
            }
            else {
                screenKeyboard.hide();
            }
        }
    }
    // Input
    getInputConfig() {
        return this.inputConfig;
    }
    setInputConfig(config) {
        Object.assign(this.inputConfig, config);
        this.stream.getInput().setConfig(this.inputConfig);
        this.renderLocalTouchCursor();
    }
    // Keyboard
    onKeyDown(event) {
        this.onUserInteraction();
        console.debug(event);
        if (event.shiftKey && event.ctrlKey && event.code == "KeyV") {
            // We are likely pasting -> don't send keys
        }
        else if (event.code == "F11") {
            // Allow manual fullscreen
        }
        else {
            event.preventDefault();
            this.stream.getInput().onKeyDown(event);
        }
        event.stopPropagation();
    }
    onKeyUp(event) {
        this.onUserInteraction();
        event.preventDefault();
        this.stream.getInput().onKeyUp(event);
        event.stopPropagation();
        if (this.toggleFullscreenWithKeybind && this.isTogglingFullscreenWithKeybind == "none" && event.ctrlKey && event.shiftKey && event.code == "KeyI") {
            this.isTogglingFullscreenWithKeybind = "waitForCtrl";
        }
        if (this.isTogglingFullscreenWithKeybind == "waitForCtrl" && (event.code == "ControlRight" || event.code == "ControlLeft")) {
            this.isTogglingFullscreenWithKeybind = "makingFullscreen";
            (() => __awaiter(this, void 0, void 0, function* () {
                if (this.isFullscreen()) {
                    yield this.exitPointerLock();
                    yield this.exitFullscreen();
                }
                else {
                    yield this.requestFullscreen();
                    yield this.requestPointerLock();
                }
                this.isTogglingFullscreenWithKeybind = "none";
            }))();
        }
    }
    onPaste(event) {
        this.onUserInteraction();
        this.stream.getInput().onPaste(event);
        event.stopPropagation();
    }
    // Mouse
    onMouseButtonDown(event) {
        if (this.consumeAutoFullscreenInteraction()) {
            this.pendingAutoFullscreenMouseGesture = true;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.onUserInteraction();
        event.preventDefault();
        this.stream.getInput().onMouseDown(event, this.getStreamRect());
        event.stopPropagation();
    }
    onMouseButtonUp(event) {
        if (this.pendingAutoFullscreenMouseGesture) {
            this.pendingAutoFullscreenMouseGesture = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.onUserInteraction();
        event.preventDefault();
        this.stream.getInput().onMouseUp(event);
        event.stopPropagation();
    }
    onMouseMove(event) {
        if (this.pendingAutoFullscreenMouseGesture) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        this.stream.getInput().onMouseMove(event, this.getStreamRect());
        event.stopPropagation();
    }
    onMouseWheel(event) {
        event.preventDefault();
        this.stream.getInput().onMouseWheel(event);
        event.stopPropagation();
    }
    onContextMenu(event) {
        event.preventDefault();
        event.stopPropagation();
    }
    // Touch
    onTouchStart(event) {
        if (this.beginAutoFullscreenTouchGesture()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.onUserInteraction();
        event.preventDefault();
        this.stream.getInput().onTouchStart(event, this.getStreamRect());
        event.stopPropagation();
    }
    onTouchEnd(event) {
        if (this.consumeAutoFullscreenTouchGesture()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.onUserInteraction();
        event.preventDefault();
        this.stream.getInput().onTouchEnd(event, this.getStreamRect());
        event.stopPropagation();
    }
    onTouchCancel(event) {
        if (this.pendingAutoFullscreenTouchGesture) {
            this.pendingAutoFullscreenTouchGesture = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.pendingAutoFullscreenTouchGesture = false;
        this.onUserInteraction();
        event === null || event === void 0 ? void 0 : event.preventDefault();
        this.stream.getInput().onTouchCancel(event, this.getStreamRect());
        event.stopPropagation();
    }
    onTouchUpdate() {
        this.stream.getInput().onTouchUpdate(this.getStreamRect());
        this.updateKeyboardViewportVideoOffset();
        this.renderLocalTouchCursor();
        window.requestAnimationFrame(this.onTouchUpdate.bind(this));
    }
    onTouchMove(event) {
        if (this.pendingAutoFullscreenTouchGesture) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        this.stream.getInput().onTouchMove(event, this.getStreamRect());
        event.stopPropagation();
    }
    // Gamepad
    onGamepadConnect(event) {
        this.onGamepadAdd(event.gamepad);
    }
    onGamepadAdd(gamepad) {
        this.stream.getInput().onGamepadConnect(gamepad);
    }
    onGamepadDisconnect(event) {
        this.stream.getInput().onGamepadDisconnect(event);
    }
    onGamepadUpdate() {
        this.stream.getInput().onGamepadUpdate();
        window.requestAnimationFrame(this.onGamepadUpdate.bind(this));
    }
    // Fullscreen
    promptAutoFullscreen() {
        return __awaiter(this, void 0, void 0, function* () {
            yield showModal(new AutoFullscreenModal(this.requestFullscreen.bind(this)));
        });
    }
    requestFullscreen() {
        return __awaiter(this, arguments, void 0, function* (showEscapeWarning = true) {
            var _a;
            const body = document.body;
            if (body) {
                if (!("requestFullscreen" in body && typeof body.requestFullscreen == "function")) {
                    yield showMessage(I.stream.fullscreenUnsupported);
                    return;
                }
                this.focusInput();
                if (!this.isFullscreen()) {
                    try {
                        yield body.requestFullscreen({
                            navigationUI: "hide"
                        });
                    }
                    catch (e) {
                        console.warn("failed to request fullscreen", e);
                    }
                }
                try {
                    yield requestKeyboardLock();
                    if (showEscapeWarning && !this.hasShownFullscreenEscapeWarning) {
                        showNotification(I.stream.fullscreenEscapeHint, "info");
                        this.hasShownFullscreenEscapeWarning = true;
                    }
                }
                catch (e) {
                    console.warn("Keyboard lock failed, skipping notification.", e);
                }
                if (((_a = this.getStream()) === null || _a === void 0 ? void 0 : _a.getInput().getConfig().mouseMode) == "relative") {
                    yield this.requestPointerLock();
                }
                try {
                    if (screen && "orientation" in screen) {
                        const orientation = screen.orientation;
                        if ("lock" in orientation && typeof orientation.lock == "function") {
                            yield orientation.lock("landscape");
                        }
                    }
                }
                catch (e) {
                    console.warn("failed to set orientation to landscape", e);
                }
            }
            else {
                console.warn("root element not found");
            }
        });
    }
    exitFullscreen() {
        return __awaiter(this, void 0, void 0, function* () {
            if ("keyboard" in navigator && navigator.keyboard && "unlock" in navigator.keyboard) {
                yield navigator.keyboard.unlock();
            }
            if ("exitFullscreen" in document && typeof document.exitFullscreen == "function") {
                yield document.exitFullscreen();
            }
        });
    }
    isFullscreen() {
        return "fullscreenElement" in document && !!document.fullscreenElement;
    }
    onFullscreenChange() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isFullscreen()) {
                this.fullscreenOnNextInteractionArmed = false;
                this.pendingAutoFullscreenTouchGesture = false;
                this.pendingAutoFullscreenMouseGesture = false;
                this.manualFullscreenExitRequested = false;
            }
            else {
                const manualExit = this.manualFullscreenExitRequested;
                this.manualFullscreenExitRequested = false;
                if (this.autoEnterFullscreenOnStart && !manualExit) {
                    this.armFullscreenOnNextInteraction();
                }
            }
            this.checkFullyImmersed();
        });
    }
    markManualFullscreenExitRequested() {
        this.manualFullscreenExitRequested = true;
    }
    // Pointer Lock
    requestPointerLock() {
        return __awaiter(this, arguments, void 0, function* (errorIfNotFound = false) {
            this.previousMouseMode = this.inputConfig.mouseMode;
            const inputElement = document.getElementById("input");
            if (inputElement && "requestPointerLock" in inputElement && typeof inputElement.requestPointerLock == "function") {
                this.focusInput();
                this.inputConfig.mouseMode = "relative";
                this.setInputConfig(this.inputConfig);
                setSidebarExtended(false);
                const onLockError = () => {
                    document.removeEventListener("pointerlockerror", onLockError);
                    // Fallback: try to request pointer lock without options
                    inputElement.requestPointerLock();
                };
                document.addEventListener("pointerlockerror", onLockError, { once: true });
                try {
                    let promise = inputElement.requestPointerLock({
                        unadjustedMovement: true
                    });
                    if (promise) {
                        yield promise;
                    }
                    else {
                        inputElement.requestPointerLock();
                    }
                }
                catch (error) {
                    // Some platforms do not support unadjusted movement. If you
                    // would like PointerLock anyway, request again.
                    if (error instanceof Error && error.name == "NotSupportedError") {
                        inputElement.requestPointerLock();
                    }
                    else {
                        throw error;
                    }
                }
                finally {
                    document.removeEventListener("pointerlockerror", onLockError);
                }
            }
            else if (errorIfNotFound) {
                yield showMessage(I.stream.pointerLockUnsupported);
            }
        });
    }
    exitPointerLock() {
        return __awaiter(this, void 0, void 0, function* () {
            if ("exitPointerLock" in document && typeof document.exitPointerLock == "function") {
                document.exitPointerLock();
            }
        });
    }
    onPointerLockChange() {
        this.checkFullyImmersed();
        if (!document.pointerLockElement) {
            this.inputConfig.mouseMode = this.previousMouseMode;
            this.setInputConfig(this.inputConfig);
        }
    }
    // -- Fully immersed Fullscreen -> Fullscreen API + Pointer Lock
    checkFullyImmersed() {
        if ("pointerLockElement" in document && document.pointerLockElement &&
            "fullscreenElement" in document && document.fullscreenElement) {
            // We're fully immersed -> remove sidebar
            setSidebar(null);
        }
        else {
            setSidebar(this.sidebar);
        }
    }
    renderLocalTouchCursor() {
        const localCursorState = this.stream.getInput().getLocalCursorState();
        if (!(localCursorState === null || localCursorState === void 0 ? void 0 : localCursorState.visible)) {
            this.localTouchCursorDiv.hidden = true;
            return;
        }
        const rect = this.getStreamRect();
        if (rect.width <= 0 || rect.height <= 0) {
            this.localTouchCursorDiv.hidden = true;
            return;
        }
        this.localTouchCursorDiv.hidden = false;
        this.localTouchCursorDiv.style.left = `${rect.left + localCursorState.x * rect.width}px`;
        this.localTouchCursorDiv.style.top = `${rect.top + localCursorState.y * rect.height}px`;
    }
    onScreenKeyboardModeWillChange(event) {
        if (event.detail.enabled) {
            this.captureKeyboardViewportBaseline();
        }
    }
    captureKeyboardViewportBaseline() {
        var _a, _b;
        this.keyboardViewportBaselineHeight = (_b = (_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.height) !== null && _b !== void 0 ? _b : null;
        this.streamVideoTopOffsetPx = 0;
        this.applyStreamVideoTopOffset();
        this.updateKeyboardFloatingButtonPosition();
    }
    resetKeyboardViewportVideoOffset() {
        this.keyboardViewportBaselineHeight = null;
        this.streamVideoTopOffsetPx = 0;
        this.applyStreamVideoTopOffset();
        this.resetKeyboardFloatingButtonPosition();
    }
    updateKeyboardViewportVideoOffset() {
        this.updateKeyboardFloatingButtonPosition();
        const screenKeyboard = this.sidebar.getScreenKeyboard();
        const visualViewport = window.visualViewport;
        const baselineHeight = this.keyboardViewportBaselineHeight;
        const localCursorState = this.stream.getInput().getLocalCursorState();
        if (!screenKeyboard.isVisible() || !visualViewport || baselineHeight == null) {
            if (this.streamVideoTopOffsetPx != 0 && !screenKeyboard.isVisible()) {
                this.resetKeyboardViewportVideoOffset();
            }
            return;
        }
        const viewportShrink = baselineHeight - visualViewport.height;
        if (viewportShrink < 80) {
            if (this.streamVideoTopOffsetPx != 0) {
                this.streamVideoTopOffsetPx = 0;
                this.applyStreamVideoTopOffset();
            }
            return;
        }
        const streamRect = this.getStreamRect();
        if (streamRect.width <= 0 || streamRect.height <= 0) {
            return;
        }
        const visibleTop = visualViewport.offsetTop;
        const visibleBottom = visualViewport.offsetTop + visualViewport.height;
        let newTopOffsetPx = this.streamVideoTopOffsetPx;
        if (localCursorState.visible) {
            let delta = 0;
            const safeMargin = Math.min(100, visualViewport.height * 0.25);
            const cursorY = streamRect.top + localCursorState.y * streamRect.height;
            if (cursorY < visibleTop + safeMargin) {
                delta = visibleTop + safeMargin - cursorY;
            }
            else if (cursorY > visibleBottom - safeMargin) {
                delta = visibleBottom - safeMargin - cursorY;
            }
            newTopOffsetPx += delta;
        }
        else {
            const screenTopToVideoTop = visualViewport.height - streamRect.height;
            if (screenTopToVideoTop > 0) {
                newTopOffsetPx = visibleTop - screenTopToVideoTop;
            }
        }
        if (Math.abs(newTopOffsetPx - this.streamVideoTopOffsetPx) >= 1) {
            this.streamVideoTopOffsetPx = newTopOffsetPx;
            this.applyStreamVideoTopOffset();
        }
    }
    applyStreamVideoTopOffset() {
        if (Math.abs(this.streamVideoTopOffsetPx) < 0.5) {
            document.documentElement.style.removeProperty("--stream-video-top");
            return;
        }
        document.documentElement.style.setProperty("--stream-video-top", `calc(50% + ${this.streamVideoTopOffsetPx}px)`);
    }
    updateKeyboardFloatingButtonPosition() {
        const screenKeyboard = this.sidebar.getScreenKeyboard();
        const visualViewport = window.visualViewport;
        if (!screenKeyboard.isVisible() || !visualViewport) {
            this.resetKeyboardFloatingButtonPosition();
            return;
        }
        const bottomInset = Math.min(16, visualViewport.height * 0.08);
        const buttonTop = visualViewport.offsetTop + visualViewport.height - bottomInset;
        document.documentElement.style.setProperty("--stream-keyboard-button-top", `${buttonTop}px`);
    }
    resetKeyboardFloatingButtonPosition() {
        document.documentElement.style.removeProperty("--stream-keyboard-button-top");
    }
    mount(parent) {
        parent.appendChild(this.div);
    }
    unmount(parent) {
        parent.removeChild(this.div);
    }
    getStreamRect() {
        var _a, _b;
        // The bounding rect of the videoElement or canvasElement can be bigger than the actual video
        // -> We need to correct for this when sending positions, else positions are wrong
        return (_b = (_a = this.stream.getVideoRenderer()) === null || _a === void 0 ? void 0 : _a.getStreamRect()) !== null && _b !== void 0 ? _b : new DOMRect();
    }
    getStream() {
        return this.stream;
    }
}
class ConnectionInfoModal {
    constructor() {
        this.eventTarget = new EventTarget();
        this.root = document.createElement("div");
        this.textTy = null;
        this.text = document.createElement("p");
        this.options = document.createElement("div");
        this.debugDetailButton = document.createElement("button");
        this.closeButton = document.createElement("button");
        this.debugDetail = ""; // We store this seperate because line breaks don't work when the element is not mounted on the dom
        this.debugDetailDisplay = document.createElement("div");
        this.root.classList.add("modal-video-connect");
        this.text.innerText = I.stream.connecting;
        this.root.appendChild(this.text);
        this.root.appendChild(this.options);
        this.options.classList.add("modal-video-connect-options");
        this.debugDetailButton.innerText = I.stream.showLogs;
        this.debugDetailButton.addEventListener("click", this.onDebugDetailClick.bind(this));
        this.options.appendChild(this.debugDetailButton);
        this.closeButton.innerText = I.stream.close;
        this.closeButton.addEventListener("click", this.onClose.bind(this));
        this.options.appendChild(this.closeButton);
        this.debugDetailDisplay.classList.add("textlike");
        this.debugDetailDisplay.classList.add("modal-video-connect-debug");
    }
    onDebugDetailClick() {
        let debugDetailCurrentlyShown = this.root.contains(this.debugDetailDisplay);
        if (debugDetailCurrentlyShown) {
            this.debugDetailButton.innerText = I.stream.showLogs;
            this.root.removeChild(this.debugDetailDisplay);
        }
        else {
            this.debugDetailButton.innerText = I.stream.hideLogs;
            this.root.appendChild(this.debugDetailDisplay);
            this.debugDetailDisplay.innerText = this.debugDetail;
        }
    }
    debugLog(line) {
        this.debugDetail += `${line}\n`;
        this.debugDetailDisplay.innerText = this.debugDetail;
        console.info(`[Stream]: ${line}`);
    }
    onInfo(event) {
        var _a, _b, _c, _d, _e, _f, _g;
        const data = event.detail;
        if (data.type == "connectionComplete") {
            const text = I.stream.connectionComplete;
            this.text.innerText = text;
            this.debugLog(text);
        }
        else if (data.type == "videoReady") {
            this.eventTarget.dispatchEvent(new Event("ml-connected"));
        }
        else if (data.type == "addDebugLine") {
            const message = data.line.trim();
            if (message) {
                this.debugLog(message);
                if (!this.textTy) {
                    this.text.innerText = message;
                    this.textTy = (_b = (_a = data.additional) === null || _a === void 0 ? void 0 : _a.type) !== null && _b !== void 0 ? _b : null;
                }
                else if (((_c = data.additional) === null || _c === void 0 ? void 0 : _c.type) == "fatalDescription" || ((_d = data.additional) === null || _d === void 0 ? void 0 : _d.type) == "ifErrorDescription") {
                    if (this.text.innerText) {
                        this.text.innerText += "\n" + message;
                    }
                    else {
                        this.text.innerText = message;
                    }
                    this.textTy = data.additional.type;
                }
            }
            if (((_e = data.additional) === null || _e === void 0 ? void 0 : _e.type) == "fatal" || ((_f = data.additional) === null || _f === void 0 ? void 0 : _f.type) == "fatalDescription") {
                showModal(this);
            }
            else if (((_g = data.additional) === null || _g === void 0 ? void 0 : _g.type) == "informError") {
                showNotification(data.line);
            }
        }
        else if (data.type == "serverMessage") {
            const text = I.stream.serverMessage(data.message);
            this.text.innerText = text;
            this.debugLog(text);
        }
    }
    onClose() {
        showModal(null);
    }
    onFinish(abort) {
        return new Promise((resolve, reject) => {
            this.eventTarget.addEventListener("ml-connected", () => resolve(), { once: true, signal: abort });
        });
    }
    mount(parent) {
        parent.appendChild(this.root);
    }
    unmount(parent) {
        parent.removeChild(this.root);
    }
}
class AutoFullscreenModal {
    constructor(onConfirm) {
        this.message = document.createElement("p");
        this.root = document.createElement("div");
        this.okButton = document.createElement("button");
        this.cancelButton = document.createElement("button");
        this.onConfirm = onConfirm;
        this.message.innerText = I.stream.autoFullscreenPrompt;
        this.okButton.innerText = I.modal.ok;
        this.cancelButton.innerText = I.modal.cancel;
    }
    mount(parent) {
        this.root.appendChild(this.message);
        this.root.appendChild(this.okButton);
        this.root.appendChild(this.cancelButton);
        parent.appendChild(this.root);
    }
    unmount(parent) {
        parent.removeChild(this.root);
    }
    onFinish(abort) {
        return new Promise((resolve) => {
            this.okButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
                yield this.onConfirm();
                resolve();
            }), { once: true, signal: abort });
            this.cancelButton.addEventListener("click", () => {
                resolve();
            }, { once: true, signal: abort });
        });
    }
}
class ViewerSidebar {
    constructor(app) {
        this.div = document.createElement("div");
        this.buttonDiv = document.createElement("div");
        this.sendKeycodeButton = document.createElement("button");
        this.keyboardButton = document.createElement("button");
        this.floatingKeyboardButton = document.createElement("button");
        this.screenKeyboard = new ScreenKeyboard();
        this.lockMouseButton = document.createElement("button");
        this.fullscreenButton = document.createElement("button");
        this.statsButton = document.createElement("button");
        this.exitStreamButton = document.createElement("button");
        this.app = app;
        // Configure divs
        this.div.classList.add("sidebar-stream");
        this.buttonDiv.classList.add("sidebar-stream-buttons");
        this.div.appendChild(this.buttonDiv);
        // Send keycode
        this.sendKeycodeButton.innerText = I.stream.sendKeycode;
        this.sendKeycodeButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const key = yield showModal(new SendKeycodeModal());
            if (key == null) {
                return;
            }
            (_a = this.app.getStream()) === null || _a === void 0 ? void 0 : _a.getInput().sendKey(true, key, 0);
            (_b = this.app.getStream()) === null || _b === void 0 ? void 0 : _b.getInput().sendKey(false, key, 0);
        }));
        this.buttonDiv.appendChild(this.sendKeycodeButton);
        // Pointer Lock
        this.lockMouseButton.innerText = I.stream.lockMouse;
        this.lockMouseButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            yield this.app.requestPointerLock(true);
        }));
        this.buttonDiv.appendChild(this.lockMouseButton);
        // Pop up keyboard
        this.keyboardButton.innerText = I.stream.keyboard;
        this.keyboardButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            setSidebarExtended(false);
            this.screenKeyboard.show();
        }));
        this.buttonDiv.appendChild(this.keyboardButton);
        this.floatingKeyboardButton.innerText = "⌨×";
        this.floatingKeyboardButton.title = I.stream.hideKeyboard;
        this.floatingKeyboardButton.ariaLabel = I.stream.hideKeyboard;
        this.floatingKeyboardButton.classList.add("stream-keyboard-floating-button");
        this.floatingKeyboardButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.screenKeyboard.hide();
        });
        stopPropagationOn(this.floatingKeyboardButton);
        this.screenKeyboard.addKeyDownListener(this.onKeyDown.bind(this));
        this.screenKeyboard.addKeyUpListener(this.onKeyUp.bind(this));
        this.screenKeyboard.addTextListener(this.onText.bind(this));
        this.screenKeyboard.addKeyboardModeWillChangeListener(this.app.onScreenKeyboardModeWillChange.bind(this.app));
        this.screenKeyboard.addKeyboardModeListener(this.onKeyboardModeChange.bind(this));
        this.div.appendChild(this.screenKeyboard.getHiddenElement());
        // Fullscreen
        this.fullscreenButton.innerText = I.stream.fullscreen;
        this.fullscreenButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            if (this.app.isFullscreen()) {
                this.app.markManualFullscreenExitRequested();
                yield this.app.exitFullscreen();
            }
            else {
                yield this.app.requestFullscreen();
            }
        }));
        this.buttonDiv.appendChild(this.fullscreenButton);
        // Stats
        this.statsButton.innerText = I.stream.stats;
        this.statsButton.addEventListener("click", () => {
            var _a;
            const stats = (_a = this.app.getStream()) === null || _a === void 0 ? void 0 : _a.getStats();
            if (stats) {
                stats.toggle();
            }
        });
        this.buttonDiv.appendChild(this.statsButton);
        // Close stream
        this.exitStreamButton.innerText = I.stream.exit;
        this.exitStreamButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            const stream = this.app.getStream();
            if (stream) {
                const success = yield stream.stop();
                if (!success) {
                    console.debug("Failed to close stream correctly");
                }
            }
            if (window.matchMedia('(display-mode: standalone)').matches) {
                history.back();
            }
            else {
                window.close();
            }
        }));
        this.buttonDiv.appendChild(this.exitStreamButton);
        // Select Mouse Mode
        this.mouseMode = new SelectComponent("mouseMode", [
            { value: "relative", name: I.stream.relative },
            { value: "follow", name: I.stream.follow },
            { value: "localCursor", name: I.stream.localCursor },
            { value: "pointAndDrag", name: I.stream.pointAndDrag }
        ], {
            displayName: I.stream.mouseMode,
            preSelectedOption: this.app.getInputConfig().mouseMode
        });
        this.mouseMode.addChangeListener(this.onMouseModeChange.bind(this));
        this.mouseMode.mount(this.div);
        // Select Touch Mode
        this.touchMode = new SelectComponent("touchMode", [
            { value: "touch", name: I.stream.touch },
            { value: "mouseRelative", name: I.stream.relative },
            { value: "localCursor", name: I.stream.localCursor },
            { value: "pointAndDrag", name: I.stream.pointAndDrag }
        ], {
            displayName: I.stream.touchMode,
            preSelectedOption: this.app.getInputConfig().touchMode
        });
        this.touchMode.addChangeListener(this.onTouchModeChange.bind(this));
        this.touchMode.mount(this.div);
    }
    onCapabilitiesChange(capabilities) {
        this.touchMode.setOptionEnabled("touch", capabilities.touch);
    }
    getScreenKeyboard() {
        return this.screenKeyboard;
    }
    // -- Keyboard
    onText(event) {
        var _a;
        (_a = this.app.getStream()) === null || _a === void 0 ? void 0 : _a.getInput().sendText(event.detail.text);
    }
    onKeyDown(event) {
        var _a;
        (_a = this.app.getStream()) === null || _a === void 0 ? void 0 : _a.getInput().onKeyDown(event);
    }
    onKeyUp(event) {
        var _a;
        (_a = this.app.getStream()) === null || _a === void 0 ? void 0 : _a.getInput().onKeyUp(event);
    }
    onKeyboardModeChange(event) {
        if (event.detail.enabled) {
            this.floatingKeyboardButton.classList.add("visible");
        }
        else {
            this.floatingKeyboardButton.classList.remove("visible");
            this.app.resetKeyboardViewportVideoOffset();
        }
    }
    // -- Mouse Mode
    onMouseModeChange() {
        const config = this.app.getInputConfig();
        config.mouseMode = this.mouseMode.getValue();
        this.app.setInputConfig(config);
    }
    // -- Touch Mode
    onTouchModeChange() {
        const config = this.app.getInputConfig();
        config.touchMode = this.touchMode.getValue();
        this.app.setInputConfig(config);
    }
    extended() {
    }
    unextend() {
    }
    mount(parent) {
        parent.appendChild(this.div);
        const appRoot = document.getElementById("root");
        (appRoot !== null && appRoot !== void 0 ? appRoot : document.body).appendChild(this.floatingKeyboardButton);
    }
    unmount(parent) {
        parent.removeChild(this.div);
        if (this.floatingKeyboardButton.parentElement) {
            this.floatingKeyboardButton.parentElement.removeChild(this.floatingKeyboardButton);
        }
    }
}
class SendKeycodeModal extends FormModal {
    constructor() {
        super();
        const keyList = [];
        for (const keyNameRaw in StreamKeys) {
            const keyName = keyNameRaw;
            const keyValue = StreamKeys[keyName];
            const PREFIX = "VK_";
            let name = keyName;
            if (name.startsWith(PREFIX)) {
                name = name.slice(PREFIX.length);
            }
            keyList.push({
                value: keyValue.toString(),
                name
            });
        }
        this.dropdownSearch = new SelectComponent("winKeycode", keyList, {
            hasSearch: true,
            displayName: I.stream.selectKeycode
        });
    }
    mountForm(form) {
        this.dropdownSearch.mount(form);
    }
    reset() {
        this.dropdownSearch.reset();
    }
    submit() {
        const keyString = this.dropdownSearch.getValue();
        if (keyString == null) {
            return null;
        }
        return parseInt(keyString);
    }
}
// Stop propagation so the stream doesn't get it
function stopPropagationOn(element) {
    element.addEventListener("keydown", onStopPropagation);
    element.addEventListener("keyup", onStopPropagation);
    element.addEventListener("keypress", onStopPropagation);
    element.addEventListener("click", onStopPropagation);
    element.addEventListener("mousedown", onStopPropagation);
    element.addEventListener("mouseup", onStopPropagation);
    element.addEventListener("mousemove", onStopPropagation);
    element.addEventListener("wheel", onStopPropagation);
    element.addEventListener("contextmenu", onStopPropagation);
    element.addEventListener("touchstart", onStopPropagation);
    element.addEventListener("touchmove", onStopPropagation);
    element.addEventListener("touchend", onStopPropagation);
    element.addEventListener("touchcancel", onStopPropagation);
}
function onStopPropagation(event) {
    event.stopPropagation();
}
