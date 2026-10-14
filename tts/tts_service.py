import sys
import os
import uuid
import traceback

import torch
import numpy as np
import torchaudio
import time

# Set torch to use all CPU cores for inference
torch.set_num_threads(max(1, os.cpu_count() or 1))

from chatterbox.tts_turbo import ChatterboxTurboTTS
import chatterbox.models.t3.t3 as t3_module
import chatterbox.models.s3gen.flow_matching as fm_module


# ============================================================
# RUMI TTS SERVICE
# Chatterbox - persistent model
# ============================================================

# Suppress tqdm progress bar output to stderr (which flooded Electron console with fake [TTS ERROR] 0/1000 lines)
t3_module.tqdm = lambda it, *a, **k: it
fm_module.tqdm = lambda it, *a, **k: it

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REFERENCE_AUDIO = os.path.join(BASE_DIR, "female_ref.wav")
OUTPUT_DIR = os.path.join(BASE_DIR, "generated")

os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Loading Chatterbox...", flush=True)

# Load model ONCE
model = ChatterboxTurboTTS.from_pretrained(
    device="cpu",
    nano=True
)

# ------------------------------------------------------------
# Compatibility patches used during our successful test
# ------------------------------------------------------------

old_log_mel = model.s3gen.tokenizer.log_mel_spectrogram

model.s3gen.tokenizer.log_mel_spectrogram = (
    lambda audio, padding=0:
    old_log_mel(audio.float(), padding).float()
)

old_embeds_from_mels = model.ve.embeds_from_mels

model.ve.embeds_from_mels = (
    lambda mels, *args, **kwargs:
    old_embeds_from_mels(
        [np.asarray(x, dtype=np.float32) for x in mels],
        *args,
        **kwargs
    )
    if isinstance(mels, list)
    else old_embeds_from_mels(
        mels.float(),
        *args,
        **kwargs
    )
)

# ------------------------------------------------------------
# Latency & safety patch: Dynamic max_gen_len for T3
# In the original library, generate() omits max_gen_len, causing
# inference_turbo to default to 1000 steps (40s of audio).
# If the model misses the EOS token, it iterates up to 1000/1000
# taking ~1.5-2 minutes on CPU. We calculate a safe bound based
# on text token count (S3 is 25 tokens/s; ~8-10 speech tokens/word).
# ------------------------------------------------------------
orig_inference_turbo = model.t3.inference_turbo

def optimized_inference_turbo(*args, **kwargs):
    if "max_gen_len" not in kwargs or kwargs["max_gen_len"] is None or kwargs["max_gen_len"] == 1000:
        text_tokens = kwargs.get("text_tokens")
        if text_tokens is None and len(args) > 1:
            text_tokens = args[1]
        if text_tokens is not None:
            n_tokens = text_tokens.shape[-1]
            kwargs["max_gen_len"] = min(500, max(120, int(n_tokens * 12) + 50))
        else:
            kwargs["max_gen_len"] = 350
    return orig_inference_turbo(*args, **kwargs)

model.t3.inference_turbo = optimized_inference_turbo

# ------------------------------------------------------------
# Latency optimization: Pre-compute reference conditionals ONCE
# Passing audio_prompt_path on every generate() call caused Chatterbox
# to re-read female_ref.wav, re-resample audio, and re-compute speaker
# embeddings on CPU (costing 20-40s per request). Pre-computing it
# once at startup preserves the exact same voice and eliminates this delay.
# ------------------------------------------------------------
print("Preparing female voice conditionals...", flush=True)
model.prepare_conditionals(REFERENCE_AUDIO)

print("Chatterbox loaded.", flush=True)
print("Rumi TTS service ready.", flush=True)


def generate_voice(text):
    text = text.strip()

    if not text:
        return None

    filename = f"rumi_{uuid.uuid4().hex}.wav"
    output_path = os.path.join(OUTPUT_DIR, filename)

    print(f"TTS: {text}", flush=True)

    try:
        # Record start time for generation
        gen_start = time.time()
        with torch.inference_mode():
            wav = model.generate(text)
        gen_end = time.time()
        # Record start time for saving
        save_start = time.time()
        torchaudio.save(
            output_path,
            wav,
            model.sr
        )
        save_end = time.time()
        # Log timings
        print(f"GENERATION_TIME:{gen_end - gen_start:.3f}s", flush=True)
        print(f"SAVE_TIME:{save_end - save_start:.3f}s", flush=True)
        print(f"OUTPUT:{output_path}", flush=True)
        return output_path

    except Exception:
        print("TTS ERROR:", flush=True)
        traceback.print_exc()
        return None


# ============================================================
# Read text continuously from Electron / terminal
# One line = one TTS request
# ============================================================

for line in sys.stdin:
    try:
        text = line.strip()

        if not text:
            continue

        if text == "__QUIT__":
            print("Stopping Rumi TTS service.", flush=True)
            break

        generate_voice(text)

    except KeyboardInterrupt:
        break

    except Exception:
        traceback.print_exc()