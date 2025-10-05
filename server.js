const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
let games = {};

app.use(express.static("public"));

io.on("connection", (socket) => {

  // === LOGIN ADMIN ===
  socket.on("loginAdmin", ({ roomId, password }, callback) => {
    if (!games[roomId]) {
      games[roomId] = {
        adminPassword: password,
        players: {},
        fase: "entregas",
        eleccionesProduccion: {},
        historial: []
      };
    }

    const game = games[roomId];
    if (game.adminPassword !== password)
      return callback({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId);
    callback({ success: true });
    io.to(roomId).emit("updatePlayers", game.players);
    io.to(roomId).emit("faseActual", game.fase);
    io.to(roomId).emit("updateHistorial", game.historial);
  });

  // === CREAR JUGADOR ===
  socket.on("crearJugador", ({ roomId, nombre, clave, trigo, hierro }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    if (game.players[nombre])
      return callback({ success: false, message: "El jugador ya existe" });

    game.players[nombre] = { nombre, password: clave, trigo, hierro, entregas: 0 };
    io.to(roomId).emit("updatePlayers", game.players);
    callback({ success: true });
  });

  // === LOGIN JUGADOR ===
  socket.on("loginPlayer", ({ roomId, nombre, password }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    const player = game.players[nombre];
    if (!player) return callback({ success: false, message: "Jugador no encontrado" });
    if (player.password !== password)
      return callback({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId + "_" + nombre);
    callback({ success: true, data: player });
    io.to(roomId).emit("updatePlayers", game.players);
    socket.emit("faseActual", game.fase);
    socket.emit("updateHistorial", game.historial);
  });

  // === ENTREGA ===
  socket.on("entrega", ({ roomId, from, to, recurso, cantidad }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.fase !== "entregas")
      return callback({ success: false, message: "No es fase de entregas" });

    const jugadorFrom = game.players[from];
    const jugadorTo = game.players[to];
    if (!jugadorFrom || !jugadorTo)
      return callback({ success: false, message: "Jugador no válido" });
    if (jugadorFrom.entregas >= 5)
      return callback({ success: false, message: "Máximo de 5 entregas alcanzado" });
    if (jugadorFrom[recurso] < cantidad)
      return callback({ success: false, message: "Recursos insuficientes" });

    jugadorFrom[recurso] -= cantidad;
    jugadorTo[recurso] += cantidad;
    jugadorFrom.entregas += 1;

    // Guardar en historial
    game.historial.push({
      from,
      to,
      recurso,
      cantidad,
      timestamp: new Date().toLocaleTimeString()
    });

    io.to(roomId).emit("updatePlayers", game.players);
    io.to(roomId).emit("updateHistorial", game.historial);
    callback({ success: true });
  });

  // === CAMBIAR FASE ===
  socket.on("cambiarFase", ({ roomId, fase }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });

    game.fase = fase;
    if (fase === "produccion") {
      game.eleccionesProduccion = {};
    }
    io.to(roomId).emit("faseActual", game.fase);
    callback({ success: true });
  });

  // === ELEGIR PROCESO ===
  socket.on("elegirProceso", ({ roomId, jugador, proceso }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.fase !== "produccion")
      return callback({ success: false, message: "No es fase de producción" });

    if (game.eleccionesProduccion[jugador])
      return callback({ success: false, message: "Ya eligió producción" });

    game.eleccionesProduccion[jugador] = proceso;
    callback({ success: true });

    if (Object.keys(game.eleccionesProduccion).length === Object.keys(game.players).length) {
      aplicarProduccion(roomId);
    }
  });
});

function aplicarProduccion(roomId) {
  const game = games[roomId];
  if (!game) return;
  const producciones = {};
  const procesosElegidos = {};

  Object.keys(game.players).forEach(jugador => {
    const p = game.players[jugador];
    const proceso = game.eleccionesProduccion[jugador] || 3;
    procesosElegidos[jugador] = proceso;

    const trigoAntes = p.trigo;
    const hierroAntes = p.hierro;

    if (proceso === 1) {
      const factor = Math.min(trigoAntes / 280, hierroAntes / 12);
      p.trigo = Math.floor(factor * 575);
      p.hierro = 0;
    } else if (proceso === 2) {
      const factor = Math.min(trigoAntes / 120, hierroAntes / 8);
      p.hierro = Math.floor(factor * 20);
      p.trigo = 0;
    } else {
      p.trigo = Math.floor(trigoAntes / 2);
      p.hierro = Math.floor(hierroAntes / 2);
    }

    p.entregas = 0;
    producciones[jugador] = {
      trigoProd: p.trigo - trigoAntes,
      hierroProd: p.hierro - hierroAntes,
      proceso
    };
  });

  io.to(roomId).emit("produccionAdmin", producciones);
  Object.keys(game.players).forEach(jugador => {
    io.to(roomId + "_" + jugador).emit("produccionJugador", producciones[jugador]);
  });

  game.fase = "entregas";
  io.to(roomId).emit("faseActual", game.fase);
}

server.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
