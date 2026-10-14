import sys, os, time

# Add project root to path
sys.path.append('C:/Users/shubh/Downloads/Rumi-Electron-Test-FRESH-v2')

from tts.tts_service import generate_voice

if __name__ == '__main__':
    text = 'Hello world, this is a test of the TTS system for profiling.'
    start = time.time()
    generate_voice(text)
    total = time.time() - start
    print(f'TOTAL_TIME:{total:.3f}s', flush=True)
