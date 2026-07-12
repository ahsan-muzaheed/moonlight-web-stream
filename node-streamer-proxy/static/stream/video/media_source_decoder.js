var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { download, globalObject } from "../../util.js";
import { ByteBuffer } from "../buffer.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { emptyVideoCodecs } from "../video.js";
import { h264NalType, H264StreamVideoTranslator } from "./annex_b_translator.js";
// auto download an mp4 file containing all data until a media source error occured, testing only
const DEBUG_FILE = false;
export class MediaSourceDecoder {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            const environmentSupported = "MediaSource" in globalObject() && "isTypeSupported" in MediaSource;
            const videoCodecs = emptyVideoCodecs();
            // We only know 100% if the codec is supported when we try to play the stream and get the
            // Sps which contains information about the actual h264 codec being used
            videoCodecs.H264 = "maybe";
            // no link
            return {
                environmentSupported,
                supportedVideoCodecs: videoCodecs
            };
        });
    }
    constructor(base, logger) {
        this.logger = null;
        this.errored = false;
        this.mediaSource = new MediaSource();
        this.url = URL.createObjectURL(this.mediaSource);
        this.videoSize = null;
        this.sequenceNumber = -1;
        this.sourceBuffer = null;
        this.debugBuffer = null;
        this.expectedDurationMicroseconds = 0;
        this.buffers = [];
        this.needIdr = true;
        this.droppedFrames = 0;
        this.timestampMicrosecondsShift = 0;
        this.lastTimestampMicroseconds = 0;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        this.implementationName = `media_source_extension_decoder -> ${base.implementationName}`;
        this.base = base;
        this.translator = new H264StreamVideoTranslator(logger);
        this.onReadyPromise = new Promise((resolve, reject) => {
            this.mediaSource.addEventListener("sourceopen", () => {
                resolve();
            });
        });
        addPipePassthrough(this);
    }
    setup(setup) {
        var arguments_1 = arguments;
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("The stream may experience increased latency, as modern browser APIs are not currently supported.", { type: "informError" });
            this.base.setUrl(this.url);
            this.videoSize = [setup.width, setup.height];
            this.expectedDurationMicroseconds = 1000000 / setup.fps;
            yield this.onReadyPromise;
            if ("setup" in this.base && typeof this.base.setup == "function") {
                return yield this.base.setup(...arguments_1);
            }
        });
    }
    // A source buffer is created on each idr
    createNewSourceBuffer(codec) {
        // Clean the old source buffer
        if (this.sourceBuffer) {
            this.mediaSource.removeSourceBuffer(this.sourceBuffer);
            this.sourceBuffer = null;
        }
        this.sourceBuffer = this.mediaSource.addSourceBuffer(`video/mp4; codecs=${codec}`);
        this.sourceBuffer.addEventListener("error", this.onError.bind(this));
        this.sourceBuffer.addEventListener("updateend", this.onUpdateEnd.bind(this));
        // https://www.w3.org/TR/media-source-2/#dom-sourcebuffer
        this.sourceBuffer.mode = "segments";
    }
    onError(event) {
        var _a, _b;
        this.errored = true;
        (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Error whilst decoding using MediaSourceExtension at sequenceNumber ${this.sequenceNumber}`, { type: "fatalDescription" });
        if (event instanceof ErrorEvent) {
            (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`${event.error}`, { type: "fatal" });
        }
        if (DEBUG_FILE && this.debugBuffer) {
            download(this.debugBuffer, "file.mp4", "video/mp4");
        }
    }
    onUpdateEnd() {
        this.tryAppendDecodeUnit();
    }
    submitDecodeUnit(unit) {
        var _a, _b;
        if (this.errored) {
            return;
        }
        const value = this.translator.submitDecodeUnit(unit);
        if (value.error) {
            this.errored = true;
            return;
        }
        const { configure, chunk } = value;
        if (!chunk) {
            console.debug("No chunk received!");
            return;
        }
        // Fix timestamps if we're given bad ones
        let timestampMicroseconds = unit.timestampMicroseconds - this.timestampMicrosecondsShift;
        if (timestampMicroseconds <= this.lastTimestampMicroseconds) {
            // Timestamps must increase at a "normal" rate
            timestampMicroseconds = this.lastTimestampMicroseconds + this.expectedDurationMicroseconds;
        }
        let durationMicroseconds = timestampMicroseconds - this.lastTimestampMicroseconds;
        this.lastTimestampMicroseconds = timestampMicroseconds;
        if (configure) {
            if (!configure.description
                || !(configure.description instanceof Uint8Array)) {
                this.errored = true;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Failed to init MediaSourceExtension Decoder because of missing description in configuration or configuration is in incorrect format\n${JSON.stringify(configure)}`, { type: "fatal" });
                return;
            }
            this.createNewSourceBuffer(configure.codec);
            if (!this.videoSize) {
                this.errored = true;
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(`Failed to init MediaSourceExtension Decoder because video size is not currently known`, { type: "fatal" });
                return;
            }
            const [width, height] = this.videoSize;
            // Every segment must start at timestamp 0
            this.timestampMicrosecondsShift = unit.timestampMicroseconds;
            this.lastTimestampMicroseconds = 0;
            // Sequence number should start at 1
            this.sequenceNumber = 1;
            const initSegment = new ByteBuffer(2000, false);
            putVideoInitSegment(initSegment, 1000000, 1, width, height, configure.description);
            initSegment.flip();
            this.buffers.push(initSegment.getRemainingBuffer());
            const idrSegment = new ByteBuffer(400 + unit.data.byteLength, false);
            putVideoFrameSegment(idrSegment, 1, this.sequenceNumber, 0, durationMicroseconds, true, chunk);
            idrSegment.flip();
            this.buffers.push(idrSegment.getRemainingBuffer());
            this.needIdr = false;
            this.droppedFrames = 0;
        }
        else {
            if (this.needIdr) {
                this.droppedFrames += 1;
                return;
            }
            this.sequenceNumber += 1;
            const segment = new ByteBuffer(400 + unit.data.byteLength, false);
            putVideoFrameSegment(segment, 1, this.sequenceNumber, timestampMicroseconds, durationMicroseconds, false, chunk);
            segment.flip();
            this.buffers.push(segment.getRemainingBuffer());
            console.debug("pushed video frame segment");
        }
        this.tryAppendDecodeUnit();
    }
    tryAppendDecodeUnit() {
        while (true) {
            if (this.errored) {
                return;
            }
            if (!this.sourceBuffer) {
                // We are currently constructing a source buffer
                return;
            }
            if (this.sourceBuffer.updating) {
                return;
            }
            if (this.buffers.length == 0) {
                return;
            }
            const [unit] = this.buffers.splice(0, 1);
            this.sourceBuffer.appendBuffer(unit);
            if (DEBUG_FILE) {
                if (!this.debugBuffer) {
                    this.debugBuffer = new Uint8Array(0);
                }
                const oldBuffer = this.debugBuffer;
                this.debugBuffer = new Uint8Array(oldBuffer.length + unit.length);
                this.debugBuffer.set(oldBuffer);
                this.debugBuffer.set(unit, oldBuffer.length);
            }
        }
    }
    pollRequestIdr() {
        let requestIdr = false;
        if (this.droppedFrames > 60) {
            requestIdr = true;
            console.debug(`Requesting idr because too many frames were dropped`);
            this.droppedFrames = 0;
        }
        if ("pollRequestIdr" in this.base && typeof this.base.pollRequestIdr == "function") {
            if (this.base.pollRequestIdr(...arguments)) {
                requestIdr = true;
            }
        }
        return requestIdr;
    }
    cleanup() {
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            this.base.cleanup(...arguments);
        }
        URL.revokeObjectURL(this.url);
    }
    getBase() {
        return this.base;
    }
}
MediaSourceDecoder.baseType = "videourl";
MediaSourceDecoder.type = "videodata";
function putVideoInitSegment(buffer, timescale, trackId, width, height, avcC) {
    // https://w3c.github.io/mse-byte-stream-format-isobmff/#iso-init-segments
    // https://github.com/moq-dev/moq/blob/bdbeb615e69ba6426fa8fd67acb500cb203a9b13/js/hang/src/container/cmaf/encode.ts#L216-L438
    // ---- ftyp ----
    putFTypeBox(buffer, "isom", 0x200, ["isom", "iso6", "avc1", "mp41"]);
    const MATRIX = [
        0x00010000, 0, 0,
        0, 0x00010000, 0,
        0, 0, 0x40000000
    ];
    // ---- moov ----
    putMoovBox(buffer, () => {
        // ---- mvhd ----
        putMvhdBox(buffer, 0, // version
        0, // creation_time
        0, // modification_time
        timescale, 0, // duration (unknown / fragmented)
        0x00010000, // rate = 1.0
        0x0100, // volume
        0, [0, 0], MATRIX, [0, 0, 0, 0, 0, 0], trackId + 1 // next_track_ID
        );
        // ---- trak ----
        putTrakBox(buffer, () => {
            // ---- tkhd ----
            putTkhdBox(buffer, 0, // version
            0x000003, // Track enabled + in movie
            0, 0, trackId, 0, 0, // duration = unknown
            [0, 0], 0, 0, 0, 0, MATRIX, width, height);
            // ---- mdia ----
            putMdiaBox(buffer, () => {
                // ---- mdhd ----
                putMdhdBox(buffer, 0, 0, 0, timescale, 0, false, "und", 0);
                // ---- hdlr ----
                putHdlrBox(buffer, "vide", [0, 0, 0], "VideoHandler");
                // ---- minf ----
                putMinfBox(buffer, () => {
                    // ---- vmhd ----
                    putVmhdBox(buffer, 0, [0, 0, 0]);
                    // ---- dinf ----
                    putDinfBox(buffer, () => {
                        putDrefBox(buffer, 1, () => {
                            putUrlBox(buffer); // self-contained
                        });
                    });
                    // ---- stbl ----
                    putStblBox(buffer, () => {
                        // ---- stsd ----
                        putStsdBox(buffer, 1, () => {
                            putAvc1Box(buffer, [0, 0, 0, 0, 0, 0], 1, // data_reference_index
                            0, 0, [0, 0, 0], width, height, 0x00480000, // horizresolution (72 dpi)
                            0x00480000, // vertresolution
                            0, 1, new Array(32).fill(0), 24, -1, () => {
                                putAvcCBox(buffer, avcC);
                            });
                        });
                        // ---- empty tables (fragmented MP4) ----
                        putSttsBox(buffer, []);
                        putStscBox(buffer, []);
                        putStszBox(buffer, 0, 0);
                        putStco(buffer, []);
                    });
                });
            });
        });
        putMvexBox(buffer, () => {
            putTrexBox(buffer, trackId, 1, 0, 0, 0);
        });
    });
}
function putVideoFrameSegment(buffer, trackId, sequenceNumber, baseDecodeTime, frameDuration, isKeyframe, frame) {
    // https://github.com/moq-dev/moq/blob/bdbeb615e69ba6426fa8fd67acb500cb203a9b13/js/hang/src/container/cmaf/encode.ts#L942-L1062
    if (isKeyframe && h264NalType(frame[4]) != 5) {
        throw "tried to submit non idr as a keyframe";
    }
    const moofPosition = buffer.getPosition();
    let dataOffsetPosition = -1;
    putMoofBox(buffer, () => {
        putMfhdBox(buffer, sequenceNumber);
        putTrafBox(buffer, () => {
            putTfhdBox(buffer, trackId);
            putTfdtBox(buffer, 1, baseDecodeTime);
            const trunBox = putTrunBox(buffer, frameDuration, frame.length, isKeyframe, 
            // Sequence number should start at 1, so 1 == first sample
            sequenceNumber == 1);
            dataOffsetPosition = trunBox.dataOffsetPosition;
        });
    });
    const dataStart = buffer.getPosition();
    // Patch the trunOffset
    // 8 = mdat header
    buffer.putI32(dataStart - moofPosition + 8, dataOffsetPosition);
    putMdatBox(buffer, frame);
}
function putMoovBox(buffer, writeBoxes) {
    putBox(buffer, "moov", writeBoxes);
}
function putTrakBox(buffer, writeBoxes) {
    putBox(buffer, "trak", writeBoxes);
}
function putTkhdBox(buffer, version, flags, creation_time, modification_time, track_ID, reserved1, duration, reserved2, layer, alternate_group, volume, reserved3, matrix, width, height) {
    putFullBox(buffer, "tkhd", version, flags, () => {
        if (version === 1) {
            buffer.putU64(creation_time);
            buffer.putU64(modification_time);
            buffer.putU32(track_ID);
            buffer.putU32(reserved1);
            buffer.putU64(duration);
        }
        else {
            buffer.putU32(creation_time);
            buffer.putU32(modification_time);
            buffer.putU32(track_ID);
            buffer.putU32(reserved1);
            buffer.putU32(duration);
        }
        if (reserved2.length !== 2)
            throw "invalid reserved2 length";
        buffer.putU32Array(new Uint32Array(reserved2));
        buffer.putU16(layer);
        buffer.putU16(alternate_group);
        buffer.putU16(volume);
        buffer.putU16(reserved3);
        if (matrix.length !== 9)
            throw "invalid matrix length";
        buffer.putU32Array(new Uint32Array(matrix));
        buffer.putU32(width << 16);
        buffer.putU32(height << 16);
    });
}
function putMdiaBox(buffer, writeBoxes) {
    putBox(buffer, "mdia", writeBoxes);
}
function putMdhdBox(buffer, version, creation_time, modification_time, timescale, duration, pad, language, pre_defined) {
    putFullBox(buffer, "mdhd", version, 0, () => {
        if (version === 1) {
            buffer.putU64(creation_time);
            buffer.putU64(modification_time);
            buffer.putU32(timescale);
            buffer.putU64(duration);
        }
        else {
            buffer.putU32(creation_time);
            buffer.putU32(modification_time);
            buffer.putU32(timescale);
            buffer.putU32(duration);
        }
        if (!/^[a-z]{3}$/.test(language)) {
            throw "invalid language (must be 3 lowercase ISO-639 letters)";
        }
        const languageBits = ((pad ? 1 : 0) << 15) |
            ((language.charCodeAt(0) - 0x60) << 10) |
            ((language.charCodeAt(1) - 0x60) << 5) |
            (language.charCodeAt(2) - 0x60);
        buffer.putU16(languageBits);
        buffer.putU16(pre_defined);
    });
}
function putHdlrBox(buffer, handler_type, reserved, name) {
    putFullBox(buffer, "hdlr", 0, 0, () => {
        buffer.putU32(0); // pre_defined
        if (handler_type.length !== 4) {
            throw "invalid handler_type length";
        }
        buffer.putUtf8Raw(handler_type);
        if (reserved.length !== 3) {
            throw "invalid reserved length";
        }
        buffer.putU32Array(new Uint32Array(reserved));
        buffer.putUtf8Raw(name);
        buffer.putU8(0);
    });
}
function putMinfBox(buffer, writeBoxes) {
    putBox(buffer, "minf", writeBoxes);
}
function putVmhdBox(buffer, graphicsmode, opcolor) {
    putFullBox(buffer, "vmhd", 0, 1, () => {
        buffer.putU16(graphicsmode);
        if (opcolor.length !== 3)
            throw "invalid opcolor length";
        buffer.putU16Array(new Uint16Array(opcolor));
    });
}
function putDinfBox(buffer, writeBoxes) {
    putBox(buffer, "dinf", writeBoxes);
}
function putDrefBox(buffer, entry_count, writeBoxes) {
    putFullBox(buffer, "dref", 0, 0, () => {
        buffer.putU32(entry_count);
        writeBoxes();
    });
}
// https://github.com/moq-dev/moq/blob/bdbeb615e69ba6426fa8fd67acb500cb203a9b13/js/hang/src/container/cmaf/encode.ts#L326-L332
function putUrlBox(buffer) {
    // self-contained reference
    putFullBox(buffer, "url ", 0, 1, () => { });
}
function putStblBox(buffer, writeBoxes) {
    putBox(buffer, "stbl", writeBoxes);
}
function putStsdBox(buffer, entry_count, writeBoxes) {
    putFullBox(buffer, "stsd", 0, 0, () => {
        buffer.putU32(entry_count);
        writeBoxes();
    });
}
function putAvc1Box(buffer, reserved, data_reference_index, pre_defined, reserved2, pre_defined2, width, height, horizresolution, vertresolution, reserved3, frame_count, compressorname, depth, pre_defined3, writeBoxes) {
    putBox(buffer, "avc1", () => {
        // https://github.com/moq-dev/moq/blob/bdbeb615e69ba6426fa8fd67acb500cb203a9b13/js/hang/src/container/cmaf/encode.ts#L137-L214
        // Sample Entry
        if (reserved.length != 6) {
            throw "invalid reserved length";
        }
        buffer.putU8Array(new Uint8Array(reserved));
        buffer.putU16(data_reference_index);
        // Visual Sample Entry
        buffer.putU16(pre_defined);
        buffer.putU16(reserved2);
        if (pre_defined2.length != 3) {
            throw "invalid pre_defined2 length";
        }
        buffer.putU32Array(new Uint32Array(pre_defined2));
        buffer.putU16(width);
        buffer.putU16(height);
        buffer.putU32(horizresolution);
        buffer.putU32(vertresolution);
        buffer.putU32(reserved3);
        buffer.putU16(frame_count);
        if (compressorname.length != 32) {
            throw "invalid compressorname length";
        }
        buffer.putU8Array(new Uint8Array(compressorname));
        buffer.putU16(depth);
        buffer.putI16(pre_defined3);
        writeBoxes();
    });
}
function putAvcCBox(buffer, avcC) {
    putBox(buffer, "avcC", () => {
        buffer.putU8Array(avcC);
    });
}
function putSttsBox(buffer, entries) {
    putFullBox(buffer, "stts", 0, 0, () => {
        buffer.putU32(entries.length);
        for (const e of entries) {
            buffer.putU32(e.sample_count);
            buffer.putU32(e.sample_delta);
        }
    });
}
function putStscBox(buffer, entries) {
    putFullBox(buffer, "stsc", 0, 0, () => {
        buffer.putU32(entries.length);
        for (const e of entries) {
            buffer.putU32(e.first_chunk);
            buffer.putU32(e.samples_per_chunk);
            buffer.putU32(e.sample_description_index);
        }
    });
}
function putStszBox(buffer, sample_size, sample_count) {
    putFullBox(buffer, "stsz", 0, 0, () => {
        buffer.putU32(sample_size);
        buffer.putU32(sample_count);
    });
}
function putStco(buffer, chunk_offsets) {
    putFullBox(buffer, "stco", 0, 0, () => {
        buffer.putU32(chunk_offsets.length);
        for (const offset of chunk_offsets) {
            buffer.putU32(offset);
        }
    });
}
function putMvhdBox(buffer, version, creation_time, modification_time, timescale, duration, rate, volume, reserved1, reserved2, matrix, pre_defined, next_track_ID) {
    putFullBox(buffer, "mvhd", version, 0, () => {
        if (version === 0) {
            buffer.putU32(creation_time);
            buffer.putU32(modification_time);
            buffer.putU32(timescale);
            buffer.putU32(duration);
        }
        else if (version === 1) {
            buffer.putU64(creation_time);
            buffer.putU64(modification_time);
            buffer.putU32(timescale);
            buffer.putU64(duration);
        }
        else {
            throw `invalid mvhd version ${version}`;
        }
        buffer.putI32(rate);
        buffer.putI16(volume);
        buffer.putI16(reserved1);
        if (reserved2.length != 2)
            throw "invalid reserved2 length";
        buffer.putU32Array(new Uint32Array(reserved2));
        if (matrix.length !== 9)
            throw "invalid matrix length";
        buffer.putU32Array(new Uint32Array(matrix));
        if (pre_defined.length !== 6)
            throw "invalid pre_defined length";
        buffer.putU32Array(new Uint32Array(pre_defined));
        buffer.putU32(next_track_ID);
    });
}
function putMvexBox(buffer, writeBoxes) {
    putBox(buffer, "mvex", writeBoxes);
}
function putTrexBox(buffer, track_ID, default_sample_description_index, default_sample_duration, default_sample_size, default_sample_flags) {
    putFullBox(buffer, "trex", 0, 0, () => {
        buffer.putU32(track_ID);
        buffer.putU32(default_sample_description_index);
        buffer.putU32(default_sample_duration);
        buffer.putU32(default_sample_size);
        buffer.putU32(default_sample_flags);
    });
}
function putFTypeBox(buffer, major_brand, minor_version, compatible_brands) {
    putBox(buffer, "ftyp", () => {
        buffer.putUtf8Raw(major_brand);
        buffer.putU32(minor_version);
        for (const brand of compatible_brands) {
            if (brand.length != 4) {
                throw "invalid brand length!";
            }
            buffer.putUtf8Raw(brand);
        }
    });
}
function putMfhdBox(buffer, sequenceNumber) {
    putFullBox(buffer, "mfhd", 0, 0, () => {
        buffer.putU32(sequenceNumber);
    });
}
function putTfhdBox(buffer, trackId) {
    // Flags: default-base-is-moof (0x020000)
    putFullBox(buffer, "tfhd", 0, 0x020000, () => {
        buffer.putU32(trackId);
    });
}
function putTfdtBox(buffer, version, baseDecodeTime) {
    putFullBox(buffer, "tfdt", version, 0, () => {
        if (version == 1) {
            buffer.putU64(baseDecodeTime);
        }
        else if (version == 0) {
            buffer.putU32(baseDecodeTime);
        }
        else {
            throw `invalid version for tfdt ${version}`;
        }
    });
}
function putTrunBox(buffer, frameDuration, frameSize, isKeyframe, isFirstSample) {
    const info = {
        dataOffsetPosition: 0,
    };
    let trunFlags = 0x000001 | // data-offset-present
        0x000100 | // sample-duration-present
        0x000200; // sample-size-present
    if (isFirstSample) {
        trunFlags |= 0x000004; // first-sample-flags
    }
    else {
        trunFlags |= 0x000400; // sample-flags
    }
    const sampleFlags = isKeyframe ? 0x02000000 : 0x01010000;
    putFullBox(buffer, "trun", 0, trunFlags, () => {
        buffer.putU32(1); // sample_count
        info.dataOffsetPosition = buffer.getPosition();
        buffer.putI32(0); // data_offset
        if (isFirstSample) {
            buffer.putU32(sampleFlags);
        }
        buffer.putU32(frameDuration);
        buffer.putU32(frameSize);
        if (!isFirstSample) {
            buffer.putU32(sampleFlags);
        }
    });
    return info;
}
function putTrafBox(buffer, writeBoxes) {
    let trunDataOffsetPosition = 0;
    putBox(buffer, "traf", writeBoxes);
    return trunDataOffsetPosition;
}
function putMoofBox(buffer, writeBoxes) {
    let trunDataOffsetPosition = 0;
    putBox(buffer, "moof", writeBoxes);
    return trunDataOffsetPosition;
}
function putMdatBox(buffer, frame) {
    putBox(buffer, "mdat", () => {
        buffer.putU8Array(frame);
    });
}
function putFullBox(buffer, type, version, flags, write) {
    if (version < 0 || version > 0xff) {
        throw "FullBox version must be 0-255";
    }
    if (flags < 0 || flags > 0xffffff) {
        throw "FullBox flags must be 0-0xFFFFFF";
    }
    putBox(buffer, type, () => {
        buffer.putU8(version);
        buffer.putU8((flags >> 16) & 0xff);
        buffer.putU8((flags >> 8) & 0xff);
        buffer.putU8(flags & 0xff);
        write();
    });
}
function putBox(buffer, type, write) {
    const payloadLenPosition = buffer.getPosition();
    buffer.putU32(0);
    if (type.length != 4) {
        throw "invalid box type length!";
    }
    buffer.putUtf8Raw(type);
    write();
    buffer.putU32(buffer.getPosition() - payloadLenPosition, payloadLenPosition);
}
