var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { apiDeleteRole, apiGetRole, apiGetUsers } from "../../api.js";
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { setContextMenu } from "../context_menu.js";
import { ComponentEvent } from "../index.js";
import { showMessage } from "../modal/index.js";
export function formatRoleName(role) {
    return `${role.name} (${role.id})`;
}
export function tryDeleteRole(api, id) {
    return __awaiter(this, void 0, void 0, function* () {
        const i = getTranslations(getCurrentLanguage()).admin;
        // Check if any user still has this role and show error if they do
        const usersResponse = yield apiGetUsers(api);
        const usersWithRole = usersResponse.users.filter(user => user.role_id == id);
        if (usersWithRole.length > 0) {
            yield showMessage(i.roleDeleteBlocked(usersWithRole.map(user => user.name)));
            return false;
        }
        // Actually delete the role
        yield apiDeleteRole(api, { id });
        return true;
    });
}
export class Role {
    constructor(api, role) {
        this.div = document.createElement("div");
        this.nameElement = document.createElement("p");
        this.api = api;
        this.div.appendChild(this.nameElement);
        this.div.addEventListener("click", this.onClick.bind(this));
        this.div.addEventListener("contextmenu", this.onContextMenu.bind(this));
        this.role = role;
        if ("name" in role) {
            this.updateCache(role);
        }
        else {
            this.forceFetch();
        }
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield apiGetRole(this.api, {
                id: this.role.id,
            });
            this.updateCache(response.role);
        });
    }
    updateCache(role) {
        this.role = role;
        this.nameElement.innerText = formatRoleName(role);
    }
    onClick() {
        this.div.dispatchEvent(new ComponentEvent("ml-roleclicked", this));
    }
    onContextMenu(event) {
        const i = getTranslations(getCurrentLanguage()).admin;
        setContextMenu(event, {
            elements: [
                {
                    name: i.delete,
                    callback: this.onDelete.bind(this)
                }
            ]
        });
    }
    addClickedListener(listener, options) {
        this.div.addEventListener("ml-roleclicked", listener, options);
    }
    removeClickedListener(listener) {
        this.div.removeEventListener("ml-roleclicked", listener);
    }
    onDelete() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield tryDeleteRole(this.api, this.role.id))) {
                return;
            }
            this.div.dispatchEvent(new ComponentEvent("ml-roledeleted", this));
        });
    }
    addDeletedListener(listener, options) {
        this.div.addEventListener("ml-roledeleted", listener, options);
    }
    removeDeletedListener(listener) {
        this.div.removeEventListener("ml-roledeleted", listener);
    }
    getCache() {
        if ("name" in this.role) {
            return this.role;
        }
        else {
            return null;
        }
    }
    getRoleId() {
        return this.role.id;
    }
    mount(parent) {
        parent.appendChild(this.div);
    }
    unmount(parent) {
        parent.removeChild(this.div);
    }
}
