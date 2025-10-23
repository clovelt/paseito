import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { Sky } from "three/addons/objects/Sky.js";

export let camera, renderer, scene, composer, dirLight;

export function initWorld() {
    scene = new THREE.Scene();
    
    scene.fog = new THREE.Fog(0xa0d8ef, 1000, 2000);

    let width = window.innerWidth;
    let height = window.innerHeight;

    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
    camera.layers.enable(3); // COLLISION_LAYER
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialiasing: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    document.getElementById("canvas-container").append(renderer.domElement);

    addLights();
    addSky();

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.15, 0.3, 0.6);
    composer.addPass(bloomPass);
    composer.addPass(new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio()));
    composer.addPass(new OutputPass());
    
    window.addEventListener("resize", onWindowResize, false);
}

function addLights() {
    const hemisphereLight = new THREE.HemisphereLight(0xadd8e6, 0xfcebb4, 1.2);
    scene.add(hemisphereLight);

    dirLight = new THREE.DirectionalLight(0xfff5e1, 3);
    dirLight.castShadow = true;
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

function addSky() {
    const sky = new Sky();
    sky.scale.setScalar(450000);

    const sun = new THREE.Vector3();

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
    
    dirLight.position.copy(sun).multiplyScalar(200);

    const sunGeometry = new THREE.SphereGeometry(20, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfffde1, fog: false });
    const sunSphere = new THREE.Mesh(sunGeometry, sunMaterial);
    sunSphere.position.copy(sun).multiplyScalar(1800);
    scene.add(sunSphere);
}

export function updateSkybox(colors = ['#1a94c4', '#2fc1fe', '#a0d8ef']) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, colors[0]); 
  gradient.addColorStop(0.7, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, 128);
  const skyTexture = new THREE.CanvasTexture(canvas);
  scene.background = skyTexture;
}

export function setQuality(isHighQuality) {
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

function onWindowResize() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
}