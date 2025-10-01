/*
 *
 * This is the server which runs all Websocket and WebRTC communications for our application.
 *
 */

const express = require("express");
const app = express();

let db;
// --- SOLUTION: Counter for sequential user names ---
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

    // --- SOLUTION: Assign a sequential name to the new user ---
    const userName = "User " + userCounter++;
    peers[socket.id] = { 
      position: [0, 0.5, 0], 
      rotation: [0, 0, 0, 1],
      name: userName
    };

    // --- SOLUTION: Send the entire peers object with names ---
    socket.emit("introduction", peers);
    socket.emit("userPositions", peers);

    db.find({}, (err, docs) => {
      if (err) return console.error("DB find error:", err);
      if (docs) docs.forEach(doc => socket.emit("data", doc));
    });

    // --- SOLUTION: Send new peer's data (including name) to others ---
    socket.broadcast.emit("peerConnection", socket.id, peers[socket.id]);

    socket.on("move", (data) => {
      if (peers[socket.id]) {
        peers[socket.id].position = data[0];
        peers[socket.id].rotation = data[1];
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

    // --- SOLUTION: Add handlers for new admin commands ---
    socket.on("admin:broadcastMessage", (message) => {
        console.log(`Admin command: broadcast "${message}" from ${socket.id}`);
        io.sockets.emit("serverMessage", `ADMIN: ${message}`);
    });

    socket.on("admin:teleportAll", () => {
        console.log(`Admin command: teleportAll from ${socket.id}`);
        for (const id in peers) {
            peers[id].position = [0, 20, 0]; // Teleport to center
        }
    });

    socket.on("disconnect", () => {
      delete peers[socket.id];
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(`Peer ${socket.id} diconnected, there are ${io.engine.clientsCount} peer(s) connected.`);
    });
  });
}