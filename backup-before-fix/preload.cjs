javascript
const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// RUMI SECURE RENDERER BRIDGE
// ============================================================

contextBridge.exposeInMainWorld('rumiDesktop', {

  // ----------------------------------------------------------
  // WINDOW INTERACTION
  // ----------------------------------------------------------

  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send(
      'rumi:set-ignore-mouse-events',
      ignore,
      options
    );
  },

  startDrag: () => {
    ipcRenderer.send('rumi:drag-start');
  },

  dragMove: () => {
    ipcRenderer.send('rumi:drag-move');
  },

  endDrag: () => {
    ipcRenderer.send('rumi:drag-end');
  },

  // ----------------------------------------------------------
  // STT
  // ----------------------------------------------------------

  testListen: () => {
    ipcRenderer.send('rumi:test-listen');
  },

  onTranscript: (callback) => {
    ipcRenderer.on(
      'rumi:transcript',
      (_event, text) => {
        callback(text);
      }
    );
  },

  // ----------------------------------------------------------
  // AI RESPONSE
  // ----------------------------------------------------------

  onAIResponse: (callback) => {
    ipcRenderer.on(
      'rumi:ai-response',
      (_event, text) => {
        callback(text);
      }
    );
  },

  // ----------------------------------------------------------
  // WAKE DETECTOR
  // ----------------------------------------------------------

  onWakeDetected: (callback) => {
    ipcRenderer.on(
      'rumi:wake-detected',
      () => {
        callback();
      }
    );
  },

  // ----------------------------------------------------------
  // CONVERSATION EVENTS
  // ----------------------------------------------------------

  onConversationStarted: (callback) => {
    ipcRenderer.on(
      'rumi:conversation-started',
      () => {
        callback();
      }
    );
  },

  onConversationEnded: (callback) => {
    ipcRenderer.on(
      'rumi:conversation-ended',
      () => {
        callback();
      }
    );
  },

  // ----------------------------------------------------------
  // CHATTERBOX AUDIO
  // ----------------------------------------------------------

  onTTSAudio: (callback) => {
    ipcRenderer.on(
      'rumi:tts-audio',
      (_event, audioPath) => {
        callback(audioPath);
      }
    );
  },

  onTTSError: (callback) => {
    ipcRenderer.on(
      'rumi:tts-error',
      () => {
        callback();
      }
    );
  },

  // ----------------------------------------------------------
  // TTS COMPLETION
  // ----------------------------------------------------------

  ttsFinished: () => {
    ipcRenderer.send('rumi:tts-finished');
  },

  ttsPlaybackError: () => {
    ipcRenderer.send('rumi:tts-playback-error');
  }

});

