import sys
import time
import os
from collections import deque
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
BLOCK_SIZE = 1600
SILENCE_DURATION = 0.55
MAX_RECORDING_TIME = 8.0
NO_SPEECH_TIMEOUT = 4.0
MIN_START_THRESHOLD = 450.0
MIN_CONTINUE_THRESHOLD = 300.0

print("Loading Whisper...", file=sys.stderr, flush=True)

model = WhisperModel(
    "base",
    device="cpu",
    compute_type="int8"
)

print("Whisper ready.", file=sys.stderr, flush=True)


def listen(t_listen_cmd=None):
    if t_listen_cmd is None:
        t_listen_cmd = time.monotonic()

    print("[STT] Listening...", file=sys.stderr, flush=True)

    frames = []
    preroll = deque(maxlen=3)  # 300ms pre-roll to preserve soft initial consonants/vowels

    speech_started = False
    speech_start_time = None
    last_speech_time = None
    consecutive_speech_blocks = 0
    start_streak = 0
    termination_reason = "unknown"

    noise_rms = None
    init_blocks = []

    t_record_start = time.monotonic()
    print(
        f"[STT] Microphone recording started (elapsed: {(t_record_start - t_listen_cmd) * 1000:.1f}ms).",
        file=sys.stderr,
        flush=True
    )

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=BLOCK_SIZE
        ) as stream:

            while True:
                audio, overflowed = stream.read(BLOCK_SIZE)
                audio = np.squeeze(audio).copy()
                now = time.monotonic()

                rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))

                if not speech_started:
                    # Calibrate initial noise floor from the first 2-3 frames
                    if noise_rms is None:
                        if rms > 1.0:
                            init_blocks.append(rms)
                        if len(init_blocks) >= 2 or (now - t_record_start) >= 0.3:
                            noise_rms = float(np.median(init_blocks)) if init_blocks else 300.0
                            noise_rms = min(max(noise_rms, 100.0), 1200.0)
                        else:
                            preroll.append(audio)
                            continue

                    # Dynamic thresholds based on noise floor
                    start_threshold = max(MIN_START_THRESHOLD, noise_rms * 1.75 + 100.0)
                    continue_threshold = max(MIN_CONTINUE_THRESHOLD, noise_rms * 1.25 + 50.0)

                    # Update noise floor estimate only during confirmed non-speech periods
                    if rms < continue_threshold and rms > 1.0:
                        noise_rms = 0.92 * noise_rms + 0.08 * rms
                        noise_rms = min(max(noise_rms, 100.0), 1200.0)

                    # Require 2 consecutive frames or 1 strong frame to start speech
                    if rms >= start_threshold:
                        start_streak += 1
                        if start_streak >= 2 or rms >= (start_threshold * 1.35):
                            speech_started = True
                            speech_start_time = now
                            last_speech_time = now
                            consecutive_speech_blocks = start_streak
                            frames.extend(preroll)
                            frames.append(audio)

                            print(
                                f"[STT] First speech activity detected at +{(speech_start_time - t_record_start):.2f}s "
                                f"(RMS: {rms:.1f}, start_th: {start_threshold:.1f}, cont_th: {continue_threshold:.1f}, "
                                f"noise_floor: {noise_rms:.1f}).",
                                file=sys.stderr,
                                flush=True
                            )
                        else:
                            preroll.append(audio)
                    else:
                        start_streak = 0
                        preroll.append(audio)
                        if now - t_record_start >= NO_SPEECH_TIMEOUT:
                            t_record_end = time.monotonic()
                            print(
                                f"[STT] Recording terminated: reason=no_speech_timeout, "
                                f"duration={(t_record_end - t_record_start):.2f}s.",
                                file=sys.stderr,
                                flush=True
                            )
                            return ""
                    continue

                # Speech is active
                frames.append(audio)
                start_threshold = max(MIN_START_THRESHOLD, noise_rms * 1.75 + 100.0)
                continue_threshold = max(MIN_CONTINUE_THRESHOLD, noise_rms * 1.25 + 50.0)

                if rms >= start_threshold:
                    last_speech_time = now
                    consecutive_speech_blocks += 1
                elif rms >= continue_threshold:
                    # Hangover smoothing: sustain speech if recent (<250ms) or continuing streak
                    if (now - last_speech_time) < 0.25 or consecutive_speech_blocks >= 1:
                        last_speech_time = now
                    consecutive_speech_blocks += 1
                else:
                    consecutive_speech_blocks = 0

                # Check silence timeout
                if last_speech_time is not None and (now - last_speech_time) >= SILENCE_DURATION:
                    termination_reason = "silence_duration"
                    break

                # Check maximum recording duration
                if speech_start_time is not None and (now - speech_start_time) >= MAX_RECORDING_TIME:
                    termination_reason = "max_recording_time"
                    break

    except Exception as error:
        print(
            f"[STT] Recording error: {error}",
            file=sys.stderr,
            flush=True
        )
        return ""

    t_record_end = time.monotonic()
    record_dur = t_record_end - t_record_start
    post_speech_delay = t_record_end - last_speech_time if last_speech_time else 0.0

    print(
        f"[STT] Recording terminated: reason={termination_reason}, "
        f"duration={record_dur:.2f}s, delay_after_last_speech={post_speech_delay:.2f}s.",
        file=sys.stderr,
        flush=True
    )

    if not frames:
        return ""

    audio_data = np.concatenate(frames)
    audio_float = audio_data.astype(np.float32) / 32768.0

    t_transcribe_start = time.monotonic()
    print(
        f"[STT] Transcription started at +{(t_transcribe_start - t_record_start):.2f}s "
        f"(in-memory waveform, {len(audio_data) / SAMPLE_RATE:.2f}s audio)...",
        file=sys.stderr,
        flush=True
    )

    try:
        segments, _ = model.transcribe(
            audio_float,
            language="en",
            condition_on_previous_text=False,
            temperature=0,
            beam_size=5,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0
        )

        text = " ".join(
            segment.text.strip()
            for segment in segments
        ).strip()

        t_transcribe_end = time.monotonic()
        transcribe_dur = t_transcribe_end - t_transcribe_start
        total_pipeline_time = t_transcribe_end - t_record_start
        est_end_of_speech_latency = t_transcribe_end - last_speech_time if last_speech_time else total_pipeline_time

        print(
            f"[STT] Transcription completed in {transcribe_dur * 1000:.1f}ms.",
            file=sys.stderr,
            flush=True
        )
        print(
            f"[STT Timing Summary] Total pipeline time: {total_pipeline_time:.2f}s | "
            f"Recording duration: {record_dur:.2f}s | "
            f"Delay after last speech: {post_speech_delay:.2f}s | "
            f"Whisper transcription: {transcribe_dur:.2f}s | "
            f"Estimated speech-end to transcript latency: {est_end_of_speech_latency:.2f}s (estimated based on detected audio activity).",
            file=sys.stderr,
            flush=True
        )

        return text

    except Exception as error:
        print(
            f"[STT] Transcription error: {error}",
            file=sys.stderr,
            flush=True
        )
        return ""


if __name__ == "__main__":
    for line in sys.stdin:
        command = line.strip()

        if command == "listen":
            t_listen_cmd = time.monotonic()
            print(
                f"[STT] Listen command received at monotonic {t_listen_cmd:.3f}s.",
                file=sys.stderr,
                flush=True
            )
            result = listen(t_listen_cmd)

            if result:
                print(result, flush=True)
            else:
                print("__NO_SPEECH__", flush=True)
