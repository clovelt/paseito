paseito.

Simulador de tours turísiticos digitales. Roquekes x Clovelt 2025.

Digital tour simulator. Roquekes x Clovelt 2025.

Powered by [three.js](https://threejs.org/), allows multiplayer scenes with integrated audio/video capabilities. The current local server uses Socket.IO for multiplayer presence and WebRTC signaling while the production move targets Cloudflare.

![image of multiplayer 3D scene](/docs/images/paseito.gif)

## Quickstart:

1. Download the repository to your computer:
   ```bash
   $ git clone https://github.com/AidanNelson/threejs-webrtc.git
   ```
2. Navigate into the local folder and install Node dependencies:
   ```bash
   $ cd threejs-webrtc
   $ npm install
   ```
3. Start the server:
   ```bash
   $ npm start
   ```
4. Navigate to `http://localhost:8080` on your browser.

## Cloudflare:

Render/Postgres-specific setup has been removed. Cloudflare Workers support is in [cloudflare/worker.js](./cloudflare/worker.js), with Durable Object room state and native WebSocket signaling. See [CLOUDFLARE.md](./CLOUDFLARE.md) for local Wrangler dev and deploy steps.

## Technology:

This space is built using a number of technologies, including:

* [three.js](https://threejs.org/) provides rendering / 3D environment interaction
* [socket.io](https://socket.io/) provides the three.js multiplayer functionality, and acts as a WebRTC signaling server
* [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) provides video / audio chat functionality
* [Simple Peer](https://github.com/feross/simple-peer) provides a friendlier API for WebRTC

## Credits:

Forked from [threejs-webrtc](https://github.com/AidanNelson/threejs-webrtc), models from Sketchfab and Models Resource (hosted externally!).

The original project uses code from a number of sources, including:

* Or Fleisher - [THREE.Multiplayer](https://github.com/juniorxsound/THREE.Multiplayer) server and client setup using socket.io with three.js
* Mikołaj Wargowski - [Simple Chat App](https://github.com/Miczeq22/simple-chat-app) using [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) with three.js
* Zachary Stenger - [Three.js Video Chat](https://github.com/zacharystenger/three-js-video-chat) using [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
