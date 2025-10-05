const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

let salas = {};

io.on("connection", socket => {
  console.log("🔗 Usuario conectado:", socket.id);

  // === LOGIN ADMIN ===
  socket.on("loginAdmin", ({ roomId, password }, cb) => {
    if (!salas[roomId]) {
      salas[roomId] = {
        adminPassword: password,
        jugadores: {},
        fase: "inicio",
        historial: []
      };
      console.log("🆕 Sala creada:", roomId);
      cb({ success: true });
    } else if (salas[roomId].adminPassword === password) {
      cb({ success: true });
    } else cb({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId);
    actualizar(roomId);
  });

  // === CREAR JUGADOR ===
  socket.on("crearJugador", ({ roomId, nombre, password, trigo, hierro }, cb) => {
    const sala = salas[roomId];
    if (!sala) return cb({ success: false, message: "Sala no encontrada" });

    sala.jugadores[nombre] = {
      password,
      trigo: parseFloat(trigo) || 0,
      hierro: parseFloat(hierro) || 0,
      entregas: 0,
      proceso: null,
      trigoProd: 0,
      hierroProd: 0
    };

    console.log(`👤 Jugador creado: ${nombre} (${roomId}) con contraseña: ${password}`);
    actualizar(roomId);
    cb({ success: true });
  });

  // === LOGIN JUGADOR ===
  socket.on("loginJugador", ({ roomId, nombre, password }, cb) => {
    const sala = salas[roomId];
    if (!sala || !sala.jugadores[nombre])
      return cb({ success: false, message: "Sala o jugador no encontrado" });
    if (sala.jugadores[nombre].password !== password)
      return cb({ success: false, message: "Contraseña incorrecta" });

    socket.join(roomId);
    socket.data = { roomId, nombre };
    cb({ success: true, jugador: sala.jugadores[nombre], fase: sala.fase });
    actualizar(roomId);
  });

  // === ABRIR/CERRAR FASE DE ENTREGAS ===
  socket.on("setFase", ({ roomId, fase }, cb) => {
    const sala = salas[roomId];
    if (!sala) return;
    sala.fase = fase;
    console.log(`⚙️ Fase cambiada a ${fase} en ${roomId}`);
    actualizar(roomId);
    cb && cb({ success: true });
  });

  // === ENTREGA ===
  socket.on("entregar", ({ roomId, from, to, recurso, cantidad }, cb) => {
    const sala = salas[roomId];
    if (!sala || sala.fase !== "entregas")
      return cb({ success: false, message: "No se pueden hacer entregas ahora" });

    const jugadorFrom = sala.jugadores[from];
    const jugadorTo = sala.jugadores[to];
    cantidad = parseFloat(cantidad);

    if (!jugadorFrom || !jugadorTo)
      return cb({ success: false, message: "Jugador no encontrado" });
    if (jugadorFrom[recurso] < cantidad)
      return cb({ success: false, message: "Recursos insuficientes" });

    jugadorFrom[recurso] -= cantidad;
    jugadorTo[recurso] += cantidad;
    jugadorFrom.entregas++;
    sala.historial.push({
      from, to, recurso, cantidad,
      timestamp: new Date().toLocaleTimeString()
    });

    actualizar(roomId);
    cb({ success: true });
  });

  // === SELECCIONAR PROCESO ===
  socket.on("elegirProceso", ({ roomId, nombre, proceso }, cb) => {
    const sala = salas[roomId];
    if (!sala || sala.fase !== "produccion")
      return cb({ success: false, message: "No se puede elegir proceso ahora" });

    const jugador = sala.jugadores[nombre];
    if (!jugador) return cb({ success: false, message: "Jugador no encontrado" });
    if (jugador.proceso) return cb({ success: false, message: "Ya elegiste proceso" });

    jugador.proceso = proceso;
    actualizar(roomId);
    cb({ success: true });
  });

  // === CONCLUIR PRODUCCIÓN ===
socket.on("concluirProduccion", ({ roomId }, cb) => {
  const sala = salas[roomId];
  if (!sala) return;

  for (let nombre in sala.jugadores) {
    const j = sala.jugadores[nombre];
    if (!j.proceso) j.proceso = 3;

    // Guardamos los insumos actuales antes de modificar nada
    const trigoDisp = j.trigo;
    const hierroDisp = j.hierro;

    let trigoProd = 0, hierroProd = 0;

    switch (j.proceso) {
      case 1:
        trigoProd = 575 * Math.min(trigoDisp / 280, hierroDisp / 12);
        hierroProd = 0;
        j.trigo = trigoProd;
        j.hierro = 0;
        break;
      case 2:
        trigoProd = 0;
        hierroProd = 20 * Math.min(trigoDisp / 120, hierroDisp / 8);
        j.trigo = 0;
        j.hierro = hierroProd;
        break;
      case 3:
      default:
        trigoProd = trigoDisp / 2;
        hierroProd = hierroDisp / 2;
        j.trigo = trigoProd;
        j.hierro = hierroProd;
    }

    // Guardamos productos por separado para mostrar
    j.trigoProd = trigoProd;
    j.hierroProd = hierroProd;
  }

  sala.fase = "fin";
  actualizar(roomId);
  cb && cb({ success: true });
});

// Función para actualizar todas las consolas
function actualizar(roomId) {
  const sala = salas[roomId];
  if (!sala) return;
  io.to(roomId).emit("updatePlayers", sala.jugadores);
  io.to(roomId).emit("updateHistorial", sala.historial);
  io.to(roomId).emit("updateFase", sala.fase);
}

server.listen(3000, () => console.log("🚀 Servidor escuchando en puerto 3000"));

