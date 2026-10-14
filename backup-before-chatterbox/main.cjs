const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let win = null;
let sttProcess = null;
let wakeProcess = null;

let conversationMode = false;
let conversationTimer = null;
let sttListening = false;

const CONVERSATION_TIMEOUT = 15000;

let dragOriginMouse = null;
let dragOriginWin = null;
let dragInterval = null;


// ===============================
// CONVERSATION TIMER
// ===============================

function clearConversationTimer() {
  if (conversationTimer) {
    clearTimeout(conversationTimer);
    conversationTimer = null;
  }
}


function startConversationTimer() {
  clearConversationTimer();

  if (!conversationMode) return;

  console.log('Conversation idle timer started: 15 seconds');

  conversationTimer = setTimeout(() => {

    console.log(
      '15 seconds of inactivity. Leaving conversation mode.'
    );

    conversationTimer = null;
    conversationMode = false;
    sttListening = false;

    if (win && !win.isDestroyed()) {
      win.webContents.send('rumi:conversation-ended');
    }

    startWakeDetector();

  }, CONVERSATION_TIMEOUT);
}


// ===============================
// ENTER CONVERSATION MODE
// ===============================

function enterConversationMode() {

  if (conversationMode) return;

  conversationMode = true;

  clearConversationTimer();

  console.log('Conversation Mode ON');

  if (win && !win.isDestroyed()) {
    win.webContents.send('rumi:conversation-started');
  }

  stopWakeDetector();

  listenToRumi();
}


// ===============================
// EXIT CONVERSATION MODE
// ===============================

function exitConversationMode() {

  conversationMode = false;

  clearConversationTimer();

  sttListening = false;

  if (win && !win.isDestroyed()) {
    win.webContents.send('rumi:conversation-ended');
  }

  startWakeDetector();
}


// ===============================
// ASK LLAMA
// ===============================

async function askLlama(text) {

  try {

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

    const data = await response.json();

    const reply =
      data.response?.trim() || '';

    console.log('Rumi AI:', reply);

    if (win && !win.isDestroyed()) {

      win.webContents.send(
        'rumi:ai-response',
        reply
      );
    }

  } catch (error) {

    console.error(
      'Llama error:',
      error
    );

    if (conversationMode) {
      startConversationTimer();
    }
  }
}


// ===============================
// START STT PYTHON SERVICE
// ===============================

function startSTT() {

  console.log('Starting Rumi STT...');

  sttProcess = spawn(
    'py',
    [
      '-3.13',
      path.join(
        __dirname,
        'stt_service.py'
      )
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


  let stdoutBuffer = '';


  sttProcess.stdout.on(
    'data',
    async (data) => {

      stdoutBuffer +=
        data.toString();

      const lines =
        stdoutBuffer.split(/\r?\n/);

      stdoutBuffer =
        lines.pop() || '';


      for (const line of lines) {

        const text =
          line.trim();

        if (!text) continue;


        console.log(
          'Rumi STT:',
          text
        );


        sttListening = false;


        // Any real user speech cancels
        // the previous idle timer.
        clearConversationTimer();


        if (
          win &&
          !win.isDestroyed()
        ) {

          win.webContents.send(
            'rumi:transcript',
            text
          );
        }


        // Send STT text to Llama
        await askLlama(text);

      }

    }
  );


  sttProcess.stderr.on(
    'data',
    (data) => {

      const message =
        data.toString().trim();

      if (message) {

        console.log(
          'STT:',
          message
        );
      }
    }
  );


  sttProcess.on(
    'error',
    (error) => {

      console.error(
        'Failed to start STT:',
        error
      );
    }
  );


  sttProcess.on(
    'close',
    (code) => {

      console.log(
        'STT process closed:',
        code
      );

      sttProcess = null;
      sttListening = false;
    }
  );
}


// ===============================
// ASK STT TO LISTEN
// ===============================

function listenToRumi() {

  if (
    !sttProcess ||
    sttProcess.killed
  ) {

    console.log(
      'STT is not running.'
    );

    return;
  }


  if (sttListening) {
    return;
  }


  console.log(
    'Sending listen command to STT...'
  );

  sttListening = true;

  sttProcess.stdin.write(
    'listen\n'
  );
}


// ===============================
// START RUMI WAKE DETECTOR
// ===============================

function startWakeDetector() {

  if (wakeProcess) {
    return;
  }

  console.log(
    'Starting Rumi wake detector...'
  );


  wakeProcess = spawn(
    'py',
    [
      '-3.13',
      '-u',
      path.join(
        __dirname,
        'wake_test.py'
      )
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


  let stdoutBuffer = '';


  wakeProcess.stdout.on(
    'data',
    (data) => {

      stdoutBuffer +=
        data.toString();

      const lines =
        stdoutBuffer.split(/\r?\n/);

      stdoutBuffer =
        lines.pop() || '';


      for (const line of lines) {

        const message =
          line.trim();

        if (!message) continue;


        console.log(
          'WAKE:',
          message
        );


        if (
          message.startsWith(
            'RUMI_WAKE'
          )
        ) {

          if (conversationMode) {
            continue;
          }


          console.log(
            'Rumi detected!'
          );


          if (
            win &&
            !win.isDestroyed()
          ) {

            win.webContents.send(
              'rumi:wake-detected'
            );
          }


          enterConversationMode();
        }
      }
    }
  );


  wakeProcess.stderr.on(
    'data',
    (data) => {

      const message =
        data.toString().trim();

      if (message) {

        console.log(
          'Wake detector:',
          message
        );
      }
    }
  );


  wakeProcess.on(
    'error',
    (error) => {

      console.error(
        'Failed to start wake detector:',
        error
      );

      wakeProcess = null;
    }
  );


  wakeProcess.on(
    'close',
    (code) => {

      console.log(
        'Wake detector closed:',
        code
      );

      wakeProcess = null;
    }
  );
}


// ===============================
// STOP RUMI WAKE DETECTOR
// ===============================

function stopWakeDetector() {

  if (
    wakeProcess &&
    !wakeProcess.killed
  ) {

    console.log(
      'Stopping Rumi wake detector...'
    );

    wakeProcess.kill();

    wakeProcess = null;
  }
}


// ===============================
// TTS FINISHED
// ===============================

ipcMain.on(
  'rumi:tts-finished',
  () => {

    console.log(
      'TTS finished.'
    );


    if (!conversationMode) {
      return;
    }


    // TTS completion is the latest
    // completed activity.
    startConversationTimer();


    // Listen for the next user sentence.
    listenToRumi();
  }
);


// ===============================
// CREATE RUMI WINDOW
// ===============================

function createWindow() {

  const display =
    screen.getPrimaryDisplay();

  const {
    width,
    height
  } = display.workAreaSize;


  win = new BrowserWindow({

    width: 500,
    height: 700,

    x: Math.max(
      0,
      width - 540
    ),

    y: Math.max(
      0,
      height - 740
    ),

    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,

    webPreferences: {

      preload:
        path.join(
          __dirname,
          'preload.cjs'
        ),

      contextIsolation: true,
      nodeIntegration: false
    }
  });


  win.setMenuBarVisibility(
    false
  );


  win.setIgnoreMouseEvents(
    true,
    {
      forward: true
    }
  );


  win.loadFile(
    path.join(
      __dirname,
      'index.html'
    )
  );
}


// ===============================
// MOUSE CLICK-THROUGH CONTROL
// ===============================

ipcMain.on(
  'rumi:set-ignore-mouse-events',
  (
    event,
    ignore,
    options
  ) => {

    if (
      win &&
      !win.isDestroyed()
    ) {

      win.setIgnoreMouseEvents(
        ignore,
        options
      );
    }
  }
);


// ===============================
// DRAG START
// ===============================

ipcMain.on(
  'rumi:drag-start',
  () => {

    if (
      !win ||
      win.isDestroyed()
    ) {
      return;
    }


    const cursor =
      screen.getCursorScreenPoint();

    const bounds =
      win.getBounds();


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

      clearInterval(
        dragInterval
      );
    }


    dragInterval =
      setInterval(
        () => {

          if (
            !win ||
            win.isDestroyed() ||
            !dragOriginMouse ||
            !dragOriginWin
          ) {

            if (dragInterval) {

              clearInterval(
                dragInterval
              );

              dragInterval = null;
            }

            return;
          }


          const currentCursor =
            screen.getCursorScreenPoint();


          const deltaX =
            currentCursor.x -
            dragOriginMouse.x;


          const deltaY =
            currentCursor.y -
            dragOriginMouse.y;


          win.setBounds({

            x: Math.round(
              dragOriginWin.x +
              deltaX
            ),

            y: Math.round(
              dragOriginWin.y +
              deltaY
            ),

            width:
              dragOriginWin.width,

            height:
              dragOriginWin.height
          });

        },
        12
      );
  }
);


// ===============================
// DRAG MOVE
// ===============================

ipcMain.on(
  'rumi:drag-move',
  () => {

    if (
      !win ||
      win.isDestroyed() ||
      !dragOriginMouse ||
      !dragOriginWin
    ) {
      return;
    }


    const cursor =
      screen.getCursorScreenPoint();


    const deltaX =
      cursor.x -
      dragOriginMouse.x;


    const deltaY =
      cursor.y -
      dragOriginMouse.y;


    win.setBounds({

      x: Math.round(
        dragOriginWin.x +
        deltaX
      ),

      y: Math.round(
        dragOriginWin.y +
        deltaY
      ),

      width:
        dragOriginWin.width,

      height:
        dragOriginWin.height
    });
  }
);


// ===============================
// DRAG END
// ===============================

ipcMain.on(
  'rumi:drag-end',
  () => {

    if (dragInterval) {

      clearInterval(
        dragInterval
      );

      dragInterval = null;
    }


    dragOriginMouse = null;
    dragOriginWin = null;
  }
);


// ===============================
// TEST STT FROM ELECTRON
// ===============================

ipcMain.on(
  'rumi:test-listen',
  () => {

    listenToRumi();
  }
);


// ===============================
// APP READY
// ===============================

app.whenReady().then(
  () => {

    createWindow();

    startSTT();

    startWakeDetector();
  }
);


// ===============================
// CLEANUP
// ===============================

app.on(
  'window-all-closed',
  () => {

    clearConversationTimer();

    if (
      sttProcess &&
      !sttProcess.killed
    ) {

      sttProcess.kill();
      sttProcess = null;
    }


    if (
      wakeProcess &&
      !wakeProcess.killed
    ) {

      wakeProcess.kill();
      wakeProcess = null;
    }


    app.quit();
  }
);