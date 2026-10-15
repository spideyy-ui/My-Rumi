RUMI ELECTRON TEST - FIXED

This version uses Electron + Three.js directly.
No Vite, Rollup, concurrently, or wait-on.

Run:
1. Open CMD in this exact folder (package.json must be visible).
2. npm install
3. npm start

The window is transparent and frameless.
Rumi.glb is included at public/models/Rumi.glb.
The Noesis character animation is permanently locked to frame 0.

TTS Dependencies (Python 3.13):
py -3.13 -m pip install supertonic==1.3.1 soundfile edge-tts
Voice: Supertonic F2 (local in-memory waveform synthesis; Microsoft Edge TTS fallback)
