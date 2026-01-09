export class ReplayRecorder {
    constructor(fps = 30) {
        this.RECORD_FPS = fps;
        this.replayData = [];
        this.frameEvents = [];
        this.accumulator = 0;
    }

    reset() {
        this.replayData = [];
        this.frameEvents = [];
        this.accumulator = 0;
    }

    recordEvent(name, payload = null) {
        this.frameEvents.push({ name, payload });
    }

    update(dt, snapshotFn) {
        this.accumulator += dt;
        if (this.accumulator >= 1 / this.RECORD_FPS) {
            const frame = snapshotFn();
            // Append events that happened since last frame
            frame.events = [...this.frameEvents];
            this.replayData.push(frame);
            
            // Reset for next frame
            this.frameEvents = [];
            this.accumulator = 0;
        }
    }

    getReplayJSON(config) {
        // Clone frames
        const frames = [...this.replayData];
        
        // Add padding frames (5 seconds)
        if (frames.length > 0) {
            const lastFrame = frames[frames.length - 1];
            // Create static frame with no events
            const paddingFrame = {
                ...lastFrame,
                events: []
            };
            
            const paddingFramesCount = 5 * this.RECORD_FPS;
            for (let i = 0; i < paddingFramesCount; i++) {
                frames.push(paddingFrame);
            }
        }

        return {
            frames: frames,
            config: config
        };
    }
}