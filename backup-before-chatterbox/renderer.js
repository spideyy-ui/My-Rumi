import * as THREE from './node_modules/three/build/three.module.js';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');

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

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(2, 4, 3);
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 1.2);
fill.position.set(-3, 2, 1);
scene.add(fill);


// ===============================
// RUMI MODEL
// ===============================

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


    // ===============================
    // CENTER AND FIT MODEL
    // ===============================

    const box =
      new THREE.Box3().setFromObject(model);

    const center =
      box.getCenter(new THREE.Vector3());

    const size =
      box.getSize(new THREE.Vector3());


    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;


    const maxDim =
      Math.max(
        size.x,
        size.y,
        size.z
      );


    const distance =
      maxDim /
      (
        2 *
        Math.tan(
          THREE.MathUtils.degToRad(
            camera.fov / 2
          )
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


    // ===============================
    // NOESIS ANIMATION
    // ===============================

    if (gltf.animations.length) {

      mixer =
        new THREE.AnimationMixer(
          model
        );


      action =
        mixer.clipAction(
          gltf.animations[0]
        );


      action.setLoop(
        THREE.LoopOnce,
        1
      );


      action.clampWhenFinished =
        true;


      // Starting frame = 0
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
            (
              progress.loaded /
              progress.total
            ) * 100
          )
        }%`;

    } else {

      loading.textContent =
        'Loading Rumi...';
    }
  },


  (error) => {

    console.error(
      'Rumi GLB load error:',
      error
    );

    loading.textContent =
      'Rumi failed to load — check DevTools';
  }
);


// ===============================
// ANIMATION LOOP
// ===============================

function animate() {

  requestAnimationFrame(
    animate
  );

  const dt =
    clock.getDelta();


  if (mixer) {
    mixer.update(dt);
  }


  renderer.render(
    scene,
    camera
  );
}


// ===============================
// WINDOW RESIZE
// ===============================

window.addEventListener(
  'resize',
  () => {

    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );
  }
);


animate();


// ===============================
// DESKTOP INTERACTION
// ===============================

const raycaster =
  new THREE.Raycaster();

const mouseNDC =
  new THREE.Vector2();

let isHoveringRumi = false;
let isDragging = false;
let activeDragPointerId = null;


// ===============================
// DOUBLE TAP / DRAG
// ===============================

let lastTapTime = 0;

let lastTapPos = {
  x: 0,
  y: 0
};

const DOUBLE_TAP_THRESHOLD_MS = 500;
const DOUBLE_TAP_DISTANCE_PX = 30;


// ===============================
// RAYCAST RUMI
// ===============================

function checkRumiIntersection(
  clientX,
  clientY
) {

  if (!model) {
    return false;
  }


  mouseNDC.x =
    (
      clientX /
      window.innerWidth
    ) * 2 - 1;


  mouseNDC.y =
    -(
      clientY /
      window.innerHeight
    ) * 2 + 1;


  raycaster.setFromCamera(
    mouseNDC,
    camera
  );


  const hits =
    raycaster.intersectObject(
      model,
      true
    );


  return hits.length > 0;
}


// ===============================
// CLICK THROUGH
// ===============================

function updateClickThrough(
  clientX,
  clientY
) {

  if (isDragging) {
    return;
  }


  const hit =
    checkRumiIntersection(
      clientX,
      clientY
    );


  if (
    hit !==
    isHoveringRumi
  ) {

    isHoveringRumi =
      hit;


    if (window.rumiDesktop) {

      if (isHoveringRumi) {

        window.rumiDesktop
          .setIgnoreMouseEvents(
            false
          );

      } else {

        window.rumiDesktop
          .setIgnoreMouseEvents(
            true,
            {
              forward: true
            }
          );
      }
    }
  }
}


// ===============================
// POINTER MOVE
// ===============================

window.addEventListener(
  'pointermove',
  (e) => {

    if (isDragging) {

      if (window.rumiDesktop) {

        window.rumiDesktop
          .dragMove();
      }

      return;
    }


    updateClickThrough(
      e.clientX,
      e.clientY
    );
  },
  {
    passive: true
  }
);


// ===============================
// POINTER DOWN
// ===============================

window.addEventListener(
  'pointerdown',
  (e) => {

    if (e.button !== 0) {
      return;
    }


    const hit =
      checkRumiIntersection(
        e.clientX,
        e.clientY
      );


    if (!hit) {

      lastTapTime = 0;

      return;
    }


    const now =
      performance.now();


    const timeDiff =
      now -
      lastTapTime;


    const dist =
      Math.hypot(
        e.clientX -
        lastTapPos.x,

        e.clientY -
        lastTapPos.y
      );


    if (
      timeDiff > 0 &&
      timeDiff <=
        DOUBLE_TAP_THRESHOLD_MS &&
      dist <=
        DOUBLE_TAP_DISTANCE_PX
    ) {

      isDragging = true;

      activeDragPointerId =
        e.pointerId;

      lastTapTime = 0;


      if (window.rumiDesktop) {

        window.rumiDesktop
          .setIgnoreMouseEvents(
            false
          );


        window.rumiDesktop
          .startDrag();
      }

    } else {

      lastTapTime = now;


      lastTapPos = {
        x: e.clientX,
        y: e.clientY
      };
    }
  }
);


// ===============================
// STOP DRAG
// ===============================

function stopDrag(e) {

  if (!isDragging) {
    return;
  }


  if (
    e &&
    e.pointerId !== undefined &&
    activeDragPointerId !== null &&
    e.pointerId !==
      activeDragPointerId
  ) {

    return;
  }


  isDragging = false;

  activeDragPointerId = null;


  if (window.rumiDesktop) {

    window.rumiDesktop
      .endDrag();
  }


  if (
    e &&
    typeof e.clientX === 'number'
  ) {

    updateClickThrough(
      e.clientX,
      e.clientY
    );

  } else {

    isHoveringRumi = false;


    if (window.rumiDesktop) {

      window.rumiDesktop
        .setIgnoreMouseEvents(
          true,
          {
            forward: true
          }
        );
    }
  }
}


window.addEventListener(
  'pointerup',
  stopDrag
);

window.addEventListener(
  'pointercancel',
  stopDrag
);

window.addEventListener(
  'mouseup',
  stopDrag
);

window.addEventListener(
  'blur',
  stopDrag
);


// ===============================
// MOUSE LEAVE
// ===============================

document.addEventListener(
  'mouseleave',
  () => {

    if (!isDragging) {

      isHoveringRumi = false;


      if (window.rumiDesktop) {

        window.rumiDesktop
          .setIgnoreMouseEvents(
            true,
            {
              forward: true
            }
          );
      }
    }
  }
);


// ===============================
// F8 TEST LISTEN
// ===============================

document.addEventListener(
  'keydown',
  (event) => {

    if (event.key === 'F8') {

      console.log(
        'Starting Rumi listening...'
      );


      if (window.rumiDesktop) {

        window.rumiDesktop
          .testListen();
      }
    }
  }
);


// ===============================
// RECEIVE TRANSCRIPT
// ===============================

if (window.rumiDesktop) {

  window.rumiDesktop
    .onTranscript(
      (text) => {

        console.log(
          'Rumi heard:',
          text
        );
      }
    );


  // ===============================
  // WAKE DETECTED
  // ===============================

  window.rumiDesktop
    .onWakeDetected(
      () => {

        console.log(
          'Rumi wake detected.'
        );
      }
    );


  // ===============================
  // CONVERSATION STARTED
  // ===============================

  window.rumiDesktop
    .onConversationStarted(
      () => {

        console.log(
          'Conversation Mode ON'
        );
      }
    );


  // ===============================
  // CONVERSATION ENDED
  // ===============================

  window.rumiDesktop
    .onConversationEnded(
      () => {

        console.log(
          'Conversation Mode OFF'
        );

        // Stop any speech immediately
        // when conversation ends.
        if (
          'speechSynthesis' in window
        ) {

          speechSynthesis.cancel();
        }
      }
    );


  // ===============================
  // RECEIVE LLAMA RESPONSE
  // ===============================

  window.rumiDesktop
    .onAIResponse(
      (response) => {

        console.log(
          'Rumi says:',
          response
        );


        // ===============================
        // TTS
        // ===============================

        if (
          !('speechSynthesis' in window)
        ) {

          console.warn(
            'Browser speech synthesis is unavailable.'
          );

          // Fallback so conversation
          // does not get stuck.
          window.rumiDesktop
            .ttsFinished();

          return;
        }


        speechSynthesis.cancel();


        const utterance =
          new SpeechSynthesisUtterance(
            response
          );


        utterance.lang =
          'en-US';


        utterance.rate =
          1.0;


        utterance.pitch =
          1.0;


        utterance.volume =
          1.0;


        utterance.onstart = () => {

          console.log(
            'Rumi TTS started.'
          );
        };


        utterance.onend = () => {

          console.log(
            'Rumi TTS finished.'
          );


          // ONLY NOW does main.cjs
          // start the 15-second timer.
          window.rumiDesktop
            .ttsFinished();
        };


        utterance.onerror = (error) => {

          console.error(
            'TTS error:',
            error
          );


          // Don't leave conversation
          // stuck if TTS fails.
          window.rumiDesktop
            .ttsFinished();
        };


        speechSynthesis.speak(
          utterance
        );
      }
    );
}