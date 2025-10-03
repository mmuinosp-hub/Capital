const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Guardamos aquí todas las salas activas
let games = {};

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Un usuario se ha conectado");

  // Login administrador
  socket.on("loginAdmin", ({ roomId, password }, callback) => {
    if (!games[roomId]) {
      games[roomId] = {
        adminPassword: password,
        players: {},
        fase: "entregas",
        eleccionesProduccion: {}
      };
    }

    const game = games[roomId];
    if (game.adminPassword !== password) {
      return callback({ success: false, message: "Contraseña incorrecta" });
    }

    socket.join(roomId);
    callback({ success: true });
    io.to(roomId).emit("updatePlayers", game.players);
    io.to(roomId).emit("faseActual", game.fase);
  });

  // Crear jugador
  socket.on("crearJugador", ({ roomId, nombre, clave, trigo, hierro }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    if (game.players[nombre]) return callback({ success: false, message: "El jugador ya existe" });

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

  // Login jugador
  socket.on("loginPlayer", ({ roomId, nombre, password }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    const player = game.players[nombre];
    if (!player) return callback({ success: false, message: "Jugador no encontrado" });

    if (player.password !== password) return callback({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId);
    callback({ success: true, data: player });
    io.to(roomId).emit("updatePlayers", game.players);
    io.to(roomId).emit("faseActual", game.fase);
  });

  // Entrega de recursos
  socket.on("entrega", ({ roomId, from, to, recurso, cantidad }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.fase !== "entregas") return callback({ success: false, message: "No es fase de entregas" });

    const jugadorFrom = game.players[from];
    const jugadorTo = game.players[to];

    if (!jugadorFrom || !jugadorTo) return callback({ success: false, message: "Jugador no válido" });
    if (jugadorFrom.entregas >= 5) return callback({ success: false, message: "Máximo de 5 entregas alcanzado" });
    if (jugadorFrom[recurso] < cantidad) return callback({ success: false, message: "Recursos insuficientes" });

    jugadorFrom[recurso] -= cantidad;
    jugadorTo[recurso] += cantidad;
    jugadorFrom.entregas += 1;

    io.to(roomId).emit("updatePlayers", game.players);
    callback({ success: true });
  });

  // Cambiar fase
  socket.on("cambiarFase", ({ roomId, fase }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    game.fase = fase;
    if (fase === "produccion") game.eleccionesProduccion = {};

    io.to(roomId).emit("faseActual", game.fase);
    callback({ success: true });
  });

  // Elegir proceso de producción
  socket.on("elegirProceso", ({ roomId, jugador, proceso }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.fase !== "produccion") return callback({ success: false, message: "No es fase de producción" });

    game.eleccionesProduccion[jugador] = proceso;
    callback({ success: true });

    // Aplicar producción si todos eligieron
    if (Object.keys(game.eleccionesProduccion).length === Object.keys(game.players).length) {
      aplicarProduccion(roomId);
    }
  });

  // Desconexión
  socket.on("disconnect", () => {
    console.log("Un usuario se ha desconectado");
  });
});

// Función para aplicar producción
function aplicarProduccion(roomId) {
  const game = games[roomId];
  if (!game) return;

  Object.keys(game.players).forEach(jugador => {
    const p = game.players[jugador];
    const proceso = game.eleccionesProduccion[jugador] || 3;

    const trigo = p.trigo;
    const hierro = p.hierro;

    if (proceso === 1) {
      const factor = Math.min(trigo / 280, hierro / 12);
      p.trigo = Math.floor(factor * 575);
      p.hierro = 0;
    } else if (proceso === 2) {
      const factor = Math.min(trigo / 120, hierro / 8);
      p.hierro = Math.floor(factor * 20);
      p.trigo = 0;
    } else {
      p.trigo = Math.floor(trigo / 2);
      p.hierro = Math.floor(hierro / 2);
    }

    p.entregas = 0; // reset para siguiente ronda
  });

  io.to(roomId).emit("updatePlayers", game.players);
  game.fase = "entregas";
  io.to(roomId).emit("faseActual", game.fase);
}

server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
