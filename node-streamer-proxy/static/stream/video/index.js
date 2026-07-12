export function getStreamRectCorrected(boundingRect, videoSize) {
    const videoAspect = videoSize[0] / videoSize[1];
    const boundingRectAspect = boundingRect.width / boundingRect.height;
    let x = boundingRect.x;
    let y = boundingRect.y;
    let videoMultiplier;
    if (boundingRectAspect > videoAspect) {
        // How much is the video scaled up
        videoMultiplier = boundingRect.height / videoSize[1];
        // Note: Both in boundingRect / page scale
        const boundingRectHalfWidth = boundingRect.width / 2;
        const videoHalfWidth = videoSize[0] * videoMultiplier / 2;
        x += boundingRectHalfWidth - videoHalfWidth;
    }
    else {
        // Same as above but inverted
        videoMultiplier = boundingRect.width / videoSize[0];
        const boundingRectHalfHeight = boundingRect.height / 2;
        const videoHalfHeight = videoSize[1] * videoMultiplier / 2;
        y += boundingRectHalfHeight - videoHalfHeight;
    }
    return new DOMRect(x, y, videoSize[0] * videoMultiplier, videoSize[1] * videoMultiplier);
}
