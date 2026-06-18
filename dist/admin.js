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
import "./styles/index.js";
import { apiGetRole, apiGetUser, apiLogout, apiPostRole, apiPostUser, FetchError, getApi } from "./api.js";
import { showNotification } from "./component/notification.js";
import { setTouchContextMenuEnabled } from "./polyfill/ios_right_click.js";
import { UserList } from "./component/user/list.js";
import { AddUserModal } from "./component/user/add_modal.js";
import { showMessage, showModal } from "./component/modal/index.js";
import { buildUrl } from "./config_.js";
import { DetailedUserPage } from "./component/user/detailed_page.js";
import { RoleList } from "./component/roles/list.js";
import { DetailedRolePage } from "./component/roles/detailed_page.js";
import { AddRoleModal } from "./component/roles/add_modal.js";
import { adoptRoleDefaultLanguage, getCurrentLanguage, getTranslations } from "./i18n.js";
let I = getTranslations(getCurrentLanguage());
function startApp() {
    return __awaiter(this, void 0, void 0, function* () {
        setTouchContextMenuEnabled(true);
        const api = yield getApi();
        const bootstrapRole = yield apiGetRole(api, { id: null });
        adoptRoleDefaultLanguage(bootstrapRole.role.default_settings);
        I = getTranslations(getCurrentLanguage());
        checkPermissions(api);
        const rootElement = document.getElementById("root");
        if (rootElement == null) {
            showNotification(I.admin.rootNotFound, "error");
            return;
        }
        const app = new AdminApp(api);
        app.mount(rootElement);
        app.forceFetch();
        // -- App states
        let lastAppState = null;
        if (sessionStorage) {
            const lastStateText = sessionStorage.getItem("mlAdminState");
            if (lastStateText) {
                lastAppState = JSON.parse(lastStateText);
            }
        }
        window.addEventListener("popstate", event => {
            if (event.state) {
                app.setAppState(event.state, false);
            }
        });
        if (lastAppState) {
            app.setAppState(lastAppState);
        }
        else {
            // set default state
            app.setAppState({ tab: "users", user_id: null });
        }
    });
}
function checkPermissions(api) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield apiGetUser(api);
        if (user.role != "Admin") {
            yield showMessage(I.admin.unauthorized);
            window.location.href = buildUrl("/");
        }
    });
}
function pushAppState(state, pushHistory) {
    if (pushHistory) {
        history.pushState(state, "");
    }
    if (sessionStorage) {
        sessionStorage.setItem("mlAdminState", JSON.stringify(state));
    }
}
function backAppState() {
    history.back();
}
startApp();
class AdminApp {
    constructor(api) {
        this.root = document.createElement("div");
        this.currentState = null;
        // Top Line
        this.topLine = document.createElement("div");
        this.moonlightTextElement = document.createElement("h1");
        this.topLineActions = document.createElement("div");
        this.logoutButton = document.createElement("button");
        this.userButton = document.createElement("button");
        // Different tabs
        this.tabs = document.createElement("div");
        this.userTabButton = document.createElement("button");
        this.rolesTabButton = document.createElement("button");
        // Content
        this.content = document.createElement("div");
        // The actual content of the tabs
        this.users = null;
        this.roles = null;
        this.api = api;
        // Top Line
        this.topLine.classList.add("top-line");
        this.moonlightTextElement.innerHTML =
            'Moonlight Web <span style="color:red; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; -webkit-text-stroke: 2px #000">Admin</span>';
        this.topLine.appendChild(this.moonlightTextElement);
        this.topLine.appendChild(this.topLineActions);
        this.topLineActions.classList.add("top-line-actions");
        // TODO: logout button doesn't work on default user
        this.logoutButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            yield apiLogout(this.api);
            window.location.reload();
        }));
        this.logoutButton.classList.add("logout-button");
        this.topLineActions.appendChild(this.logoutButton);
        this.userButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            window.location.href = buildUrl("/");
        }));
        this.userButton.classList.add("user-button");
        this.topLineActions.appendChild(this.userButton);
        this.root.appendChild(this.topLine);
        // Tab div
        this.tabs.classList.add("admin-panel-tabs");
        this.root.appendChild(this.tabs);
        // Users tab
        this.userTabButton.innerText = I.admin.users;
        this.userTabButton.addEventListener("click", () => {
            this.setAppState({ tab: "users", user_id: null });
        });
        this.tabs.appendChild(this.userTabButton);
        // Roles tab
        this.rolesTabButton.innerText = I.admin.roles;
        this.rolesTabButton.addEventListener("click", () => {
            this.setAppState({ tab: "roles", role_id: null });
        });
        this.tabs.appendChild(this.rolesTabButton);
        // Content div
        this.content.classList.add("admin-panel-content");
        this.root.appendChild(this.content);
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (((_a = this.currentState) === null || _a === void 0 ? void 0 : _a.tab) == "users") {
                yield ((_b = this.users) === null || _b === void 0 ? void 0 : _b.forceFetch());
            }
            else if (((_c = this.currentState) === null || _c === void 0 ? void 0 : _c.tab) == "roles") {
                yield ((_d = this.roles) === null || _d === void 0 ? void 0 : _d.forceFetch());
            }
        });
    }
    setAppState(state, pushIntoHistory) {
        var _a, _b, _c, _d, _e, _f, _g;
        // check if tab changed and mount accordingly
        if (((_a = this.currentState) === null || _a === void 0 ? void 0 : _a.tab) != state.tab) {
            // Unmount old tab
            if (((_b = this.currentState) === null || _b === void 0 ? void 0 : _b.tab) == "users") {
                (_c = this.users) === null || _c === void 0 ? void 0 : _c.unmount(this.content);
            }
            else if (((_d = this.currentState) === null || _d === void 0 ? void 0 : _d.tab) == "roles") {
                (_e = this.roles) === null || _e === void 0 ? void 0 : _e.unmount(this.content);
            }
            // Mount and create (if necessary) new tab
            if (state.tab == "users") {
                if (!this.users) {
                    this.users = new UserPanel(this.api);
                    this.users.addUserChangedListener(event => {
                        pushAppState({ tab: "users", user_id: event.component.getUserId() }, true);
                    });
                }
                this.users.mount(this.content);
            }
            else if (state.tab == "roles") {
                if (!this.roles) {
                    this.roles = new RolePanel(this.api);
                    this.roles.addRoleChangedListener(event => {
                        pushAppState({ tab: "roles", role_id: event.component.getRoleId() }, true);
                    });
                }
                this.roles.mount(this.content);
            }
        }
        // Save app state to browser history
        pushAppState(state, pushIntoHistory !== null && pushIntoHistory !== void 0 ? pushIntoHistory : true);
        // Change the content (e.g. user / role) of the tab
        this.currentState = state;
        if (state.tab == "users" && state.user_id != null) {
            (_f = this.users) === null || _f === void 0 ? void 0 : _f.setUserId(state.user_id);
        }
        else if (state.tab == "roles" && state.role_id != null) {
            (_g = this.roles) === null || _g === void 0 ? void 0 : _g.setRoleId(state.role_id);
        }
        // Force fetch self to update data
        this.forceFetch();
    }
    mount(parent) {
        parent.appendChild(this.root);
    }
    unmount(parent) {
        parent.removeChild(this.root);
    }
}
class UserPanel {
    constructor(api) {
        this.rootDiv = document.createElement("div");
        this.userPanel = document.createElement("div");
        this.addUserButton = document.createElement("button");
        this.userSearch = document.createElement("input");
        this.userInfoPage = null;
        this.api = api;
        this.rootDiv.classList.add("admin-panel-users");
        // Select User Panel
        this.userPanel.classList.add("user-panel");
        this.rootDiv.appendChild(this.userPanel);
        this.addUserButton.innerText = I.admin.addUser;
        this.addUserButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const addUserModal = new AddUserModal(api);
            const userRequest = yield showModal(addUserModal);
            if (userRequest) {
                try {
                    const newUser = yield apiPostUser(this.api, userRequest);
                    this.userList.insertList(newUser.id, newUser);
                }
                catch (e) {
                    // 409 = Conflict
                    if (e instanceof FetchError && ((_a = e.getResponse()) === null || _a === void 0 ? void 0 : _a.status) == 409) {
                        // Name already exists
                        yield showMessage(I.admin.userExists(userRequest.name));
                    }
                    else {
                        throw e;
                    }
                }
            }
        }));
        this.userPanel.appendChild(this.addUserButton);
        this.userSearch.placeholder = I.admin.searchUser;
        this.userSearch.type = "text";
        this.userSearch.addEventListener("input", this.onUserSearchChange.bind(this));
        this.userPanel.appendChild(this.userSearch);
        this.userList = new UserList(api);
        this.userList.addUserClickedListener(this.onUserClicked.bind(this));
        this.userList.addUserDeletedListener(this.onUserDeleted.bind(this));
        this.userList.mount(this.userPanel);
    }
    addUserChangedListener(listener) {
        this.userList.addUserClickedListener(listener);
    }
    getCurrentUserId() {
        var _a, _b;
        return (_b = (_a = this.userInfoPage) === null || _a === void 0 ? void 0 : _a.getUserId()) !== null && _b !== void 0 ? _b : null;
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.userList.forceFetch();
        });
    }
    onUserSearchChange() {
        this.userList.setFilter(this.userSearch.value);
    }
    onUserClicked(event) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setUserId(event.component.getUserId());
        });
    }
    setUserId(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield apiGetUser(this.api, {
                user_id: userId,
                name: null
            });
            this.setUserInfo(user);
        });
    }
    setUserInfo(user) {
        if (this.userInfoPage) {
            this.userInfoPage.unmount(this.rootDiv);
            this.userInfoPage.removeDeletedListener(this.onUserDeleted.bind(this));
        }
        this.userInfoPage = null;
        if (user) {
            this.userInfoPage = new DetailedUserPage(this.api, user);
            this.userInfoPage.addDeletedListener(this.onUserDeleted.bind(this));
            this.userInfoPage.mount(this.rootDiv);
        }
    }
    onUserDeleted(event) {
        var _a;
        if (((_a = this.userInfoPage) === null || _a === void 0 ? void 0 : _a.getUserId()) == event.component.getUserId()) {
            this.setUserInfo(null);
        }
        this.userList.removeUser(event.component.getUserId());
    }
    mount(parent) {
        parent.appendChild(this.rootDiv);
    }
    unmount(parent) {
        parent.removeChild(this.rootDiv);
    }
}
class RolePanel {
    constructor(api) {
        this.rootDiv = document.createElement("div");
        this.rolePanel = document.createElement("div");
        this.addRoleButton = document.createElement("button");
        this.roleSearch = document.createElement("input");
        this.roleInfoPage = null;
        this.api = api;
        this.rootDiv.classList.add("admin-panel-roles");
        // Select Role Panel
        this.rolePanel.classList.add("role-panel");
        this.rootDiv.appendChild(this.rolePanel);
        this.addRoleButton.innerText = I.admin.addRole;
        this.addRoleButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const addRoleModal = new AddRoleModal();
            const roleRequest = yield showModal(addRoleModal);
            if (roleRequest) {
                try {
                    const newRole = yield apiPostRole(this.api, roleRequest);
                    this.roleList.insertList(newRole.role.id, newRole.role);
                }
                catch (e) {
                    // 409 = Conflict
                    if (e instanceof FetchError && ((_a = e.getResponse()) === null || _a === void 0 ? void 0 : _a.status) == 409) {
                        // Name already exists
                        yield showMessage(I.admin.roleExists(roleRequest.name));
                    }
                    else {
                        throw e;
                    }
                }
            }
        }));
        this.rolePanel.appendChild(this.addRoleButton);
        this.roleSearch.placeholder = I.admin.searchRole;
        this.roleSearch.type = "text";
        this.roleSearch.addEventListener("input", this.onRoleSearchChange.bind(this));
        this.rolePanel.appendChild(this.roleSearch);
        this.roleList = new RoleList(api);
        this.roleList.addRoleClickedListener(this.onRoleClicked.bind(this));
        this.roleList.addRoleDeletedListener(this.onRoleDeleted.bind(this));
        this.roleList.mount(this.rolePanel);
    }
    addRoleChangedListener(listener) {
        this.roleList.addRoleClickedListener(listener);
    }
    getCurrentRoleId() {
        var _a, _b;
        return (_b = (_a = this.roleInfoPage) === null || _a === void 0 ? void 0 : _a.getRoleId()) !== null && _b !== void 0 ? _b : null;
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.roleList.forceFetch();
        });
    }
    onRoleSearchChange() {
        this.roleList.setFilter(this.roleSearch.value);
    }
    onRoleClicked(event) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setRoleId(event.component.getRoleId());
        });
    }
    setRoleId(roleId) {
        return __awaiter(this, void 0, void 0, function* () {
            const role = yield apiGetRole(this.api, {
                id: roleId,
            });
            this.setRoleInfo(role.role);
        });
    }
    setRoleInfo(role) {
        if (this.roleInfoPage) {
            this.roleInfoPage.unmount(this.rootDiv);
            this.roleInfoPage.removeDeletedListener(this.onRoleDeleted.bind(this));
        }
        this.roleInfoPage = null;
        if (role) {
            this.roleInfoPage = new DetailedRolePage(this.api, role);
            this.roleInfoPage.addDeletedListener(this.onRoleDeleted.bind(this));
            this.roleInfoPage.mount(this.rootDiv);
        }
    }
    onRoleDeleted(event) {
        var _a;
        if (((_a = this.roleInfoPage) === null || _a === void 0 ? void 0 : _a.getRoleId()) == event.component.getRoleId()) {
            this.setRoleInfo(null);
        }
        this.roleList.removeRole(event.component.getRoleId());
    }
    mount(parent) {
        parent.appendChild(this.rootDiv);
    }
    unmount(parent) {
        parent.removeChild(this.rootDiv);
    }
}
