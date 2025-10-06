const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const salas = {};

function generarId() {
  return Math.random().toString(36).substring(2, 10);
}

// === Conexión de clientes ===
io.on("connection", (socket) => {

  // Crear sala
  socket.on("crearSala", ({ sala, password }) => {
    if (salas[sala]) return socket.emit("salaExiste");
    salas[sala] = {
      adminPassword: password,
      jugadores: {},
      entregasAbiertas: false,
      produccionAbierta: false,
      historial: [],
      historialEntregas: [],
      historialProduccion: []
    };
    socket.join(sala);
    socket.emit("salaCreada", sala);
  });

  // Entrar como admin
  socket.on("entrarAdmin", ({ sala, password }) => {
    const room = salas[sala];
    if (!room) return socket.emit("error", "Sala no existe");
    if (room.adminPassword !== password) return socket.emit("error", "Contraseña incorrecta");
    socket.join(sala);
    socket.emit("adminEntrado", sala);
    io.to(sala).emit("actualizarEstado", room);
  });

  // Crear jugador
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const room = salas[sala];
    if (!room) return socket.emit("error", "Sala no existe");
    if (room.jugadores[nombre]) return socket.emit("error", "Jugador ya existe");

    room.jugadores[nombre] = {
      password,
      trigoInsumo: parseFloat(trigo) || 0,
      hierroInsumo: parseFloat(hierro) || 0,
      trigoProd: parseFloat(trigo) || 0,
      hierroProd: parseFloat(hierro) || 0,
      trigo: parseFloat(trigo) || 0,
      hierro: parseFloat(hierro) || 0,
      entregasDisponibles: 5,
      proceso: null
    };
    io.to(sala).emit("actualizarEstado", room);
  });

  // Entrar como jugador
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const room = salas[sala];
    if (!room) return socket.emit("error", "Sala no existe");
    const jugador = room.jugadores[nombre];
    if (!jugador) return socket.emit("error", "Jugador no existe");
    if (jugador.password !== password) return socket.emit("error", "Contraseña incorrecta");
    socket.join(sala);
    socket.emit("actualizarEstado", room);
  });

  // Enviar entrega
  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const room = salas[sala];
    if (!room || !room.entregasAbiertas) return;
    const jDe = room.jugadores[de];
    const jPara = room.jugadores[para];
    if (!jDe || !jPara) return;

    trigo = Math.min(parseFloat(trigo) || 0, jDe.trigo);
    hierro = Math.min(parseFloat(hierro) || 0, jDe.hierro);

    jDe.trigo -= trigo;
    jDe.hierro -= hierro;
    jPara.trigo += trigo;
    jPara.hierro += hierro;

    jDe.trigoInsumo = jDe.trigo;
    jDe.hierroInsumo = jDe.hierro;
    jPara.trigoInsumo = jPara.trigo;
    jPara.hierroInsumo = jPara.hierro;

    jDe.entregasDisponibles--;

    const entrega = {
      de, para, trigo, hierro, fecha: new Date().toLocaleString()
    };
    room.historial.push(entrega);
    room.historialEntregas.push(entrega);

    io.to(sala).emit("actualizarEstado", room);
  });

  // Elegir proceso de producción
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const room = salas[sala];
    if (!room || !room.produccionAbierta) return;
    const jugador = room.jugadores[nombre];
    if (!jugador) return;
    jugador.proceso = proceso;
    io.to(sala).emit("actualizarEstado", room);
  });

  // Toggle entregas
  socket.on("toggleEntregas", (sala) => {
    const room = salas[sala];
    if (!room) return;
    room.entregasAbiertas = !room.entregasAbiertas;
    io.to(sala).emit("actualizarEstado", room);
  });

  // Toggle producción
  socket.on("toggleProduccion", (sala) => {
    const room = salas[sala];
    if (!room) return;
    room.produccionAbierta = !room.produccionAbierta;

    // Si se cierra la producción, aplicar cálculos
    if (!room.produccionAbierta) {
      for (const nombre in room.jugadores) {
        const j = room.jugadores[nombre];
        const trigo = j.trigoInsumo;
        const hierro = j.hierroInsumo;
        const proceso = j.proceso || 3;

        let trigoProd = 0, hierroProd = 0;
        if (proceso === 1) {
          const factor = Math.min(trigo / 280, hierro / 12);
          trigoProd = 575 * factor;
          hierroProd = 0;
        } else if (proceso === 2) {
          const factor = Math.min(trigo / 120, hierro / 8);
          trigoProd = 0;
          hierroProd = 20 * factor;
        } else { // proceso 3
          trigoProd = trigo / 2;
          hierroProd = hierro / 2;
        }

        j.trigoProd = trigoProd;
        j.hierroProd = hierroProd;
        j.trigo = trigoProd;
        j.hierro = hierroProd;

        // Guardar historial de producción
        room.historialProduccion.push({
          jugador: nombre,
          trigoInsumo: trigo,
          hierroInsumo: hierro,
          proceso,
          trigoProd,
          hierroProd,
          fecha: new Date().toLocaleString()
        });

        j.entregasDisponibles = 5;
        j.proceso = null;
      }
    }

    io.to(sala).emit("actualizarEstado", room);
  });

  // Nueva sesión: mantiene producción como insumo
  socket.on("reiniciarSesion", (sala) => {
    const room = salas[sala];
    if (!room) return;
    for (const j of Object.values(room.jugadores)) {
      j.trigoInsumo = j.trigoProd;
      j.hierroInsumo = j.hierroProd;
      j.trigo = j.trigoInsumo;
      j.hierro = j.hierroInsumo;
      j.trigoProd = j.trigoInsumo;
      j.hierroProd = j.hierroInsumo;
      j.proceso = null;
      j.entregasDisponibles = 5;
    }
    room.historial = [];
    io.to(sala).emit("actualizarEstado", room);
  });
});

server.listen(3000, () => console.log("Servidor iniciado en http://localhost:3000"));
