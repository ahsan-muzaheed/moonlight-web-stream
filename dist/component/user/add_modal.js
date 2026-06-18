import { apiGetRoles } from "../../api.js";
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { showNotification } from "../notification.js";
import { InputComponent } from "../input.js";
import { FormModal } from "../modal/form.js";
import { createSelectRoleInput } from "./role_select.js";
export class AddUserModal extends FormModal {
    constructor(api) {
        super();
        this.header = document.createElement("h2");
        this.modalRoot = document.createElement("div");
        const i = getTranslations(getCurrentLanguage()).admin;
        this.header.innerText = i.user;
        this.modalRoot.appendChild(this.header);
        this.name = new InputComponent("userName", "text", i.name, {
            formRequired: true
        });
        this.name.mount(this.modalRoot);
        this.defaultPassword = new InputComponent("userPassword", "text", i.defaultPassword, {
            formRequired: true
        });
        this.defaultPassword.mount(this.modalRoot);
        this.role = createSelectRoleInput([]);
        this.role.mount(this.modalRoot);
        apiGetRoles(api).then(roles => {
            this.role.unmount(this.modalRoot);
            this.role = createSelectRoleInput(roles.roles);
            this.role.mountBefore(this.modalRoot, this.clientUniqueId);
        });
        this.clientUniqueId = new InputComponent("userClientUniqueId", "text", i.moonlightClientId, {
            formRequired: true,
            hasEnableCheckbox: true
        });
        this.clientUniqueId.mount(this.modalRoot);
        this.name.addChangeListener(this.updateClientUniqueId.bind(this));
    }
    updateClientUniqueId() {
        this.clientUniqueId.setPlaceholder(this.name.getValue());
    }
    mountForm(form) {
        form.appendChild(this.modalRoot);
    }
    reset() {
        this.name.reset();
        this.defaultPassword.reset();
        this.role.reset();
    }
    submit() {
        const i = getTranslations(getCurrentLanguage()).admin;
        const name = this.name.getValue();
        const password = this.defaultPassword.getValue();
        const role = this.role.getValue();
        if (!role) {
            showNotification(i.pleaseSelectRole);
            return null;
        }
        let clientUniqueId = name;
        if (this.clientUniqueId.isEnabled()) {
            clientUniqueId = this.clientUniqueId.getValue();
        }
        return {
            name,
            password,
            role_id: parseInt(role),
            client_unique_id: clientUniqueId,
        };
    }
}
