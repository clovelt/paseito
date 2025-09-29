/*
 *
 * This is the server which runs all Websocket and WebRTC communications for our application.
 *
 */

// Set up an express application to run the server
const express = require("express");
const app = express();
const { Pool } = require('pg'); // <-- ADD a PG Pool

// tell our express application to serve the 'public' folder
app.use(express.static("public"));

// tell the server to listen on a given port
const port = process.env.PORT || 8080;
const server = app.listen(port, "0.0.0.0", () => {
  console.log("Webserver is running on http://0.0.0.0:" + port);
});

// We will use the socket.io library to manage Websocket connections
const io = require("socket.io")().listen(server);

// --- DATABASE SETUP ---
// Create a Pool to manage database connections.
// It automatically uses the DATABASE_URL environment variable on Render.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On Render, we need to enable SSL but not reject unauthorized connections
  // For local development, you might not need SSL.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Function to ensure our 'boxes' table exists
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50),
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("Database initialized and 'boxes' table is ready.");
  } catch (err) {
    console.error("Error initializing database:", err);
  } finally {
    client.release();
  }
}

// We will use this object to store information about active peers
let peers = {};

function main() {
  initializeDatabase(); // <-- Run the database setup
  setupSocketServer();

  // periodically update all peers with their positions
  setInterval(function () {
    io.sockets.emit("positions", peers);
  }, 100);
}

main();

async function setupSocketServer() {
  // Set up each socket connection
  io.on("connection", async (socket) => {
    console.log(
      "Peer joined with ID",
      socket.id,
      ". There are " + io.engine.clientsCount + " peer(s) connected."
    );

    // add a new peer indexed by their socket id
    peers[socket.id] = {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1], // stored as XYZW values of Quaternion
    };

    socket.emit("introduction", Object.keys(peers));
    socket.emit("userPositions", peers);

    // --- MODIFIED: Get existing boxes from PostgreSQL ---
    try {
      const result = await pool.query('SELECT type, data FROM boxes ORDER BY created_at ASC');
      result.rows.forEach(row => socket.emit("data", row));
    } catch (err) {
      console.error("Error fetching data from DB:", err);
    }

    io.emit("peerConnection", socket.id);

    socket.on("move", (data) => {
      if (peers[socket.id]) {
        peers[socket.id].position = data[0];
        peers[socket.id].rotation = data[1];
      }
    });

    // --- MODIFIED: Save new boxes to PostgreSQL ---
    socket.on("data", async (data) => {
      try {
        await pool.query('INSERT INTO boxes (type, data) VALUES ($1, $2)', [data.type, data.data]);
        io.sockets.emit("data", data);
      } catch (err) {
        console.error("Error saving data to DB:", err);
      }
    });

    socket.on("signal", (to, from, data) => {
      if (to in peers) {
        io.to(to).emit("signal", to, from, data);
      } else {
        console.log("Peer not found!");
      }
    });

    socket.on("disconnect", () => {
      delete peers[socket.id];
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(
        "Peer " + socket.id + " diconnected, there are " + io.engine.clientsCount + " peer(s) connected."
      );
    });
  });
}