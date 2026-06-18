import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { InputComponent, SelectComponent } from "../input.js";
import { FormModal } from "../modal/form.js";
import { globalDefaultSettings, StreamSettingsComponent } from "../settings_menu.js";
import { RolePermissionsMenu } from "./permissions.js";
export class AddRoleModal extends FormModal {
    constructor() {
        super();
        this.header = document.createElement("h2");
        this.modalRoot = document.createElement("div");
        this.permissionsHeader = document.createElement("h3");
        this.defaultSettingsHeader = document.createElement("h3");
        const i = getTranslations(getCurrentLanguage()).admin;
        this.header.innerText = i.role;
        this.modalRoot.appendChild(this.header);
        // Name
        this.name = new InputComponent("roleName", "text", i.name, {
            formRequired: true
        });
        this.name.mount(this.modalRoot);
        // Ty
        this.ty = new SelectComponent("roleTy", [
            { value: "User", name: "User" },
            { value: "Admin", name: "Admin" },
        ], {
            displayName: i.roleType,
            preSelectedOption: "User",
        });
        this.ty.mount(this.modalRoot);
        // Permissions
        this.permissionsHeader.innerText = i.permissions;
        this.modalRoot.appendChild(this.permissionsHeader);
        this.permissions = new RolePermissionsMenu();
        this.permissions.mount(this.modalRoot);
        this.permissions.addChangeListener(this.onPermissionsChange.bind(this));
        // Default Settings
        this.defaultSettingsHeader.innerText = i.defaultSettings;
        this.modalRoot.appendChild(this.defaultSettingsHeader);
        this.defaultSettings = new StreamSettingsComponent(this.permissions.getPermissions(), globalDefaultSettings());
        this.defaultSettings.mount(this.modalRoot);
    }
    onPermissionsChange() {
        const settings = this.defaultSettings.getStreamSettings();
        this.defaultSettings.unmount(this.modalRoot);
        this.defaultSettings = new StreamSettingsComponent(this.permissions.getPermissions(), settings);
        this.defaultSettings.mount(this.modalRoot);
    }
    mountForm(form) {
        form.appendChild(this.modalRoot);
    }
    reset() {
        this.name.reset();
    }
    submit() {
        const name = this.name.getValue();
        const ty = this.ty.getValue();
        return {
            name,
            ty,
            default_settings: this.defaultSettings.getStreamSettings(),
            permissions: this.permissions.getPermissions()
        };
    }
}
