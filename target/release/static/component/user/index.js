var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { apiDeleteUser, apiGetUser } from "../../api.js";
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { setContextMenu } from "../context_menu.js";
import { ComponentEvent } from "../index.js";
export function tryDeleteUser(api, id) {
    return __awaiter(this, void 0, void 0, function* () {
        yield apiDeleteUser(api, { id });
    });
}
export class User {
    constructor(api, user) {
        this.div = document.createElement("div");
        this.nameElement = document.createElement("p");
        this.api = api;
        this.div.appendChild(this.nameElement);
        this.div.addEventListener("click", this.onClick.bind(this));
        this.div.addEventListener("contextmenu", this.onContextMenu.bind(this));
        this.user = user;
        if ("name" in user) {
            this.updateCache(user);
        }
        else {
            this.forceFetch();
        }
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield apiGetUser(this.api, {
                name: null,
                user_id: this.user.id,
            });
            this.updateCache(user);
        });
    }
    updateCache(user) {
        this.user = user;
        this.nameElement.innerText = user.name;
    }
    onClick() {
        this.div.dispatchEvent(new ComponentEvent("ml-userclicked", this));
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
        this.div.addEventListener("ml-userclicked", listener, options);
    }
    removeClickedListener(listener) {
        this.div.removeEventListener("ml-userclicked", listener);
    }
    onDelete() {
        tryDeleteUser(this.api, this.user.id);
        this.div.dispatchEvent(new ComponentEvent("ml-userdeleted", this));
    }
    addDeletedListener(listener, options) {
        this.div.addEventListener("ml-userdeleted", listener, options);
    }
    removeDeletedListener(listener) {
        this.div.removeEventListener("ml-userdeleted", listener);
    }
    getCache() {
        if ("name" in this.user) {
            return this.user;
        }
        else {
            return null;
        }
    }
    getUserId() {
        return this.user.id;
    }
    mount(parent) {
        parent.appendChild(this.div);
    }
    unmount(parent) {
        parent.removeChild(this.div);
    }
}
