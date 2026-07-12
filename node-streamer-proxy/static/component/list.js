export class ListComponent {
    constructor(list, init) {
        var _a, _b;
        this.mounted = 0;
        this.listElement = document.createElement("ul");
        this.liElements = [];
        this.currentFilter = () => true;
        this.unfilteredList = list !== null && list !== void 0 ? list : [];
        this.list = [];
        this.listElement.classList.add("list-like");
        if (init === null || init === void 0 ? void 0 : init.listClasses) {
            this.listElement.classList.add(...init === null || init === void 0 ? void 0 : init.listClasses);
        }
        this.liClasses = (_a = init === null || init === void 0 ? void 0 : init.elementLiClasses) !== null && _a !== void 0 ? _a : [];
        this.remountIsInsertTransition = (_b = init === null || init === void 0 ? void 0 : init.remountIsInsert) !== null && _b !== void 0 ? _b : true;
        this.syncLists();
    }
    elementAt(index) {
        let li = this.liElements[index];
        if (!li) {
            li = document.createElement("li");
            li.classList.add(...this.liClasses);
            this.liElements[index] = li;
        }
        return li;
    }
    onAnimElementInserted(index) {
        const element = this.liElements[index];
        // let the element render and then add "list-show" for transitions :)
        setTimeout(() => {
            element.classList.add("list-show");
        }, 0);
    }
    onAnimElementRemoved(index) {
        let element;
        while ((element = this.liElements[index]).classList.contains("list-show")) {
            element.classList.remove("list-show");
        }
    }
    setFilter(filter) {
        if (!filter) {
            filter = () => true;
        }
        this.currentFilter = filter;
        this.syncLists();
    }
    syncLists() {
        const newList = this.unfilteredList.filter(this.currentFilter);
        // Unmount all old components
        for (let index = 0; index < this.list.length; index++) {
            const oldComponent = this.list[index];
            const element = this.elementAt(index);
            oldComponent.unmount(element);
            if (index >= newList.length) {
                this.listElement.removeChild(element);
            }
        }
        // Mount all new components and unmount old
        for (let index = 0; index < newList.length; index++) {
            const newComponent = newList[index];
            const element = this.elementAt(index);
            if (this.list.length <= index) {
                this.listElement.appendChild(element);
            }
            newComponent.mount(element);
        }
        this.list = newList;
    }
    insert(index, value) {
        if (index == this.unfilteredList.length) {
            this.unfilteredList.push(value);
        }
        else {
            this.unfilteredList.splice(index, 0, value);
        }
        this.syncLists();
        this.onAnimElementInserted(index);
    }
    remove(index) {
        if (index >= this.unfilteredList.length) {
            this.onAnimElementRemoved(index);
        }
        const value = this.unfilteredList.splice(index, 1);
        this.syncLists();
        return value[0];
    }
    append(value) {
        this.insert(this.get().length, value);
    }
    removeValue(value) {
        const index = this.get().indexOf(value);
        if (index != -1) {
            this.remove(index);
        }
    }
    clear() {
        this.unfilteredList.splice(0, this.unfilteredList.length);
        this.syncLists();
    }
    get() {
        return this.unfilteredList;
    }
    mount(parent) {
        this.mounted++;
        parent.appendChild(this.listElement);
        // Mount all elements
        if (this.mounted == 1) {
            this.syncLists();
            if (this.remountIsInsertTransition) {
                for (let i = 0; i < this.list.length; i++) {
                    this.onAnimElementInserted(i);
                }
            }
        }
    }
    unmount(parent) {
        this.mounted--;
        parent.removeChild(this.listElement);
        // Unmount all elements
        if (this.mounted == 0) {
            if (this.remountIsInsertTransition) {
                for (let i = 0; i < this.list.length; i++) {
                    this.onAnimElementRemoved(i);
                }
            }
            for (let index = this.list.length - 1; index >= 0; index--) {
                const element = this.elementAt(index);
                this.listElement.removeChild(element);
            }
            this.list = [];
        }
    }
}
