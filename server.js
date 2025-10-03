const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Guardamos aquí todas las salas activas
let games = {};

// Servir archivos estáticos (admin.html, player.html, etc.)
app.use(express.static("public"));

// ---- Socket.IO ----
io.on("connection", (socket) => {
  console.log("Un usuario se ha conectado");

  // ---- Login del administrador ----
  socket.on("loginAdmin", ({ roomId, password }, callback) => {
    if (!games[roomId]) {
      // Crear sala nueva si no existe
      games[roomId] = {
        adminPassword: password,
        players: {}
      };
      console.log(`Sala creada: ${roomId}`);
    }

    const game = games[roomId];

    // Verificar contraseña
    if (game.adminPassword !== password) {
      return callback({ success: false, message: "Contraseña incorrecta" });
    }

    socket.join(roomId);
    callback({ success: true });

    // Mandar estado actual al admin que acaba de entrar
    io.to(roomId).emit("updatePlayers", game.players);
  });

  // ---- Crear jugador desde admin ----
  socket.on("crearJugador", ({ roomId, nombre, clave, trigo, hierro }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    if (game.players[nombre]) {
      return callback({ success: false, message: "El jugador ya existe" });
    }

    game.players[nombre] = {
      nombre,
      password: clave,
      trigo,
      hierro,
      entregas: 0
    };

    io.to(roomId).emit("updatePlayers", game.players);
    callback({ success: true });
  });

  // ---- Login de jugador ----
  socket.on("loginPlayer", ({ roomId, nombre, password }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    const player = game.players[nombre];
    if (!player) return callback({ success: false, message: "Jugador no encontrado" });

    if (player.password !== password) {
      return callback({ success: false, message: "Contraseña incorrecta" });
    }

    socket.join(roomId);
    callback({ success: true, data: player });

    // Mandar estado actual al jugador que entra
    io.to(roomId).emit("updatePlayers", game.players);
  });

  // ---- Entrega de recursos ----
  socket.on("entrega", ({ roomId, from, to, recurso, cantidad }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    const jugadorFrom = game.players[from];
    const jugadorTo = game.players[to];

    if (!jugadorFrom || !jugadorTo) {
      return callback({ success: false, message: "Jugador no válido" });
    }

    if (jugadorFrom.entregas >= 5) {
      return callback({ success: false, message: "Máximo de 5 entregas alcanzado" });
    }

    if (jugadorFrom[recurso] < cantidad) {
      return callback({ success: false, message: "Recursos insuficientes" });
    }

    // Transferencia
    jugadorFrom[recurso] -= cantidad;
    jugadorTo[recurso] += cantidad;
    jugadorFrom.entregas += 1;

    io.to(roomId).emit("updatePlayers", game.players);
    callback({ success: true });
  });

  // ---- Desconexión ----
  socket.on("disconnect", () => {
    console.log("Un usuario se ha desconectado");
  });
});

// ---- Iniciar servidor ----
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
