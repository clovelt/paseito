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
let dirLight, sky, sun, sunSphere; // Make sunSphere globally accessible
let isHighQuality = true;

const COLLISION_LAYER = 3;

let frameCount = 0;
let peers = {};
const userListContainer = document.getElementById('user-list-container');
const qualityButton = document.getElementById('quality-button');
const runButton = document.getElementById('run-button');
const micButton = document.getElementById('mic-button');
const cameraButton = document.getElementById('camera-button');

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
  communications.on("peerJoined", (id) => { addPeer(id); addUserToList(id); });
  communications.on("peerLeft", (id) => { removePeer(id); removeUserFromList(id); });
  communications.on("positions", (positions) => { updatePeerPositions(positions); });
  communications.on("data", (msg) => {
    console.log("Received message:", msg);
    if (msg.type == "box") onNewBox(msg);
  });

  let width = window.innerWidth;
  let height = window.innerHeight * 0.9;

  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
  camera.position.set(-100, 75, 245);
  camera.layers.enable(COLLISION_LAYER);
  scene.add(camera);

  listener = new THREE.AudioListener();
  camera.add(listener);

  renderer = new THREE.WebGLRenderer({ antialiasing: true });
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

  // --- SOLUTION: Fix the race condition by querying for the element inside the function ---
  const userList = document.getElementById('user-list-container');
  const updateVideoPosition = () => {
    const videoPreview = document.getElementById('local_video');
    if (!videoPreview) return; // If element doesn't exist yet, do nothing.

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
  update();
}

init();

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

function addPeer(id) {
  let videoElement = document.getElementById(id + "_video");
  let videoTexture = new THREE.VideoTexture(videoElement);
  let videoMaterial = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide });
  let otherMat = new THREE.MeshNormalMaterial();
  let head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [otherMat, otherMat, otherMat, otherMat, otherMat, videoMaterial]);
  head.position.set(0, 0, 0);
  var group = new THREE.Group();
  group.add(head);
  scene.add(group);
  peers[id] = {};
  peers[id].group = group;
  peers[id].previousPosition = new THREE.Vector3();
  peers[id].previousRotation = new THREE.Quaternion();
  peers[id].desiredPosition = new THREE.Vector3();
  peers[id].desiredRotation = new THREE.Quaternion();
}

function removePeer(id) {
  if(peers[id] && peers[id].group) scene.remove(peers[id].group);
}

function updatePeerPositions(positions) {
  lerpValue = 0;
  for (let id in positions) {
    if (!peers[id]) continue;
    peers[id].previousPosition.copy(peers[id].group.position);
    peers[id].previousRotation.copy(peers[id].group.quaternion);
    peers[id].desiredPosition = new THREE.Vector3().fromArray(positions[id].position);
    peers[id].desiredRotation = new THREE.Quaternion().fromArray(positions[id].rotation);
  }
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
  let height = Math.floor(window.innerHeight * 0.9);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
}

function addBox() {
  let msg = { type: "box", data: { x: camera.position.x, y: camera.position.y, z: camera.position.z } };
  communications.sendData(msg);
}

function onNewBox(msg) {
  let geo = new THREE.BoxGeometry(1, 1, 1);
  let mat = new THREE.MeshBasicMaterial();
  let mesh = new THREE.Mesh(geo, mat);
  let pos = msg.data;
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);
}

function addUserToList(id, isLocal = false) {
    const userItem = document.createElement('div');
    userItem.id = 'useritem-' + id;
    userItem.className = 'user-list-item';
    let name = isLocal ? 'You' : id.substring(0, 6);
    let icon = isLocal ? 'fa-user' : 'fa-headset';
    userItem.innerHTML = `<i class="fa-solid ${icon}"></i> ${name}`;
    userListContainer.appendChild(userItem);
}

function removeUserFromList(id) {
    const userItem = document.getElementById('useritem-' + id);
    if (userItem) { userItem.remove(); }
}