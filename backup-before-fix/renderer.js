javascript
import * as THREE from './node_modules/three/build/three.module.js';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';

// ============================================================
// DOM
// ============================================================

const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');

// ============================================================
// THREE.JS RENDERER
// ============================================================

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  premultipliedAlpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);

camera.position.set(0, 1.25, 4.0);

// ============================================================
// LIGHTING
// ============================================================

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(2, 4, 3);
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 1.2);
fill.position.set(-3, 2, 1);
scene.add(fill);

// ============================================================
// RUMI MODEL
// ============================================================

const loader = new GLTFLoader();

let mixer = null;
let model = null;
let action = null;

const clock = new THREE.Clock();

loader.load(
  './public/models/Rumi.glb',

  (gltf) => {
    model = gltf.scene;
    scene.add(model);

    // Center and fit model.
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;

    const maxDim = Math.max(size.x, size.y, size.z);

    const distance =
      maxDim /
      (
        2 *
        Math.tan(
          THREE.MathUtils.degToRad(camera.fov / 2)
        )
      );

    camera.position.set(
      0,
      size.y * 0.52,
      distance * 1.15
    );

    camera.lookAt(
      0,
      size.y * 0.52,
      0
    );

    // Preserve the existing Noesis animation setup.
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);

      action = mixer.clipAction(gltf.animations[0]);

      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;

      action.reset();
      action.time = 0;
      action.paused = true;

      mixer.update(0);
    }

    loading.remove();
  },

  (progress) => {
    if (progress.total > 0) {
      loading.textContent =
        `Loading Rumi... ${
          Math.round(
            (progress.loaded / progress.total) * 100
          )
        }%`;
    } else {
      loading.textContent = 'Loading Rumi...';
    }
  },

  (error) => {
    console.error('Rumi GLB load error:', error);

    loading.textContent =
      'Rumi failed to load — check DevTools';
  }
);

// ============================================================
// ANIMATION LOOP
// ============================================================

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  if (mixer) {
    mixer.update(dt);
  }

  renderer.render(scene, camera);
}

animate();

// ============================================================
// WINDOW RESIZE
// ============================================================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
});

// ============================================================
// DESKTOP INTERACTION
// ============================================================

const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

let isHoveringRumi = false;
let isDragging = false;
let activeDragPointerId = null;

// ============================================================
// DOUBLE TAP / DRAG
// ============================================================

let lastTapTime = 0;

let lastTapPos = {
  x: 0,
  y: 0
};

const DOUBLE_TAP_THRESHOLD_MS = 500;
const DOUBLE_TAP_DISTANCE_PX = 30;

// ============================================================
// RAYCAST RUMI
// ============================================================

function checkRumiIntersection(clientX, clientY) {
  if (!model) {
    return false;
  }

  mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;

  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouseNDC, camera);

  const hits = raycaster.intersectObject(model, true);

  return hits.length > 0;
}

// ============================================================
// CLICK THROUGH
// ============================================================

function updateClickThrough(clientX, clientY) {
  if (isDragging) {
    return;
  }

  const hit = checkRumiIntersection(clientX, clientY);

  if (hit !== isHoveringRumi) {
    isHoveringRumi = hit;

    if (window.rumiDesktop) {
      if (isHoveringRumi) {
        window.rumiDesktop.setIgnoreMouseEvents(false);
      } else {
        window.rumiDesktop.setIgnoreMouseEvents(
          true,
          { forward: true }
        );
      }
    }
  }
}

// ============================================================
// POINTER MOVE
// ============================================================

window.addEventListener(
  'pointermove',
  (e) => {
    if (isDragging) {
      if (window.rumiDesktop) {
        window.rumiDesktop.dragMove();
      }

      return;
    }

    updateClickThrough(e.clientX, e.clientY);
  },
  { passive: true }
);

// ============================================================
// POINTER DOWN
// ============================================================

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) {
    return;
  }

  const hit = checkRumiIntersection(e.clientX, e.clientY);

  if (!hit) {
    lastTapTime = 0;
    return;
  }

  const now = performance.now();
  const timeDiff = now - lastTapTime;

  const dist = Math.hypot(
    e.clientX - lastTapPos.x,
    e.clientY - lastTapPos.y
  );

  if (
    timeDiff > 0 &&
    timeDiff <= DOUBLE_TAP_THRESHOLD_MS &&
    dist <= DOUBLE_TAP_DISTANCE_PX
  ) {
    isDragging = true;
    activeDragPointerId = e.pointerId;
    lastTapTime = 0;

    if (window.rumiDesktop) {
      window.rumiDesktop.setIgnoreMouseEvents(false);
      window.rumiDesktop.startDrag();
    }
  } else {
    lastTapTime = now;

    lastTapPos = {
      x: e.clientX,
      y: e.clientY
    };
  }
});

// ============================================================
// STOP DRAG
// ============================================================

function stopDrag(e) {
  if (!isDragging) {
    return;
  }

  if (
    e &&
    e.pointerId !== undefined &&
    activeDragPointerId !== null &&
    e.pointerId !== activeDragPointerId
  ) {
    return;
  }

  isDragging = false;
  activeDragPointerId = null;

  if (window.rumiDesktop) {
    window.rumiDesktop.endDrag();
  }

  if (e && typeof e.clientX === 'number') {
    updateClickThrough(e.clientX, e.clientY);
  } else {
    isHoveringRumi = false;

    if (window.rumiDesktop) {
      window.rumiDesktop.setIgnoreMouseEvents(
        true,
        { forward: true }
      );
    }
  }
}

window.addEventListener('pointerup', stopDrag);
window.addEventListener('pointercancel', stopDrag);
window.addEventListener('mouseup', stopDrag);
window.addEventListener('blur', stopDrag);

// ============================================================
// MOUSE LEAVE
// ============================================================

document.addEventListener('mouseleave', () => {
  if (!isDragging) {
    isHoveringRumi = false;

    if (window.rumiDesktop) {
      window.rumiDesktop.setIgnoreMouseEvents(
        true,
        { forward: true }
      );
    }
  }
});

// ============================================================
// F8 TEST LISTEN
// ============================================================

document.addEventListener('keydown', (event) => {
  if (event.key === 'F8') {
    console.log('Starting Rumi listening...');

    if (window.rumiDesktop) {
      window.rumiDesktop.testListen();
    }
  }
});

// ============================================================
// CHATTERBOX AUDIO PLAYBACK
// ============================================================

// Audio paths are only accepted from the main process through
// the restricted preload bridge. The renderer receives a path,
// not unrestricted filesystem access.

let currentAudio = null;
let playbackGeneration = 0;
let playbackFinished = true;
let conversationActive = false;

function finishPlaybackOnce(generation, failed = false) {
  if (generation !== playbackGeneration || playbackFinished) {
    return;
  }

  playbackFinished = true;

  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.onabort = null;
  }

  currentAudio = null;

  if (failed) {
    console.error('Rumi audio playback failed.');

    if (window.rumiDesktop) {
      window.rumiDesktop.ttsPlaybackError();
    }

    return;
  }

  console.log('Rumi audio playback finished.');

  if (window.rumiDesktop) {
    window.rumiDesktop.ttsFinished();
  }
}

function stopCurrentAudio() {
  // Invalidate callbacks belonging to the previous playback.
  playbackGeneration += 1;
  playbackFinished = true;

  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.onabort = null;

    currentAudio.pause();

    try {
      currentAudio.currentTime = 0;
    } catch {
      // Ignore if the audio element has not initialized.
    }

    currentAudio.removeAttribute('src');
    currentAudio.load();

    currentAudio = null;
  }
}

function playChatterboxAudio(audioPath) {
  if (typeof audioPath !== 'string' || !audioPath.trim()) {
    console.error('Received an invalid TTS audio path.');

    if (window.rumiDesktop) {
      window.rumiDesktop.ttsPlaybackError();
    }

    return;
  }

  // Stop any previous response before playing the new one.
  stopCurrentAudio();

  const generation = playbackGeneration;
  playbackFinished = false;

  // Electron's main process generated this WAV path.
  // Convert the Windows path to a file URL safely.
  const audioUrl = `file:///${audioPath
    .replace(/\\/g, '/')
    .split('/')
    .map((part, index) => {
      // Preserve the drive colon, e.g. C:
      if (index === 0 && /^[A-Za-z]:$/.test(part)) {
        return part;
      }

      return encodeURIComponent(part);
    })
    .join('/')}`;

  const audio = new Audio(audioUrl);

  currentAudio = audio;

  audio.preload = 'auto';
  audio.volume = 1;

  audio.onended = () => {
    finishPlaybackOnce(generation, false);
  };

  audio.onerror = () => {
    console.error(
      'Audio element error:',
      audio.error?.message || 'Unknown audio error'
    );

    finishPlaybackOnce(generation, true);
  };

  audio.onabort = () => {
    // Ignore deliberate cancellation; generation checks prevent
    // an old audio element from completing a newer response.
    if (generation === playbackGeneration && !playbackFinished) {
      finishPlaybackOnce(generation, true);
    }
  };

  audio.play().then(() => {
    if (generation === playbackGeneration) {
      console.log('Rumi Chatterbox audio started.');
    }
  }).catch((error) => {
    console.error('Unable to start Rumi audio:', error);

    finishPlaybackOnce(generation, true);
  });
}

// ============================================================
// RUMI IPC EVENTS
// ============================================================

if (window.rumiDesktop) {
  // Transcript received from STT.
  window.rumiDesktop.onTranscript((text) => {
    console.log('Rumi heard:', text);
  });

  // Wake detected.
  window.rumiDesktop.onWakeDetected(() => {
    console.log('Rumi wake detected.');
  });

  // Conversation started.
  window.rumiDesktop.onConversationStarted(() => {
    console.log('Conversation Mode ON');

    conversationActive = true;
  });

  // Conversation ended.
  window.rumiDesktop.onConversationEnded(() => {
    console.log('Conversation Mode OFF');

    conversationActive = false;

    // Stop playback immediately when conversation ends.
    stopCurrentAudio();
  });

  // AI response: keep logging, while main.cjs requests
  // Chatterbox generation separately.
  window.rumiDesktop.onAIResponse((response) => {
    console.log('Rumi says:', response);
  });

  // Generated WAV ready.
  window.rumiDesktop.onTTSAudio((audioPath) => {
    console.log('Received Chatterbox audio:', audioPath);

    playChatterboxAudio(audioPath);
  });

  // TTS generation failure.
  window.rumiDesktop.onTTSError(() => {
    console.error('Rumi TTS generation failed.');

    // Do not send multiple completion signals for the same
    // active playback. If no audio is playing, allow the main
    // process to continue its conversation flow.
    if (currentAudio && !playbackFinished) {
      finishPlaybackOnce(playbackGeneration, true);
    } else if (conversationActive) {
      if (window.rumiDesktop) {
        window.rumiDesktop.ttsPlaybackError();
      }
    }
  });
}

