/*
 *
 * This file sets up our web app with 3D scene and communications.
 *
 */

import * as THREE from "three";
import { Communications } from "./communications.js";
import { FirstPersonControls } from "./libs/firstPersonControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// --- MODIFIED IMPORTS ---
import { Sky } from "three/addons/objects/Sky.js"; // Use the procedural Sky object
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

let lerpValue = 0;
let camera, renderer, scene, composer;
let controls;
let listener;
let communications;
let dirLight, sky, sun, sunSphere;
let isHighQuality = true;

const COLLISION_LAYER = 3;

let frameCount = 0;
let peers = {};
let signs = [];
const userListContainer = document.getElementById('user-list-container');
const qualityButton = document.getElementById('quality-button');
const runButton = document.getElementById('run-button');
const micButton = document.getElementById('mic-button');
const cameraButton = document.getElementById('camera-button');
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

// --- SOLUTION: Moved helper functions to the module scope to fix ReferenceError ---

function addPeer(id, peerData) {
  const MII_HEAD_RADIUS = 0.6;
  const MII_BODY_HEIGHT = 1.8;
  const MII_BODY_WIDTH = 1;
  const MII_LIMB_RADIUS = 0.15;
  const MII_ARM_LENGTH = 0.8;
  const MII_LEG_LENGTH = 1.2;
  
  const videoElement = document.getElementById(id + "_video");
  const videoTexture = new THREE.VideoTexture(videoElement);
  
  const headMat = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd3a6 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x4287f5 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3d3d3d });

  const headGeo = new THREE.SphereGeometry(MII_HEAD_RADIUS, 32, 16);
  const bodyGeo = new THREE.BoxGeometry(MII_BODY_WIDTH, MII_BODY_HEIGHT, MII_BODY_WIDTH * 0.7);
  const armGeo = new THREE.CylinderGeometry(MII_LIMB_RADIUS, MII_LIMB_RADIUS, MII_ARM_LENGTH);
  const legGeo = new THREE.CylinderGeometry(MII_LIMB_RADIUS, MII_LIMB_RADIUS, MII_LEG_LENGTH);
  const handGeo = new THREE.SphereGeometry(MII_LIMB_RADIUS);
  const footGeo = new THREE.SphereGeometry(MII_LIMB_RADIUS * 1.2);

  const head = new THREE.Mesh(headGeo, headMat);
  head.rotation.y = Math.PI;

  const body = new THREE.Mesh(bodyGeo, shirtMat);
  body.position.y = -(MII_HEAD_RADIUS + MII_BODY_HEIGHT / 2);

  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(MII_BODY_WIDTH / 2 + MII_LIMB_RADIUS, MII_HEAD_RADIUS/2, 0);
  
  const armR = armL.clone();
  armR.position.x *= -1;

  const handL = new THREE.Mesh(handGeo, skinMat);
  handL.position.y = -MII_ARM_LENGTH / 2;
  armL.add(handL);

  const handR = new THREE.Mesh(handGeo, skinMat);
  handR.position.y = -MII_ARM_LENGTH / 2;
  armR.add(handR);

  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(MII_BODY_WIDTH / 4, -(MII_HEAD_RADIUS + MII_BODY_HEIGHT + MII_LEG_LENGTH / 2), 0);
  
  const legR = legL.clone();
  legR.position.x *= -1;

  const footL = new THREE.Mesh(footGeo, pantsMat);
  footL.position.y = -MII_LEG_LENGTH / 2;
  legL.add(footL);

  const footR = new THREE.Mesh(footGeo, pantsMat);
  footR.position.y = -MII_LEG_LENGTH / 2;
  legR.add(footR);

  const group = new THREE.Group();
  group.add(head, body, armL, armR, legL, legR);
  group.position.y = MII_HEAD_RADIUS + MII_BODY_HEIGHT + MII_LEG_LENGTH; // Adjust so feet are on the ground

  scene.add(group);
  peers[id] = {};
  peers[id].group = group;
  peers[id].name = peerData.name;
  peers[id].previousPosition = new THREE.Vector3();
  peers[id].previousRotation = new THREE.Quaternion();
  peers[id].desiredPosition = new THREE.Vector3();
  peers[id].desiredRotation = new THREE.Quaternion();
}

function removePeer(id) {
  if(peers[id] && peers[id].group) scene.remove(peers[id].group);
  delete peers[id];
}

function updatePeerPositions(positions) {
  lerpValue = 0;
  for (let id in positions) {
    if (peers[id]) {
      peers[id].previousPosition.copy(peers[id].group.position);
      peers[id].previousRotation.copy(peers[id].group.quaternion);
      peers[id].desiredPosition = new THREE.Vector3().fromArray(positions[id].position);
      peers[id].desiredRotation = new THREE.Quaternion().fromArray(positions[id].rotation);
    }
  }
}

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

function addUserToList(id, name) {
    const userItem = document.createElement('div');
    userItem.id = 'useritem-' + id;
    userItem.className = 'user-list-item';
    let displayName = name ? name : id.substring(0, 6);
    userItem.innerHTML = `<i class="fa-solid fa-headset"></i> ${displayName}`;
    userListContainer.appendChild(userItem);
}

function removeUserFromList(id) {
    const userItem = document.getElementById('useritem-' + id);
    if (userItem) { userItem.remove(); }
}

function init() {
  scene = new THREE.Scene();
  
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#1a94c4'); 
  gradient.addColorStop(0.7, '#2fc1fe');
  gradient.addColorStop(1, '#a0d8ef');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, 128);
  const skyTexture = new THREE.CanvasTexture(canvas);
  scene.background = skyTexture;

  scene.fog = new THREE.Fog(0xa0d8ef, 1000, 2000);

  const loadingManager = new THREE.LoadingManager();
  loadingManager.onLoad = () => { console.log("All assets loaded!"); };
  loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => { console.log(`Loading file: ${url}. \nLoaded ${itemsLoaded} of ${itemsTotal} files.`); };
  loadingManager.onError = (url) => { console.error(`There was an error loading ${url}`); };

  const loader = new GLTFLoader(loadingManager);
  loader.load(
    'https://gustavochico.com/paseito/resort.glb',
    (gltf) => {
      const model = gltf.scene;
      model.scale.set(30, 30, 30);
      
      scene.add(model);
      console.log("Model added to the scene");

      model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          node.layers.set(COLLISION_LAYER);
        }
      });
    },
    undefined,
    (error) => { console.error('An error happened while loading the model:', error); }
  );

  communications = new Communications();
  communications.on("peerJoined", (id, peerData) => { addPeer(id, peerData); addUserToList(id, peerData.name); });
  communications.on("peerLeft", (id) => { removePeer(id); removeUserFromList(id); });
  communications.on("positions", updatePeerPositions);
  communications.on("data", (msg) => {
    if (msg.type == "sign") onNewSign(msg);
  });
  communications.on("clearAllObjects", clearAllSigns);
  communications.on("serverMessage", (message) => { alert(message); });


  let width = window.innerWidth;
  let height = window.innerHeight;

  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
  camera.position.set(-100, 75, 245);
  camera.layers.enable(COLLISION_LAYER);
  scene.add(camera);

  listener = new THREE.AudioListener();
  camera.add(listener);

  renderer = new THREE.WebGLRenderer({ antialiasing: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  sky = new Sky();
  sky.scale.setScalar(450000);

  sun = new THREE.Vector3();

  const effectController = {
    turbidity: 1, rayleigh: 3, mieCoefficient: 0.001,
    mieDirectionalG: 0.95, elevation: 35, azimuth: 180,
  };

  const uniforms = sky.material.uniforms;
  uniforms['turbidity'].value = effectController.turbidity;
  uniforms['rayleigh'].value = effectController.rayleigh;
  uniforms['mieCoefficient'].value = effectController.mieCoefficient;
  uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

  const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
  const theta = THREE.MathUtils.degToRad(effectController.azimuth);
  sun.setFromSphericalCoords(1, phi, theta);
  uniforms['sunPosition'].value.copy(sun);

  const sunGeometry = new THREE.SphereGeometry(20, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfffde1, fog: false });
  sunSphere = new THREE.Mesh(sunGeometry, sunMaterial);
  sunSphere.position.copy(sun).multiplyScalar(1800);
  scene.add(sunSphere);
  
  addLights();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.15, 0.3, 0.6);
  composer.addPass(bloomPass);
  composer.addPass(new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio()));
  composer.addPass(new OutputPass());

  controls = new FirstPersonControls(scene, camera, renderer);
  
  qualityButton.addEventListener('click', () => setQuality(!isHighQuality));
  micButton.addEventListener('click', () => {
    const isEnabled = communications.toggleMic();
    micButton.classList.toggle('active', isEnabled);
    micButton.innerHTML = isEnabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
  });
  cameraButton.addEventListener('click', () => {
    const isEnabled = communications.toggleCamera();
    cameraButton.classList.toggle('active', isEnabled);
  });
  runButton.addEventListener('click', () => {
    controls.toggleRun();
  });

  addSignButton.addEventListener('click', () => {
    const text = prompt("Enter sign text:", "");
    if (text && text.trim() !== "") {
      const position = new THREE.Vector3();
      const direction = new THREE.Vector3();

      camera.getWorldDirection(direction);
      position.copy(camera.position).add(direction.multiplyScalar(10));
      const raycaster = new THREE.Raycaster(position, new THREE.Vector3(0, -1, 0));
      raycaster.layers.set(COLLISION_LAYER);
      const intersects = raycaster.intersectObject(scene, true);
      if(intersects.length > 0) {
        position.y = intersects[0].point.y;
      }

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
    controls.camera.position.set(0, 200, 0);
    controls.velocity.y = 0;
  });

  adminMenuButton.addEventListener('click', () => {
    const password = prompt("Enter admin password:");
    if (password === "gazpacho") {
      adminPanel.style.display = 'flex';
    } else if (password) {
      alert("Incorrect password.");
    }
  });

  adminDeleteAllButton.addEventListener('click', () => {
    if (confirm("Are you sure you want to delete ALL signs from the server?")) {
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
      if(confirm("Are you sure you want to teleport all users to the center?")) {
          communications.socket.emit("admin:teleportAll");
          adminPanel.style.display = 'none';
      }
  });

  window.addEventListener('keydown', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    switch(event.key.toLowerCase()) {
        case 'q':
            setQuality(!isHighQuality);
            break;
        case 'm':
            micButton.click();
            break;
        case 'v':
            cameraButton.click();
            break;
    }
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

  document.getElementById("canvas-container").append(renderer.domElement);
  window.addEventListener("resize", onWindowResize, false);
  scene.add(new THREE.AxesHelper(10));
  
  setQuality(isHighQuality);
  updateVideoPosition();

  if ('ontouchstart' in window) {
    document.getElementById('jump-button').style.display = 'block';
  }

  update();
}

function setQuality(high) {
  isHighQuality = high;
  qualityButton.classList.toggle('active', isHighQuality);

  renderer.shadowMap.enabled = isHighQuality;
  if (dirLight) {
    dirLight.castShadow = isHighQuality;
    dirLight.visible = isHighQuality;
  }
  
  const pixelRatio = isHighQuality ? window.devicePixelRatio : window.devicePixelRatio * 0.75;
  renderer.setPixelRatio(pixelRatio);

  if (isHighQuality) {
      scene.fog.near = 800;
      scene.fog.far = 2200;
  } else {
      scene.fog.near = 100;
      scene.fog.far = 1500;
  }
  
  onWindowResize();
}

function addLights() {
  const hemisphereLight = new THREE.HemisphereLight(0xadd8e6, 0xfcebb4, 1.2);
  scene.add(hemisphereLight);
  
  dirLight = new THREE.DirectionalLight(0xfff5e1, 3);
  dirLight.position.copy(sun).multiplyScalar(200);
  dirLight.castShadow = isHighQuality;
  dirLight.shadow.bias = -0.0002;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 2000;
  dirLight.shadow.camera.left = -1000;
  dirLight.shadow.camera.right = 1000;
  dirLight.shadow.camera.top = 1000;
  dirLight.shadow.camera.bottom = -1000;
  scene.add(dirLight);
}

function interpolatePositions() {
  lerpValue = Math.min(lerpValue + 0.1, 1.0);
  for (let id in peers) {
    if (peers[id] && peers[id].group) {
      peers[id].group.position.lerpVectors(peers[id].previousPosition, peers[id].desiredPosition, lerpValue);
      peers[id].group.quaternion.slerpQuaternions(peers[id].previousRotation, peers[id].desiredRotation, lerpValue);
    }
  }
}

function updatePeerVolumes() {
  for (let id in peers) {
    let audioEl = document.getElementById(id + "_audio");
    if (audioEl && peers[id] && peers[id].group) {
      let distSquared = camera.position.distanceToSquared(peers[id].group.position);
      if (distSquared > 500) { audioEl.volume = 0; }
      else { audioEl.volume = Math.min(1, 10 / distSquared); }
    }
  }
}

function getPlayerPosition() {
  return [[camera.position.x, camera.position.y, camera.position.z], [camera.quaternion._x, camera.quaternion._y, camera.quaternion._z, camera.quaternion._w]];
}

function update() {
  requestAnimationFrame(() => update());
  frameCount++;

  if (controls) {
    runButton.classList.toggle('active', controls.isRunning);
  }

  if (frameCount % 25 === 0) updatePeerVolumes();
  if (frameCount % 10 === 0 && communications.socket) {
    communications.sendPosition(getPlayerPosition());
  }
  interpolatePositions();
  controls.update();

  if (isHighQuality) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function onWindowResize() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
}

// Start of the script
init();