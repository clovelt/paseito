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

    this.userDefinedCallbacks = {
      peerJoined: [],
      peerLeft: [],
      positions: [],
      introduction: [],
      peerStream: [], // For when a video/audio stream arrives
      data: [],
      clearAllObjects: [],
      serverMessage: []
    };

    this.micVolume = 0;
    this.audioContext = null;
    this.analyser = null;
    this.micSource = null;
    this.volumeData = null;
  }

  async initialize() {
    // first get user media
    this.localMediaStream = await this.getLocalMedia();

    // The main app (index.js) is now responsible for creating DOM elements
    // We just need to fire an event to tell it to create the local one
    this.callEventCallback("peerStream", { id: 'local', stream: this.localMediaStream, isLocal: true });

    // then initialize socket connection
    this.monitorMicVolume();
    this.initSocketConnection();
  }

  // add a callback for a given event
  on(event, callback) {
    if (!this.userDefinedCallbacks[event]) {
        console.error(`Event "${event}" is not a valid event.`);
        return;
    }
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
    if (this.userDefinedCallbacks[event]) {
      this.userDefinedCallbacks[event].forEach((callback) => {
        callback(data);
      });
    }
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

  monitorMicVolume() {
    if (!this.localMediaStream || !this.localMediaStream.getAudioTracks().length || !this.localMediaStream.getAudioTracks()[0].enabled) {
        console.warn("No active audio track to monitor.");
        return;
    }
    if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!this.micSource) {
        this.micSource = this.audioContext.createMediaStreamSource(this.localMediaStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.micSource.connect(this.analyser);
        this.volumeData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    const checkVolume = () => {
        if (this.socket?.disconnected) return; // Stop when disconnected
        this.analyser.getByteFrequencyData(this.volumeData);
        let sum = 0;
        for (const amplitude of this.volumeData) {
            sum += amplitude * amplitude;
        }
        this.micVolume = Math.sqrt(sum / this.volumeData.length);
        requestAnimationFrame(checkVolume);
    };
    checkVolume();
  }

  toggleMic() {
    if (!this.localMediaStream) return false;
    
    const audioTracks = this.localMediaStream.getAudioTracks();
    if (audioTracks.length > 0) {
      if (audioTracks[0].label !== 'MediaStreamAudioDestinationNode') {
         audioTracks[0].enabled = !audioTracks[0].enabled;
         if (audioTracks[0].enabled && !this.micSource) {
            // If mic was off at init, start monitoring now.
            this.monitorMicVolume();
         }
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
    
    this.socket.on("clearAllObjects", () => {
        this.callEventCallback("clearAllObjects");
    });
    this.socket.on("serverMessage", (message) => {
        this.callEventCallback("serverMessage", message);
    });


    this.socket.on("introduction", (data) => {
      this.callEventCallback("introduction", data);

      const allPeers = data.peers;
      for (let id in allPeers) {
        if (id !== this.socket.id) {
          console.log("Setting up peer connection for " + id);
          this.peers[id] = {};
          let pc = this.createPeerConnection(id, true);
          this.peers[id].peerConnection = pc;
        }
      }
    });

    this.socket.on("peerConnection", (theirId, peerData) => {
      if (theirId != this.socket.id && !(theirId in this.peers)) {
        this.peers[theirId] = {};
        this.callEventCallback("peerJoined", {id: theirId, peerData: peerData});
      }
    });

    this.socket.on("peerDisconnection", (_id) => {
      if (_id != this.socket.id) {
        this.callEventCallback("peerLeft", _id);
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
      console.log("Incoming Stream from " + theirSocketId);
      this.callEventCallback("peerStream", { id: theirSocketId, stream: stream });
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