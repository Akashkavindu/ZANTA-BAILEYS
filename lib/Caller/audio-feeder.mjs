/**
 * Audio feeder.
 *
 * Decodes `source` into an in-memory Float32Array PCM buffer at the requested rate,
 * then meters frames out with microsecond-accurate cadence to the WASM VoIP uplink.
 * Uses an elastic accumulator loop with a 60ms cushion matching PJMEDIA's 60ms encoder
 * frame length, eliminating Windows timer jitter and buffer underruns.
 *
 * @author ShellTear & Chama
 */
import { spawn } from "node:child_process";
// Cache decoded audio buffers in memory across calls for instant 0ms startup
const audioBufferCache = new Map();
export class AudioFeeder {
    sampleRate;
    channels;
    framesPerChunk;
    onChunk;
    source;
    onFinished;
    loop;
    warmupSilenceMs;
    trailingSilenceMs;
    loopGapMs;
    #proc = null;
    #timer = null;
    #active = false;
    #samples = null;
    #playhead = 0;
    #startTime = 0;
    #chunksEmitted = 0;
    #finishedEmitted = false;
    #warmupRemaining = 0;
    #trailingRemaining = 0;
    #loopGapRemaining = 0;
    #cushionChunks = 3; // 60ms cushion (3 * 20ms) matching PJMEDIA's 60ms encoder cycle
    #chunkSamples = 0;
    #chunkIntervalMs = 0;
    droppedChunks = 0;
    underflowChunks = 0;
    bytesProduced = 0;
    constructor(sampleRate, channels, framesPerChunk, onChunk, source = "silence", onFinished, loop = true, warmupSilenceMs = 1500, // 1500ms warm-up for WebRTC/RTP stabilization
    trailingSilenceMs = 2000, loopGapMs = 1500) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.framesPerChunk = framesPerChunk;
        this.onChunk = onChunk;
        this.source = source;
        this.onFinished = onFinished;
        this.loop = loop;
        this.warmupSilenceMs = warmupSilenceMs;
        this.trailingSilenceMs = trailingSilenceMs;
        this.loopGapMs = loopGapMs;
        this.#chunkSamples = this.framesPerChunk * this.channels;
        this.#chunkIntervalMs = (this.framesPerChunk / this.sampleRate) * 1000;
        this.#warmupRemaining = Math.max(0, Math.round(this.warmupSilenceMs / this.#chunkIntervalMs));
        this.#trailingRemaining = Math.max(0, Math.round(this.trailingSilenceMs / this.#chunkIntervalMs));
        this.#loopGapRemaining = Math.max(0, Math.round(this.loopGapMs / this.#chunkIntervalMs));
    }
    get chunksEmitted() {
        return this.#chunksEmitted;
    }
    /**
     * Clear cached in-memory decoded audio buffers.
     */
    static clearCache = () => {
        audioBufferCache.clear();
    };
    /**
     * Pre-decode an audio file into memory ahead of time so playback can start with 0ms latency.
     */
    static preload = async (source, sampleRate = 16000, channels = 1) => {
        if (!source || source === "silence")
            return null;
        const cacheKey = `${source}:${sampleRate}:${channels}`;
        if (audioBufferCache.has(cacheKey)) {
            return audioBufferCache.get(cacheKey);
        }
        return AudioFeeder.#decodeSource(source, sampleRate, channels);
    };
    static #decodeSource = (source, sampleRate, channels) => {
        const cacheKey = `${source}:${sampleRate}:${channels}`;
        return new Promise((resolve) => {
            console.log(`[AudioFeeder] Decoding audio source to PCM: ${source}`);
            const inputArgs = source.startsWith("lavfi:")
                ? ["-f", "lavfi", "-i", source.slice("lavfi:".length)]
                : ["-i", source];
            const proc = spawn("ffmpeg", [
                "-hide_banner",
                "-loglevel", "error",
                ...inputArgs,
                "-af", "volume=2.2",
                "-f", "f32le",
                "-ac", String(channels),
                "-ar", String(sampleRate),
                "pipe:1",
            ]);
            const chunks = [];
            proc.stdout.on("data", (chunk) => {
                chunks.push(chunk);
            });
            proc.stderr.on("data", (chunk) => {
                process.stderr.write(`[AudioFeeder] ${chunk.toString().trim()}\n`);
            });
            proc.on("close", () => {
                const fullBuf = Buffer.concat(chunks);
                if (fullBuf.length >= 4) {
                    const numFloats = Math.floor(fullBuf.length / 4);
                    const fullFloats = new Float32Array(numFloats);
                    const srcView = new Uint8Array(fullBuf.buffer, fullBuf.byteOffset, numFloats * 4);
                    const dstView = new Uint8Array(fullFloats.buffer, fullFloats.byteOffset, numFloats * 4);
                    dstView.set(srcView);
                    audioBufferCache.set(cacheKey, fullFloats);
                    console.log(`✅ [AudioFeeder] Decoded and cached audio (${numFloats} samples, ${(numFloats / sampleRate).toFixed(1)}s) from ${source}`);
                    resolve(fullFloats);
                }
                else {
                    console.warn(`[AudioFeeder] Decode produced no audio bytes for ${source}`);
                    resolve(null);
                }
            });
            proc.on("error", (err) => {
                console.error(`[AudioFeeder] ffmpeg spawn error decoding ${source}:`, err);
                resolve(null);
            });
        });
    };
    start = () => {
        if (this.#active)
            return;
        this.#active = true;
        this.#startTime = performance.now();
        this.#chunksEmitted = 0;
        this.#finishedEmitted = false;
        this.#playhead = 0;
        const cacheKey = `${this.source}:${this.sampleRate}:${this.channels}`;
        if (!this.source || this.source === "silence") {
            this.#samples = new Float32Array(this.#chunkSamples);
            this.#startPacer();
            return;
        }
        const cached = audioBufferCache.get(cacheKey);
        if (cached && cached.length > 0) {
            console.log(`[AudioFeeder] Using cached PCM buffer (${cached.length} samples, ${(cached.length / this.sampleRate).toFixed(1)}s) for ${this.source}`);
            this.#samples = cached;
            this.#startPacer();
            return;
        }
        // If not cached, start pacer immediately with silence while decoding in background
        console.log(`[AudioFeeder] Audio buffer not cached yet; starting pacer with silence while decoding ${this.source}...`);
        this.#startPacer();
        AudioFeeder.#decodeSource(this.source, this.sampleRate, this.channels).then((samples) => {
            if (this.#active && samples) {
                this.#samples = samples;
                console.log(`[AudioFeeder] Background decode completed (${samples.length} samples); voice streaming active!`);
            }
        });
    };
    #startPacer = () => {
        if (this.#timer || !this.#active)
            return;
        // Immediately flush initial cushion frames so PJMEDIA's sound port buffer is never empty
        this.#tick();
        // High-resolution polling every 5ms to keep jitter buffer perfectly filled
        this.#timer = setInterval(this.#tick, 5);
    };
    #tick = () => {
        if (!this.#active)
            return;
        const elapsedMs = performance.now() - this.#startTime;
        // Calculate total frames that should have been emitted by now + cushion
        const targetChunks = Math.floor(elapsedMs / this.#chunkIntervalMs) + this.#cushionChunks;
        // Flush all pending chunks up to target in this tick
        while (this.#chunksEmitted < targetChunks && this.#active && !this.#finishedEmitted) {
            this.#flushOne();
        }
    };
    #flushOne = () => {
        if (!this.#active)
            return;
        const frame = new Float32Array(this.#chunkSamples);
        // 1. Warm-up silence phase (allows WebRTC/RTP connection to fully establish)
        if (this.#warmupRemaining > 0) {
            this.#warmupRemaining--;
            // frame remains all 0.0f
        }
        // 2. Speech PCM samples phase
        else if (this.#samples && this.#playhead < this.#samples.length) {
            const audio = this.#samples;
            for (let i = 0; i < this.#chunkSamples; i++) {
                if (this.#playhead < audio.length) {
                    frame[i] = audio[this.#playhead++];
                }
                else {
                    frame[i] = 0;
                }
            }
            // If audio finished playing and loop is enabled, prime the loop gap pause
            if (this.#playhead >= audio.length && this.loop) {
                this.#loopGapRemaining = Math.max(0, Math.round(this.loopGapMs / this.#chunkIntervalMs));
            }
        }
        // 3. Loop gap silence phase (natural pause before repeating greeting)
        else if (this.loop && this.#loopGapRemaining > 0) {
            this.#loopGapRemaining--;
            // frame remains all 0.0f
            if (this.#loopGapRemaining <= 0) {
                // Rewind playhead to replay greeting cleanly!
                this.#playhead = 0;
            }
        }
        // 4. Trailing silence padding phase (for non-looping audio)
        else {
            if (!this.loop) {
                if (this.#trailingRemaining > 0) {
                    this.#trailingRemaining--;
                    // frame remains all 0.0f
                }
                else {
                    if (!this.#finishedEmitted) {
                        this.#finishedEmitted = true;
                        this.#chunksEmitted++;
                        this.bytesProduced += frame.byteLength;
                        this.onChunk(frame);
                        console.log(`[AudioFeeder] Audio playback completed (${this.#chunksEmitted} chunks emitted). Triggering onFinished to cut call...`);
                        this.stop();
                        this.onFinished?.();
                        return;
                    }
                }
            }
        }
        this.#chunksEmitted++;
        this.bytesProduced += frame.byteLength;
        this.onChunk(frame);
    };
    stop = () => {
        if (!this.#active)
            return;
        this.#active = false;
        console.log(`[AudioFeeder] Stopped. Total emitted chunks: ${this.#chunksEmitted}, bytes: ${this.bytesProduced}`);
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
        if (this.#proc) {
            try {
                this.#proc.kill("SIGTERM");
            }
            catch { }
            this.#proc = null;
        }
        this.#playhead = 0;
    };
}
