const availableMaps = {
  "Resort": {
    sourceUrl: "https://gustavochico.com/paseito/resort.glb",
    url: "/api/maps/Resort/model",
    startPosition: [-100, 75, 295],
    skyColors: ["#1a94c4", "#2fc1fe", "#212324ff"],
    ambientSourceUrl: "https://gustavochico.com/paseito/ambient_resort.mp3",
    ambientTrack: "/api/maps/Resort/ambient",
  },
  "Wind Waker": {
    sourceUrl: "https://gustavochico.com/paseito/windWaker.glb",
    url: "/api/maps/Wind%20Waker/model",
    startPosition: [0, 0, 0],
    skyColors: ["#1a94c4", "#2fc1fe", "#a0d8ef"],
  },
  "Dust2": {
    sourceUrl: "https://gustavochico.com/paseito/dedust2.glb",
    url: "/api/maps/Dust2/model",
    startPosition: [80, 850, 0],
    skyColors: ["#5c6e80", "#829ab1", "#d9e2ec"],
  },
  "Rainbow Road": {
    sourceUrl: "https://gustavochico.com/paseito/rainbowRoad.glb",
    url: "/api/maps/Rainbow%20Road/model",
    startPosition: [1210, 615, 580],
    skyColors: ["#000000ff", "#173b5cff", "#000000ff"],
  },
  "Shinobi Earth": {
    sourceUrl: "https://gustavochico.com/paseito/shinobi.glb",
    url: "/api/maps/Shinobi%20Earth/model",
    startPosition: [0, 0, 0],
    skyColors: ["#1a94c4", "#2fc1fe", "#212324ff"],
  },
  "The Catacombs": {
    sourceUrl: "https://gustavochico.com/paseito/catacombs.glb",
    url: "/api/maps/The%20Catacombs/model",
    startPosition: [10, 0, 100],
    skyColors: ["#2b2e2fff", "#212324ff", "#131414ff"],
  },
  "Anor Londo PELIGRO NO ES BROMA": {
    sourceUrl: "https://gustavochico.com/paseito/anorLondo.glb",
    url: "/api/maps/Anor%20Londo%20PELIGRO%20NO%20ES%20BROMA/model",
    startPosition: [0, 0, 0],
    skyColors: ["#1a94c4", "#2fc1fe", "#212324ff"],
  },
};

const fallbackMap = availableMaps.Resort.url;
const defaultServerState = {
  currentMapUrl: availableMaps.Resort.url,
  availableMaps,
  fallbackMap,
  voiceDistanceMultiplier: 1.0,
  playerScale: 1.0,
  maxSpeed: 2000,
  acceleration: 600,
  fallbackAmbientTrack: availableMaps.Resort.ambientTrack,
};

const numericSettings = {
  voiceDistanceMultiplier: { min: 0.25, max: 8 },
  playerScale: { min: 0.2, max: 3 },
  maxSpeed: { min: 100, max: 2500 },
  acceleration: { min: 100, max: 2500 },
};

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function isVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every((number) => Number.isFinite(number) && Math.abs(number) < 1_000_000);
}

function isQuaternion(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
}

function sanitizeWorldData(data) {
  if (!data || data.type !== "sign" || !data.data) return null;
  const text = typeof data.data.text === "string" ? data.data.text.trim().slice(0, 180) : "";
  if (!text || !isVector3(data.data.position) || !isQuaternion(data.data.rotation)) return null;
  return {
    type: "sign",
    data: {
      position: data.data.position,
      rotation: data.data.rotation,
      text,
    },
  };
}

function json(event, ...args) {
  return JSON.stringify({ event, args });
}

function reply(requestId, data) {
  return JSON.stringify({ replyTo: requestId, data });
}

function safeSend(socket, payload) {
  try {
    socket.send(payload);
  } catch {
    // Dead sockets are cleaned up by close/error handlers.
  }
}

async function proxyMapAsset(request, name, assetKey, contentType) {
  const map = availableMaps[name];
  const sourceUrl = map?.[assetKey];
  if (!sourceUrl) return new Response("Map asset not found", { status: 404 });

  const upstream = await fetch(sourceUrl, {
    headers: {
      "Accept": "application/octet-stream,*/*",
      "User-Agent": "undici",
    },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Unable to fetch map asset", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": contentType,
    },
  });
}

export class PaseitoRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.adminSockets = new Set();
    this.peers = {};
    this.userCounter = 1;
    this.serverState = { ...defaultServerState };
    this.positionInterval = null;
    this.initialized = this.initialize();
  }

  async initialize() {
    this.worldObjects = await this.state.storage.get("worldObjects") || [];
    this.serverState = await this.state.storage.get("serverState") || { ...defaultServerState };
  }

  async fetch(request) {
    await this.initialized;
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.connect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  connect(socket) {
    socket.accept();
    const id = crypto.randomUUID();
    const peer = {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1],
      name: `User ${this.userCounter++}`,
      isShouting: false,
    };

    this.sessions.set(id, socket);
    this.peers[id] = peer;
    this.startPositionBroadcasts();

    safeSend(socket, json("connect", id));
    safeSend(socket, json("introduction", { peers: this.peers, state: this.serverState }));
    for (const object of this.worldObjects) safeSend(socket, json("data", object));
    this.broadcast("peerConnection", id, peer, id);

    socket.addEventListener("message", (event) => this.onMessage(id, socket, event));
    socket.addEventListener("close", () => this.disconnect(id));
    socket.addEventListener("error", () => this.disconnect(id));
  }

  async onMessage(id, socket, event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    const { event: type, args = [], requestId } = message;
    switch (type) {
      case "move":
        this.handleMove(id, args[0]);
        break;
      case "data":
        await this.handleData(args[0]);
        break;
      case "signal":
        this.handleSignal(args[0], args[1], args[2]);
        break;
      case "admin:auth":
        this.handleAdminAuth(id, socket, args[0], requestId);
        break;
      case "admin:getSnapshot":
        this.handleAdminSnapshot(id, socket, requestId);
        break;
      case "admin:deleteAllObjects":
        await this.handleAdminDeleteAll(id);
        break;
      case "admin:changeMap":
        await this.handleAdminChangeMap(id, args[0]);
        break;
      case "admin:updateSetting":
        await this.handleAdminUpdateSetting(id, args[0]);
        break;
      case "admin:broadcastMessage":
        this.handleAdminBroadcast(id, args[0]);
        break;
      case "admin:teleportAllToMe":
        this.handleAdminTeleportAllToMe(id);
        break;
      case "admin:respawnAll":
        this.handleAdminRespawnAll(id);
        break;
      case "admin:resetSettings":
        await this.handleAdminResetSettings(id);
        break;
    }
  }

  disconnect(id) {
    if (!this.sessions.has(id)) return;
    this.sessions.delete(id);
    this.adminSockets.delete(id);
    delete this.peers[id];
    this.broadcast("peerDisconnection", id);
    if (this.sessions.size === 0) this.stopPositionBroadcasts();
  }

  startPositionBroadcasts() {
    if (!this.positionInterval) {
      this.positionInterval = setInterval(() => this.broadcast("positions", this.peers), 100);
    }
  }

  stopPositionBroadcasts() {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  broadcast(event, ...args) {
    let exceptId = null;
    if (typeof args[args.length - 1] === "string" && event === "peerConnection") {
      exceptId = args.pop();
    }
    const payload = json(event, ...args);
    for (const [id, socket] of this.sessions) {
      if (id !== exceptId) safeSend(socket, payload);
    }
  }

  handleMove(id, data) {
    if (this.peers[id] && data && isVector3(data.position) && isQuaternion(data.rotation)) {
      this.peers[id].position = data.position;
      this.peers[id].rotation = data.rotation;
      this.peers[id].isShouting = !!data.isShouting;
    }
  }

  async handleData(data) {
    const sanitized = sanitizeWorldData(data);
    if (!sanitized) return;
    this.worldObjects.push(sanitized);
    await this.state.storage.put("worldObjects", this.worldObjects);
    this.broadcast("data", sanitized);
  }

  handleSignal(to, from, data) {
    const socket = this.sessions.get(to);
    if (socket) safeSend(socket, json("signal", to, from, data));
  }

  isAdmin(id, action) {
    if (this.adminSockets.has(id)) return true;
    const socket = this.sessions.get(id);
    if (socket) safeSend(socket, json("serverMessage", `Admin command rejected: ${action}`));
    return false;
  }

  getPeerSnapshot() {
    return {
      peers: Object.entries(this.peers).map(([id, peer]) => ({
        id,
        name: peer.name,
        position: peer.position,
        isShouting: !!peer.isShouting,
      })),
      state: this.serverState,
      objectCount: this.worldObjects.length,
    };
  }

  handleAdminAuth(id, socket, password, requestId) {
    const expectedPassword = this.env.ADMIN_PASSWORD || "gazpacho";
    const ok = password === expectedPassword;
    if (ok) this.adminSockets.add(id);
    if (requestId) safeSend(socket, reply(requestId, { ok, snapshot: ok ? this.getPeerSnapshot() : null }));
  }

  handleAdminSnapshot(id, socket, requestId) {
    if (!this.isAdmin(id, "getSnapshot")) return;
    if (requestId) safeSend(socket, reply(requestId, this.getPeerSnapshot()));
  }

  async handleAdminDeleteAll(id) {
    if (!this.isAdmin(id, "deleteAllObjects")) return;
    this.worldObjects = [];
    await this.state.storage.put("worldObjects", this.worldObjects);
    this.broadcast("clearAllObjects");
  }

  async handleAdminChangeMap(id, mapUrl) {
    if (!this.isAdmin(id, "changeMap")) return;
    const isValidMap = Object.values(availableMaps).some((map) => map.url === mapUrl);
    if (!isValidMap) return;
    this.serverState.currentMapUrl = mapUrl;
    await this.state.storage.put("serverState", this.serverState);
    this.broadcast("changeMap", mapUrl);
  }

  async handleAdminUpdateSetting(id, payload) {
    if (!this.isAdmin(id, "updateSetting")) return;
    const { key, value } = payload || {};
    if (!(key in numericSettings)) return;
    const range = numericSettings[key];
    const parsed = clampNumber(value, range.min, range.max);
    if (parsed === null) return;
    this.serverState[key] = parsed;
    await this.state.storage.put("serverState", this.serverState);
    this.broadcast("updateSetting", { key, value: parsed });
  }

  handleAdminBroadcast(id, message) {
    if (!this.isAdmin(id, "broadcastMessage")) return;
    if (typeof message !== "string" || !message.trim()) return;
    this.broadcast("serverMessage", `ADMIN: ${message.trim().slice(0, 300)}`);
  }

  handleAdminTeleportAllToMe(id) {
    if (!this.isAdmin(id, "teleportAllToMe")) return;
    const adminPosition = this.peers[id]?.position;
    if (!adminPosition) return;
    for (const peerId of Object.keys(this.peers)) {
      if (peerId !== id) this.peers[peerId].position = adminPosition.slice();
    }
    this.broadcast("positions", this.peers);
  }

  handleAdminRespawnAll(id) {
    if (!this.isAdmin(id, "respawnAll")) return;
    const currentMap = Object.values(availableMaps).find((map) => map.url === this.serverState.currentMapUrl) || availableMaps.Resort;
    for (const peerId of Object.keys(this.peers)) {
      this.peers[peerId].position = currentMap.startPosition.slice();
    }
    this.broadcast("positions", this.peers);
    this.broadcast("serverMessage", "ADMIN: Everyone was sent back to spawn.");
  }

  async handleAdminResetSettings(id) {
    if (!this.isAdmin(id, "resetSettings")) return;
    this.serverState = {
      ...this.serverState,
      voiceDistanceMultiplier: defaultServerState.voiceDistanceMultiplier,
      playerScale: defaultServerState.playerScale,
      maxSpeed: defaultServerState.maxSpeed,
      acceleration: defaultServerState.acceleration,
    };
    await this.state.storage.put("serverState", this.serverState);
    for (const key of Object.keys(numericSettings)) {
      this.broadcast("updateSetting", { key, value: this.serverState[key] });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const roomName = url.searchParams.get("room") || "main";
      const roomId = env.PASEITO_ROOM.idFromName(roomName);
      const room = env.PASEITO_ROOM.get(roomId);
      return room.fetch(request);
    }

    const mapMatch = url.pathname.match(/^\/api\/maps\/(.+)\/(model|ambient)$/);
    if (mapMatch) {
      const name = decodeURIComponent(mapMatch[1]);
      const kind = mapMatch[2];
      return proxyMapAsset(
        request,
        name,
        kind === "model" ? "sourceUrl" : "ambientSourceUrl",
        kind === "model" ? "model/gltf-binary" : "audio/mpeg",
      );
    }

    return env.ASSETS.fetch(request);
  },
};
