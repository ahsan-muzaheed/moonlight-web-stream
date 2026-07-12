var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { showNotification } from "./component/notification.js";
import { showMessage, showModal } from "./component/modal/index.js";
import { ApiUserPasswordPrompt } from "./component/modal/login.js";
import { buildUrl } from "./config_.js";
// IMPORTANT: this should be a bit bigger than the moonlight-common reqwest backend timeout if some hosts are offline!
const API_TIMEOUT = 12000;
// -- Any errors related to auth will reload page -> show the auth modal
function handleError(event) {
    onError(event.error);
}
function handleRejection(event) {
    onError(event.reason);
}
function onError(error) {
    if (error instanceof FetchError) {
        const response = error.getResponse();
        // 401 = Unauthorized
        if ((response === null || response === void 0 ? void 0 : response.status) == 401) {
            window.location.reload();
        }
    }
}
window.addEventListener("error", handleError);
window.addEventListener("unhandledrejection", handleRejection);
export function getApi() {
    return __awaiter(this, void 0, void 0, function* () {
        const host_url = buildUrl("/api");
        let api = { host_url, bearer: null, user: null, role: null };
        if (yield apiAuthenticate(api)) {
            return api;
        }
        let newApi;
        while (true) {
            const api = yield tryLogin();
            if (api) {
                newApi = api;
                break;
            }
        }
        return newApi;
    });
}
export function tryLogin() {
    return __awaiter(this, void 0, void 0, function* () {
        const host_url = buildUrl("/api");
        let api = { host_url, bearer: null, user: null, role: null };
        const prompt = new ApiUserPasswordPrompt();
        const userAuth = yield showModal(prompt);
        if (userAuth == null) {
            return null;
        }
        if (yield apiLogin(api, userAuth)) {
            if (!(yield apiAuthenticate(api))) {
                showNotification("Login was successful but authentication doesn't work!");
            }
            return api;
        }
        else {
            yield showMessage("Credentials are not Valid");
            return null;
        }
    });
}
const GET = "GET";
const POST = "POST";
const PATCH = "PATCH";
const DELETE = "DELETE";
export function isDetailedHost(host) {
    return host.https_port !== undefined;
}
function buildRequest(api, endpoint, method, init) {
    const queryObj = (init === null || init === void 0 ? void 0 : init.query) || {};
    const queryParts = [];
    for (const key in queryObj) {
        // Remove all null values from query, these cause problems in rust
        if (queryObj[key] != null) {
            queryParts.push(encodeURIComponent(key) + "=" + encodeURIComponent(queryObj[key]));
        }
    }
    const queryString = queryParts.length > 0 ? "?" + queryParts.join("&") : "";
    const url = `${api.host_url}${endpoint}${queryString}`;
    const headers = {};
    if (api.bearer) {
        headers["Authorization"] = `Bearer ${api.bearer}`;
    }
    if (init === null || init === void 0 ? void 0 : init.json) {
        headers["Content-Type"] = "application/json";
    }
    const request = {
        method: method,
        headers,
        body: (init === null || init === void 0 ? void 0 : init.json) && JSON.stringify(init.json),
        credentials: "include"
    };
    return [url, request];
}
export class FetchError extends Error {
    constructor(type, endpoint, method, responseOrError, reason) {
        if (type == "timeout") {
            super(`failed to fetch ${method} at ${endpoint} because of timeout`);
        }
        else if (type == "failed") {
            const response = responseOrError;
            super(`failed to fetch ${method} at ${endpoint} with code ${response === null || response === void 0 ? void 0 : response.status} ${reason ? `because of ${reason}` : ""}`);
            this.response = response;
        }
        else if (type == "unknown") {
            const error = responseOrError;
            super(`failed to fetch ${method} at ${endpoint} because of ${error}`);
        }
    }
    getResponse() {
        var _a;
        return (_a = this.response) !== null && _a !== void 0 ? _a : null;
    }
}
class StreamedJsonResponse {
    constructor(body, response) {
        this.decoder = new TextDecoder();
        this.bufferedText = "";
        this.reader = body;
        this.response = response;
    }
    next() {
        return __awaiter(this, void 0, void 0, function* () {
            while (true) {
                const { done, value } = yield this.reader.read();
                if (done) {
                    return null;
                }
                this.bufferedText += this.decoder.decode(value);
                const split = this.bufferedText.split("\n", 2);
                if (split.length == 2) {
                    this.bufferedText = split[1];
                    const text = split[0];
                    const json = JSON.parse(text);
                    return json;
                }
            }
        });
    }
}
export function fetchApi(api_1, endpoint_1) {
    return __awaiter(this, arguments, void 0, function* (api, endpoint, method = GET, init, timeout = API_TIMEOUT) {
        var _a;
        const [url, request] = buildRequest(api, endpoint, method, init);
        request.signal = AbortSignal.timeout(timeout);
        let response;
        try {
            response = yield fetch(url, request);
        }
        catch (e) {
            throw new FetchError("unknown", endpoint, method, e);
        }
        if (!response.ok) {
            throw new FetchError("failed", endpoint, method, response);
        }
        if ((init === null || init === void 0 ? void 0 : init.response) == "ignore") {
            return response;
        }
        if ((init === null || init === void 0 ? void 0 : init.response) == undefined || init.response == "json") {
            const json = yield response.json();
            return json;
        }
        else if ((init === null || init === void 0 ? void 0 : init.response) == "jsonStreaming") {
            if (!response.body) {
                throw new FetchError("failed", endpoint, method, response);
            }
            // @ts-ignore
            const stream = new StreamedJsonResponse((_a = response.body) === null || _a === void 0 ? void 0 : _a.getReader());
            const data = yield stream.next();
            stream.response = data;
            return stream;
        }
    });
}
export function apiLogin(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        let response;
        try {
            response = yield fetchApi(api, "/login", "post", {
                json: request,
                response: "ignore"
            });
        }
        catch (e) {
            if (e instanceof FetchError) {
                const response = e.getResponse();
                if (response && (response.status == 401 || response.status == 404)) {
                    return false;
                }
                else {
                    showNotification(e.message);
                    return false;
                }
            }
        }
        return true;
    });
}
export function apiLogout(api) {
    return __awaiter(this, void 0, void 0, function* () {
        let response;
        try {
            response = yield fetchApi(api, "/logout", "post", { response: "ignore" });
        }
        catch (e) {
            throw e;
        }
        return true;
    });
}
export function apiAuthenticate(api, retryOnFail) {
    return __awaiter(this, void 0, void 0, function* () {
        const retryOnFail_ = retryOnFail === undefined ? true : retryOnFail;
        let response;
        try {
            response = yield fetchApi(api, "/authenticate", GET, { response: "ignore" });
        }
        catch (e) {
            if (e instanceof FetchError) {
                const response = e.getResponse();
                if ((response === null || response === void 0 ? void 0 : response.status) == 401) {
                    return false;
                }
                else if ((response === null || response === void 0 ? void 0 : response.status) == 409 && retryOnFail_) {
                    // 409 = Conflict, SessionTokenNotFound -> requires a new request
                    return yield apiAuthenticate(api, false);
                }
                else {
                    throw e;
                }
            }
            throw e;
        }
        return response != null;
    });
}
export function apiGetUser(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!query || (query.name == null && query.user_id == null)) {
            if (api.user) {
                return api.user;
            }
        }
        const response = yield fetchApi(api, "/user", GET, {
            query: query !== null && query !== void 0 ? query : { name: null, user_id: null }
        });
        return response;
    });
}
export function apiGetUsers(api) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/users", GET);
        return response;
    });
}
export function apiPostUser(api, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/user", POST, { json: data });
        return response;
    });
}
export function apiPatchUser(api, data) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/user", PATCH, {
            json: data,
            response: "ignore"
        });
    });
}
export function apiDeleteUser(api, data) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/user", DELETE, {
            json: data,
            response: "ignore"
        });
    });
}
export function apiGetRoles(api) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/roles", GET, {
            response: "json"
        });
        return response;
    });
}
export function apiGetRole(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/role", GET, {
            query,
            response: "json"
        });
        return response;
    });
}
export function apiPostRole(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/role", POST, {
            json: request,
            response: "json"
        });
        return response;
    });
}
export function apiPatchRole(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/role", PATCH, {
            json: request,
            response: "ignore",
        });
    });
}
export function apiDeleteRole(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/role", DELETE, {
            query,
            response: "ignore",
        });
    });
}
export function apiGetHosts(api) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield fetchApi(api, "/hosts", GET, { response: "jsonStreaming" });
    });
}
export function apiGetHost(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/host", GET, { query });
        return response.host;
    });
}
export function apiPostHost(api, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/host", "post", { json: data });
        return response.host;
    });
}
export function apiPatchHost(api, data) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/host", PATCH, {
            json: data,
            response: "ignore"
        });
    });
}
export function apiDeleteHost(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/host", "delete", { query, response: "ignore" });
    });
}
export function apiPostPair(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield fetchApi(api, "/pair", "post", {
            json: request,
            response: "jsonStreaming",
            noTimeout: true
        });
    });
}
export function apiWakeUp(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fetchApi(api, "/host/wake", "post", {
            json: request,
            response: "ignore"
        });
    });
}
export function apiGetApps(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/apps", GET, { query });
        return response.apps;
    });
}
export function apiGetAppImage(api, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/app/image", GET, {
            query,
            response: "ignore"
        }, 60000);
        return yield response.blob();
    });
}
export function apiHostCancel(api, request) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetchApi(api, "/host/cancel", POST, {
            json: request
        });
        return response;
    });
}
