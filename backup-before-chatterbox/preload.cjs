const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rumiDesktop', {

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

  testListen: () => {
    ipcRenderer.send('rumi:test-listen');
  },

  onTranscript: (callback) => {
    ipcRenderer.on(
      'rumi:transcript',
      (event, text) => {
        callback(text);
      }
    );
  },

  onAIResponse: (callback) => {
    ipcRenderer.on(
      'rumi:ai-response',
      (event, text) => {
        callback(text);
      }
    );
  },

  onWakeDetected: (callback) => {
    ipcRenderer.on(
      'rumi:wake-detected',
      () => {
        callback();
      }
    );
  },

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

  ttsFinished: () => {
    ipcRenderer.send(
      'rumi:tts-finished'
    );
  }

});