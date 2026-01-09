export class AudioManager {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = 0.5;
        this.masterGain.connect(this.audioCtx.destination);

        this.sounds = {};
        this.muted = false;
        this.enabled = false;
    }

    async load(name, url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            this.sounds[name] = audioBuffer;
        } catch (e) {
            console.error('Error loading sound:', name, e);
        }
    }

    play(name, volume = 1.0) {
        if (!this.enabled || this.muted) return;
        if (this.sounds[name] && this.audioCtx.state === 'running') {
            const source = this.audioCtx.createBufferSource();
            const gainNode = this.audioCtx.createGain();
            gainNode.gain.value = volume;
            source.buffer = this.sounds[name];
            source.connect(gainNode).connect(this.masterGain);
            source.start(0);
        }
    }

    resume() {
        this.enabled = true;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    getState() {
        return this.audioCtx.state;
    }

    toggleMuted() {
        this.muted = !this.muted;
        return this.muted;
    }

    setMuted(value) {
        this.muted = !!value;
    }

    isMuted() {
        return this.muted;
    }
}