import { globalDefaultSettings, getLocalStreamSettings } from "../component/settings_menu.js";
let currentStyle = null;
const styleLink = document.getElementById("style");
function toAbsolute(path) {
    return new URL(path, document.baseURI).href;
}
export function setStyle(style) {
    if (!currentStyle) {
        document.head.appendChild(styleLink);
    }
    const path = `styles/${style}.css`;
    const absolute = toAbsolute(path);
    if (styleLink.href !== absolute) {
        styleLink.href = absolute;
    }
    currentStyle = style;
}
export function getStyle() {
    return currentStyle;
}
const settings = getLocalStreamSettings(globalDefaultSettings());
setStyle(settings.pageStyle);
