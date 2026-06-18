var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { TransportChannelId } from "../../api_bindings.js";
import { CAPABILITIES_CODECS, emptyVideoCodecs, maybeVideoCodecs } from "../video.js";
export class WebRTCTransport {
    constructor(logger) {
        this.implementationName = "webrtc";
        this.peer = null;
        this.onsendmessage = null;
        this.remoteDescription = null;
        this.iceCandidates = [];
        this.wasConnected = false;
        this.channels = [];
        this.videoTrackHolder = { ontrack: null, track: null };
        this.videoReceiver = null;
        this.audioTrackHolder = { ontrack: null, track: null };
        this.onconnect = null;
        this.onclose = null;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
    }
    initPeer(configuration) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Creating Client Peer`);
            if (this.peer) {
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Cannot create Peer because a Peer already exists`);
                return;
            }
            // Configure web rtc
            // TODO: use this for signaling instead and extend the protocol so that the client also requests a control channel with name: "control", protocol:"moonlight-control-v1": https://www.ietf.org/archive/id/draft-ietf-wish-whep-02.html
            this.peer = new RTCPeerConnection(configuration);
            this.peer.addEventListener("error", this.onError.bind(this));
            this.peer.addEventListener("icecandidate", this.onIceCandidate.bind(this));
            this.peer.addEventListener("connectionstatechange", this.onConnectionStateChange.bind(this));
            this.peer.addEventListener("signalingstatechange", this.onSignalingStateChange.bind(this));
            this.peer.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange.bind(this));
            this.peer.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange.bind(this));
            this.peer.addEventListener("track", this.onTrack.bind(this));
            this.peer.addEventListener("datachannel", this.onDataChannel.bind(this));
            this.initChannels();
            // Maybe we already received data
            if (this.remoteDescription) {
                yield this.handleRemoteDescription(this.remoteDescription);
            }
            yield this.tryDequeueIceCandidates();
        });
    }
    onError(event) {
        var _a;
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Web Socket or WebRtcPeer Error`);
        console.error(`Web Socket or WebRtcPeer Error`, event);
    }
    sendMessage(message) {
        var _a;
        if (this.onsendmessage) {
            this.onsendmessage(message);
        }
        else {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to call onicecandidate because no handler is set");
        }
    }
    onReceiveMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            if ("Description" in message) {
                const description = message.Description;
                yield this.handleRemoteDescription({
                    type: description.ty,
                    sdp: description.sdp
                });
            }
            else if ("AddIceCandidate" in message) {
                const candidate = message.AddIceCandidate;
                yield this.addIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdp_mid,
                    sdpMLineIndex: candidate.sdp_mline_index,
                    usernameFragment: candidate.username_fragment
                });
            }
        });
    }
    handleRemoteDescription(sdp) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Received remote description: ${sdp === null || sdp === void 0 ? void 0 : sdp.type}`);
            const remoteDescription = sdp;
            this.remoteDescription = remoteDescription;
            if (!this.peer) {
                return;
            }
            this.remoteDescription = null;
            if (remoteDescription) {
                yield this.peer.setRemoteDescription(remoteDescription);
                if (remoteDescription.type == "offer") {
                    yield this.peer.setLocalDescription();
                    const localDescription = this.peer.localDescription;
                    if (!localDescription) {
                        (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug("Peer didn't have a localDescription whilst receiving an offer and trying to answer");
                        return;
                    }
                    (_c = this.logger) === null || _c === void 0 ? void 0 : _c.debug(`Responding to offer description: ${localDescription.type}`);
                    this.sendMessage({
                        Description: {
                            ty: localDescription.type,
                            sdp: (_d = localDescription.sdp) !== null && _d !== void 0 ? _d : ""
                        }
                    });
                }
            }
        });
    }
    onIceCandidate(event) {
        var _a, _b, _c, _d, _e, _f;
        if (event.candidate) {
            const candidate = event.candidate.toJSON();
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Sending ice candidate: ${candidate.candidate}`);
            this.sendMessage({
                AddIceCandidate: {
                    candidate: (_b = candidate.candidate) !== null && _b !== void 0 ? _b : "",
                    sdp_mid: (_c = candidate.sdpMid) !== null && _c !== void 0 ? _c : null,
                    sdp_mline_index: (_d = candidate.sdpMLineIndex) !== null && _d !== void 0 ? _d : null,
                    username_fragment: (_e = candidate.usernameFragment) !== null && _e !== void 0 ? _e : null
                }
            });
        }
        else {
            (_f = this.logger) === null || _f === void 0 ? void 0 : _f.debug("No new ice candidates");
        }
    }
    addIceCandidate(candidate) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Received ice candidate: ${candidate.candidate}`);
            if (!this.peer) {
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug("Buffering ice candidate");
                this.iceCandidates.push(candidate);
                return;
            }
            yield this.tryDequeueIceCandidates();
            yield this.peer.addIceCandidate(candidate);
        });
    }
    tryDequeueIceCandidates() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.peer) {
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("called tryDequeueIceCandidates without a peer");
                return;
            }
            for (const candidate of this.iceCandidates) {
                yield this.peer.addIceCandidate(candidate);
            }
            this.iceCandidates.length = 0;
        });
    }
    onConnectionStateChange() {
        var _a, _b;
        if (!this.peer) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("OnConnectionStateChange without a peer");
            return;
        }
        let type = null;
        if (this.peer.connectionState == "connected") {
            type = "recover";
            if (this.onconnect) {
                this.onconnect();
            }
            this.wasConnected = true;
        }
        else if ((this.peer.connectionState == "failed" || this.peer.connectionState == "closed") && this.peer.iceGatheringState == "complete") {
            type = "fatal";
        }
        if (this.peer.connectionState == "failed" || this.peer.connectionState == "closed") {
            if (this.onclose) {
                if (this.wasConnected) {
                    this.onclose("failed");
                }
                else {
                    this.onclose("failednoconnect");
                }
            }
        }
        (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Changing Peer State to ${this.peer.connectionState}`, {
            type: type !== null && type !== void 0 ? type : undefined
        });
    }
    onSignalingStateChange() {
        var _a, _b;
        if (!this.peer) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("OnSignalingStateChange without a peer");
            return;
        }
        (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Changing Peer Signaling State to ${this.peer.signalingState}`);
    }
    onIceConnectionStateChange() {
        var _a, _b;
        if (!this.peer) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("OnIceConnectionStateChange without a peer");
            return;
        }
        (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Changing Peer Ice State to ${this.peer.iceConnectionState}`);
    }
    onIceGatheringStateChange() {
        var _a, _b;
        if (!this.peer) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("OnIceGatheringStateChange without a peer");
            return;
        }
        (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Changing Peer Ice Gathering State to ${this.peer.iceGatheringState}`);
        if (this.peer.iceConnectionState == "new" && this.peer.iceGatheringState == "complete") {
            // we failed without connection
            if (this.onclose) {
                this.onclose("failednoconnect");
            }
        }
    }
    initChannels() {
        var _a, _b;
        if (!this.peer) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to initialize channel without peer");
            return;
        }
        if (this.channels.length > 0) {
            (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug("Already initialized channels");
            return;
        }
        for (const channelRaw in TransportChannelId) {
            const channel = channelRaw;
            if (channel == "HOST_VIDEO") {
                const channel = new WebRTCInboundTrackTransportChannel(this.logger, "videotrack", "video", this.videoTrackHolder);
                this.channels[TransportChannelId.HOST_VIDEO] = channel;
                continue;
            }
            if (channel == "HOST_AUDIO") {
                const channel = new WebRTCInboundTrackTransportChannel(this.logger, "audiotrack", "audio", this.audioTrackHolder);
                this.channels[TransportChannelId.HOST_AUDIO] = channel;
                continue;
            }
            // All Data Channels are created by the server
            const id = TransportChannelId[channel];
            this.channels[id] = new WebRTCDataTransportChannel(channel, null);
        }
    }
    onTrack(event) {
        var _a;
        const track = event.track;
        const receiver = event.receiver;
        if (track.kind == "video") {
            this.videoReceiver = receiver;
        }
        receiver.jitterBufferTarget = 0;
        if ("playoutDelayHint" in receiver) {
            receiver.playoutDelayHint = 0;
        }
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Adding receiver: ${track.kind}, ${track.id}, ${track.label}`);
        if (track.kind == "video") {
            if ("contentHint" in track) {
                track.contentHint = "motion";
            }
            this.videoTrackHolder.track = track;
            if (!this.videoTrackHolder.ontrack) {
                throw "No video track listener registered!";
            }
            this.videoTrackHolder.ontrack();
        }
        else if (track.kind == "audio") {
            this.audioTrackHolder.track = track;
            if (!this.audioTrackHolder.ontrack) {
                throw "No audio track listener registered!";
            }
            this.audioTrackHolder.ontrack();
        }
    }
    // Handle data channels created by the remote peer (server)
    onDataChannel(event) {
        var _a, _b, _c, _d;
        const remoteChannel = event.channel;
        const label = remoteChannel.label;
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Received remote data channel: ${label}`);
        // Map the channel label to the corresponding TransportChannelId
        const channelKey = label.toUpperCase();
        if (channelKey in TransportChannelId) {
            const id = TransportChannelId[channelKey];
            const existingChannel = this.channels[id];
            // If we already have a channel for this ID, replace its underlying RTCDataChannel
            // with the remote one so we can receive messages from the server
            if (existingChannel && existingChannel.type === "data") {
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Replacing underlying channel for ${label} with remote channel`);
                existingChannel.replaceChannel(remoteChannel);
            }
            else {
                (_c = this.logger) === null || _c === void 0 ? void 0 : _c.debug(`Creating new channel for ${label}`);
                this.channels[id] = new WebRTCDataTransportChannel(label, remoteChannel);
            }
        }
        else {
            (_d = this.logger) === null || _d === void 0 ? void 0 : _d.debug(`Unknown remote data channel: ${label}`);
        }
    }
    setupHostVideo(_setup) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: check transport type
            var _a;
            let capabilities;
            if ("getCapabilities" in RTCRtpReceiver && (capabilities = RTCRtpReceiver.getCapabilities("video"))) {
                const codecs = emptyVideoCodecs();
                for (const codec in codecs) {
                    const supportRequirements = CAPABILITIES_CODECS[codec];
                    if (!supportRequirements) {
                        continue;
                    }
                    let supported = false;
                    capabilityCodecLoop: for (const codecCapability of capabilities.codecs) {
                        if (codecCapability.mimeType != supportRequirements.mimeType) {
                            continue;
                        }
                        for (const fmtpLine of supportRequirements.fmtpLine) {
                            if (!((_a = codecCapability.sdpFmtpLine) === null || _a === void 0 ? void 0 : _a.includes(fmtpLine))) {
                                continue capabilityCodecLoop;
                            }
                        }
                        supported = true;
                        break;
                    }
                    codecs[codec] = supported;
                }
                return codecs;
            }
            else {
                return maybeVideoCodecs();
            }
        });
    }
    setupHostAudio(_setup) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: check transport type
        });
    }
    getChannel(id) {
        var _a;
        const channel = this.channels[id];
        if (!channel) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to setup video without peer");
            throw `Failed to get channel because it is not yet initialized, Id: ${id}`;
        }
        return channel;
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Closing WebRTC Peer");
            (_b = this.peer) === null || _b === void 0 ? void 0 : _b.close();
        });
    }
    getStats() {
        return __awaiter(this, void 0, void 0, function* () {
            const statsData = {};
            if (!this.videoReceiver) {
                return {};
            }
            const stats = yield this.videoReceiver.getStats();
            console.debug("----------------- raw video stats -----------------");
            for (const [key, value] of stats.entries()) {
                console.debug("raw video stats", key, value);
                if ("decoderImplementation" in value && value.decoderImplementation != null) {
                    statsData.decoderImplementation = value.decoderImplementation;
                }
                if ("frameWidth" in value && value.frameWidth != null) {
                    statsData.videoWidth = value.frameWidth;
                }
                if ("frameHeight" in value && value.frameHeight != null) {
                    statsData.videoHeight = value.frameHeight;
                }
                if ("framesPerSecond" in value && value.framesPerSecond != null) {
                    statsData.webrtcFps = value.framesPerSecond;
                }
                if ("jitterBufferDelay" in value && value.jitterBufferDelay != null) {
                    statsData.webrtcJitterBufferDelayMs = value.jitterBufferDelay;
                }
                if ("jitterBufferTargetDelay" in value && value.jitterBufferTargetDelay != null) {
                    statsData.webrtcJitterBufferTargetDelayMs = value.jitterBufferTargetDelay;
                }
                if ("jitterBufferMinimumDelay" in value && value.jitterBufferMinimumDelay != null) {
                    statsData.webrtcJitterBufferMinimumDelayMs = value.jitterBufferMinimumDelay;
                }
                if ("jitter" in value && value.jitter != null) {
                    statsData.webrtcJitterMs = value.jitter;
                }
                if ("totalDecodeTime" in value && value.totalDecodeTime != null) {
                    statsData.webrtcTotalDecodeTimeMs = value.totalDecodeTime;
                }
                if ("totalAssemblyTime" in value && value.totalAssemblyTime != null) {
                    statsData.webrtcTotalAssemblyTimeMs = value.totalAssemblyTime;
                }
                if ("totalProcessingDelay" in value && value.totalProcessingDelay != null) {
                    statsData.webrtcTotalProcessingDelayMs = value.totalProcessingDelay;
                }
                if ("packetsReceived" in value && value.packetsReceived != null) {
                    statsData.webrtcPacketsReceived = value.packetsReceived;
                }
                if ("packetsLost" in value && value.packetsLost != null) {
                    statsData.webrtcPacketsLost = value.packetsLost;
                }
                if ("framesDropped" in value && value.framesDropped != null) {
                    statsData.webrtcFramesDropped = value.framesDropped;
                }
                if ("keyFramesDecoded" in value && value.keyFramesDecoded != null) {
                    statsData.webrtcKeyFramesDecoded = value.keyFramesDecoded;
                }
                if ("nackCount" in value && value.nackCount != null) {
                    statsData.webrtcNackCount = value.nackCount;
                }
            }
            return statsData;
        });
    }
}
// This receives track data
class WebRTCInboundTrackTransportChannel {
    constructor(logger, type, label, trackHolder) {
        this.canReceive = true;
        this.canSend = false;
        this.trackListeners = [];
        this.logger = logger;
        this.type = type;
        this.label = label;
        this.trackHolder = trackHolder;
        this.trackHolder.ontrack = this.onTrack.bind(this);
    }
    setTrack(_track) {
        throw "WebRTCInboundTrackTransportChannel cannot addTrack";
    }
    onTrack() {
        var _a;
        const track = this.trackHolder.track;
        if (!track) {
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("WebRTC TrackHolder.track is null!");
            return;
        }
        for (const listener of this.trackListeners) {
            listener(track);
        }
    }
    addTrackListener(listener) {
        if (this.trackHolder.track) {
            listener(this.trackHolder.track);
        }
        this.trackListeners.push(listener);
    }
    removeTrackListener(listener) {
        const index = this.trackListeners.indexOf(listener);
        if (index != -1) {
            this.trackListeners.splice(index, 1);
        }
    }
}
class WebRTCDataTransportChannel {
    constructor(label, channel, logger) {
        var _a;
        this.type = "data";
        this.canReceive = true;
        this.canSend = true;
        this.logger = null;
        this.sendQueue = [];
        this.receiveListeners = [];
        this.label = label;
        this.channel = channel;
        this.boundOnMessage = this.onMessage.bind(this);
        this.boundTryDequeueSendQueue = this.tryDequeueSendQueue.bind(this);
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        (_a = this.channel) === null || _a === void 0 ? void 0 : _a.addEventListener("message", this.boundOnMessage);
    }
    // Replace the underlying channel with a new one (e.g., from remote peer)
    // This is used when we receive a data channel from the server that should
    // replace our locally created one for receiving messages
    replaceChannel(newChannel) {
        var _a, _b;
        // Remove listener from old channel
        (_a = this.channel) === null || _a === void 0 ? void 0 : _a.removeEventListener("open", this.boundTryDequeueSendQueue);
        (_b = this.channel) === null || _b === void 0 ? void 0 : _b.removeEventListener("message", this.boundOnMessage);
        // Add listener to new channel
        this.channel = newChannel;
        this.channel.addEventListener("open", this.boundTryDequeueSendQueue);
        this.channel.addEventListener("message", this.boundOnMessage);
    }
    send(message) {
        var _a;
        console.debug(this.label, message);
        if (!this.channel || this.channel.readyState != "open") {
            console.debug(`Tried sending packet to ${this.label} with readyState ${(_a = this.channel) === null || _a === void 0 ? void 0 : _a.readyState}. Buffering it for the future.`);
            // Make sure to copy the message
            this.sendQueue.push(message.slice(0));
        }
        else {
            this.channel.send(message);
        }
    }
    tryDequeueSendQueue() {
        if (!this.channel || this.channel.readyState != "open") {
            return;
        }
        for (const message of this.sendQueue.splice(0)) {
            this.channel.send(message);
        }
    }
    onMessage(event) {
        const data = event.data;
        if (!(data instanceof ArrayBuffer)) {
            console.warn(`received text data on webrtc channel ${this.label}`);
            return;
        }
        for (const listener of this.receiveListeners) {
            listener(event.data);
        }
    }
    addReceiveListener(listener) {
        this.receiveListeners.push(listener);
    }
    removeReceiveListener(listener) {
        const index = this.receiveListeners.indexOf(listener);
        if (index != -1) {
            this.receiveListeners.splice(index, 1);
        }
    }
    estimatedBufferedBytes() {
        var _a, _b;
        return (_b = (_a = this.channel) === null || _a === void 0 ? void 0 : _a.bufferedAmount) !== null && _b !== void 0 ? _b : null;
    }
}
