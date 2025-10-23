import * as THREE from "three";
import { scene, camera } from './world.js';

export let peers = {};
let lerpValue = 0;
let audioContext;

export function setAudioContext(ctx) {
    audioContext = ctx;
}

// --- DOM Utility Functions ---

export function createPeerDOMElements(_id, ctx, reverbBuffer) {
  if (document.getElementById(_id + "_video")) return; // Already exists

  const videoElement = document.createElement("video");
  videoElement.id = _id + "_video";
  videoElement.autoplay = true;
  videoElement.muted = true;
  videoElement.setAttribute("playsinline", ""); // Important for iOS
  document.body.appendChild(videoElement);

  let audioEl = document.createElement("audio");
  audioEl.setAttribute("id", _id + "_audio");
  audioEl.controls = "controls";
  audioEl.volume = 0;
  document.body.appendChild(audioEl);

  audioEl.addEventListener("loadeddata", () => {
    audioEl.play().catch(e => console.warn("Audio play failed:", e));
  });

  // If audio context is ready, set up the audio graph
  if (ctx && peers[_id] && peers[_id].stream) {
      setupAudioProcessing(_id, peers[_id].stream, reverbBuffer);
  }
}

function setupAudioProcessing(id, stream, reverbBuffer) {
    if (!audioContext || !stream.getAudioTracks().length || (peers[id] && peers[id].sourceNode)) return;

    // --- TEMPORARY FIX to restore voice ---
    // Bypassing the PannerNode and connecting directly to the output.
    // This will disable 3D spatial audio but should make voices audible again.
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(audioContext.destination);
    peers[id] = { ...peers[id], sourceNode };
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
  }
  if (audioTrack) {
    const audioStream = new MediaStream([audioTrack]);
    if (peers[id]) {
        peers[id].stream = audioStream;
    }
    // If the audio context is ready, process the stream. Otherwise, it will be processed when the context is created.
    if (audioContext && !isLocal) setupAudioProcessing(id, audioStream);
  }
}

export function cleanupPeerDomElements(_id) {
  let videoEl = document.getElementById(_id + "_video");
  if (videoEl) videoEl.remove();

  let audioEl = document.getElementById(_id + "_audio");
  if (audioEl) audioEl.remove();

  if (peers[_id] && peers[_id].sourceNode) {
      peers[_id].sourceNode.disconnect();
      peers[_id].pannerNode.disconnect();
      if (peers[_id].reverbNode) peers[_id].reverbNode.disconnect();
  }
}


// --- Main Peer Logic ---

export function addPeer(id, peerData, playerScale) {
  const MII_HEAD_RADIUS = 0.65;
  const MII_BODY_HEIGHT = 2;
  const MII_BODY_WIDTH = 1;
  const MII_LIMB_RADIUS = 0.15;
  const MII_ARM_LENGTH = 0.9;
  const MII_LEG_LENGTH = 2.2;
  
  const videoElement = document.getElementById(id + "_video");
  if (!videoElement) {
      console.error(`addPeer failed: video element for ${id} not found.`);
      return;
  }
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
  armL.position.set(MII_BODY_WIDTH / 2 + MII_LIMB_RADIUS, -MII_HEAD_RADIUS, 0);
  
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
  group.position.y = MII_HEAD_RADIUS + MII_BODY_HEIGHT + MII_LEG_LENGTH;
  group.scale.set(playerScale, playerScale, playerScale);

  scene.add(group);
  peers[id] = {};
  peers[id].group = group;
  peers[id].name = peerData.name;
  peers[id].previousPosition = new THREE.Vector3();
  peers[id].previousRotation = new THREE.Quaternion();
  peers[id].desiredPosition = new THREE.Vector3();
  peers[id].desiredRotation = new THREE.Quaternion();
  peers[id].isShouting = peerData.isShouting || false;
}

export function removePeer(id) {
  if(peers[id] && peers[id].group) scene.remove(peers[id].group);
  delete peers[id];
}

export function updatePeerPositions(positions) {
  lerpValue = 0;
  for (let id in positions) {
    if (peers[id] && peers[id].group && positions[id] && positions[id].position && positions[id].rotation) {
      peers[id].previousPosition.copy(peers[id].group.position);
      peers[id].previousRotation.copy(peers[id].group.quaternion);
      peers[id].desiredPosition.fromArray(positions[id].position);
      peers[id].desiredRotation.fromArray(positions[id].rotation);
      peers[id].isShouting = positions[id].isShouting;
    }
  }
}

export function interpolatePositions() {
  lerpValue = Math.min(lerpValue + 0.1, 1.0);
  for (let id in peers) {
    if (peers[id] && peers[id].group) {
      peers[id].group.position.lerpVectors(peers[id].previousPosition, peers[id].desiredPosition, lerpValue);
      peers[id].group.quaternion.slerpQuaternions(peers[id].previousRotation, peers[id].desiredRotation, lerpValue);
    }
  }
}

export function updatePeerVolumes(voiceDistanceMultiplier, reverbBuffer) {
  for (let id in peers) {
    if (peers[id] && peers[id].group && peers[id].pannerNode) {
      const peerPosition = peers[id].group.position;
      const panner = peers[id].pannerNode;

      // Update panner position for 3D audio
      panner.positionX.setTargetAtTime(peerPosition.x, audioContext.currentTime, 0.1);
      panner.positionY.setTargetAtTime(peerPosition.y, audioContext.currentTime, 0.1);
      panner.positionZ.setTargetAtTime(peerPosition.z, audioContext.currentTime, 0.1);

      const isShouting = peers[id].isShouting;
      panner.refDistance = isShouting ? 4.0 : 1.0;
      panner.rolloffFactor = isShouting ? 1.5 : 2.5;
    }
  }
}