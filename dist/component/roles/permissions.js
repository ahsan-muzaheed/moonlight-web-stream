import { getCurrentLanguage, getTranslations } from "../../i18n.js";
import { ComponentEvent } from "../index.js";
import { InputComponent } from "../input.js";
export function defaultRolePermissions() {
    return {
        allow_add_hosts: true,
        maximum_bitrate_kbps: null,
        allow_codec_h264: true,
        allow_codec_h265: true,
        allow_codec_av1: true,
        allow_hdr: true,
        allow_transport_webrtc: true,
        allow_transport_websockets: true,
    };
}
export class RolePermissionsMenu {
    constructor(permissions = defaultRolePermissions()) {
        var _a;
        this.rootDiv = document.createElement("div");
        const i = getTranslations(getCurrentLanguage()).admin;
        // Allow Add Hosts
        this.allowAddHosts = new InputComponent("allowAddHosts", "checkbox", i.allowAddHosts, {
            checked: permissions.allow_add_hosts,
        });
        this.allowAddHosts.mount(this.rootDiv);
        this.allowAddHosts.addChangeListener(this.onChange.bind(this));
        // Maximum Bitrate
        this.maximumBitrateKbps = new InputComponent("maximumBitrateKbps", "number", i.maximumBitrate, {
            hasEnableCheckbox: true,
            defaultValue: `${(_a = permissions.maximum_bitrate_kbps) !== null && _a !== void 0 ? _a : 10000}`,
            step: "100",
            numberSlider: {
                range_min: 1000,
                range_max: 10000,
            }
        });
        this.maximumBitrateKbps.setEnabled(permissions.maximum_bitrate_kbps != null);
        this.maximumBitrateKbps.mount(this.rootDiv);
        this.maximumBitrateKbps.addChangeListener(this.onChange.bind(this));
        // Codecs
        this.allowCodecH264 = new InputComponent("allowCodecH264", "checkbox", i.allowH264, {
            checked: permissions.allow_codec_h264,
        });
        this.allowCodecH264.mount(this.rootDiv);
        this.allowCodecH264.addChangeListener(this.onChange.bind(this));
        this.allowCodecH265 = new InputComponent("allowCodecH265", "checkbox", i.allowH265, {
            checked: permissions.allow_codec_h265,
        });
        this.allowCodecH265.mount(this.rootDiv);
        this.allowCodecH265.addChangeListener(this.onChange.bind(this));
        this.allowCodecAv1 = new InputComponent("allowCodecAv1", "checkbox", i.allowAv1, {
            checked: permissions.allow_codec_av1,
        });
        this.allowCodecAv1.mount(this.rootDiv);
        this.allowCodecAv1.addChangeListener(this.onChange.bind(this));
        // Hdr
        this.allowHdr = new InputComponent("allowHdr", "checkbox", i.allowHdr, {
            checked: permissions.allow_hdr,
        });
        this.allowHdr.mount(this.rootDiv);
        this.allowHdr.addChangeListener(this.onChange.bind(this));
        // Transport
        this.allowWebRTC = new InputComponent("allowTransportWebRTC", "checkbox", i.allowWebrtc, {
            checked: permissions.allow_transport_webrtc,
        });
        this.allowWebRTC.mount(this.rootDiv);
        this.allowWebRTC.addChangeListener(this.onChange.bind(this));
        this.allowWebSockets = new InputComponent("allowTransportWebSockets", "checkbox", i.allowWebSockets, {
            checked: permissions.allow_transport_websockets,
        });
        this.allowWebSockets.mount(this.rootDiv);
        this.allowWebSockets.addChangeListener(this.onChange.bind(this));
    }
    onChange() {
        this.rootDiv.dispatchEvent(new ComponentEvent("ml-change", this));
    }
    addChangeListener(listener) {
        this.rootDiv.addEventListener("ml-change", listener);
    }
    removeChangeListener(listener) {
        this.rootDiv.removeEventListener("ml-change", listener);
    }
    getPermissions() {
        return {
            allow_add_hosts: this.allowAddHosts.isChecked(),
            maximum_bitrate_kbps: this.maximumBitrateKbps.isEnabled() ? parseInt(this.maximumBitrateKbps.getValue()) : null,
            allow_codec_h264: this.allowCodecH264.isChecked(),
            allow_codec_h265: this.allowCodecH265.isChecked(),
            allow_codec_av1: this.allowCodecAv1.isChecked(),
            allow_hdr: this.allowHdr.isChecked(),
            allow_transport_webrtc: this.allowWebRTC.isChecked(),
            allow_transport_websockets: this.allowWebSockets.isChecked(),
        };
    }
    mount(parent) {
        parent.appendChild(this.rootDiv);
    }
    unmount(parent) {
        parent.removeChild(this.rootDiv);
    }
}
