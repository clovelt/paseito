/*
 *
 * This is the server which runs all Websocket and WebRTC communications for our application.
 *
 */

const express = require("express");
const app = express();

let db;

// Check if we are in a production environment (like Render)
// The DATABASE_URL is only set on Render.
if (process.env.DATABASE_URL) {
  // --- PRODUCTION CODE ---
  // Only require 'pg' if we are in production. This prevents local crashes.
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Create the real database interface
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
    // --- SOLUTION: Add deleteAll method for admin panel ---
    deleteAll: async (callback) => {
      await pool.query('TRUNCATE TABLE boxes RESTART IDENTITY;');
      if(callback) callback(null);
    }
  };

  db.initialize().catch(err => console.error("Database initialization failed:", err));

} else {
  // --- LOCAL DEVELOPMENT CODE ---
  console.warn("WARNING: No DATABASE_URL found. Database features are disabled for local testing.");
  // Create a fake database object that does nothing but prevents crashes.
  db = {
    find: (query, callback) => callback(null, []), // Always return empty array
    insert: (doc, callback) => { if (callback) callback(null, doc); }, // Pretend to save
    // --- SOLUTION: Add deleteAll method for local dev ---
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

    peers[socket.id] = { position: [0, 0.5, 0], rotation: [0, 0, 0, 1] };

    socket.emit("introduction", Object.keys(peers));
    socket.emit("userPositions", peers);

    db.find({}, (err, docs) => {
      if (err) return console.error("DB find error:", err);
      if (docs) docs.forEach(doc => socket.emit("data", doc));
    });

    io.emit("peerConnection", socket.id);

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

    // --- SOLUTION: Add listener for the admin delete command ---
    socket.on("admin:deleteAllObjects", () => {
        console.log(`Admin command: deleteAllObjects received from ${socket.id}`);
        db.deleteAll((err) => {
            if (err) return console.error("DB deleteAll error:", err);
            // Tell all clients to clear the objects from their scenes
            io.sockets.emit("clearAllObjects");
        });
    });

    socket.on("disconnect", () => {
      delete peers[socket.id];
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(`Peer ${socket.id} diconnected, there are ${io.engine.clientsCount} peer(s) connected.`);
    });
  });
}