const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

const DATOS_FILE = path.join(__dirname, "datos.json");

app.use(express.static(path.join(__dirname, "public")));

// ====== Cargar datos existentes ======
let salas = {};
if (fs.existsSync(DATOS_FILE)) {
  try {
    const raw = fs.readFileSync(DATOS_FILE);
    salas = JSON.parse(raw);
  } catch (e) {
    console.error("Error leyendo datos.json:", e);
    salas = {};
  }
}

// ====== Guardar datos ======
function guardarDatos() {
  fs.writeFileSync(DATOS_FILE, JSON.stringify(salas, null, 2));
}

// ====== Función para crear sala nueva ======
function crearSala(nombre) {
  if (!salas[nombre]) {
    salas[nombre] = {
      jugadores: {},
      entregasAbiertas: false,
      produccionAbierta: false,
      sesionActual: 1,
      historialSesiones: [],
      entregasSesion: []
    };
    guardarDatos();
  }
}

// ====== Función para enviar estado a clientes ======
function getEstadoSala(nombre) {
  const s = salas[nombre];
  if (!s) return null;
  return {
    sala: nombre,
    entregasAbiertas: s.entregasAbiertas,
    produccionAbierta: s.produccionAbierta,
    jugadores: s.jugadores,
    historial: s.entregasSesion
  };
}

// ===== SOCKET.IO =====
io.on("connection", (socket) => {

  // === Crear sala ===
  socket.on("crearSala", (nombre) => {
    crearSala(nombre);
    socket.emit("salaCreada", nombre);
  });

  // === Entrar admin ===
  socket.on("entrarAdmin", (nombre) => {
    if (!salas[nombre]) return socket.emit("error", "Sala no existe");
    socket.join(nombre);
    socket.emit("adminEntrado", nombre);
    socket.emit("actualizarEstado", getEstadoSala(nombre));
  });

  // === Entrar jugador ===
  socket.on("entrarJugador", ({ sala, jugador }) => {
    if (!salas[sala]) return socket.emit("error", "Sala no existe");
    if (!salas[sala].jugadores[jugador]) return socket.emit("error", "Jugador no existe");
    socket.join(sala);
    socket.emit("jugadorEntrado", { sala, jugador });
    socket.emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Crear jugador ===
  socket.on("crearJugador", ({ sala, nombre }) => {
    if (!salas[sala]) return;
    salas[sala].jugadores[nombre] = { 
      trigo: 100, 
      hierro: 100, 
      entregas: 0, 
      proceso: "-", 
      produccionTrigo: 0, 
      produccionHierro: 0 
    };
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Entregar ===
  socket.on("entregar", ({ sala, de, para, trigo, hierro }) => {
    const room = salas[sala];
    if (!room || !room.entregasAbiertas) return;
    const j1 = room.jugadores[de];
    const j2 = room.jugadores[para];
    if (!j1 || !j2) return;
    if (j1.trigo < trigo || j1.hierro < hierro) return;

    j1.trigo -= trigo;
    j1.hierro -= hierro;
    j2.trigo += trigo;
    j2.hierro += hierro;
    j1.entregas++;

    const registro = {
      sesion: room.sesionActual,
      de,
      para,
      trigo,
      hierro,
      hora: new Date().toLocaleTimeString()
    };
    room.entregasSesion.push(registro);
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Elegir proceso ===
  socket.on("elegirProceso", ({ sala, jugador, proceso }) => {
    const room = salas[sala];
    if (!room || !room.produccionAbierta) return;
    const j = room.jugadores[jugador];
    if (!j) return;
    j.proceso = proceso;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Abrir/Cerrar entregas ===
  socket.on("abrirEntregas", (sala) => {
    if (!salas[sala]) return;
    salas[sala].entregasAbiertas = true;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });
  socket.on("cerrarEntregas", (sala) => {
    if (!salas[sala]) return;
    salas[sala].entregasAbiertas = false;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Abrir/Cerrar producción ===
  socket.on("abrirProduccion", (sala) => {
    if (!salas[sala]) return;
    salas[sala].produccionAbierta = true;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });
  socket.on("cerrarProduccion", (sala) => {
    if (!salas[sala]) return;
    salas[sala].produccionAbierta = false;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Nueva sesión ===
  socket.on("nuevaSesion", (sala) => {
    const room = salas[sala];
    if (!room) return;
    // Archivar sesión actual
    room.historialSesiones.push({
      sesion: room.sesionActual,
      jugadores: JSON.parse(JSON.stringify(room.jugadores)),
      entregas: [...room.entregasSesion]
    });
    // Crear sesión nueva
    room.sesionActual++;
    room.entregasSesion = [];
    room.entregasAbiertas = false;
    room.produccionAbierta = false;
    guardarDatos();
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Obtener historial completo ===
  socket.on("getHistorialCompleto", (sala) => {
    const room = salas[sala];
    if (!room) return;
    const data = [];
    for (const sesion of room.historialSesiones) {
      for (const [nombre, j] of Object.entries(sesion.jugadores)) {
        data.push({
          sesion: sesion.sesion,
          jugador: nombre,
          trigo: j.trigo.toFixed(2),
          hierro: j.hierro.toFixed(2),
          entregas: j.entregas
        });
      }
    }
    socket.emit("historialCompleto", data);
  });

  // === Obtener entregas completas ===
  socket.on("getEntregasCompletas", (sala) => {
    const room = salas[sala];
    if (!room) return;
    const data = [];
    for (const sesion of room.historialSesiones) {
      for (const e of sesion.entregas) {
        data.push({
          sesion: sesion.sesion,
          de: e.de,
          para: e.para,
          trigo: e.trigo,
          hierro: e.hierro,
          hora: e.hora
        });
      }
    }
    socket.emit("entregasCompletas", data);
  });

});

// ===== Servidor =====
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
