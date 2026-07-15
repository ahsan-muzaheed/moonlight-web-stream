import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";
import { ptBR } from "./locales/pt-BR.js";
import { frFr } from "./locales/fr-FR.js";
import { koKR } from "./locales/ko-KR.js";
const locales = {
    "en": en,
    "zh-CN": zhCN,
    "pt-BR": ptBR,
    "fr-FR": frFr,
    "ko-KR": koKR,
};
export function getTranslations(language) {
    return locales[language];
}
export function normalizeLanguage(language) {
    if (language === "zh" || language === "zh-CN" || language === "zh_CN") {
        return "zh-CN";
    }
    if (language === "pt" || language === "pt-BR" || language === "pt_BR") {
        return "pt-BR";
    }
    if (language === "ko" || language === "ko-KR" || language === "ko_KR") {
        return "ko-KR";
    }
    return "en";
}
function getStoredSettings() {
    try {
        const raw = localStorage.getItem("mlSettings");
        return raw ? JSON.parse(raw) : null;
    }
    catch (_a) {
        return null;
    }
}
export function getCurrentLanguage() {
    var _a;
    return normalizeLanguage((_a = getStoredSettings()) === null || _a === void 0 ? void 0 : _a.language);
}
export function hasStoredLanguage() {
    var _a;
    return ((_a = getStoredSettings()) === null || _a === void 0 ? void 0 : _a.language) != null;
}
export function adoptRoleDefaultLanguage(roleDefaultSettings) {
    var _a;
    if (hasStoredLanguage()) {
        return false;
    }
    const roleLanguage = normalizeLanguage(roleDefaultSettings === null || roleDefaultSettings === void 0 ? void 0 : roleDefaultSettings.language);
    if (roleLanguage === getCurrentLanguage()) {
        return false;
    }
    try {
        const settings = (_a = getStoredSettings()) !== null && _a !== void 0 ? _a : {};
        settings.language = roleLanguage;
        localStorage.setItem("mlSettings", JSON.stringify(settings));
        return true;
    }
    catch (_b) {
        localStorage.setItem("mlSettings", JSON.stringify({ language: roleLanguage }));
        return true;
    }
}
export function getLanguageOptions() {
    return [
        { value: "en", name: "English" },
        { value: "zh-CN", name: "中文" },
        { value: "pt-BR", name: "Português (Brasil)" },
        { value: "fr-FR", name: "Français" },
        { value: "ko-KR", name: "한국어" },
    ];
}
