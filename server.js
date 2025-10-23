/*
 *
 * This is the server which runs all Websocket and WebRTC communications for our application.
 *
 */

const express = require("express");
const app = express();

let db;
let userCounter = 1;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  db = {
    initialize: async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS boxes (id SERIAL PRIMARY KEY, type VARCHAR(50), data JSONB);`);
      console.log("SUCCESS: Connected to PostgreSQL database.");
    },
    find: async (query, callback) => {
      const result = await pool.query('SELECT type, data FROM boxes');
      callback(null, result.rows);
    },
    insert: async (doc, callback) => {
      await pool.query('INSERT INTO boxes (type, data) VALUES ($1, $2)', [doc.type, doc.data]);
      if (callback) callback(null, doc);
    },
    deleteAll: async (callback) => {
      await pool.query('TRUNCATE TABLE boxes RESTART IDENTITY;');
      if(callback) callback(null);
    }
  };

  db.initialize().catch(err => console.error("Database initialization failed:", err));

} else {
  console.warn("WARNING: No DATABASE_URL found. Database features are disabled for local testing.");
  db = {
    find: (query, callback) => callback(null, []),
    insert: (doc, callback) => { if (callback) callback(null, doc); },
    deleteAll: (callback) => { if(callback) callback(null); }
  };
}

app.use(express.static("public"));

const port = process.env.PORT || 8080;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Webserver is running on http://0.0.0.0:${port}`);
});

const io = require("socket.io")().listen(server);
let peers = {};

const availableMaps = {
    "Resort": {
        url: "https://gustavochico.com/paseito/resort.glb",
        startPosition: [-100, 75, 295],
        skyColors: ['#1a94c4', '#2fc1fe', '#212324ff']
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
const fallbackMap = 'https://gustavochico.com/paseito/resort.glb';

let serverState = {
    currentMapUrl: availableMaps["Resort"].url, // Store URL for simplicity
    availableMaps: availableMaps,
    fallbackMap: fallbackMap,
    voiceDistanceMultiplier: 1.0,
    playerScale: 1.0,
    maxSpeed: 2000,
    acceleration: 600
};


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
      if (peers[socket.id] && data && Array.isArray(data.position) && Array.isArray(data.rotation)) {
        peers[socket.id].position = data.position;
        peers[socket.id].rotation = data.rotation;
        peers[socket.id].isShouting = !!data.isShouting;
      }
    });

    socket.on("data", (data) => {
      db.insert(data, (err) => {
        if (err) return console.error("DB insert error:", err);
        io.sockets.emit("data", data);
      });
    });

    socket.on("signal", (to, from, data) => {
      if (to in peers) io.to(to).emit("signal", to, from, data);
    });

    socket.on("admin:deleteAllObjects", () => {
        console.log(`Admin command: deleteAllObjects received from ${socket.id}`);
        db.deleteAll((err) => {
            if (err) return console.error("DB deleteAll error:", err);
            io.sockets.emit("clearAllObjects");
        });
    });

    socket.on("admin:changeMap", (mapUrl) => {
        const isValidMap = Object.values(availableMaps).some(map => map.url === mapUrl);
        if (isValidMap) {
            console.log(`Admin command: changeMap to ${mapUrl} from ${socket.id}`);
            serverState.currentMapUrl = mapUrl;
            io.sockets.emit("changeMap", mapUrl);
        }
    });

    socket.on("admin:updateSetting", ({ key, value }) => {
        console.log(`Admin command: updateSetting ${key} to ${value} from ${socket.id}`);
        if (key in serverState) {
            serverState[key] = parseFloat(value); // Ensure value is a number
            io.sockets.emit("updateSetting", { key, value: serverState[key] });
        }
    });

    socket.on("admin:broadcastMessage", (message) => {
        console.log(`Admin command: broadcast "${message}" from ${socket.id}`);
        io.sockets.emit("serverMessage", `ADMIN: ${message}`);
    });

    socket.on("admin:teleportAllToMe", () => {
        console.log(`Admin command: teleportAllToMe from ${socket.id}`);
        if (peers[socket.id]) {
            const adminPosition = peers[socket.id].position;
            for (const id in peers) {
                if (id !== socket.id) { // Don't teleport the admin
                    peers[id].position = adminPosition.slice(); // Use slice to create a copy
                }
            }
        }
    });

    socket.on("disconnect", () => {
      delete peers[socket.id];
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(`Peer ${socket.id} diconnected, there are ${io.engine.clientsCount} peer(s) connected.`);
    });
  });
}