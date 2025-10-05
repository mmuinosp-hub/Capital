// === server.js ===
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const games = {}; // Estructura: { roomId: { adminPassword, players, fase, historial } }

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // === ADMIN LOGIN ===
  socket.on("loginAdmin", ({ roomId, password }, callback) => {
    if (!games[roomId]) {
      games[roomId] = {
        adminPassword: password,
        players: {},
        fase: "entregas",
        historial: [],
        producciones: {}
      };
    }
    const game = games[roomId];
    if (game.adminPassword !== password)
      return callback({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId);
    callback({ success: true });
    io.to(roomId).emit("updatePlayers", game.players);
    io.to(roomId).emit("updateHistorial", game.historial);
  });

  // === CREAR JUGADOR (ADMIN) ===
  socket.on("crearJugador", ({ roomId, nombre, password, trigo, hierro }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.players[nombre])
      return callback({ success: false, message: "Jugador ya existe" });

    game.players[nombre] = {
      password,
      trigo: parseFloat(trigo),
      hierro: parseFloat(hierro),
      entregas: 0,
      proceso: null,
      trigoProd: 0,
      hierroProd: 0
    };
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

    socket.join(roomId);
    socket.data = { roomId, nombre };
    callback({ success: true, data: player });

    io.to(roomId).emit("updatePlayers", game.players);
    socket.emit("updateHistorial", game.historial);
    socket.emit("faseActual", game.fase);
  });

  // === ENTREGA ===
  socket.on("entrega", ({ roomId, from, to, recurso, cantidad }, callback) => {
    const game = games[roomId];
    if (!game) return callback({ success: false, message: "Sala no encontrada" });
    if (game.fase !== "entregas")
      return callback({ success: false, message: "Las entregas están cerradas" });

    const jugadorFrom = game.players[from];
    const jugadorTo = game.players[to];
    if (!jugadorFrom || !jugadorTo)
      return callback({ success: false, message: "Jugador inválido" });
    if (jugadorFrom.entregas >= 5)
      return callback({ success: false, message: "Límite de 5 entregas alcanzado" });

    if (jugadorFrom[recurso] < cantidad)
      return callback({ success: false, message: "Recursos insuficientes" });

    jugadorFrom[recurso] -= cantidad;
    jugadorTo[recurso] += cantidad;
    jugadorFrom.entregas++;

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

  // === CONTROL DE FASE ===
  socket.on("setFase", ({ roomId, fase }, callback) => {
    const game = games[roomId];
    if (!game) return;
    game.fase = fase;
    io.to(roomId).emit("faseActual", fase);

    if (fase === "entregas") {
      Object.values(game.players).forEach(p => (p.entregas = 0));
    }

    if (fase === "produccion") {
      Object.values(game.players).forEach(p => (p.proceso = null));
    }

    io.to(roomId).emit("updatePlayers", game.players);
    callback && callback({ success: true });
  });

  // === ELEGIR PROCESO ===
  socket.on("elegirProceso", ({ roomId, jugador, proceso }, callback) => {
    const game = games[roomId];
    if (!game || game.fase !== "produccion")
      return callback({ success: false, message: "No está abierta la producción" });

    const player = game.players[jugador];
    if (!player) return callback({ success: false, message: "Jugador no encontrado" });
    if (player.proceso) return callback({ success: false, message: "Ya elegiste proceso" });

    player.proceso = proceso;
    callback({ success: true });

    const totalJugadores = Object.keys(game.players).length;
    const elegidos = Object.values(game.players).filter(p => p.proceso).length;
    if (elegidos === totalJugadores) aplicarProduccion(game, roomId);
  });

  function aplicarProduccion(game, roomId) {
    Object.keys(game.players).forEach(nombre => {
      const p = game.players[nombre];
      let trigoProd = 0, hierroProd = 0;

      if (p.proceso === 1) {
        const factor = Math.min(p.trigo / 280, p.hierro / 12);
        trigoProd = 575 * factor;
        p.trigo = trigoProd;
        p.hierro = 0;
      } else if (p.proceso === 2) {
        const factor = Math.min(p.trigo / 120, p.hierro / 8);
        hierroProd = 20 * factor;
        p.hierro = hierroProd;
        p.trigo = 0;
      } else {
        p.trigo /= 2;
        p.hierro /= 2;
      }

      p.trigoProd = trigoProd;
      p.hierroProd = hierroProd;
    });

    io.to(roomId).emit("updatePlayers", game.players);

    // Notificar a cada jugador su producción
    Object.keys(game.players).forEach(nombre => {
      const p = game.players[nombre];
      io.to(roomId).emit("produccionJugador", {
        jugador: nombre,
        trigoProd: p.trigoProd,
        hierroProd: p.hierroProd
      });
    });
  }

  socket.on("disconnect", () => {
    console.log("Desconectado:", socket.id);
  });
});

server.listen(PORT, () => console.log("Servidor activo en puerto", PORT));
