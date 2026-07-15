import { getCurrentLanguage, getTranslations } from "../i18n.js";
import { showNotification } from "./notification.js";
import { ListComponent } from "./list.js";
document.addEventListener("click", () => removeContextMenu());
const contextMenuElement = document.getElementById("context-menu");
const contextMenuList = new ListComponent([], {
    listClasses: ["context-menu-list"]
});
export function setContextMenu(event, init) {
    var _a;
    const i = getTranslations(getCurrentLanguage()).common;
    event.preventDefault();
    event.stopPropagation();
    if (contextMenuElement == null) {
        showNotification(i.missingContextMenu);
        return;
    }
    contextMenuElement.style.setProperty("left", `${event.clientX}px`);
    contextMenuElement.style.setProperty("top", `${event.clientY}px`);
    contextMenuList.clear();
    for (const element of (_a = init === null || init === void 0 ? void 0 : init.elements) !== null && _a !== void 0 ? _a : []) {
        contextMenuList.append(new ContextMenuElementComponent(element));
    }
    contextMenuList.mount(contextMenuElement);
    contextMenuElement.classList.remove("context-menu-disabled");
}
export function removeContextMenu() {
    const i = getTranslations(getCurrentLanguage()).common;
    if (contextMenuElement == null) {
        showNotification(i.missingContextMenu);
        return;
    }
    contextMenuElement.classList.add("context-menu-disabled");
}
class ContextMenuElementComponent {
    constructor(element) {
        this.nameElement = document.createElement("p");
        this.nameElement.innerText = element.name;
        this.nameElement.classList.add("context-menu-element");
        this.nameElement.addEventListener("click", event => {
            element.callback(event);
        });
        // Also register right click for certain devices which make left click hard: https://github.com/MrCreativ3001/moonlight-web-stream/issues/55
        this.nameElement.addEventListener("contextmenu", event => {
            event.preventDefault();
            removeContextMenu();
            element.callback(event);
        }, { passive: false });
        if (element.classes) {
            this.nameElement.classList.add(...element.classes);
        }
    }
    mount(parent) {
        parent.appendChild(this.nameElement);
    }
    unmount(parent) {
        parent.removeChild(this.nameElement);
    }
}
