import { ERROR_IMAGE, INFO_IMAGE, WARN_IMAGE } from "../resources/index.js";
import { ListComponent } from "./list.js";
const ERROR_REMOVAL_TIME_MS = 10000;
const notificationListElement = document.getElementById("notification-list");
const notificationListComponent = new ListComponent([], { listClasses: ["notification-list"], elementLiClasses: ["notification-element"] });
if (notificationListElement) {
    notificationListComponent.mount(notificationListElement);
}
let alertedNotificationListNotFound = false;
export function showNotification(message, level = "error", errorObject) {
    console.error(message, errorObject);
    if (!notificationListElement) {
        if (!alertedNotificationListNotFound) {
            alert("couldn't find the notification element");
            alertedNotificationListNotFound = true;
        }
        alert(message);
        return;
    }
    let error;
    if (level == "error") {
        error = new NotificationComponent(message, ERROR_IMAGE);
    }
    else if (level == "warn") {
        error = new NotificationComponent(message, WARN_IMAGE);
    }
    else if (level = "info") {
        error = new NotificationComponent(message, INFO_IMAGE);
    }
    else {
        error = new NotificationComponent(`Unknown notification level (\"${level}\") for message: ${message}`, ERROR_IMAGE);
    }
    notificationListComponent.append(error);
    setTimeout(() => {
        notificationListComponent.removeValue(error);
    }, ERROR_REMOVAL_TIME_MS);
}
function handleError(event) {
    showNotification(`${event.error}`, "error", event);
}
function handleRejection(event) {
    showNotification(`${event.reason}`, "error", event);
}
window.addEventListener("error", handleError);
window.addEventListener("unhandledrejection", handleRejection);
class NotificationComponent {
    constructor(message, image) {
        this.messageElement = document.createElement("p");
        this.imageElement = document.createElement("img");
        this.messageElement.innerText = message;
        this.messageElement.classList.add("notification-message");
        this.imageElement.src = image;
        this.imageElement.classList.add("notification-image");
    }
    mount(parent) {
        parent.appendChild(this.imageElement);
        parent.appendChild(this.messageElement);
    }
    unmount(parent) {
        parent.removeChild(this.imageElement);
        parent.removeChild(this.messageElement);
    }
}
