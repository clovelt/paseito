import * as THREE from "three";
import { scene, camera } from './world.js';

export let peers = {};
let lerpValue = 0;
let audioContext;
let lastAnimationTime = performance.now();

const COLLISION_LAYER = 3;
const avatarRaycaster = new THREE.Raycaster();
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');

const AVATAR = {
  eyeToBody: 2.05,
  hipDrop: 3.05,
  hipWidth: 0.52,
  footForward: 0.34,
  strideLength: 0.95,
  strideLift: 0.42,
  legRadius: 0.09,
  groundProbeUp: 2.2,
  groundProbeDown: 6.5,
  groundOffset: 0.06,
};

export function setAudioContext(ctx) {
    audioContext = ctx;
}

// --- DOM Utility Functions ---

export function createPeerDOMElements(_id) {
  if (document.getElementById(_id + "_video")) return; // Already exists

  const videoElement = document.createElement("video");
  videoElement.id = _id + "_video";
  videoElement.autoplay = true;
  videoElement.muted = true;
  videoElement.setAttribute("playsinline", "");
  document.body.appendChild(videoElement);

  // If audio context is ready, set up the audio graph
  if (audioContext && peers[_id] && peers[_id].stream) {
      setupAudioProcessing(_id, peers[_id].stream);
  }
}

function setupAudioProcessing(id, stream) {
    if (!audioContext || !stream.getAudioTracks().length || (peers[id] && peers[id].sourceNode)) return;

    // Revert to GainNode for simple volume control
    const gainNode = audioContext.createGain();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    
    // Ensure the peer object exists before trying to attach nodes
    peers[id] = peers[id] || {};
    sourceNode.connect(gainNode).connect(audioContext.destination);
    Object.assign(peers[id], { sourceNode, gainNode });
}

export function updatePeerDOMElements({ id, stream, isLocal = false }) {
  if (!stream) return;
  
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  if (videoTrack) {
    let videoStream = new MediaStream([videoTrack]);
    const videoElement = document.getElementById(id + "_video");
    if (isLocal) {
        // The local preview element is now inside the HTML
        const localVideoPreview = document.getElementById('local_video');
        // If the new track is from a canvas, we need to manually update the preview
        // because the original stream from getUserMedia is disconnected.
        if (videoTrack.label.toLowerCase().includes('canvas')) {
            localVideoPreview.srcObject = videoStream;
        }
        if(localVideoPreview) localVideoPreview.srcObject = videoStream;
    }
    if (videoElement) videoElement.srcObject = videoStream;

    // CRITICAL FIX: The audio stream must be attached to a playable element.
    // We can attach the full incoming stream (video+audio) to the existing video element.
    // The video is muted via the element's property, but the audio track is now available for the AudioContext.
    if (videoElement && !isLocal) {
        videoElement.srcObject = stream;
    }
  }
  if (audioTrack) {
    const audioStream = new MediaStream([audioTrack]);
    // Ensure the peer object exists before assigning the stream
    if (!peers[id]) {
        peers[id] = {};
    }
    peers[id].stream = audioStream;
    // If the audio context is ready, process the stream. Otherwise, it will be processed when the context is created.
    if (audioContext && !isLocal) setupAudioProcessing(id, audioStream);
  }
}

export function cleanupPeerDomElements(_id) {
  let videoEl = document.getElementById(_id + "_video");
  if (videoEl) videoEl.remove();

  if (peers[_id] && peers[_id].sourceNode) {
      peers[_id].sourceNode.disconnect();
      if (peers[_id].gainNode) {
          peers[_id].gainNode.disconnect();
      }
      if (peers[_id].reverbNode) {
          peers[_id].reverbNode.disconnect();
      }
  }
}


// --- Main Peer Logic ---

function createPeerMaterial(color, roughness = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function makeCapsule(radius, length, material) {
  const geometry = new THREE.CapsuleGeometry(radius, length, 10, 18);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeSphere(radius, material, widthSegments = 24, heightSegments = 16) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
}

function setYawFromQuaternion(target, source) {
  tempEuler.setFromQuaternion(source, 'YXZ');
  tempEuler.x = 0;
  tempEuler.z = 0;
  target.setFromEuler(tempEuler);
}

function placeLimbBetween(mesh, start, end) {
  tempVecA.subVectors(end, start);
  const length = Math.max(tempVecA.length(), 0.001);
  mesh.position.copy(start).addScaledVector(tempVecA, 0.5);
  mesh.scale.set(1, length, 1);
  tempQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tempVecA.normalize());
  mesh.quaternion.copy(tempQuat);
}

function probeGround(worldPoint, fallbackY) {
  tempVecB.set(worldPoint.x, worldPoint.y + AVATAR.groundProbeUp, worldPoint.z);
  avatarRaycaster.set(tempVecB, new THREE.Vector3(0, -1, 0));
  avatarRaycaster.far = AVATAR.groundProbeUp + AVATAR.groundProbeDown;
  avatarRaycaster.layers.set(COLLISION_LAYER);

  const hits = avatarRaycaster.intersectObject(scene, true);
  if (hits.length > 0) {
    return hits[0].point.y + AVATAR.groundOffset;
  }
  return fallbackY;
}

function buildCutePlayerModel(videoElement) {
  const group = new THREE.Group();
  group.name = 'paseito-cute-player';

  const bodyMat = createPeerMaterial(0xffd84d);
  const bellyMat = createPeerMaterial(0xfff4ad);
  const legMat = createPeerMaterial(0x1d1d21);
  const footMat = createPeerMaterial(0xf25f5c);
  const armMat = createPeerMaterial(0x2fbf71);
  const cheekMat = createPeerMaterial(0xff7aa2, 0.9);

  const body = makeSphere(0.82, bodyMat, 32, 20);
  body.name = 'avatar-body';
  body.scale.set(1.22, 1.0, 0.78);
  body.position.y = -AVATAR.eyeToBody;

  const belly = makeSphere(0.46, bellyMat, 24, 14);
  belly.name = 'avatar-belly';
  belly.scale.set(1.25, 0.75, 0.22);
  belly.position.set(0, -AVATAR.eyeToBody - 0.08, -0.55);

  const videoTexture = new THREE.VideoTexture(videoElement);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshBasicMaterial({ map: videoTexture, transparent: true, side: THREE.DoubleSide });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.43, 36), faceMat);
  face.name = 'avatar-video-face';
  face.position.set(0, -AVATAR.eyeToBody + 0.26, -0.64);
  face.rotation.y = Math.PI;

  const cheekL = makeSphere(0.09, cheekMat, 16, 10);
  cheekL.position.set(-0.38, -AVATAR.eyeToBody + 0.12, -0.66);
  cheekL.scale.set(1.25, 0.8, 0.25);
  const cheekR = cheekL.clone();
  cheekR.position.x *= -1;

  const antennaMat = createPeerMaterial(0x1d1d21);
  const antennaL = makeCapsule(0.035, 0.55, antennaMat);
  antennaL.position.set(-0.24, -AVATAR.eyeToBody + 0.78, -0.05);
  antennaL.rotation.z = -0.48;
  const antennaR = antennaL.clone();
  antennaR.position.x *= -1;
  antennaR.rotation.z *= -1;

  const armL = makeCapsule(0.065, 0.85, armMat);
  armL.name = 'avatar-arm-left';
  armL.position.set(-0.86, -AVATAR.eyeToBody - 0.05, -0.02);
  armL.rotation.z = -0.82;
  const armR = armL.clone();
  armR.name = 'avatar-arm-right';
  armR.position.x *= -1;
  armR.rotation.z *= -1;

  const legL = makeCapsule(AVATAR.legRadius, 1, legMat);
  legL.name = 'avatar-leg-left';
  const legR = makeCapsule(AVATAR.legRadius, 1, legMat);
  legR.name = 'avatar-leg-right';
  const footL = makeSphere(0.18, footMat, 18, 10);
  footL.name = 'avatar-foot-left';
  footL.scale.set(1.65, 0.45, 0.9);
  const footR = footL.clone();
  footR.name = 'avatar-foot-right';

  group.add(body, belly, face, cheekL, cheekR, antennaL, antennaR, armL, armR, legL, legR, footL, footR);

  return {
    group,
    body,
    face,
    armL,
    armR,
    legL,
    legR,
    footL,
    footR,
    videoTexture,
  };
}

export function addPeer(id, peerData, playerScale) {
  // Create the DOM element first, as it's needed for the video texture.
  createPeerDOMElements(id);

  const videoElement = document.getElementById(id + "_video");
  if (!videoElement) {
      console.error(`addPeer failed: video element for ${id} not found.`);
      return;
  }

  const rig = buildCutePlayerModel(videoElement);
  const group = rig.group;
  if (peerData.position) group.position.fromArray(peerData.position);
  if (peerData.rotation) setYawFromQuaternion(group.quaternion, new THREE.Quaternion().fromArray(peerData.rotation));
  group.scale.set(playerScale, playerScale, playerScale);

  scene.add(group);
  peers[id] = peers[id] || {}; // Safely initialize the peer object, preserving any existing data (like a stream)
  peers[id].group = group;
  peers[id].rig = rig;
  peers[id].name = peerData.name;
  peers[id].previousPosition = group.position.clone();
  peers[id].previousRotation = group.quaternion.clone();
  peers[id].desiredPosition = group.position.clone();
  peers[id].desiredRotation = group.quaternion.clone();
  peers[id].lastPosition = group.position.clone();
  peers[id].stridePhase = Math.random() * Math.PI * 2;
  peers[id].movementSpeed = 0;
  peers[id].isShouting = peerData.isShouting || false;
}

export function removePeer(id) {
  if(peers[id] && peers[id].group) {
    scene.remove(peers[id].group);
    disposeObject(peers[id].group);
  }
  delete peers[id];
}

export function updatePeerPositions(positions) {
  lerpValue = 0;
  for (let id in positions) {
    if (peers[id] && peers[id].group && positions[id] && positions[id].position && positions[id].rotation) {
      peers[id].previousPosition.copy(peers[id].group.position);
      peers[id].previousRotation.copy(peers[id].group.quaternion);
      peers[id].desiredPosition.fromArray(positions[id].position);
      setYawFromQuaternion(peers[id].desiredRotation, new THREE.Quaternion().fromArray(positions[id].rotation));
      peers[id].isShouting = positions[id].isShouting;
    }
  }
}

export function interpolatePositions() {
  const now = performance.now();
  const delta = Math.min((now - lastAnimationTime) / 1000, 0.1);
  lastAnimationTime = now;
  lerpValue = Math.min(lerpValue + 0.1, 1.0);
  for (let id in peers) {
    if (peers[id] && peers[id].group) {
      peers[id].group.position.lerpVectors(peers[id].previousPosition, peers[id].desiredPosition, lerpValue);
      peers[id].group.quaternion.slerpQuaternions(peers[id].previousRotation, peers[id].desiredRotation, lerpValue);
      updatePeerAvatar(peers[id], delta);
    }
  }
}

function updatePeerAvatar(peer, delta) {
  const rig = peer.rig;
  if (!rig) return;
  peer.group.updateMatrixWorld();

  const horizontalDelta = tempVecC.copy(peer.group.position).sub(peer.lastPosition);
  horizontalDelta.y = 0;
  const distance = horizontalDelta.length();
  const speed = distance / Math.max(delta, 0.001);
  peer.movementSpeed = THREE.MathUtils.lerp(peer.movementSpeed || 0, speed, 0.18);
  peer.stridePhase += THREE.MathUtils.clamp(peer.movementSpeed * 0.018, 0.025, 0.42);
  peer.lastPosition.copy(peer.group.position);

  const moving = peer.movementSpeed > 0.2;
  const phase = peer.stridePhase;
  const bob = moving ? Math.abs(Math.sin(phase * 2)) * 0.08 : Math.sin(phase) * 0.025;
  rig.body.position.y = -AVATAR.eyeToBody + bob;
  rig.face.position.y = -AVATAR.eyeToBody + 0.26 + bob * 0.65;
  rig.armL.rotation.x = Math.sin(phase + Math.PI) * 0.42;
  rig.armR.rotation.x = Math.sin(phase) * 0.42;

  updateFoot(peer, -1, phase, moving, rig.legL, rig.footL);
  updateFoot(peer, 1, phase + Math.PI, moving, rig.legR, rig.footR);
}

function updateFoot(peer, side, phase, moving, leg, foot) {
  const root = peer.group;
  const hipLocal = tempVecA.set(side * AVATAR.hipWidth, -AVATAR.hipDrop, -0.03);
  const hipWorld = hipLocal.clone().applyMatrix4(root.matrixWorld);

  const stride = moving ? Math.sin(phase) * AVATAR.strideLength : 0;
  const lift = moving ? Math.max(0, Math.cos(phase)) * AVATAR.strideLift : 0;
  const footLocal = tempVecB.set(side * AVATAR.hipWidth, -AVATAR.hipDrop - 1.7 + lift, -AVATAR.footForward + stride);
  const footWorld = footLocal.clone().applyMatrix4(root.matrixWorld);
  const fallbackY = root.position.y - AVATAR.hipDrop - 1.7 + lift;
  footWorld.y = probeGround(footWorld, fallbackY) + lift;

  const footLocalSolved = root.worldToLocal(footWorld.clone());
  foot.position.copy(footLocalSolved);
  foot.rotation.set(Math.sin(phase) * 0.18, 0, side * 0.04);

  const hipLocalSolved = root.worldToLocal(hipWorld.clone());
  placeLimbBetween(leg, hipLocalSolved, footLocalSolved);
}

export function updatePeerVolumes(voiceDistanceMultiplier) {
  for (let id in peers) {
    if (peers[id] && peers[id].group && peers[id].gainNode) {
      let distSquared = camera.position.distanceToSquared(peers[id].group.position);
      
      const isShouting = peers[id].isShouting;
      const distMult = (isShouting ? 9.0 : 2.25) * voiceDistanceMultiplier;
      let maxDistSquared = 4500 * distMult;
      let volume = 0;

      if (distSquared > maxDistSquared) {
        volume = 0;
      } else {
        volume = Math.min(1, (80 * distMult) / distSquared);
      }
      
      peers[id].gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.1);
    }
  }
}
