import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const salas = {}; // estructura principal

/*
Estructura de cada sala:
{
  passwordAdmin: "xxx",
  entregasAbiertas: false,
  produccionAbierta: false,
  jugadores: {
    nombre: { password, trigo, hierro, entregas }
  },
  entregas: []  // historial de entregas
}
*/

io.on("connection", (socket) => {

  // ------------------------------
  // CREAR O ENTRAR COMO ADMIN
  // ------------------------------
  socket.on("crearSala", ({ sala, password }) => {
    if (salas[sala]) {
      socket.emit("error", "Esa sala ya existe.");
      return;
    }
    salas[sala] = {
      passwordAdmin: password,
      entregasAbiertas: false,
      produccionAbierta: false,
      jugadores: {},
      entregas: []
    };
    socket.join(sala);
    socket.emit("salaCreada", { sala });
    console.log(`Sala creada: ${sala}`);
  });

  socket.on("entrarAdmin", ({ sala, password }) => {
    const s = salas[sala];
    if (!s) return socket.emit("error", "Esa sala no existe.");
    if (s.passwordAdmin !== password) return socket.emit("error", "Contraseña incorrecta.");
    socket.join(sala);
    socket.emit("adminEntrado", { sala });
    enviarEstado(sala);
  });

  // ------------------------------
  // CREAR JUGADOR
  // ------------------------------
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const s = salas[sala];
    if (!s) return socket.emit("error", "Sala inexistente.");
    if (s.jugadores[nombre]) return socket.emit("error", "Ya existe un jugador con ese nombre.");
    s.jugadores[nombre] = {
      password,
      trigo,
      hierro,
      entregas: 5
    };
    enviarEstado(sala);
  });

  // ------------------------------
  // ENTRAR JUGADOR
  // ------------------------------
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const s = salas[sala];
    if (!s) return socket.emit("error", "Sala inexistente.");
    const j = s.jugadores[nombre];
    if (!j) return socket.emit("error", "Jugador no encontrado.");
    if (j.password !== password) return socket.emit("error", "Contraseña incorrecta.");
    socket.join(sala);
    socket.emit("jugadorEntrado", { sala, nombre });
    enviarEstado(sala);
  });

  // ------------------------------
  // ENTREGAS
  // ------------------------------
  socket.on("entregar", ({ sala, origen, destino, producto, cantidad }) => {
    const s = salas[sala];
    if (!s || !s.entregasAbiertas) return;
    const o = s.jugadores[origen];
    const d = s.jugadores[destino];
    if (!o || !d) return socket.emit("error", "Jugador inválido.");
    if (o.entregas <= 0) return socket.emit("error", "Sin entregas disponibles.");
    if (producto === "trigo" && o.trigo < cantidad) return socket.emit("error", "No hay suficiente trigo.");
    if (producto === "hierro" && o.hierro < cantidad) return socket.emit("error", "No hay suficiente hierro.");

    // Actualizar insumos
    if (producto === "trigo") {
      o.trigo -= cantidad;
      d.trigo += cantidad;
    } else {
      o.hierro -= cantidad;
      d.hierro += cantidad;
    }

    o.entregas -= 1;

    s.entregas.push({ origen, destino, producto, cantidad });

    enviarEstado(sala);
    io.to(sala).emit("actualizarEntregas", s.entregas);
  });

  // ------------------------------
  // PRODUCCIÓN
  // ------------------------------
  socket.on("producir", ({ sala, nombre, proceso }) => {
    const s = salas[sala];
    if (!s || !s.produccionAbierta) return;
    const j = s.jugadores[nombre];
    if (!j) return;

    switch (proceso) {
      case 1: // sin cambio
        break;
      case 2: // duplica hierro
        j.hierro *= 2;
        break;
      case 3: // reduce insumos a la mitad
        j.trigo /= 2;
        j.hierro /= 2;
        break;
      default:
        return;
    }

    enviarEstado(sala);
  });

  // ------------------------------
  // CONTROL DEL JUEGO
  // ------------------------------
  socket.on("abrirEntregas", ({ sala, abrir }) => {
    const s = salas[sala];
    if (!s) return;
    s.entregasAbiertas = abrir;
    enviarEstado(sala);
  });

  socket.on("abrirProduccion", ({ sala, abrir }) => {
    const s = salas[sala];
    if (!s) return;
    s.produccionAbierta = abrir;
    enviarEstado(sala);
  });

  socket.on("nuevaSesion", (sala) => {
    const s = salas[sala];
    if (!s) return;
    // cada jugador mantiene sus insumos pero reinicia las entregas
    for (const j of Object.values(s.jugadores)) {
      j.entregas = 5;
    }
    s.entregas = [];
    s.entregasAbiertas = false;
    s.produccionAbierta = false;
    enviarEstado(sala);
    io.to(sala).emit("actualizarEntregas", s.entregas);
  });

  // ------------------------------
  // CONSULTAS
  // ------------------------------
  socket.on("solicitarEstado", (sala) => {
    enviarEstado(sala);
  });

  socket.on("solicitarEntregas", (sala) => {
    const s = salas[sala];
    if (s) socket.emit("actualizarEntregas", s.entregas);
  });

});

function enviarEstado(sala) {
  const s = salas[sala];
  if (!s) return;
  const data = {
    entregasAbiertas: s.entregasAbiertas,
    produccionAbierta: s.produccionAbierta,
    jugadores: s.jugadores
  };
  io.to(sala).emit("actualizarEstado", data);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor funcionando en puerto ${PORT}`));
