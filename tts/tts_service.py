import sys
import os
import uuid
import time
import re
import io
import base64
import asyncio
import traceback

import numpy as np
import soundfile as sf

# ============================================================
# RUMI TTS SERVICE - SUPERTONIC F2 (LOCAL) WITH EDGE TTS FALLBACK
# ============================================================

VOICE_NAME = "F2"
FALLBACK_EDGE_VOICE = "en-US-MichelleNeural"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "generated")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Preserve fallback ability: If Chatterbox engine is explicitly requested,
# route directly to the preserved Chatterbox implementation.
if os.environ.get("RUMI_TTS_ENGINE", "").strip().lower() == "chatterbox":
    chatterbox_script = os.path.join(BASE_DIR, "chatterbox_tts_service.py")
    if os.path.exists(chatterbox_script):
        print("Routing to preserved Chatterbox TTS service...", flush=True)
        import runpy
        runpy.run_path(chatterbox_script, run_name="__main__")
        sys.exit(0)

# Optional Edge TTS import for fallback
try:
    import edge_tts
    edge_tts_available = True
except ImportError:
    edge_tts_available = False

# Import Supertonic TTS
try:
    from supertonic import TTS
    supertonic_available = True
except ImportError:
    print(
        "ERROR: 'supertonic' package is not installed in this Python environment.",
        file=sys.stderr,
        flush=True
    )
    supertonic_available = False

# ============================================================
# MODEL INITIALIZATION (LOADED ONCE AT STARTUP)
# ============================================================

supertonic_tts = None
voice_style = None
sample_rate = 44100
supertonic_ready = False
synthesis_count = 0

if supertonic_available and os.environ.get("RUMI_FORCE_EDGE_TTS") != "1":
    try:
        print(f"Loading Supertonic TTS (Voice: {VOICE_NAME})...", flush=True)
        supertonic_tts = TTS(
            auto_download=True,
            intra_op_num_threads=2,
            inter_op_num_threads=1
        )
        sample_rate = supertonic_tts.sample_rate
        voice_style = supertonic_tts.get_voice_style(VOICE_NAME)
        supertonic_ready = True
        print(f"Supertonic TTS ready. Voice: {VOICE_NAME}, Sample Rate: {sample_rate} Hz.", flush=True)
    except Exception as init_err:
        print(f"[TTS WARNING] Failed to initialize Supertonic TTS: {init_err}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        supertonic_ready = False

if not supertonic_ready:
    print("[TTS NOTICE] Supertonic is unavailable. Running in Edge TTS fallback mode.", flush=True)

print("Rumi TTS service ready.", flush=True)


def clean_speech_text(text: str) -> str:
    """
    Clean markdown symbols, action tags, and superfluous whitespace
    so speech sounds natural.
    """
    if not text:
        return ""

    # Remove code blocks or inline backticks
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # Remove bold / italic markdown asterisks or underscores
    text = re.sub(r'[*_]{1,3}([^*_]+)[*_]{1,3}', r'\1', text)

    # Remove standalone asterisks or special decorative characters
    text = re.sub(r'[*_#~>]', '', text)

    # Collapse multiple whitespace characters into a single space
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def synthesize_supertonic_in_memory(clean_text: str) -> str:
    """
    Synthesize speech using local Supertonic F2 and encode waveform
    into an in-memory WAV data URI without touching disk.
    """
    global synthesis_count
    synthesis_count += 1

    gen_start = time.time()
    wav, duration = supertonic_tts.synthesize(
        text=clean_text,
        voice_style=voice_style,
        lang="en",
        total_steps=8,
        speed=1.0
    )
    gen_end = time.time()

    dur_val = float(duration.squeeze())

    # Encode in-memory WAV
    bio = io.BytesIO()
    sf.write(bio, wav.squeeze(), sample_rate, format="WAV")
    wav_bytes = bio.getvalue()
    b64_data = base64.b64encode(wav_bytes).decode("ascii")
    data_uri = f"data:audio/wav;base64,{b64_data}"

    print(f"GENERATION_TIME:{gen_end - gen_start:.3f}s", flush=True)
    print(f"AUDIO_DURATION:{dur_val:.2f}s", flush=True)
    print(f"OUTPUT:{data_uri}", flush=True)
    return data_uri


async def synthesize_edge_tts_file(text: str, output_path: str):
    """
    Generate speech using Microsoft Edge TTS fallback.
    """
    communicate = edge_tts.Communicate(text, FALLBACK_EDGE_VOICE)
    await communicate.save(output_path)


def synthesize_edge_fallback(clean_text: str) -> str:
    """
    Fallback synthesis using Microsoft Edge TTS saved to a temporary MP3 file.
    """
    if not edge_tts_available:
        raise RuntimeError("edge_tts package is not installed for fallback.")

    print(f"[TTS Fallback] Synthesizing via Edge TTS: {clean_text}", flush=True)
    filename = f"rumi_fallback_{uuid.uuid4().hex}.mp3"
    output_path = os.path.join(OUTPUT_DIR, filename)

    gen_start = time.time()
    asyncio.run(synthesize_edge_tts_file(clean_text, output_path))
    gen_end = time.time()

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError(f"Edge TTS fallback did not produce a valid file: {output_path}")

    print(f"GENERATION_TIME:{gen_end - gen_start:.3f}s", flush=True)
    print(f"OUTPUT:{output_path}", flush=True)
    return output_path


def generate_voice(text: str):
    """
    Synthesize speech for a given text prompt.
    Tries Supertonic F2 (in-memory) first, then falls back to Edge TTS if needed.
    """
    clean_text = clean_speech_text(text)

    if not clean_text:
        return None

    print(f"TTS: {clean_text}", flush=True)

    # 1. Primary: Supertonic F2
    if supertonic_ready and os.environ.get("RUMI_FORCE_EDGE_TTS") != "1":
        try:
            return synthesize_supertonic_in_memory(clean_text)
        except Exception as supertonic_err:
            print(f"[TTS WARNING] Supertonic synthesis failed: {supertonic_err}. Falling back to Edge TTS...", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)

    # 2. Fallback: Edge TTS
    try:
        return synthesize_edge_fallback(clean_text)
    except Exception as fallback_err:
        print("TTS ERROR:", flush=True)
        print(f"[TTS Fallback Error] {fallback_err}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        return None


# ============================================================
# Protocol loop: Read text continuously from stdin
# One line = one TTS request
# ============================================================

def main():
    for line in sys.stdin:
        try:
            raw_text = line.strip()

            if not raw_text:
                continue

            if raw_text == "__QUIT__":
                print("Stopping Rumi TTS service.", flush=True)
                break

            generate_voice(raw_text)

        except KeyboardInterrupt:
            break

        except Exception:
            print("TTS ERROR:", flush=True)
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()