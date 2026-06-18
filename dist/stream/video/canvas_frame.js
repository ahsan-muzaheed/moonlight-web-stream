var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { copyIntoYuv, yuvBufferSize } from "../../libopenh264/index.js";
import { globalObject } from "../../util.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { allVideoCodecs } from "../video.js";
class BaseCanvasFrameDrawPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: "CanvasRenderingContext2D" in globalObject() || "OffscreenCanvasRenderingContext2D" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(implementationName, base, _logger, options) {
        var _a;
        this.animationFrameRequest = null;
        this.implementationName = implementationName;
        this.base = base;
        const opts = options;
        this.drawOnSubmit = (_a = opts === null || opts === void 0 ? void 0 : opts.drawOnSubmit) !== null && _a !== void 0 ? _a : true;
        addPipePassthrough(this);
    }
    setup(setup) {
        var arguments_1 = arguments;
        return __awaiter(this, void 0, void 0, function* () {
            if (this.animationFrameRequest == null) {
                this.animationFrameRequest = requestAnimationFrame(this.onAnimationFrame.bind(this));
            }
            if ("setup" in this.base && typeof this.base.setup == "function") {
                return this.base.setup(...arguments_1);
            }
        });
    }
    cleanup() {
        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            return this.base.cleanup(...arguments);
        }
    }
    onFrameSubmitted() {
        if (this.drawOnSubmit) {
            this.drawCurrentFrameIfReady();
        }
    }
    onAnimationFrame() {
        if (!this.drawOnSubmit) {
            this.drawCurrentFrameIfReady();
        }
        this.animationFrameRequest = requestAnimationFrame(this.onAnimationFrame.bind(this));
    }
    getBase() {
        return this.base;
    }
}
BaseCanvasFrameDrawPipe.baseType = "canvas";
export class CanvasFrameDrawPipe extends BaseCanvasFrameDrawPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: "CanvasRenderingContext2D" in globalObject() || "OffscreenCanvasRenderingContext2D" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base, _logger, options) {
        super(`canvas_frame -> ${base.implementationName}`, base, _logger, options);
        this.currentFrame = null;
        addPipePassthrough(this);
    }
    submitFrame(frame) {
        var _a;
        (_a = this.currentFrame) === null || _a === void 0 ? void 0 : _a.close();
        this.currentFrame = frame;
        this.onFrameSubmitted();
    }
    /** Draw currentFrame to canvas if context and frame are ready. Only updates size when dimensions change. */
    drawCurrentFrameIfReady() {
        const frame = this.currentFrame;
        const { context, error } = this.base.useCanvasContext("2d");
        if (!frame || error) {
            return;
        }
        const w = frame.displayWidth;
        const h = frame.displayHeight;
        this.base.setCanvasSize(w, h);
        context.clearRect(0, 0, w, h);
        context.drawImage(frame, 0, 0, w, h);
        this.base.commitFrame();
    }
}
CanvasFrameDrawPipe.type = "videoframe";
export class CanvasRgbaFrameDrawPipe extends BaseCanvasFrameDrawPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: "CanvasRenderingContext2D" in globalObject() || "OffscreenCanvasRenderingContext2D" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base, _logger, options) {
        super(`rgba_canvas_frame -> ${base.implementationName}`, base, _logger, options);
        this.currentFrame = null;
        addPipePassthrough(this);
    }
    submitRawFrame(frame) {
        this.currentFrame = new ImageData(frame.buffer, frame.width, frame.height);
        this.onFrameSubmitted();
    }
    /** Draw currentFrame to canvas if context and frame are ready. Only updates size when dimensions change. */
    drawCurrentFrameIfReady() {
        const frame = this.currentFrame;
        const { context, error } = this.base.useCanvasContext("2d");
        if (!frame || error) {
            return;
        }
        const w = frame.width;
        const h = frame.height;
        this.base.setCanvasSize(w, h);
        context.clearRect(0, 0, w, h);
        context.putImageData(frame, 0, 0);
        this.base.commitFrame();
    }
}
CanvasRgbaFrameDrawPipe.type = "rgbavideoframe";
export class CanvasYuv420FrameDrawPipe extends BaseCanvasFrameDrawPipe {
    static getInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            // no link
            return {
                environmentSupported: "WebGLRenderingContext" in globalObject(),
                supportedVideoCodecs: allVideoCodecs()
            };
        });
    }
    constructor(base, logger, options) {
        super(`rgba_canvas_frame -> ${base.implementationName}`, base, logger, options);
        this.errored = false;
        this.sizeChanged = false;
        this.width = -1;
        this.height = -1;
        this.currentFrame = null;
        this.textureY = null;
        this.textureU = null;
        this.textureV = null;
        this.program = null;
        this.quad = null;
        this.logger = logger !== null && logger !== void 0 ? logger : null;
        addPipePassthrough(this);
    }
    submitRawFrame(frame) {
        if (this.errored) {
            return;
        }
        const bufferSize = yuvBufferSize(frame.width, frame.height);
        if (!this.currentFrame || this.currentFrame.length < bufferSize) {
            this.currentFrame = new Uint8Array(bufferSize);
        }
        copyIntoYuv([frame.yPlane, frame.uPlane, frame.vPlane], [frame.yStride, frame.uvStride], frame.width, frame.height, this.currentFrame);
        if (this.width != frame.width || this.height != frame.height) {
            this.width = frame.width;
            this.height = frame.height;
            this.sizeChanged = true;
        }
        this.onFrameSubmitted();
    }
    /** Draw currentFrame to canvas if context and frame are ready. Only updates size when dimensions change. */
    drawCurrentFrameIfReady() {
        if (this.errored) {
            return;
        }
        const frame = this.currentFrame;
        const { context: gl, error } = this.base.useCanvasContext("webgl");
        if (!frame || error) {
            return;
        }
        const w = this.width;
        const h = this.height;
        this.base.setCanvasSize(w, h);
        gl.viewport(0, 0, w, h);
        // -- Create Program if not present
        const program = this.getProgram(gl);
        if (!program) {
            return;
        }
        // -- Create and Bind Quad to program
        const quadBuffer = this.bindQuadBuffer(gl, program);
        if (!quadBuffer) {
            return;
        }
        // -- Create and bind Texture correctly
        // sizeChanged will realloc a texture -> set it to true
        if (!this.textureY) {
            this.textureY = this.createTexture(gl);
            this.sizeChanged = true;
            if (!this.setProgramTexture(gl, program, "textureY", this.textureY, 1)) {
                return;
            }
        }
        if (!this.textureU) {
            this.textureU = this.createTexture(gl);
            this.sizeChanged = true;
            if (!this.setProgramTexture(gl, program, "textureU", this.textureU, 2)) {
                return;
            }
        }
        if (!this.textureV) {
            this.textureV = this.createTexture(gl);
            this.sizeChanged = true;
            if (!this.setProgramTexture(gl, program, "textureV", this.textureV, 3)) {
                return;
            }
        }
        // -- Upload texture to the gpu
        const size = this.width * this.height;
        const uvWidth = this.width >> 1;
        const uvHeight = this.height >> 1;
        const uvSize = uvWidth * uvHeight;
        if (this.sizeChanged) {
            // Realloc
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.bindTexture(gl.TEXTURE_2D, this.textureY);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(0, size));
            gl.bindTexture(gl.TEXTURE_2D, this.textureU);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, uvWidth, uvHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(size, size + uvSize));
            gl.bindTexture(gl.TEXTURE_2D, this.textureV);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, uvWidth, uvHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(size + uvSize, size + uvSize + uvSize));
            this.sizeChanged = false;
        }
        else {
            // Only reassign
            gl.bindTexture(gl.TEXTURE_2D, this.textureY);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(0, size));
            gl.bindTexture(gl.TEXTURE_2D, this.textureU);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, uvWidth, uvHeight, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(size, size + uvSize));
            gl.bindTexture(gl.TEXTURE_2D, this.textureV);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, uvWidth, uvHeight, gl.LUMINANCE, gl.UNSIGNED_BYTE, frame.subarray(size + uvSize, size + uvSize + uvSize));
        }
        // -- Draw the frame
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.base.commitFrame();
    }
    getProgram(gl) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const VERTEX_SHADER = `
attribute vec2 aPosition;

varying vec2 vPosition;

void main() {
   gl_Position = vec4(aPosition, 0.0, 1.0);
   vPosition = vec2(aPosition.x, -aPosition.y);
}
`;
        const FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vPosition;

uniform sampler2D textureY;
uniform sampler2D textureU;
uniform sampler2D textureV;
 
void main() {
    vec2 texCoord = vPosition.xy * 0.5 + 0.5;

    float y = texture2D(textureY, texCoord).r;
    float u = texture2D(textureU, texCoord).r - 0.5;
    float v = texture2D(textureV, texCoord).r - 0.5;

    // BT.601 conversion
    float r = y + (1.402 * v);
    float g = y - (0.344136 * u) - (0.714136 * v);
    float b = y + (1.772 * u);

    gl_FragColor = vec4(r, g, b, 1.0);
}
`;
        if (!this.program) {
            // Vertex Shader
            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            if (!vertexShader) {
                this.errored = true;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to create vertex shader!", { type: "fatalDescription" });
                return null;
            }
            gl.shaderSource(vertexShader, VERTEX_SHADER);
            gl.compileShader(vertexShader);
            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(vertexShader);
                this.errored = true;
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug("Failed to compile vertex shader!", { type: "fatalDescription" });
                if (log) {
                    (_c = this.logger) === null || _c === void 0 ? void 0 : _c.debug(log);
                }
                return null;
            }
            // Fragment Shader
            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            if (!fragmentShader) {
                this.errored = true;
                (_d = this.logger) === null || _d === void 0 ? void 0 : _d.debug("Failed to create fragment shader!", { type: "fatalDescription" });
                return null;
            }
            gl.shaderSource(fragmentShader, FRAGMENT_SHADER);
            gl.compileShader(fragmentShader);
            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
                this.errored = true;
                const log = gl.getShaderInfoLog(fragmentShader);
                (_e = this.logger) === null || _e === void 0 ? void 0 : _e.debug("Failed to compile fragment shader!", { type: "fatalDescription" });
                if (log) {
                    (_f = this.logger) === null || _f === void 0 ? void 0 : _f.debug(log);
                }
                return null;
            }
            // Link Program
            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                this.errored = true;
                const log = gl.getProgramInfoLog(program);
                (_g = this.logger) === null || _g === void 0 ? void 0 : _g.debug("Failed to link program!", { type: "fatalDescription" });
                if (log) {
                    (_h = this.logger) === null || _h === void 0 ? void 0 : _h.debug(log);
                }
                return null;
            }
            this.program = program;
            // Use program
            gl.useProgram(this.program);
            // Mark shaders for deletion, is allowed at this point as we've got them in a program
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
        }
        return this.program;
    }
    bindQuadBuffer(gl, program) {
        var _a;
        if (!this.quad) {
            // Note: We're using a triangle strip
            const quadData = new Float32Array([
                -1, 1, // Top Left
                -1, -1, // Bottom Left
                1, 1, // Top Right
                1, -1, // Bottom Right
            ]);
            const quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, quad);
            gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);
            this.quad = quad;
            // Set Vertex Attribute
            const quadAttrib = gl.getAttribLocation(program, "aPosition");
            if (quadAttrib == -1) {
                this.errored = true;
                (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug("Failed to get \"aPosition\" attribute from program", { type: "fatalDescription" });
                return null;
            }
            gl.enableVertexAttribArray(quadAttrib);
            gl.vertexAttribPointer(quadAttrib, 2, gl.FLOAT, false, 0, 0);
        }
        return this.quad;
    }
    createTexture(gl) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }
    setProgramTexture(gl, program, name, texture, textureId) {
        var _a;
        const uniform = gl.getUniformLocation(program, name);
        if (uniform == null) {
            this.errored = true;
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(`Failed to find uniform "${name}"`, { type: "fatalDescription" });
            return false;
        }
        gl.activeTexture(gl.TEXTURE0 + textureId);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform, textureId);
        // For further calls use the first texture
        gl.activeTexture(gl.TEXTURE0);
        return true;
    }
    cleanup() {
        const { context: gl } = this.base.useCanvasContext("webgl");
        if (gl) {
            gl.deleteTexture(this.textureY);
            this.textureY = null;
            gl.deleteTexture(this.textureU);
            this.textureU = null;
            gl.deleteTexture(this.textureV);
            this.textureV = null;
            gl.deleteProgram(this.program);
            this.program = null;
            gl.deleteBuffer(this.quad);
            this.quad = null;
        }
        return super.cleanup();
    }
}
CanvasYuv420FrameDrawPipe.type = "yuv420videoframe";
