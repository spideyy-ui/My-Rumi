import sys
import time
import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wav
from faster_whisper import WhisperModel
import tempfile
import os


SAMPLE_RATE = 16000
BLOCK_SIZE = 1600
SILENCE_DURATION = 0.7
MAX_RECORDING_TIME = 8.0
SPEECH_THRESHOLD = 500


print("Loading Whisper...", file=sys.stderr, flush=True)

model = WhisperModel(
    "base",
    device="cpu",
    compute_type="int8"
)

print("Whisper ready.", file=sys.stderr, flush=True)


def listen():

    print("Listening...", file=sys.stderr, flush=True)

    frames = []

    speech_started = False
    speech_start_time = None
    last_speech_time = None

    start_time = time.monotonic()

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

                rms = float(
                    np.sqrt(
                        np.mean(
                            audio.astype(np.float32) ** 2
                        )
                    )
                )

                if not speech_started:

                    if rms >= SPEECH_THRESHOLD:

                        speech_started = True
                        speech_start_time = now
                        last_speech_time = now

                        print(
                            "Speech detected.",
                            file=sys.stderr,
                            flush=True
                        )

                        frames.append(audio)

                    else:

                        if now - start_time >= 4.0:

                            print(
                                "No speech detected.",
                                file=sys.stderr,
                                flush=True
                            )

                            return ""

                    continue

                frames.append(audio)

                if rms >= SPEECH_THRESHOLD:
                    last_speech_time = now

                if (
                    last_speech_time is not None
                    and now - last_speech_time >= SILENCE_DURATION
                ):
                    break

                if (
                    speech_start_time is not None
                    and now - speech_start_time >= MAX_RECORDING_TIME
                ):
                    break

    except Exception as error:

        print(
            f"Recording error: {error}",
            file=sys.stderr,
            flush=True
        )

        return ""

    if not frames:
        return ""

    audio_data = np.concatenate(frames)

    temp_file = tempfile.NamedTemporaryFile(
        suffix=".wav",
        delete=False
    )

    temp_path = temp_file.name
    temp_file.close()

    try:

        wav.write(
            temp_path,
            SAMPLE_RATE,
            audio_data
        )

        print(
            "Transcribing...",
            file=sys.stderr,
            flush=True
        )

        segments, _ = model.transcribe(
            temp_path,
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

        return text

    finally:

        if os.path.exists(temp_path):
            os.remove(temp_path)


for line in sys.stdin:

    command = line.strip()

    if command == "listen":

        result = listen()

        if result:
            print(result, flush=True)
        else:
            print("__NO_SPEECH__", flush=True)