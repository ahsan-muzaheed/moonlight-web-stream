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
import { apiPatchRole } from "../../api.js";
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { InputComponent, SelectComponent } from "../input.js";
import { tryDeleteRole } from "./index.js";
import { RolePermissionsMenu } from "./permissions.js";
import { StreamSettingsComponent } from "../settings_menu.js";
export class DetailedRolePage {
    constructor(api, role) {
        this.formRoot = document.createElement("form");
        // -- Permissions
        this.permissionsHeader = document.createElement("h3");
        // -- Default Settings
        this.defaultSettingsHeader = document.createElement("h3");
        // -- Apply buttons
        this.applyButton = document.createElement("button");
        this.deleteButton = document.createElement("button");
        this.api = api;
        this.id = role.id;
        const i = getTranslations(getCurrentLanguage()).admin;
        this.formRoot.classList.add("role-info");
        // Role stuff
        this.idElement = new InputComponent("roleId", "number", i.roleId, {
            defaultValue: `${role.id}`
        });
        this.idElement.setEnabled(false);
        this.idElement.mount(this.formRoot);
        this.name = new InputComponent("roleName", "text", i.roleName, {
            defaultValue: role.name,
        });
        this.name.mount(this.formRoot);
        this.ty = new SelectComponent("roleTy", [
            { value: "User", name: "User" },
            { value: "Admin", name: "Admin" },
        ], {
            displayName: i.roleType,
            preSelectedOption: role.ty,
        });
        this.ty.mount(this.formRoot);
        // Permissions
        this.permissionsHeader.innerText = i.permissions;
        this.formRoot.appendChild(this.permissionsHeader);
        this.permissions = new RolePermissionsMenu(role.permissions);
        this.permissions.mount(this.formRoot);
        this.permissions.addChangeListener(this.onPermissionsChange.bind(this));
        // Default Settings
        this.defaultSettingsHeader.innerText = i.defaultSettings;
        this.formRoot.appendChild(this.defaultSettingsHeader);
        this.defaultSettings = new StreamSettingsComponent(role.permissions, role.default_settings);
        this.defaultSettings.mount(this.formRoot);
        // Apply / Delete
        this.applyButton.innerText = i.apply;
        this.applyButton.type = "submit";
        this.formRoot.appendChild(this.applyButton);
        this.deleteButton.addEventListener("click", this.delete.bind(this));
        this.deleteButton.classList.add("role-info-delete");
        this.deleteButton.innerText = i.delete;
        this.deleteButton.type = "button";
        this.formRoot.appendChild(this.deleteButton);
        this.formRoot.addEventListener("submit", this.apply.bind(this));
    }
    onPermissionsChange() {
        const currentSettings = this.defaultSettings.getStreamSettings();
        this.defaultSettings.unmount(this.formRoot);
        this.defaultSettings = new StreamSettingsComponent(this.permissions.getPermissions(), currentSettings);
        this.defaultSettings.mountBefore(this.formRoot, this.applyButton);
    }
    apply(event) {
        return __awaiter(this, void 0, void 0, function* () {
            event.preventDefault();
            const request = {
                id: this.id,
                name: this.name.getValue(),
                ty: this.ty.getValue(),
                default_settings: this.defaultSettings.getStreamSettings(),
                permissions: this.permissions.getPermissions()
            };
            yield apiPatchRole(this.api, request);
        });
    }
    delete() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield tryDeleteRole(this.api, this.id))) {
                return;
            }
            this.formRoot.dispatchEvent(new ComponentEvent("ml-roledeleted", this));
        });
    }
    addDeletedListener(listener, options) {
        this.formRoot.addEventListener("ml-roledeleted", listener, options);
    }
    removeDeletedListener(listener) {
        this.formRoot.removeEventListener("ml-roledeleted", listener);
    }
    getRoleId() {
        return this.id;
    }
    mount(parent) {
        parent.appendChild(this.formRoot);
    }
    unmount(parent) {
        parent.removeChild(this.formRoot);
    }
}
