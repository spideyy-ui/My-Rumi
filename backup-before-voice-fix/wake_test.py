import time
import numpy as np
import sounddevice as sd
from openwakeword.model import Model

MODEL_PATH = r"public\models\wakeword\rumi.onnx"

print("Loading Rumi wake detector...", flush=True)

model = Model(
    wakeword_models=[MODEL_PATH],
    inference_framework="onnx"
)

print("Rumi wake detector ready!", flush=True)

last_detection = 0
threshold = 0.5
cooldown = 2.0

try:
    with sd.InputStream(
        samplerate=16000,
        channels=1,
        dtype="int16",
        blocksize=1280
    ) as stream:

        while True:
            audio, overflowed = stream.read(1280)
            audio = np.squeeze(audio)

            predictions = model.predict(audio)
            score = float(predictions["rumi"])

            if score >= threshold:
                now = time.time()

                if now - last_detection >= cooldown:
                    print(
                        f"RUMI_WAKE score={score:.3f}",
                        flush=True
                    )

                    last_detection = now

except KeyboardInterrupt:
    print("Wake detector stopped.", flush=True)