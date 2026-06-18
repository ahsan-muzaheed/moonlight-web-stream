import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { InputComponent } from "../input.js";
import { FormModal } from "../modal/form.js";
export class AddHostModal extends FormModal {
    constructor() {
        super();
        this.header = document.createElement("h2");
        const i = getTranslations(getCurrentLanguage()).addHost;
        this.header.innerText = i.header;
        this.address = new InputComponent("address", "text", i.address, {
            formRequired: true
        });
        this.httpPort = new InputComponent("httpPort", "text", i.port, {
            inputMode: "numeric"
        });
    }
    reset() {
        this.address.reset();
        this.httpPort.reset();
    }
    submit() {
        const address = this.address.getValue();
        const httpPort = parseInt(this.httpPort.getValue());
        return {
            address,
            http_port: httpPort
        };
    }
    mountForm(form) {
        form.appendChild(this.header);
        this.address.mount(form);
        this.httpPort.mount(form);
    }
}
