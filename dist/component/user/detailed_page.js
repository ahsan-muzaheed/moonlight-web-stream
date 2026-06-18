var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ComponentEvent } from "../index.js";
import { apiGetRoles, apiPatchUser } from "../../api.js";
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { InputComponent } from "../input.js";
import { createSelectRoleInput } from "./role_select.js";
import { tryDeleteUser } from "./index.js";
import { showNotification } from "../notification.js";
export class DetailedUserPage {
    constructor(api, user) {
        this.formRoot = document.createElement("form");
        this.applyButton = document.createElement("button");
        this.deleteButton = document.createElement("button");
        this.api = api;
        this.id = user.id;
        const i = getTranslations(getCurrentLanguage()).admin;
        this.formRoot.classList.add("user-info");
        this.idElement = new InputComponent("userId", "number", i.userId, {
            defaultValue: `${user.id}`
        });
        this.idElement.setEnabled(false);
        this.idElement.mount(this.formRoot);
        this.name = new InputComponent("userName", "text", i.userName, {
            defaultValue: user.name,
        });
        this.name.setEnabled(false);
        this.name.mount(this.formRoot);
        this.password = new InputComponent("userPassword", "text", i.password, {
            placeholer: i.newPassword,
            formRequired: true,
            hasEnableCheckbox: true
        });
        this.password.setEnabled(false);
        this.password.mount(this.formRoot);
        this.role = createSelectRoleInput([], user.role_id);
        this.role.mount(this.formRoot);
        apiGetRoles(api).then(roles => {
            this.role.unmount(this.formRoot);
            this.role = createSelectRoleInput(roles.roles, user.role_id);
            this.role.mountBefore(this.formRoot, this.clientUniqueId);
        });
        this.clientUniqueId = new InputComponent("userClientUniqueId", "text", i.moonlightClientId, {
            defaultValue: user.client_unique_id,
        });
        this.clientUniqueId.mount(this.formRoot);
        this.applyButton.innerText = i.apply;
        this.applyButton.type = "submit";
        this.formRoot.appendChild(this.applyButton);
        this.deleteButton.addEventListener("click", this.delete.bind(this));
        this.deleteButton.classList.add("user-info-delete");
        this.deleteButton.innerText = i.delete;
        this.deleteButton.type = "button";
        this.formRoot.appendChild(this.deleteButton);
        this.formRoot.addEventListener("submit", this.apply.bind(this));
    }
    apply(event) {
        return __awaiter(this, void 0, void 0, function* () {
            event.preventDefault();
            const i = getTranslations(getCurrentLanguage()).admin;
            let password = null;
            if (this.password.isEnabled()) {
                password = this.password.getValue();
            }
            const role = this.role.getValue();
            if (!role) {
                showNotification(i.pleaseSelectRole);
                return;
            }
            const request = {
                id: this.id,
                role_id: parseInt(role),
                password,
                client_unique_id: this.clientUniqueId.getValue()
            };
            yield apiPatchUser(this.api, request);
        });
    }
    delete() {
        return __awaiter(this, void 0, void 0, function* () {
            yield tryDeleteUser(this.api, this.id);
            this.formRoot.dispatchEvent(new ComponentEvent("ml-userdeleted", this));
        });
    }
    addDeletedListener(listener, options) {
        this.formRoot.addEventListener("ml-userdeleted", listener, options);
    }
    removeDeletedListener(listener) {
        this.formRoot.removeEventListener("ml-userdeleted", listener);
    }
    getUserId() {
        return this.id;
    }
    mount(parent) {
        parent.appendChild(this.formRoot);
    }
    unmount(parent) {
        parent.removeChild(this.formRoot);
    }
}
