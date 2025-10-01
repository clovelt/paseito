/*
 *
 * This file exports a class which sets up the Websocket and WebRTC communications for our peer.
 *
 */

export class Communications {
  constructor() {
    // socket.io
    this.socket;

    // array of connected peers
    this.peers = {};

    // Our local media stream (i.e. webcam and microphone stream)
    this.localMediaStream = null;

    this.initialize();

    // --- SOLUTION: Restored the initialization of the event callbacks object ---
    this.userDefinedCallbacks = {
      peerJoined: [],
      peerLeft: [],
      positions: [],
      data: [],
      clearAllObjects: [],
      serverMessage: []
    };
  }

  async initialize() {
    // first get user media
    this.localMediaStream = await this.getLocalMedia();

    createPeerDOMElements("local");
    updatePeerDOMElements("local", this.localMediaStream);

    // then initialize socket connection
    this.initSocketConnection();
  }

  // add a callback for a given event
  on(event, callback) {
    console.log(`Setting ${event} callback.`);
    this.userDefinedCallbacks[event].push(callback);
  }

  sendPosition(position) {
    this.socket?.emit("move", position);
  }

  sendData(data) {
    this.socket?.emit("data", data);
  }

  callEventCallback(event, data) {
    this.userDefinedCallbacks[event].forEach((callback) => {
      callback(data);
    });
  }

  async getLocalMedia() {
    const videoWidth = 80;
    const videoHeight = 60;
    const videoFrameRate = 15;
    let mediaConstraints = {
      audio: true,
      video: {
        width: videoWidth,
        height: videoHeight,
        frameRate: videoFrameRate,
      },
    };

    let stream = null;

    try {
      // Access media devices
      stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    } catch (err) {
      console.log("Failed to get user media!");
      console.warn(err);
      // Create a dummy stream if media access fails
      stream = this.createDummyStream();
    }

    // Keep track of the local stream regardless of success
    this.localStream = stream;
    return stream;
  }
  
  createDummyStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 1, 1);
    const videoStream = canvas.captureStream(1); // 1 fps
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const dst = oscillator.connect(audioContext.createMediaStreamDestination());
    oscillator.start();
    const audioStream = dst.stream;

    const dummyStream = new MediaStream([
      videoStream.getVideoTracks()[0],
      audioStream.getAudioTracks()[0],
    ]);
    return dummyStream;
  }


  toggleMic() {
    if (!this.localMediaStream) return false;
    
    const audioTracks = this.localMediaStream.getAudioTracks();
    if (audioTracks.length > 0) {
      if (audioTracks[0].label !== 'MediaStreamAudioDestinationNode') {
         audioTracks[0].enabled = !audioTracks[0].enabled;
         return audioTracks[0].enabled;
      }
    }
    return false;
  }

  toggleCamera() {
    if (!this.localMediaStream) return false;

    const videoTracks = this.localMediaStream.getVideoTracks();
    if (videoTracks.length > 0) {
      if (videoTracks[0].label !== 'canvas') {
        videoTracks[0].enabled = !videoTracks[0].enabled;
        const localVideo = document.getElementById('local_video');
        if(localVideo) localVideo.style.display = videoTracks[0].enabled ? 'block' : 'none';
        return videoTracks[0].enabled;
      }
    }
    return false;
  }

  disableOutgoingStream() {
    this.localMediaStream.getTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  enableOutgoingStream() {
    this.localMediaStream.getTracks().forEach((track) => {
      track.enabled = true;
    });
  }

  initSocketConnection() {
    console.log("Initializing socket.io...");
    this.socket = io(window.location.origin);

    this.socket.on("connect", () => {
      console.log("My socket ID:", this.socket.id);
    });

    this.socket.on("data", (data) => {
      this.callEventCallback("data", data);
    });
    
    // --- SOLUTION: Add listeners for new server events ---
    this.socket.on("clearAllObjects", () => {
        this.callEventCallback("clearAllObjects");
    });
    this.socket.on("serverMessage", (message) => {
        this.callEventCallback("serverMessage", message);
    });


    this.socket.on("introduction", (allPeers) => {
      for (let id in allPeers) {
        if (id !== this.socket.id) {
          console.log("Adding peer with id " + id);
          this.peers[id] = {};

          let pc = this.createPeerConnection(id, true);
          this.peers[id].peerConnection = pc;

          createPeerDOMElements(id);
          // Pass the peerData (which includes the name)
          this.userDefinedCallbacks["peerJoined"].forEach(callback => callback(id, allPeers[id]));
        }
      }
    });

    this.socket.on("peerConnection", (theirId, peerData) => {
      if (theirId != this.socket.id && !(theirId in this.peers)) {
        this.peers[theirId] = {};
        createPeerDOMElements(theirId);
        this.userDefinedCallbacks["peerJoined"].forEach(callback => callback(theirId, peerData));
      }
    });

    this.socket.on("peerDisconnection", (_id) => {
      if (_id != this.socket.id) {
        this.callEventCallback("peerLeft", _id);
        cleanupPeerDomElements(_id);
        delete this.peers[_id];
      }
    });

    this.socket.on("signal", (to, from, data) => {
      if (to != this.socket.id) {
        console.log("Socket IDs don't match");
      }

      let peer = this.peers[from];
      if (peer.peerConnection) {
        peer.peerConnection.signal(data);
      } else {
        let peerConnection = this.createPeerConnection(from, false);
        this.peers[from].peerConnection = peerConnection;
        peerConnection.signal(data);
      }
    });

    this.socket.on("positions", (positions) => {
      this.callEventCallback("positions", positions);
    });
  }

  createPeerConnection(theirSocketId, isInitiator = false) {
    console.log("Connecting to peer with ID", theirSocketId);
    console.log("initiating?", isInitiator);

    const configuration = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        },
        {
          urls: 'stun:global.stun.twilio.com:3478'
        },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
           urls: "turn:openrelay.metered.ca:443",
           username: "openrelayproject",
           credential: "openrelayproject"
        }
      ]
    };

    let peerConnection = new SimplePeer({
        initiator: isInitiator,
        config: configuration,
        stream: this.localMediaStream
    });

    peerConnection.on("signal", (data) => {
        this.socket.emit("signal", theirSocketId, this.socket.id, data);
    });

    peerConnection.on("connect", () => {
        console.log("PEER CONNECTION ESTABLISHED");
    });

    peerConnection.on("stream", (stream) => {
      console.log("Incoming Stream");
      updatePeerDOMElements(theirSocketId, stream);
    });

    peerConnection.on("close", () => {
      console.log("Got close event");
    });

    peerConnection.on("error", (err) => {
      console.log(err);
    });

    return peerConnection;
  }
}

// Utilities 🚂

function createPeerDOMElements(_id) {
  const videoElement = document.createElement("video");
  videoElement.id = _id + "_video";
  videoElement.autoplay = true;
  videoElement.muted = true;
  document.body.appendChild(videoElement);

  let audioEl = document.createElement("audio");
  audioEl.setAttribute("id", _id + "_audio");
  audioEl.controls = "controls";
  audioEl.muted = true;
  audioEl.volume = 0;
  document.body.appendChild(audioEl);

  audioEl.addEventListener("loadeddata", () => {
    audioEl.play().catch(e => console.warn("Audio play failed:", e));
  });
}

function updatePeerDOMElements(_id, stream) {
  if (!stream) return;
  
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  if (videoTrack) {
    let videoStream = new MediaStream([videoTrack]);
    const videoElement = document.getElementById(_id + "_video");
    videoElement.srcObject = videoStream;
  }
  if (audioTrack) {
    let audioStream = new MediaStream([audioTrack]);
    let audioEl = document.getElementById(_id + "_audio");
    audioEl.srcObject = audioStream;
    audioEl.muted = false;
  }
}

function cleanupPeerDomElements(_id) {
  let videoEl = document.getElementById(_id + "_video");
  if (videoEl != null) {
    videoEl.remove();
  }

  let audioEl = document.getElementById(_id + "audio");
  if (audioEl != null) {
    audioEl.remove();
  }
}