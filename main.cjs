const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

// ============================================================
// RUMI PROCESS MANAGEMENT
// ============================================================

let win = null;

let sttProcess = null;
let wakeProcess = null;
let ttsProcess = null;

let conversationMode = false;
let conversationTimer = null;
let sttListening = false;

let shuttingDown = false;

const CONVERSATION_TIMEOUT = 15000;

const TTS_PYTHON =
  'C:\\Users\\shubh\\Downloads\\Rumi-TTS-Test\\.venv\\Scripts\\python.exe';

const TTS_SCRIPT = path.join(
  __dirname,
  'tts',
  'tts_service.py'
);

let dragOriginMouse = null;
let dragOriginWin = null;
let dragInterval = null;


// ============================================================
// SAFE WINDOW MESSAGING
// ============================================================

function sendToRenderer(channel, ...args) {
  if (
    win &&
    !win.isDestroyed() &&
    !win.webContents.isDestroyed()
  ) {
    win.webContents.send(channel, ...args);
  }
}


// ============================================================
// CONVERSATION TIMER
// ============================================================

function clearConversationTimer() {
  if (conversationTimer) {
    clearTimeout(conversationTimer);
    conversationTimer = null;
  }
}


function startConversationTimer() {
  clearConversationTimer();

  if (!conversationMode || shuttingDown) {
    return;
  }

  console.log('Conversation idle timer started: 15 seconds');

  conversationTimer = setTimeout(() => {
    console.log(
      '15 seconds of inactivity. Leaving conversation mode.'
    );

    conversationTimer = null;
    conversationMode = false;
    sttListening = false;

    sendToRenderer('rumi:conversation-ended');

    startWakeDetector();
  }, CONVERSATION_TIMEOUT);
}


// ============================================================
// ENTER CONVERSATION MODE
// ============================================================

function enterConversationMode() {
  if (conversationMode || shuttingDown) {
    return;
  }

  conversationMode = true;

  clearConversationTimer();

  console.log('Conversation Mode ON');

  sendToRenderer('rumi:conversation-started');

  stopWakeDetector();

  listenToRumi();
}


// ============================================================
// EXIT CONVERSATION MODE
// ============================================================

function exitConversationMode() {
  conversationMode = false;

  clearConversationTimer();

  sttListening = false;

  sendToRenderer('rumi:conversation-ended');

  startWakeDetector();
}


// ============================================================
// START CHATTERBOX TTS SERVICE
// ============================================================

function startTTS() {
  if (ttsProcess || shuttingDown) {
    return;
  }

  console.log('Starting Rumi Chatterbox TTS service...');

  console.log('Python:', TTS_PYTHON);
  console.log('TTS script:', TTS_SCRIPT);

  ttsProcess = spawn(
    TTS_PYTHON,
    [
      '-u',
      TTS_SCRIPT
    ],
    {
      cwd: path.join(__dirname, 'tts'),

      stdio: [
        'pipe',
        'pipe',
        'pipe'
      ],

      windowsHide: true
    }
  );

  const currentProcess = ttsProcess;

  let stdoutBuffer = '';

  currentProcess.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();

    const lines = stdoutBuffer.split(/\r?\n/);

    stdoutBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      // Only this exact protocol line is treated as an audio path.
      if (line.startsWith('OUTPUT:')) {
        const audioPath = line.slice('OUTPUT:'.length).trim();

        if (audioPath) {
          console.log('Chatterbox audio generated:', audioPath);

          sendToRenderer('rumi:tts-audio', audioPath);
        }

        continue;
      }

      if (line === 'TTS ERROR:') {
        console.error('Chatterbox failed to generate audio.');

        sendToRenderer('rumi:tts-error');

        continue;
      }

      console.log('[TTS]', line);
    }
  });

  currentProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();

    if (message) {
      console.error('[TTS ERROR]', message);
    }
  });

  currentProcess.on('error', (error) => {
    console.error('Failed to start Chatterbox TTS:', error);

    if (ttsProcess === currentProcess) {
      ttsProcess = null;
    }

    sendToRenderer('rumi:tts-error');
  });

  currentProcess.on('close', (code) => {
    console.log('Chatterbox TTS process closed:', code);

    if (ttsProcess === currentProcess) {
      ttsProcess = null;
    }

    if (!shuttingDown && conversationMode) {
      sendToRenderer('rumi:tts-error');
    }
  });
}


// ============================================================
// SEND TEXT TO CHATTERBOX
// ============================================================

function speakWithTTS(text) {
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    sendToRenderer('rumi:tts-error');
    return;
  }

  if (
    !ttsProcess ||
    ttsProcess.killed ||
    !ttsProcess.stdin ||
    ttsProcess.stdin.destroyed ||
    !ttsProcess.stdin.writable
  ) {
    console.error('Chatterbox TTS service is not available.');

    sendToRenderer('rumi:tts-error');

    return;
  }

  console.log('Sending response to Chatterbox.');
  console.log(`[TIMING] TTS_SENT ${Date.now()}`);
  try {
    // The service accepts one text request per line.
    // Prevent embedded newlines from creating multiple requests.
    const singleLineText = cleanText.replace(/[\r\n]+/g, ' ');

    ttsProcess.stdin.write(singleLineText + '\n', (error) => {
      if (error) {
        console.error('Failed to send text to TTS:', error);

        sendToRenderer('rumi:tts-error');
      }
    });
  } catch (error) {
    console.error('TTS request failed:', error);

    sendToRenderer('rumi:tts-error');
  }
}


// ============================================================
// ASK LOCAL OLLAMA
// ============================================================

async function askLlama(text) {
  try {
    const requestStart = Date.now();
    console.log(`[TIMING] OLLAMA_START ${requestStart}`);
    console.log('Sending to Llama:', text);

    const response = await fetch(
      'http://localhost:11434/api/generate',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          model: 'llama3.2:1b',

          prompt: `You are Rumi, a friendly desktop AI companion.
Reply naturally and briefly in English.
Do not act poetic or philosophical.
Keep your response conversational.

User: ${text}
Rumi:`,

          stream: false
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Ollama returned HTTP ${response.status}`
      );
    }

    const data = await response.json();
    console.log(
      `[TIMING] OLLAMA_DONE ${Date.now()} elapsed=${Date.now() - requestStart}ms`
    );
    const reply = data.response?.trim() || '';

    console.log('Rumi AI:', reply);

    if (!reply) {
      console.warn('Ollama returned an empty response.');

      sendToRenderer('rumi:tts-error');

      return;
    }

    // Keep the existing AI-response event for renderer logging
    // and any other existing UI listeners.
    sendToRenderer('rumi:ai-response', reply);

    // Generate speech using the persistent Chatterbox process.
    speakWithTTS(reply);

  } catch (error) {
    console.error('Llama error:', error);

    // Prevent conversation mode from getting stuck.
    if (conversationMode) {
      startConversationTimer();
    }
  }
}


// ============================================================
// START STT PYTHON SERVICE
// ============================================================

function startSTT() {
  if (sttProcess || shuttingDown) {
    return;
  }

  console.log('Starting Rumi STT...');

  sttProcess = spawn(
    'py',
    [
      '-3.13',
      path.join(__dirname, 'stt_service.py')
    ],
    {
      stdio: [
        'pipe',
        'pipe',
        'pipe'
      ],

      windowsHide: true
    }
  );

  const currentProcess = sttProcess;

  let stdoutBuffer = '';

  currentProcess.stdout.on('data', async (data) => {
    stdoutBuffer += data.toString();

    const lines = stdoutBuffer.split(/\r?\n/);

    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const text = line.trim();

      if (!text) {
        continue;
      }

      if (text === '__NO_SPEECH__') {
        sttListening = false;
        console.log('STT: Cycle finished (no speech detected).');
        if (conversationMode && !shuttingDown) {
          startConversationTimer();
          listenToRumi();
        }
        continue;
      }

      console.log('Rumi STT:', text);

      sttListening = false;

      // Real user speech resets the idle timer.
      clearConversationTimer();

      sendToRenderer('rumi:transcript', text);

      await askLlama(text);
    }
  });

  currentProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();

    if (message) {
      console.log('STT:', message);
    }
  });

  currentProcess.on('error', (error) => {
    console.error('Failed to start STT:', error);
  });

  currentProcess.on('close', (code) => {
    console.log('STT process closed:', code);

    if (sttProcess === currentProcess) {
      sttProcess = null;
    }

    sttListening = false;
  });
}


// ============================================================
// ASK STT TO LISTEN
// ============================================================

function listenToRumi() {
  if (
    !sttProcess ||
    sttProcess.killed ||
    !sttProcess.stdin ||
    sttProcess.stdin.destroyed ||
    !sttProcess.stdin.writable
  ) {
    console.log('STT is not running.');
    return;
  }

  if (sttListening) {
    return;
  }

  console.log('Sending listen command to STT...');

  sttListening = true;

  sttProcess.stdin.write('listen\n', (error) => {
    if (error) {
      console.error('Failed to send STT listen command:', error);
      sttListening = false;
    }
  });
}


// ============================================================
// START RUMI WAKE DETECTOR
// ============================================================

function startWakeDetector() {
  if (wakeProcess || shuttingDown) {
    return;
  }

  console.log('Starting Rumi wake detector...');

  wakeProcess = spawn(
    'py',
    [
      '-3.13',
      '-u',
      path.join(__dirname, 'wake_test.py')
    ],
    {
      stdio: [
        'ignore',
        'pipe',
        'pipe'
      ],

      windowsHide: true
    }
  );

  const currentProcess = wakeProcess;

  let stdoutBuffer = '';

  currentProcess.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();

    const lines = stdoutBuffer.split(/\r?\n/);

    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const message = line.trim();

      if (!message) {
        continue;
      }

      console.log('WAKE:', message);

      if (message.startsWith('RUMI_WAKE')) {
        if (conversationMode) {
          continue;
        }

        console.log('Rumi detected!');

        sendToRenderer('rumi:wake-detected');

        enterConversationMode();
      }
    }
  });

  currentProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();

    if (message) {
      console.log('Wake detector:', message);
    }
  });

  currentProcess.on('error', (error) => {
    console.error('Failed to start wake detector:', error);

    if (wakeProcess === currentProcess) {
      wakeProcess = null;
    }
  });

  currentProcess.on('close', (code) => {
    console.log('Wake detector closed:', code);

    if (wakeProcess === currentProcess) {
      wakeProcess = null;
    }
  });
}


// ============================================================
// STOP RUMI WAKE DETECTOR
// ============================================================

function stopWakeDetector() {
  if (wakeProcess) {
    console.log('Stopping Rumi wake detector...');

    const pid = wakeProcess.pid;

    try {
      if (!wakeProcess.killed) {
        wakeProcess.kill();
      }
    } catch {}

    if (process.platform === 'win32' && pid) {
      try {
        const { exec } = require('child_process');
        exec(`taskkill /F /T /PID ${pid} 2>nul`);
      } catch {}
    }

    wakeProcess = null;
  }
}


// ============================================================
// TTS FINISHED
// ============================================================

ipcMain.on('rumi:tts-finished', () => {
  console.log('TTS finished.');

  if (!conversationMode || shuttingDown) {
    return;
  }

  startConversationTimer();

  // Listen for the next user sentence.
  listenToRumi();
});


// ============================================================
// TTS AUDIO ERROR
// ============================================================

ipcMain.on('rumi:tts-playback-error', () => {
  console.error('TTS audio playback failed.');

  if (!conversationMode || shuttingDown) {
    return;
  }

  startConversationTimer();

  listenToRumi();
});


// ============================================================
// CREATE RUMI WINDOW
// ============================================================

function createWindow() {
  const display = screen.getPrimaryDisplay();

  const {
    width,
    height
  } = display.workAreaSize;

  win = new BrowserWindow({
    width: 500,
    height: 700,

    x: Math.max(0, width - 540),
    y: Math.max(0, height - 740),

    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),

      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);

  win.webContents.on('console-message', (event, level, message) => {
    const text = typeof event === 'object' && event !== null && event.message !== undefined ? event.message : (message || event);
    console.log('[Renderer]', text);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.setIgnoreMouseEvents(true, {
    forward: true
  });

  win.loadFile(
    path.join(__dirname, 'index.html')
  );
}


// ============================================================
// MOUSE CLICK-THROUGH CONTROL
// ============================================================

ipcMain.on(
  'rumi:set-ignore-mouse-events',
  (event, ignore, options) => {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, options);
    }
  }
);


// ============================================================
// DRAG START
// ============================================================

ipcMain.on('rumi:drag-start', () => {
  if (!win || win.isDestroyed()) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();

  const bounds = win.getBounds();

  dragOriginMouse = {
    x: cursor.x,
    y: cursor.y
  };

  dragOriginWin = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };

  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }

  dragInterval = setInterval(() => {
    if (
      !win ||
      win.isDestroyed() ||
      !dragOriginMouse ||
      !dragOriginWin
    ) {
      if (dragInterval) {
        clearInterval(dragInterval);
        dragInterval = null;
      }

      return;
    }

    const currentCursor = screen.getCursorScreenPoint();

    const deltaX = currentCursor.x - dragOriginMouse.x;
    const deltaY = currentCursor.y - dragOriginMouse.y;

    win.setBounds({
      x: Math.round(dragOriginWin.x + deltaX),
      y: Math.round(dragOriginWin.y + deltaY),

      width: dragOriginWin.width,
      height: dragOriginWin.height
    });
  }, 12);
});


// ============================================================
// DRAG MOVE
// ============================================================

ipcMain.on('rumi:drag-move', () => {
  if (
    !win ||
    win.isDestroyed() ||
    !dragOriginMouse ||
    !dragOriginWin
  ) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();

  const deltaX = cursor.x - dragOriginMouse.x;
  const deltaY = cursor.y - dragOriginMouse.y;

  win.setBounds({
    x: Math.round(dragOriginWin.x + deltaX),
    y: Math.round(dragOriginWin.y + deltaY),

    width: dragOriginWin.width,
    height: dragOriginWin.height
  });
});


// ============================================================
// DRAG END
// ============================================================

ipcMain.on('rumi:drag-end', () => {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }

  dragOriginMouse = null;
  dragOriginWin = null;
});


// ============================================================
// TEST STT FROM ELECTRON
// ============================================================

ipcMain.on('rumi:test-listen', () => {
  console.log('Manual listen triggered (F8)');
  enterConversationMode();
});


// ============================================================
// APP READY
// ============================================================

app.whenReady().then(() => {
  createWindow();

  startSTT();

  startWakeDetector();

  startTTS();
});


// ============================================================
// PROCESS CLEANUP
// ============================================================

function stopProcess(childProcess, name) {
  if (!childProcess) {
    return;
  }

  try {
    if (
      childProcess.stdin &&
      !childProcess.stdin.destroyed &&
      childProcess.stdin.writable
    ) {
      childProcess.stdin.write('__QUIT__\n');
      childProcess.stdin.end();
    }
  } catch (error) {
    console.error(`Could not send shutdown to ${name}:`, error);
  }

  const pid = childProcess.pid;

  try {
    if (!childProcess.killed) {
      childProcess.kill();
    }
  } catch (error) {
    console.error(`Could not stop ${name}:`, error);
  }

  if (process.platform === 'win32' && pid) {
    try {
      const { exec } = require('child_process');
      exec(`taskkill /F /T /PID ${pid} 2>nul`);
    } catch {}
  }
}


function cleanup() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  clearConversationTimer();

  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }

  dragOriginMouse = null;
  dragOriginWin = null;

  const oldSTT = sttProcess;
  const oldWake = wakeProcess;
  const oldTTS = ttsProcess;

  sttProcess = null;
  wakeProcess = null;
  ttsProcess = null;

  stopProcess(oldSTT, 'STT');
  stopProcess(oldWake, 'wake detector');
  stopProcess(oldTTS, 'Chatterbox TTS');
}


app.on('before-quit', cleanup);

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});