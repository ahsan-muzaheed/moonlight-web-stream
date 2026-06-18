var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { User } from "./index.js";
import { FetchListComponent } from "../fetch_list.js";
import { apiGetUsers } from "../../api.js";
import { ComponentEvent } from "../index.js";
export class UserList extends FetchListComponent {
    constructor(api) {
        super({
            listClasses: ["user-list"],
            elementLiClasses: ["user-element"]
        });
        this.eventTarget = new EventTarget();
        this.api = api;
    }
    forceFetch() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield apiGetUsers(this.api);
            this.updateCache(response.users);
        });
    }
    insertList(dataId, data) {
        const newUser = new User(this.api, data);
        this.list.append(newUser);
        newUser.addClickedListener(this.onUserClicked.bind(this));
        newUser.addDeletedListener(this.onUserDeleted.bind(this));
    }
    removeList(listIndex) {
        const userComponent = this.list.remove(listIndex);
        userComponent === null || userComponent === void 0 ? void 0 : userComponent.removeClickedListener(this.onUserClicked.bind(this));
        userComponent === null || userComponent === void 0 ? void 0 : userComponent.removeDeletedListener(this.onUserDeleted.bind(this));
    }
    setFilter(filter) {
        this.list.setFilter((user) => { var _a, _b; return (_b = (_a = user.getCache()) === null || _a === void 0 ? void 0 : _a.name.includes(filter)) !== null && _b !== void 0 ? _b : false; });
    }
    removeUser(id) {
        const componentIndex = this.list.get().findIndex(user => user.getUserId() == id);
        if (componentIndex != -1) {
            this.list.remove(componentIndex);
        }
    }
    onUserClicked(event) {
        this.eventTarget.dispatchEvent(new ComponentEvent("ml-userclicked", event.component));
    }
    addUserClickedListener(listener, options) {
        this.eventTarget.addEventListener("ml-userclicked", listener, options);
    }
    removeUserClickedListener(listener, options) {
        this.eventTarget.removeEventListener("ml-userclicked", listener, options);
    }
    onUserDeleted(event) {
        // Remove from our list
        this.list.removeValue(event.component);
        // Call other listeners
        this.eventTarget.dispatchEvent(new ComponentEvent("ml-userdeleted", event.component));
    }
    addUserDeletedListener(listener, options) {
        this.eventTarget.addEventListener("ml-userdeleted", listener, options);
    }
    removeUserDeletedListener(listener, options) {
        this.eventTarget.removeEventListener("ml-userdeleted", listener, options);
    }
    updateComponentData(component, data) {
        component.updateCache(data);
    }
    getDataId(data) {
        return data.id;
    }
    getComponentDataId(component) {
        return component.getUserId();
    }
}
