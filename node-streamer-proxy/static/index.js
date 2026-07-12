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
import { getApi, apiPostHost, FetchError, apiLogout, apiGetUser, tryLogin, apiGetHost, apiGetRole, apiPatchRole } from "./api.js";
import { AddHostModal } from "./component/host/add_modal.js";
import { HostList } from "./component/host/list.js";
import { showNotification } from "./component/notification.js";
import { showMessage, showModal } from "./component/modal/index.js";
import { setContextMenu } from "./component/context_menu.js";
import { GameList } from "./component/game/list.js";
import { getLocalStreamSettings, globalDefaultSettings, setLocalStreamSettings, StreamSettingsComponent } from "./component/settings_menu.js";
import { adoptRoleDefaultLanguage, getCurrentLanguage, getTranslations } from "./i18n.js";
import { setTouchContextMenuEnabled } from "./polyfill/ios_right_click.js";
import { buildUrl } from "./config_.js";
import { setStyle as setPageStyle } from "./styles/index.js";
let I = getTranslations(getCurrentLanguage());
function startApp() {
    return __awaiter(this, void 0, void 0, function* () {
        setTouchContextMenuEnabled(true);
        const api = yield getApi();
        const bootstrapRole = yield apiGetRole(api, { id: null });
        adoptRoleDefaultLanguage(bootstrapRole.role.default_settings);
        I = getTranslations(getCurrentLanguage());
        const rootElement = document.getElementById("root");
        if (rootElement == null) {
            showNotification(I.index.rootNotFound, "error");
            return;
        }
        let lastAppState = null;
        if (sessionStorage) {
            const lastStateText = sessionStorage.getItem("mlState");
            if (lastStateText) {
                lastAppState = JSON.parse(lastStateText);
            }
        }
        const app = new MainApp(api, bootstrapRole.role);
        app.mount(rootElement);
        window.addEventListener("popstate", event => {
            app.setAppState(event.state, false);
        });
        app.forceFetch();
        if (lastAppState) {
            app.setAppState(lastAppState);
        }
    });
}
startApp();
function setAppState(state, pushHistory) {
    if (pushHistory) {
        history.pushState(state, "");
    }
    if (sessionStorage) {
        sessionStorage.setItem("mlState", JSON.stringify(state));
    }
}
function backAppState() {
    history.back();
}
class MainApp {
    constructor(api, bootstrapRole) {
        this.user = null;
        this.role = null;
        this.divElement = document.createElement("div");
        // Top Line
        this.topLine = document.createElement("div");
        this.moonlightTextElement = document.createElement("h1");
        this.topLineActions = document.createElement("div");
        this.logoutButton = document.createElement("button");
        // This is for the default user
        this.loginButton = document.createElement("button");
        this.adminButton = document.createElement("button");
        // Actions
        this.actionElement = document.createElement("div");
        this.backButton = document.createElement("button");
        this.hostAddButton = document.createElement("button");
        this.settingsButton = document.createElement("button");
        this.saveRoleDefaultsButton = document.createElement("button");
        // Different submenus
        this.currentDisplay = null;
        this.gameList = null;
        this.settings = null;
        this.api = api;
        this.role = bootstrapRole;
        // Top Line
        this.topLine.classList.add("top-line");
        this.moonlightTextElement.innerHTML = I.index.appTitle;
        this.topLine.appendChild(this.moonlightTextElement);
        this.topLine.appendChild(this.topLineActions);
        this.topLineActions.classList.add("top-line-actions");
        this.logoutButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            yield apiLogout(this.api);
            window.location.reload();
        }));
        this.logoutButton.classList.add("logout-button");
        this.loginButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            const success = yield tryLogin();
            if (success) {
                window.location.reload();
            }
        }));
        this.loginButton.classList.add("login-button");
        this.adminButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            window.location.href = buildUrl("/admin.html");
        }));
        this.adminButton.classList.add("admin-button");
        // Actions
        this.actionElement.classList.add("actions-list");
        // Back button
        this.backButton.innerText = I.index.back;
        this.backButton.classList.add("button-fit-content");
        this.backButton.addEventListener("click", backAppState);
        this.backButton.dataset.variant = "back-button";
        // Host add button
        this.hostAddButton.classList.add("host-add");
        this.hostAddButton.addEventListener("click", this.addHost.bind(this));
        // Host list
        this.hostList = new HostList(api);
        this.hostList.addHostOpenListener(this.onHostOpen.bind(this));
        // Settings Button
        this.settingsButton.classList.add("open-settings");
        this.settingsButton.addEventListener("click", () => this.setCurrentDisplay("settings"));
        this.saveRoleDefaultsButton.innerText = I.settings.saveRoleDefaults;
        this.saveRoleDefaultsButton.classList.add("button-fit-content");
        this.saveRoleDefaultsButton.addEventListener("click", this.onSaveRoleDefaults.bind(this));
        this.saveRoleDefaultsButton.dataset.variant = "save-button";
        // Settings
        this.settings = new StreamSettingsComponent(bootstrapRole.permissions, getLocalStreamSettings(bootstrapRole.default_settings));
        this.settings.addChangeListener(this.onSettingsChange.bind(this));
        // Append default elements
        this.divElement.appendChild(this.topLine);
        this.divElement.appendChild(this.actionElement);
        this.setCurrentDisplay("hosts");
        // Context Menu
        document.body.addEventListener("contextmenu", this.onContextMenu.bind(this), { passive: false });
    }
    setAppState(state, pushIntoHistory) {
        if (state.display == "hosts") {
            this.setCurrentDisplay("hosts", null, pushIntoHistory);
        }
        else if (state.display == "games" && state.hostId != null) {
            this.setCurrentDisplay("games", { hostId: state.hostId }, pushIntoHistory);
        }
        else if (state.display == "settings") {
            this.setCurrentDisplay("settings", null, pushIntoHistory);
        }
    }
    addHost() {
        return __awaiter(this, void 0, void 0, function* () {
            const modal = new AddHostModal();
            let host = yield showModal(modal);
            if (host) {
                let newHost;
                try {
                    newHost = yield apiPostHost(this.api, host);
                }
                catch (e) {
                    if (e instanceof FetchError) {
                        const response = e.getResponse();
                        if (response && response.status == 404) {
                            showNotification(I.index.addHostUnreachable(host.address));
                            return;
                        }
                    }
                    throw e;
                }
                this.hostList.insertList(newHost.host_id, newHost);
            }
        });
    }
    onContextMenu(event) {
        if (this.currentDisplay == "hosts" || this.currentDisplay == "games") {
            const elements = [
                {
                    name: I.index.reload,
                    callback: this.forceFetch.bind(this)
                }
            ];
            setContextMenu(event, {
                elements
            });
        }
    }
    onHostOpen(event) {
        return __awaiter(this, void 0, void 0, function* () {
            const hostId = event.component.getHostId();
            this.setCurrentDisplay("games", { hostId });
        });
    }
    onSettingsChange() {
        if (!this.settings) {
            showNotification(I.index.saveSettingsFailed);
            return;
        }
        const previousLanguage = getLocalStreamSettings(globalDefaultSettings()).language;
        const newSettings = this.settings.getStreamSettings();
        // store settings in localStorage
        setLocalStreamSettings(newSettings);
        // apply style
        setPageStyle(newSettings.pageStyle);
        if (previousLanguage !== newSettings.language) {
            window.location.reload();
        }
    }
    onSaveRoleDefaults() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.settings || !this.role || ((_a = this.user) === null || _a === void 0 ? void 0 : _a.role) !== "Admin") {
                showNotification(I.settings.saveRoleDefaultsFailed);
                return;
            }
            this.saveRoleDefaultsButton.disabled = true;
            try {
                const newSettings = this.settings.getStreamSettings();
                yield apiPatchRole(this.api, {
                    id: this.role.id,
                    name: null,
                    ty: this.role.ty,
                    default_settings: newSettings,
                    permissions: null,
                });
                this.role = Object.assign(Object.assign({}, this.role), { default_settings: newSettings });
                yield showMessage(I.settings.saveRoleDefaultsSuccess);
            }
            catch (_b) {
                showNotification(I.settings.saveRoleDefaultsFailed);
            }
            finally {
                this.saveRoleDefaultsButton.disabled = false;
            }
        });
    }
    setCurrentDisplay(display, extraInfo, pushIntoHistory_) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const pushIntoHistory = pushIntoHistory_ === undefined ? true : pushIntoHistory_;
        if (display == "games" && (extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostId) == null) {
            // invalid input state
            throw "invalid display state was requested";
        }
        // Check if we need to change
        if (this.currentDisplay == display) {
            if (this.currentDisplay == "games" && ((_a = this.gameList) === null || _a === void 0 ? void 0 : _a.getHostId()) != (extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostId)) {
                // fall through
            }
            else {
                return;
            }
        }
        // Unmount the current display
        if (this.currentDisplay == "hosts") {
            this.actionElement.removeChild(this.hostAddButton);
            this.actionElement.removeChild(this.settingsButton);
            this.hostList.unmount(this.divElement);
        }
        else if (this.currentDisplay == "games") {
            this.actionElement.removeChild(this.backButton);
            this.actionElement.removeChild(this.settingsButton);
            (_b = this.gameList) === null || _b === void 0 ? void 0 : _b.unmount(this.divElement);
        }
        else if (this.currentDisplay == "settings") {
            this.actionElement.removeChild(this.backButton);
            if (this.actionElement.contains(this.saveRoleDefaultsButton)) {
                this.actionElement.removeChild(this.saveRoleDefaultsButton);
            }
            (_c = this.settings) === null || _c === void 0 ? void 0 : _c.unmount(this.divElement);
        }
        // Mount the new display
        if (display == "hosts") {
            this.actionElement.appendChild(this.hostAddButton);
            this.actionElement.appendChild(this.settingsButton);
            this.hostList.mount(this.divElement);
            setAppState({ display: "hosts" }, pushIntoHistory);
        }
        else if (display == "games" && (extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostId) != null) {
            this.actionElement.appendChild(this.backButton);
            this.actionElement.appendChild(this.settingsButton);
            if (((_d = this.gameList) === null || _d === void 0 ? void 0 : _d.getHostId()) != (extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostId)) {
                this.gameList = new GameList(this.api, extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostId, (_e = extraInfo === null || extraInfo === void 0 ? void 0 : extraInfo.hostCache) !== null && _e !== void 0 ? _e : null);
                this.gameList.addForceReloadListener(this.forceFetch.bind(this));
            }
            this.gameList.mount(this.divElement);
            this.refreshGameListActiveGame();
            setAppState({ display: "games", hostId: (_f = this.gameList) === null || _f === void 0 ? void 0 : _f.getHostId() }, pushIntoHistory);
        }
        else if (display == "settings") {
            this.actionElement.appendChild(this.backButton);
            if (((_g = this.user) === null || _g === void 0 ? void 0 : _g.role) == "Admin") {
                this.actionElement.appendChild(this.saveRoleDefaultsButton);
            }
            (_h = this.settings) === null || _h === void 0 ? void 0 : _h.mount(this.divElement);
            setAppState({ display: "settings" }, pushIntoHistory);
        }
        this.currentDisplay = display;
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const promiseUser = this.refreshUserRole();
            const promiseRoles = this.refreshUserPermissions();
            yield Promise.all([
                this.hostList.forceFetch(),
                (_a = this.gameList) === null || _a === void 0 ? void 0 : _a.forceFetch()
            ]);
            if (this.currentDisplay == "games"
                && this.gameList
                && !this.hostList.getHost(this.gameList.getHostId())) {
                // The newly fetched list doesn't contain the hosts game view we're in -> go to hosts
                this.setCurrentDisplay("hosts");
            }
            yield Promise.all([
                promiseUser,
                promiseRoles,
                this.refreshGameListActiveGame()
            ]);
        });
    }
    refreshUserRole() {
        return __awaiter(this, void 0, void 0, function* () {
            this.user = yield apiGetUser(this.api);
            if (this.topLineActions.contains(this.logoutButton)) {
                this.topLineActions.removeChild(this.logoutButton);
            }
            if (this.topLineActions.contains(this.loginButton)) {
                this.topLineActions.removeChild(this.loginButton);
            }
            if (this.topLineActions.contains(this.adminButton)) {
                this.topLineActions.removeChild(this.adminButton);
            }
            if (this.user.is_default_user) {
                this.topLineActions.appendChild(this.loginButton);
            }
            else {
                this.topLineActions.appendChild(this.logoutButton);
            }
            if (this.user.role == "Admin") {
                this.topLineActions.appendChild(this.adminButton);
                if (this.currentDisplay == "settings" && !this.actionElement.contains(this.saveRoleDefaultsButton)) {
                    this.actionElement.appendChild(this.saveRoleDefaultsButton);
                }
            }
            else if (this.actionElement.contains(this.saveRoleDefaultsButton)) {
                this.actionElement.removeChild(this.saveRoleDefaultsButton);
            }
        });
    }
    refreshUserPermissions() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield apiGetRole(this.api, { id: null });
            this.role = response.role;
            if (this.role.permissions.allow_add_hosts) {
                this.hostAddButton.disabled = false;
            }
            else {
                this.hostAddButton.disabled = true;
            }
        });
    }
    refreshGameListActiveGame() {
        return __awaiter(this, void 0, void 0, function* () {
            const gameList = this.gameList;
            const hostId = gameList === null || gameList === void 0 ? void 0 : gameList.getHostId();
            if (hostId == null) {
                return;
            }
            const host = this.hostList.getHost(hostId);
            let currentGame = null;
            if (host != null) {
                currentGame = yield host.getCurrentGame();
            }
            else {
                const host = yield apiGetHost(this.api, { host_id: hostId });
                if (host.current_game != 0) {
                    currentGame = host.current_game;
                }
            }
            if (currentGame != null) {
                gameList === null || gameList === void 0 ? void 0 : gameList.setActiveGame(currentGame);
            }
            else {
                gameList === null || gameList === void 0 ? void 0 : gameList.setActiveGame(null);
            }
        });
    }
    mount(parent) {
        parent.appendChild(this.divElement);
    }
    unmount(parent) {
        parent.removeChild(this.divElement);
    }
}
