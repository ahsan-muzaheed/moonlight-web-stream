const KEYBOARD_SENTINEL = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export class ScreenKeyboard {
    constructor() {
        this.eventTarget = new EventTarget();
        this.fakeElement = document.createElement("textarea");
        this.enabled = false;
        this.fakeElement.classList.add("hiddeninput");
        this.fakeElement.name = "keyboard";
        this.fakeElement.autocomplete = "off";
        this.fakeElement.autocapitalize = "off";
        this.fakeElement.spellcheck = false;
        if ("autocorrect" in this.fakeElement) {
            this.fakeElement.autocorrect = false;
        }
        this.resetInputValue();
        this.fakeElement.addEventListener("input", this.onKeyInput.bind(this));
        this.fakeElement.addEventListener("compositionend", this.onCompositionEnd.bind(this));
        document.addEventListener("click", this.refocusIfEnabled.bind(this));
    }
    getHiddenElement() {
        return this.fakeElement;
    }
    show() {
        this.setEnabled(true);
    }
    hide() {
        this.setEnabled(false);
    }
    isVisible() {
        return this.enabled;
    }
    setEnabled(enabled) {
        const changed = this.enabled != enabled;
        if (changed) {
            const event = new CustomEvent("ml-keyboardmodewillchange", {
                detail: { enabled }
            });
            this.eventTarget.dispatchEvent(event);
        }
        this.enabled = enabled;
        if (enabled) {
            this.refocusIfEnabled();
        }
        else if (document.activeElement === this.fakeElement) {
            this.fakeElement.blur();
        }
        if (changed) {
            const event = new CustomEvent("ml-keyboardmode", {
                detail: { enabled }
            });
            this.eventTarget.dispatchEvent(event);
        }
    }
    refocusIfEnabled() {
        if (!this.enabled || document.activeElement === this.fakeElement) {
            return;
        }
        this.resetInputValue();
        this.fakeElement.focus();
    }
    addKeyDownListener(listener) {
        this.eventTarget.addEventListener("keydown", listener);
    }
    addKeyUpListener(listener) {
        this.eventTarget.addEventListener("keyup", listener);
    }
    addTextListener(listener) {
        this.eventTarget.addEventListener("ml-text", listener);
    }
    addKeyboardModeListener(listener) {
        this.eventTarget.addEventListener("ml-keyboardmode", listener);
    }
    addKeyboardModeWillChangeListener(listener) {
        this.eventTarget.addEventListener("ml-keyboardmodewillchange", listener);
    }
    // -- Events
    resetInputValue() {
        this.fakeElement.value = KEYBOARD_SENTINEL;
        this.fakeElement.setSelectionRange(KEYBOARD_SENTINEL.length, KEYBOARD_SENTINEL.length);
    }
    dispatchText(text) {
        const customEvent = new CustomEvent("ml-text", {
            detail: { text }
        });
        this.eventTarget.dispatchEvent(customEvent);
    }
    dispatchKey(code) {
        const keyDown = new KeyboardEvent("keydown", { code });
        const keyUp = new KeyboardEvent("keyup", { code });
        this.eventTarget.dispatchEvent(keyDown);
        this.eventTarget.dispatchEvent(keyUp);
    }
    dispatchTextWithLineBreaks(text) {
        const parts = text.split(/\r\n|\r|\n/);
        parts.forEach((part, index) => {
            if (part) {
                this.dispatchText(part);
            }
            if (index < parts.length - 1) {
                this.dispatchKey("Enter");
            }
        });
    }
    extractInsertedText() {
        const value = this.fakeElement.value;
        if (value == KEYBOARD_SENTINEL) {
            return "";
        }
        if (value.startsWith(KEYBOARD_SENTINEL)) {
            return value.slice(KEYBOARD_SENTINEL.length);
        }
        if (value.endsWith(KEYBOARD_SENTINEL)) {
            return value.slice(0, -KEYBOARD_SENTINEL.length);
        }
        if (value.includes(KEYBOARD_SENTINEL)) {
            return value.replace(KEYBOARD_SENTINEL, "");
        }
        return value;
    }
    onCompositionEnd() {
        const text = this.extractInsertedText();
        if (text) {
            this.dispatchTextWithLineBreaks(text);
        }
        this.resetInputValue();
    }
    onKeyInput(event) {
        if (!(event instanceof InputEvent)) {
            return;
        }
        if (event.isComposing) {
            return;
        }
        if (event.inputType == "insertLineBreak" || event.inputType == "insertParagraph") {
            this.dispatchKey("Enter");
        }
        else if ((event.inputType == "insertText" || event.inputType == "insertFromPaste" || event.inputType == "insertReplacementText") && event.data != null) {
            this.dispatchTextWithLineBreaks(event.data);
        }
        else if (event.inputType == "deleteContentBackward" || event.inputType == "deleteByCut") {
            this.dispatchKey("Backspace");
        }
        else if (event.inputType == "deleteContentForward") {
            this.dispatchKey("Delete");
        }
        else {
            const text = this.extractInsertedText();
            if (text) {
                this.dispatchTextWithLineBreaks(text);
            }
        }
        // Repopulate the input so that the deleteContent commands will work
        this.resetInputValue();
    }
}
