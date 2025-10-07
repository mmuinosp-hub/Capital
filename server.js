const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const path = require("path");

app.use(express.static(__dirname + "/public"));

const salas = {};

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
  }
}

// ===== SOCKET.IO =====
io.on("connection", (socket) => {

  // === Crear nueva sala ===
  socket.on("crearSala", (nombre) => {
    crearSala(nombre);
    socket.emit("salaCreada", nombre);
  });

  // === Entrar como administrador ===
  socket.on("entrarAdmin", (nombre) => {
    if (!salas[nombre]) return socket.emit("error", "Sala no existe");
    socket.join(nombre);
    socket.emit("adminEntrado", nombre);
    socket.emit("actualizarEstado", getEstadoSala(nombre));
  });

  // === Entrar como jugador ===
  socket.on("entrarJugador", ({ sala, jugador }) => {
    if (!salas[sala]) return socket.emit("error", "Sala no existe");
    if (!salas[sala].jugadores[jugador]) {
      return socket.emit("error", "Jugador no existe");
    }
    socket.join(sala);
    socket.emit("jugadorEntrado", { sala, jugador });
    socket.emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Entrar como observador (estado_jugadores o entregas_realizadas) ===
  socket.on("entrarObservador", (sala) => {
    if (!salas[sala]) return socket.emit("error", "Sala no existe");
    socket.join(sala);
    socket.emit("observadorEntrado", sala);
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
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Elegir proceso ===
  socket.on("elegirProceso", ({ sala, jugador, proceso }) => {
    const room = salas[sala];
    if (!room || !room.produccionAbierta) return;
    const j = room.jugadores[jugador];
    if (!j) return;
    j.proceso = proceso;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Producir ===
  socket.on("producir", ({ sala, jugador }) => {
    const room = salas[sala];
    if (!room || !room.produccionAbierta) return;
    const j = room.jugadores[jugador];
    if (!j) return;

    // Lógica de producción
    if (j.proceso === "1") {
      j.produccionTrigo = j.trigo * 0.5;
      j.produccionHierro = j.hierro * 0.5;
      j.trigo += j.produccionTrigo;
      j.hierro += j.produccionHierro;
    } else if (j.proceso === "2") {
      j.produccionTrigo = j.trigo * 0.8;
      j.produccionHierro = j.hierro * 0.2;
      j.trigo += j.produccionTrigo;
      j.hierro += j.produccionHierro;
    } else if (j.proceso === "3") {
      j.produccionTrigo = j.trigo * 0.3;
      j.produccionHierro = j.hierro * 0.7;
      j.trigo += j.produccionTrigo;
      j.hierro += j.produccionHierro;
    } else {
      j.produccionTrigo = 0;
      j.produccionHierro = 0;
    }

    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Controles del administrador ===
  socket.on("abrirEntregas", (sala) => {
    if (!salas[sala]) return;
    salas[sala].entregasAbiertas = true;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  socket.on("cerrarEntregas", (sala) => {
    if (!salas[sala]) return;
    salas[sala].entregasAbiertas = false;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  socket.on("abrirProduccion", (sala) => {
    if (!salas[sala]) return;
    salas[sala].produccionAbierta = true;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  socket.on("cerrarProduccion", (sala) => {
    if (!salas[sala]) return;
    salas[sala].produccionAbierta = false;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Nueva sesión ===
  socket.on("nuevaSesion", (sala) => {
    const room = salas[sala];
    if (!room) return;
    room.historialSesiones.push({
      sesion: room.sesionActual,
      jugadores: JSON.parse(JSON.stringify(room.jugadores)),
      entregas: [...room.entregasSesion]
    });
    room.sesionActual++;
    room.entregasSesion = [];
    room.produccionAbierta = false;
    room.entregasAbiertas = false;
    io.to(sala).emit("actualizarEstado", getEstadoSala(sala));
  });

  // === Historial completo ===
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

// ===== Función para estado actual =====
function getEstadoSala(nombre) {
  const s = salas[nombre];
  return {
    sala: nombre,
    entregasAbiertas: s.entregasAbiertas,
    produccionAbierta: s.produccionAbierta,
    jugadores: s.jugadores,
    historial: s.entregasSesion
  };
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Servidor activo en puerto " + PORT));
