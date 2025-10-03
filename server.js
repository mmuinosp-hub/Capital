const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Estado de juegos
let games = {}; 
// Estructura:
// games[roomId] = { adminPassword, players: { nombre: { password, trigo, hierro, entregas } } }

// Generador de IDs simple
function generateRoomId(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Crear sala (admin)
  socket.on("createRoom", ({ adminPassword, jugadores }, callback) => {
    let roomId;
    do {
      roomId = generateRoomId();
    } while (games[roomId]); // asegura que no se repita

    const playersObj = {};
    jugadores.forEach(j => {
      playersObj[j.nombre] = {
        password: j.password,
        trigo: 500,
        hierro: 50,
        entregas: 0
      };
    });
    games[roomId] = {
      adminPassword,
      players: playersObj
    };
    socket.join(roomId);
    callback({ success: true, roomId });
  });

  // Login admin
  socket.on("loginAdmin", ({ roomId, password }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.adminPassword !== password) return callback({ success: false, message: "Contraseña incorrecta" });
    socket.join(roomId);
    callback({ success: true, players: game.players });
  });

  // Login jugador
  socket.on("loginPlayer", ({ roomId, nombre, password }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    const player = game.players[nombre];
    if (!player || player.password !== password) return callback({ success: false, message: "Credenciales incorrectas" });
    socket.join(roomId);
    callback({ success: true, data: player });
  });

  // Entregas
  socket.on("entrega", ({ roomId, from, to, recurso, cantidad }, callback) => {
    const game = games[roomId];
    if (!game || !game.players[from] || !game.players[to]) return;
    const sender = game.players[from];
    const receiver = game.players[to];

    if (sender.entregas >= 5) return callback({ success: false, message: "Máximo 5 entregas alcanzado" });
    if (sender[recurso] < cantidad) return callback({ success: false, message: "Recursos insuficientes" });

    sender[recurso] -= cantidad;
    sender.entregas += 1;
    receiver[recurso] += cantidad;

    io.to(roomId).emit("updatePlayers", game.players);
    callback({ success: true });
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Servidor escuchando en puerto " + port));
