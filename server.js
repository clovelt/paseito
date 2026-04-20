/*
 *
 * This is the server which runs all Websocket and WebRTC communications for our application.
 *
 */

const express = require("express");
const { Readable } = require("stream");
const app = express();

let db;
let userCounter = 1;
const worldObjects = [];

db = {
  find: (query, callback) => callback(null, worldObjects.slice()),
  insert: (doc, callback) => {
    worldObjects.push(doc);
    if (callback) callback(null, doc);
  },
  deleteAll: (callback) => {
    worldObjects.length = 0;
    if(callback) callback(null);
  }
};

app.use(express.static("public"));

const port = process.env.PORT || 8080;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Webserver is running on http://0.0.0.0:${port}`);
});

const io = require("socket.io")().listen(server);
let peers = {};
const adminSockets = new Set();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gazpacho";

const availableMaps = {
    "Resort": {
        url: "https://gustavochico.com/paseito/resort.glb",
        startPosition: [-100, 75, 295],
        skyColors: ['#1a94c4', '#2fc1fe', '#212324ff'],
        ambientTrack: "https://gustavochico.com/paseito/ambient_resort.mp3"
    },
    "Wind Waker": {
        url: "https://gustavochico.com/paseito/windWaker.glb",
        startPosition: [0, 0, 0],
        skyColors: ['#1a94c4', '#2fc1fe', '#a0d8ef']
    },
    "Dust2": {
        url: "https://gustavochico.com/paseito/dedust2.glb",
        startPosition: [80, 850, 0],
        skyColors: ['#5c6e80', '#829ab1', '#d9e2ec']
    },
    "Rainbow Road": {
        url: "https://gustavochico.com/paseito/rainbowRoad.glb",
        startPosition: [1210, 615, 580],
        skyColors: ['#000000ff', '#173b5cff', '#000000ff']
    },
    "Shinobi Earth": {
        url: "https://gustavochico.com/paseito/shinobi.glb",
        startPosition: [0, 0, 0],
        skyColors: ['#1a94c4', '#2fc1fe', '#212324ff']
    },
    "The Catacombs": {
        url: "https://gustavochico.com/paseito/catacombs.glb",
        startPosition: [10, 0, 100],
        skyColors: ['#2b2e2fff', '#212324ff', '#131414ff']
    },
    "Anor Londo PELIGRO NO ES BROMA": {
        url: "https://gustavochico.com/paseito/anorLondo.glb",
        startPosition: [0, 0, 0],
        skyColors: ['#1a94c4', '#2fc1fe', '#212324ff']
    }
};

for (const [name, map] of Object.entries(availableMaps)) {
    const encodedName = encodeURIComponent(name);
    map.sourceUrl = map.url;
    map.url = `/api/maps/${encodedName}/model`;
    if (map.ambientTrack) {
        map.ambientSourceUrl = map.ambientTrack;
        map.ambientTrack = `/api/maps/${encodedName}/ambient`;
    }
}

const fallbackMap = availableMaps.Resort.url;

async function proxyMapAsset(req, res, assetKey, contentType) {
    const map = availableMaps[req.params.name];
    const sourceUrl = map?.[assetKey];
    if (!sourceUrl) {
        res.status(404).send("Map asset not found");
        return;
    }

    try {
        const upstream = await fetch(sourceUrl, {
            headers: {
                "Accept": "application/octet-stream,*/*",
                "User-Agent": "undici"
            }
        });
        if (!upstream.ok || !upstream.body) {
            res.status(upstream.status || 502).send("Unable to fetch map asset");
            return;
        }

        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Content-Type", contentType);
        Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
        console.error(`Failed to proxy ${sourceUrl}:`, error);
        res.status(502).send("Unable to fetch map asset");
    }
}

app.get("/api/maps/:name/model", (req, res) => {
    proxyMapAsset(req, res, "sourceUrl", "model/gltf-binary");
});

app.get("/api/maps/:name/ambient", (req, res) => {
    proxyMapAsset(req, res, "ambientSourceUrl", "audio/mpeg");
});

let serverState = {
    currentMapUrl: availableMaps["Resort"].url, // Store URL for simplicity
    availableMaps: availableMaps,
    fallbackMap: fallbackMap,
    voiceDistanceMultiplier: 1.0,
    playerScale: 1.0,
    maxSpeed: 2000,
    acceleration: 600,
    fallbackAmbientTrack: "https://gustavochico.com/paseito/ambient_resort.mp3"
};

const defaultServerState = { ...serverState };
const numericSettings = {
    voiceDistanceMultiplier: { min: 0.25, max: 8 },
    playerScale: { min: 0.2, max: 3 },
    maxSpeed: { min: 100, max: 2500 },
    acceleration: { min: 100, max: 2500 }
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
            text
        }
    };
}

function requireAdmin(socket, action) {
    if (adminSockets.has(socket.id)) return true;
    console.warn(`Rejected admin command "${action}" from unauthenticated socket ${socket.id}`);
    socket.emit("serverMessage", "Admin command rejected. Unlock the admin panel first.");
    return false;
}

function getPeerSnapshot() {
    return {
        peers: Object.entries(peers).map(([id, peer]) => ({
            id,
            name: peer.name,
            position: peer.position,
            isShouting: !!peer.isShouting
        })),
        state: serverState,
        objectCount: null
    };
}

function main() {
  setupSocketServer();
  setInterval(() => {
    io.sockets.emit("positions", peers);
  }, 100);
}

main();

function setupSocketServer() {
  io.on("connection", (socket) => {
    console.log(`Peer joined with ID ${socket.id}. There are ${io.engine.clientsCount} peer(s) connected.`);

    // Assign a sequential name to the new user
    const userName = "User " + userCounter++;
    peers[socket.id] = { 
      position: [0, 0.5, 0], 
      rotation: [0, 0, 0, 1],
      name: userName,
      isShouting: false
    };

    // Send the entire peers object with names and current server state
    socket.emit("introduction", { peers: peers, state: serverState });

    db.find({}, (err, docs) => {
      if (err) return console.error("DB find error:", err);
      if (docs) docs.forEach(doc => socket.emit("data", doc));
    });

    // Send new peer's data (including name) to others
    socket.broadcast.emit("peerConnection", socket.id, peers[socket.id]);

    socket.on("move", (data) => {
      // Add validation to prevent server state corruption
      if (peers[socket.id] && data && isVector3(data.position) && isQuaternion(data.rotation)) {
        peers[socket.id].position = data.position;
        peers[socket.id].rotation = data.rotation;
        peers[socket.id].isShouting = !!data.isShouting;
      }
    });

    socket.on("data", (data) => {
      const sanitized = sanitizeWorldData(data);
      if (!sanitized) return;
      db.insert(sanitized, (err) => {
        if (err) return console.error("DB insert error:", err);
        io.sockets.emit("data", sanitized);
      });
    });

    socket.on("signal", (to, from, data) => {
      if (to in peers) io.to(to).emit("signal", to, from, data);
    });

    socket.on("admin:auth", (password, callback) => {
        const ok = password === ADMIN_PASSWORD;
        if (ok) {
            adminSockets.add(socket.id);
            console.log(`Admin unlocked for ${socket.id}`);
        } else {
            console.warn(`Failed admin unlock attempt from ${socket.id}`);
        }
        if (callback) callback({ ok, snapshot: ok ? getPeerSnapshot() : null });
    });

    socket.on("admin:getSnapshot", (callback) => {
        if (!requireAdmin(socket, "getSnapshot")) return;
        db.find({}, (err, docs) => {
            const snapshot = getPeerSnapshot();
            snapshot.objectCount = err || !docs ? null : docs.length;
            if (callback) callback(snapshot);
        });
    });

    socket.on("admin:deleteAllObjects", () => {
        if (!requireAdmin(socket, "deleteAllObjects")) return;
        console.log(`Admin command: deleteAllObjects received from ${socket.id}`);
        db.deleteAll((err) => {
            if (err) return console.error("DB deleteAll error:", err);
            io.sockets.emit("clearAllObjects");
        });
    });

    socket.on("admin:changeMap", (mapUrl) => {
        if (!requireAdmin(socket, "changeMap")) return;
        const isValidMap = Object.values(availableMaps).some(map => map.url === mapUrl);
        if (isValidMap) {
            console.log(`Admin command: changeMap to ${mapUrl} from ${socket.id}`);
            serverState.currentMapUrl = mapUrl;
            io.sockets.emit("changeMap", mapUrl);
        }
    });

    socket.on("admin:updateSetting", ({ key, value }) => {
        if (!requireAdmin(socket, "updateSetting")) return;
        console.log(`Admin command: updateSetting ${key} to ${value} from ${socket.id}`);
        if (key in numericSettings) {
            const range = numericSettings[key];
            const parsed = clampNumber(value, range.min, range.max);
            if (parsed === null) return;
            serverState[key] = parsed;
            io.sockets.emit("updateSetting", { key, value: serverState[key] });
        }
    });

    socket.on("admin:broadcastMessage", (message) => {
        if (!requireAdmin(socket, "broadcastMessage")) return;
        if (typeof message !== "string" || !message.trim()) return;
        console.log(`Admin command: broadcast "${message}" from ${socket.id}`);
        io.sockets.emit("serverMessage", `ADMIN: ${message.trim().slice(0, 300)}`);
    });

    socket.on("admin:teleportAllToMe", () => {
        if (!requireAdmin(socket, "teleportAllToMe")) return;
        console.log(`Admin command: teleportAllToMe from ${socket.id}`);
        if (peers[socket.id]) {
            const adminPosition = peers[socket.id].position;
            for (const id in peers) {
                if (id !== socket.id) { // Don't teleport the admin
                    peers[id].position = adminPosition.slice(); // Use slice to create a copy
                }
            }
            io.sockets.emit("positions", peers);
        }
    });

    socket.on("admin:respawnAll", () => {
        if (!requireAdmin(socket, "respawnAll")) return;
        const currentMap = Object.values(availableMaps).find(map => map.url === serverState.currentMapUrl) || availableMaps.Resort;
        for (const id in peers) {
            peers[id].position = currentMap.startPosition.slice();
        }
        io.sockets.emit("positions", peers);
        io.sockets.emit("serverMessage", "ADMIN: Everyone was sent back to spawn.");
    });

    socket.on("admin:resetSettings", () => {
        if (!requireAdmin(socket, "resetSettings")) return;
        serverState.voiceDistanceMultiplier = defaultServerState.voiceDistanceMultiplier;
        serverState.playerScale = defaultServerState.playerScale;
        serverState.maxSpeed = defaultServerState.maxSpeed;
        serverState.acceleration = defaultServerState.acceleration;
        for (const key of Object.keys(numericSettings)) {
            io.sockets.emit("updateSetting", { key, value: serverState[key] });
        }
    });

    socket.on("disconnect", () => {
      delete peers[socket.id];
      adminSockets.delete(socket.id);
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(`Peer ${socket.id} disconnected, there are ${io.engine.clientsCount} peer(s) connected.`);
    });
  });
}
