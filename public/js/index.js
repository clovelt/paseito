/*
 *
 * This file is the main controller, orchestrating the scene, peers, and UI.
 *
 */

import * as THREE from "three";
import { Communications } from "./communications.js";
import { FirstPersonControls } from "./libs/firstPersonControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

// Import new modules
import { initWorld, camera, renderer, composer, scene, setQuality, updateSkybox } from "./world.js";
import {
    peers, addPeer, removePeer, updatePeerPositions, interpolatePositions, updatePeerVolumes, setAudioContext,
    createPeerDOMElements, updatePeerDOMElements, cleanupPeerDomElements
} from "./peers.js";


let controls;
let communications;
let currentMapModel = null;
let fallbackMapUrl = '';
let currentMapUrl = '';
let worldMapData = {};
let gltfLoader; // Will be initialized once
let audioContext;
let reverbBuffer;
let ambientAudio;
let isAudioUnlocked = false;

let worldState = {
    voiceDistanceMultiplier: 1.0,
    playerScale: 1.0,
    fallbackAmbientTrack: ''
};

let isHighQuality = true;
const COLLISION_LAYER = 3;
let frameCount = 0;
let signs = [];

// --- UI Elements ---
const userListContainer = document.getElementById('user-list-container');
const qualityButton = document.getElementById('quality-button');
const runButton = document.getElementById('run-button');
const micButton = document.getElementById('mic-button');
const cameraButton = document.getElementById('camera-button');
const selfieButton = document.getElementById('selfie-button');
const uploadSelfieButton = document.getElementById('upload-selfie-button');
const addSignButton = document.getElementById('add-sign-button');
const photoButton = document.getElementById('photo-button');
const settingsButton = document.getElementById('settings-button');
const settingsMenu = document.getElementById('settings-menu-container');
const flyButton = document.getElementById('fly-button');
const adminMenuButton = document.getElementById('admin-menu-button');
const adminPanel = document.getElementById('admin-panel');
const adminDeleteAllButton = document.getElementById('admin-delete-all');
const adminBroadcastButton = document.getElementById('admin-broadcast-message');
const adminTeleportButton = document.getElementById('admin-teleport-all');
const adminChangeMapButton = document.getElementById('admin-change-map');
const mapSelectorContainer = document.getElementById('map-selector-container');
const mapSelect = document.getElementById('map-select');
const voiceSlider = document.getElementById('voice-slider');
const sizeSlider = document.getElementById('size-slider');
const speedSlider = document.getElementById('speed-slider');
const accelSlider = document.getElementById('accel-slider');


function onNewSign(msg) {
  const POST_HEIGHT = 4;
  const POST_RADIUS = 0.1;
  const BOARD_WIDTH = 3;
  const BOARD_HEIGHT = 2;
  const BOARD_DEPTH = 0.2;

  const postGeometry = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, POST_HEIGHT);
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
  const post = new THREE.Mesh(postGeometry, postMaterial);
  post.position.y = POST_HEIGHT / 2;
  post.castShadow = true;
  post.receiveShadow = true;

  const boardGeometry = new THREE.BoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, BOARD_DEPTH);
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xdeb887 });
  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  board.position.y = POST_HEIGHT;
  board.castShadow = true;
  board.receiveShadow = true;
  
  const canvas = document.createElement('canvas');
  const canvasSize = 256;
  canvas.width = canvasSize * (BOARD_WIDTH / BOARD_HEIGHT);
  canvas.height = canvasSize;
  const context = canvas.getContext('2d');
  context.fillStyle = '#000000';
  context.font = '24px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  
  const words = msg.data.text.split(' ');
  let line = '';
  let lines = [];
  const maxWidth = canvas.width - 20;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = context.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  
  const lineHeight = 28;
  const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;
  for(let i = 0; i < lines.length; i++) {
    context.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const textMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const textGeometry = new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT);
  const textPlane = new THREE.Mesh(textGeometry, textMaterial);
  textPlane.position.y = POST_HEIGHT;
  textPlane.position.z = BOARD_DEPTH / 2 + 0.01;

  const sign = new THREE.Group();
  sign.add(post);
  sign.add(board);
  sign.add(textPlane);

  sign.position.fromArray(msg.data.position);
  sign.quaternion.fromArray(msg.data.rotation);
  
  scene.add(sign);
  signs.push(sign);
}

function clearAllSigns() {
    for (const sign of signs) {
        scene.remove(sign);
    }
    signs.length = 0;
}


function addUserToList(id, name, isLocal = false) {
    const userItem = document.createElement('div');
    userItem.id = 'useritem-' + id;
    userItem.className = 'user-list-item';
    let displayName = name ? name : id.substring(0, 6);

    if (isLocal) {
        const localVideo = document.getElementById('local_video');
        if (localVideo) userItem.appendChild(localVideo);
    }

    userItem.innerHTML += `<i class="fa-solid fa-headset"></i> ${displayName}`;
    userListContainer.appendChild(userItem);
}



function removeUserFromList(id) {
    const userItem = document.getElementById('useritem-' + id);
    if (userItem) { userItem.remove(); }
}


function placePlayerAt(positionVec3) {
    const raycaster = new THREE.Raycaster();
    const rayOrigin = new THREE.Vector3(positionVec3.x, 3000, positionVec3.z); // Start high up
    raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    raycaster.layers.set(COLLISION_LAYER);

    const intersects = raycaster.intersectObject(scene, true);

    if (intersects.length > 0 && intersects[0].point.y > -500) {
        const groundPoint = intersects[0].point;
        camera.position.set(groundPoint.x, groundPoint.y + controls.cameraHeight, groundPoint.z);
        console.log("Player raycast hit ground at:", groundPoint);
    } else {
        camera.position.copy(positionVec3);
        console.warn("Player raycast missed. Placing player at default height.");
    }
    controls.camera.position.copy(camera.position); // Sync controls camera
    controls.velocity.y = 0;
}

function playAmbientTrack() {
    console.log(`[AUDIO] Attempting to play ambient track. Audio Unlocked: ${isAudioUnlocked}, Current Map URL: ${currentMapUrl}`);
    if (!isAudioUnlocked || !currentMapUrl || !Object.keys(worldMapData).length) {
        console.log("[AUDIO] Conditions not met. Aborting playback for now.");
        return;
    }

    const mapEntry = Object.values(worldMapData).find(m => m.url === currentMapUrl);
    const trackUrl = mapEntry?.ambientTrack || worldState.fallbackAmbientTrack;
    
    if (trackUrl) {
        const absoluteUrl = new URL(trackUrl, window.location.href).href;
        if (ambientAudio.src === absoluteUrl && !ambientAudio.paused) {
            console.log("[AUDIO] Track is already playing.");
            return; 
        }
        console.log(`[AUDIO] Setting audio source to: ${trackUrl}`);
        ambientAudio.src = trackUrl;
    }
}

function loadMap(mapUrl, fallbackUrl) {
    if (currentMapModel) {
        scene.remove(currentMapModel);
        currentMapModel = null;
    }
    currentMapUrl = mapUrl; // Store the current map URL reliably

    const onModelLoaded = (gltf) => {
        const model = gltf.scene;
        // No need for userData.url, we will use currentMapUrl

        let mapData;
        let mapName;
        for (const name in worldMapData) {
            if (worldMapData[name].url === mapUrl) {
                mapData = worldMapData[name];
                mapName = name;
                break;
            }
        }

        if (mapData) {
            controls.setMapStartPosition(mapData.startPosition);
            updateSkybox(mapData.skyColors);
        }
        
        switch(mapName) {
            case "Resort":
                model.scale.set(0.3, 0.3, 0.3);
                break;
            case "De_Dust2":
                model.scale.set(0.2, 0.2, 0.2);
                break;
            case "Wind Waker":
                model.scale.set(0.1, 0.1, 0.1);
                break;
            case "Shinobi Earth":
                model.scale.set(2.7, 2.7, 2.7);
                break;
            case "The Catacombs":
                model.scale.set(5.7, 5.7, 5.7);
                break;
            case "Hyrule Field":
                model.scale.set(0.14, 0.14, 0.14);
                break;
            case "Rainbow Road":
                model.scale.set(20, 20, 20);
                break;
            default:
                model.scale.set(1, 1, 1);
        }

        scene.add(model);
        currentMapModel = model;

        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
                node.layers.set(COLLISION_LAYER);
            }
        });
        
        if (mapData) {
            requestAnimationFrame(() => {
                placePlayerAt(new THREE.Vector3().fromArray(mapData.startPosition));
            });
        }

        // This is a reliable place to trigger the audio logic.
        playAmbientTrack(); // Attempt to play audio now that model is loaded
    };

    gltfLoader.load(
        mapUrl,
        onModelLoaded,
        undefined,
        (error) => {
            console.error(`An error happened loading model: ${mapUrl}`, error);
            if (fallbackUrl) {
                console.log('Attempting to load fallback model...');
                gltfLoader.load(fallbackUrl, onModelLoaded, undefined, (fallbackError) => {
                    console.error('The fallback model also failed to load:', fallbackError);
                });
            }
        }
    );
}

function applyQualitySettings(isHigh) {
    setQuality(isHigh); // This handles post-processing

    if (isHigh) {
        camera.far = 10000;
        renderer.setPixelRatio(window.devicePixelRatio);
    } else {
        camera.far = 1500; // Reduce render distance
        renderer.setPixelRatio(window.devicePixelRatio * 0.75); // Render at lower resolution
    }
    camera.updateProjectionMatrix();
    qualityButton.classList.toggle('active', isHigh);
}

function applySettings(state) {
    if (!state) return;
    
    if (state.voiceDistanceMultiplier) updateSetting('voiceDistanceMultiplier', state.voiceDistanceMultiplier, true);
    if (state.playerScale) updateSetting('playerScale', state.playerScale, true);
    if (state.maxSpeed) updateSetting('maxSpeed', state.maxSpeed, true);
    if (state.acceleration) updateSetting('acceleration', state.acceleration, true);
}


async function init() {
  initWorld();
  

  // Create AudioContext on first user interaction (important for browser policy)
  const startAudio = async () => {
      if (audioContext) return;
      document.body.removeEventListener('pointerdown', startAudio);

      try {
          console.log("[AUDIO] User interaction detected. Initializing AudioContext.");
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          setAudioContext(audioContext); // Pass context to peers module

          // Isolate reverb loading so it doesn't block ambient audio
          try {
            const response = await fetch('https://gustavochico.com/paseito/reverb_impulse.mp3');
            const arrayBuffer = await response.arrayBuffer();
            reverbBuffer = await audioContext.decodeAudioData(arrayBuffer);
            console.log("[AUDIO] Reverb impulse response loaded successfully.");
          } catch (reverbError) {
            console.error("[AUDIO] Failed to load reverb, but continuing with other audio.", reverbError);
          }
          
          ambientAudio = new Audio();
          ambientAudio.loop = true;
          ambientAudio.volume = 0.25;
          document.body.appendChild(ambientAudio);
          console.log("[AUDIO] Ambient audio element created.");

          ambientAudio.addEventListener('loadeddata', () => {
            console.log("[AUDIO] 'loadeddata' event fired. Attempting to play.");
            const playPromise = ambientAudio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.error("[AUDIO] Playback failed in 'loadeddata' listener:", e));
            }
          });

          isAudioUnlocked = true;
          console.log("[AUDIO] Audio is now unlocked.");

          // Now that audio is unlocked, try to play the track immediately.
          playAmbientTrack();
      } catch (e) {
          console.error("[AUDIO] CRITICAL: Failed to initialize audio context or load reverb:", e);
      }
  };
  document.body.addEventListener('pointerdown', startAudio, { once: true });
  
  const loadingManager = new THREE.LoadingManager();
  const dracoLoader = new DRACOLoader(loadingManager);
  dracoLoader.setDecoderPath('js/libs/draco/');
  
  const ktx2Loader = new KTX2Loader(loadingManager)
      .setTranscoderPath('js/libs/basis/')
      .detectSupport(renderer);

  gltfLoader = new GLTFLoader(loadingManager);
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setKTX2Loader(ktx2Loader);

  controls = new FirstPersonControls(scene, camera, renderer);
  
  communications = new Communications();
  await communications.initialize();

  // --- Communication Event Listeners ---
  communications.on("introduction", ({ peers: initialPeers, state }) => {
      console.log("Received introduction:", state);
      worldMapData = state.availableMaps;
      fallbackMapUrl = state.fallbackMap;
      currentMapUrl = state.currentMapUrl;
      worldState.fallbackAmbientTrack = state.fallbackAmbientTrack;
      loadMap(state.currentMapUrl, fallbackMapUrl);
      applySettings(state);

      mapSelectorContainer.style.display = 'block';
      for (const name in state.availableMaps) {
          const option = new Option(name, state.availableMaps[name].url);
          mapSelect.add(option);
      }
      mapSelect.value = state.currentMapUrl;

      for (let id in initialPeers) {
          if (id !== communications.socket.id) {
              createPeerDOMElements(id);
              addPeer(id, initialPeers[id], state.playerScale);
              addUserToList(id, initialPeers[id].name);
          }
      }
  });
  
  communications.on("peerStream", (data) => {
    createPeerDOMElements(data.id, audioContext, reverbBuffer);
    updatePeerDOMElements(data);
  });

  communications.on("peerJoined", ({id, peerData}) => { 
      createPeerDOMElements(id);
      addPeer(id, peerData, worldState.playerScale);
      addUserToList(id, peerData.name); 
  });
  
  communications.on("peerLeft", (id) => { 
      removePeer(id); 
      removeUserFromList(id);
      cleanupPeerDomElements(id);
  });
  
  communications.on("positions", updatePeerPositions);
  communications.on("data", (msg) => {
    if (msg.type == "sign") onNewSign(msg);
  });
  communications.on("clearAllObjects", clearAllSigns);
  communications.on("serverMessage", (message) => { alert(message); });

  communications.socket.on("changeMap", (mapUrl) => loadMap(mapUrl, fallbackMapUrl));
  communications.socket.on("updateSetting", ({ key, value }) => updateSetting(key, value));

  
  // --- UI Event Listeners ---
  qualityButton.addEventListener('click', () => {
      isHighQuality = !isHighQuality;
      applyQualitySettings(isHighQuality);
  });
  micButton.addEventListener('click', () => {
      const isEnabled = communications.toggleMic();
      micButton.classList.toggle('active', isEnabled);
      micButton.innerHTML = isEnabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
  });
  cameraButton.addEventListener('click', () => {
      const videoTrack = communications.localMediaStream?.getVideoTracks()[0];
      // If the track is from a canvas (selfie image), re-acquire the camera.
      if (videoTrack && videoTrack.label === 'canvas') {
          communications.getLocalMedia().then(newStream => {
              const newVideoTrack = newStream.getVideoTracks()[0];
              communications.replaceLocalVideoTrack(newVideoTrack);
              cameraButton.classList.add('active');
          });
      } else {
          const isEnabled = communications.toggleCamera();
          cameraButton.classList.toggle('active', isEnabled);
      }
  });
  runButton.addEventListener('click', () => {
    controls.toggleRun();
  });

  selfieButton.addEventListener('click', () => {
      const localVideo = document.getElementById('local_video');
      const videoTrack = communications.localMediaStream?.getVideoTracks()[0];

      // If the current track is from a canvas OR the camera is off, first enable the camera.
      if (!videoTrack || !videoTrack.enabled || videoTrack.label.toLowerCase().includes('canvas')) {
          console.log("Selfie button: Camera not ready, activating it first.");
          // This simulates a click on the camera button to restore the webcam view.
          cameraButton.click(); 
          return;
      }

      // If we reach here, the webcam is active and ready for a snapshot.
      console.log("Selfie button: Taking snapshot from webcam.");

      const canvas = document.createElement('canvas');
      canvas.width = 128; // Match the resolution of uploaded selfies
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      
      // Draw the current video frame to the canvas
      ctx.drawImage(localVideo, 0, 0, canvas.width, canvas.height);

      const newStream = canvas.captureStream(10);
      communications.replaceLocalVideoTrack(newStream.getVideoTracks()[0]).then(() => {
          console.log("Selfie snapshot successfully applied.");
      });
      cameraButton.classList.add('active'); // Ensure the button state is correct
  });

  uploadSelfieButton.addEventListener('click', () => {
      document.getElementById('selfie-upload').click();
  });
  document.getElementById('selfie-upload').addEventListener('change', handleSelfieFile);

  addSignButton.addEventListener('click', () => {
    const text = prompt("Enter sign text:", "");
    if (text && text.trim() !== "") {
      const position = new THREE.Vector3();
      const direction = new THREE.Vector3(0, 0, -1); // Forward vector

      // Get camera's forward direction, but only on the XZ plane
      direction.applyQuaternion(camera.quaternion);
      direction.y = 0; // Ignore vertical component
      position.copy(camera.position).add(direction.normalize().multiplyScalar(10));
      position.y = camera.position.y - controls.cameraHeight; // Place at player's feet

      const msg = {
        type: "sign",
        data: {
          position: position.toArray(),
          rotation: camera.quaternion.toArray(),
          text: text.trim()
        }
      };
      communications.sendData(msg);
    }
  });

  photoButton.addEventListener('click', () => {
    if (isHighQuality) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
    
    renderer.domElement.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'paseito_capture.png';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
  });

  settingsButton.addEventListener('click', () => {
    settingsMenu.classList.toggle('open');
  });
  
  flyButton.addEventListener('click', () => {
    controls.camera.position.y += 20;
    controls.velocity.y = 0;
  });

  adminMenuButton.addEventListener('click', () => {
    const password = prompt("Enter admin password:");
    if (password === "gazpacho") {
      adminPanel.style.display = 'flex';
      adminTeleportButton.textContent = "Teleport All to Me";
    } else if (password) {
      alert("Incorrect password.");
    }
  });

  adminDeleteAllButton.addEventListener('click', () => {
    if (confirm("Are you sure you want to delete ALL world objects from the server? This cannot be undone.")) {
        communications.socket.emit("admin:deleteAllObjects");
        adminPanel.style.display = 'none';
    }
  });

  adminBroadcastButton.addEventListener('click', () => {
      const message = prompt("Enter message to broadcast to all users:");
      if (message) {
          communications.socket.emit("admin:broadcastMessage", message);
          adminPanel.style.display = 'none';
      }
  });
  
  adminTeleportButton.addEventListener('click', () => {
      if(confirm("Are you sure you want to teleport all users to your current location?")) {
          communications.socket.emit("admin:teleportAllToMe");
          adminPanel.style.display = 'none';
      }
  });

  adminChangeMapButton.addEventListener('click', () => {
      const selectedMap = mapSelect.value;
      if (selectedMap && confirm(`Are you sure you want to change the map for everyone to ${mapSelect.options[mapSelect.selectedIndex].text}?`)) {
          communications.socket.emit("admin:changeMap", selectedMap);
          adminPanel.style.display = 'none';
      }
  });
  
  // Admin Sliders
  const setupSlider = (slider, key, valueLabel) => {
      slider.addEventListener('input', () => {
          valueLabel.textContent = slider.value;
          communications.socket.emit("admin:updateSetting", { key, value: slider.value });
      });
  };
  setupSlider(voiceSlider, 'voiceDistanceMultiplier', document.getElementById('voice-value'));
  setupSlider(sizeSlider, 'playerScale', document.getElementById('size-value'));
  setupSlider(speedSlider, 'maxSpeed', document.getElementById('speed-value'));
  setupSlider(accelSlider, 'acceleration', document.getElementById('accel-value'));

  function handleSelfieFile(event) {
      const file = event.target.files[0];
      console.log("Handling selfie file:", file ? file.name : "No file selected");
      if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
              const img = new Image();
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  canvas.width = 128; // Keep it small for performance
                  canvas.height = 128;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                  const newStream = canvas.captureStream(10); // 10 fps is enough for a static image
                  communications.replaceLocalVideoTrack(newStream.getVideoTracks()[0]).then(() => {
                      console.log("Uploaded selfie image successfully applied.");
                  });
                  cameraButton.classList.add('active');
              };
              img.src = e.target.result;
          };
          reader.readAsDataURL(file);
      }
      // Reset file input to allow re-uploading the same file
      event.target.value = '';
  }

  window.addEventListener('keydown', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    switch(event.key.toLowerCase()) {
        case 'q':
            isHighQuality = !isHighQuality;
            applyQualitySettings(isHighQuality);
            break;
        case 'm':
            micButton.click();
            break;
        case 'v':
            cameraButton.click();
            break;
    }
  });

  // --- Drag and Drop for Selfie Image ---
  const body = document.body;
  const dragOverlay = document.getElementById('drag-overlay');
  body.addEventListener('dragover', (event) => {
      event.preventDefault();
      dragOverlay.style.display = 'flex';
  });
  body.addEventListener('dragleave', () => {
      dragOverlay.style.display = 'none';
  });
  body.addEventListener('drop', (event) => {
      event.preventDefault();
      dragOverlay.style.display = 'none';      
      handleSelfieFile({ target: event.dataTransfer });
  });

  const userList = document.getElementById('user-list-container');
  const updateVideoPosition = () => {
    const videoPreview = document.getElementById('local_video');
    if (!videoPreview) return;

    const listRect = userList.getBoundingClientRect();
    videoPreview.style.bottom = `${window.innerHeight - listRect.top + 10}px`;
  };

  const observer = new ResizeObserver(updateVideoPosition);
  observer.observe(userList);
  
  applyQualitySettings(isHighQuality);
  updateVideoPosition();

  if ('ontouchstart' in window) {
    document.getElementById('jump-button').style.display = 'block';
  }

  update();
}

function updateSetting(key, value, isInitial = false) {
    const numericValue = parseFloat(value);
    switch(key) {
        case 'voiceDistanceMultiplier':
            worldState.voiceDistanceMultiplier = numericValue;
            if (!isInitial) voiceSlider.value = numericValue;
            document.getElementById('voice-value').textContent = numericValue;
            break;
        case 'playerScale':
            worldState.playerScale = numericValue;
            for (const id in peers) {
                if (peers[id].group) {
                    peers[id].group.scale.set(numericValue, numericValue, numericValue);
                }
            }
            controls.setCameraHeight(6.0 * numericValue);
            if (!isInitial) sizeSlider.value = numericValue;
            document.getElementById('size-value').textContent = numericValue;
            break;
        case 'maxSpeed':
            // We'll let the update loop handle this based on running state
            if (!isInitial) speedSlider.value = numericValue;
            document.getElementById('speed-value').textContent = numericValue;
            break;
        case 'acceleration':
            // Store the base acceleration, the update loop will apply it.
            if (controls) {
                controls.baseAcceleration = numericValue;
            } else {
                // controls might not be initialized yet
                setTimeout(() => updateSetting(key, value, isInitial), 100);
            }
            if (!isInitial) accelSlider.value = numericValue;
            document.getElementById('accel-value').textContent = numericValue;
            break;
    }
}


function getPlayerData() {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    rotation: [
      camera.quaternion._x,
      camera.quaternion._y,
      camera.quaternion._z,
      camera.quaternion._w,
    ],
    isShouting: communications.micVolume > 20, // Threshold for shouting
  };
}

function update() {
  requestAnimationFrame(() => update());
  frameCount++;

  if (controls) {
    runButton.classList.toggle('active', controls.isRunning);
    // Apply different acceleration and speed when running
    const currentSettings = {
        maxSpeed: parseFloat(document.getElementById('speed-slider').value),
        acceleration: controls.baseAcceleration || parseFloat(document.getElementById('accel-slider').value) // Restore baseAcceleration
    };
    if (controls.isRunning) {
        currentSettings.acceleration *= 3; // Triple acceleration when running
    }
    controls.updateMovementSettings(currentSettings);
  }

  if (frameCount % 25 === 0) updatePeerVolumes(worldState.voiceDistanceMultiplier, reverbBuffer);
  if (frameCount % 10 === 0 && communications.socket) {
    communications.sendPosition(getPlayerData());
  }
  interpolatePositions();
  controls.update();

  if (isHighQuality) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// Start the application
init();