var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { InputComponent } from "../input.js";
import { FormModal } from "./form.js";
export class ApiUserPasswordPrompt extends FormModal {
    constructor() {
        super();
        this.text = document.createElement("h3");
        const i = getTranslations(getCurrentLanguage()).modal;
        this.text.innerText = i.login;
        this.name = new InputComponent("ml-api-name", "text", i.username, {
            formRequired: true
        });
        this.password = new InputComponent("ml-api-password", "password", i.password, {
            formRequired: true
        });
        this.passwordFile = new InputComponent("ml-api-password-file", "file", i.passwordAsFile, { accept: ".txt" });
        this.passwordFile.addChangeListener(this.setFilePassword.bind(this));
    }
    setFilePassword(event) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = event.component.getFiles();
            if (!files) {
                return;
            }
            const file = files[0];
            if (!file) {
                return;
            }
            const text = yield file.text();
            // Remove carriage return and new line
            const password = text
                .replace(/\r/g, "")
                .replace(/\n/g, "");
            this.password.setValue(password);
        });
    }
    reset() {
        this.name.reset();
        this.password.reset();
        this.passwordFile.reset();
    }
    submit() {
        const name = this.name.getValue();
        const password = this.password.getValue();
        if (name && password) {
            return { name, password };
        }
        else {
            return null;
        }
    }
    onFinish(abort) {
        const abortController = new AbortController();
        abort.addEventListener("abort", abortController.abort.bind(abortController));
        return new Promise((resolve, reject) => {
            super.onFinish(abortController.signal).then((data) => {
                abortController.abort();
                resolve(data);
            }, (data) => {
                abortController.abort();
                reject(data);
            });
        });
    }
    mountForm(form) {
        form.appendChild(this.text);
        this.name.mount(form);
        this.password.mount(form);
        this.passwordFile.mount(form);
    }
}
