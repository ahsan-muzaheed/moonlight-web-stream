export function addPipePassthrough(pipe, overwrite) {
    const pipeAny = pipe;
    const passthrough = (name, force) => {
        if (name in pipeAny && !force) {
            return;
        }
        pipeAny[name] = function () {
            const base = pipe.getBase();
            if (base) {
                return base[name].apply(base, arguments);
            }
        };
    };
    passthrough("setup", false);
    passthrough("cleanup", false);
    passthrough("pollRequestIdr", false);
    passthrough("getStreamRect", false);
    passthrough("onUserInteraction", false);
    passthrough("mount", false);
    passthrough("unmount", false);
    passthrough("reportStats", false);
    if (overwrite) {
        for (const overwriteFn of overwrite) {
            passthrough(overwriteFn, true);
        }
    }
}
