const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Función simple para generar IDs únicos
function generarId() {
  return Math.random().toString(36).substring(2, 10);
}

const salas = {};

io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  socket.on("crearSala", ({ sala, password }) => {
    if (!salas[sala]) {
      salas[sala] = {
        adminPassword: password,
        jugadores: {},
        entregasAbiertas: true,
        produccionAbierta: false,
        historial: [],
      };
      socket.emit("salaCreada", sala);
      console.log(`🆕 Sala creada: ${sala}`);
    } else {
      socket.emit("salaExiste");
    }
  });

  socket.on("entrarAdmin", ({ sala, password }) => {
    const data = salas[sala];
    if (data && data.adminPassword === password) {
      socket.join(sala);
      socket.emit("adminEntrado", sala);
      io.to(sala).emit("actualizarEstado", data);
    } else {
      socket.emit("error", "Sala o contraseña incorrecta");
    }
  });

  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const data = salas[sala];
    if (data) {
      const id = generarId(); // Generamos un ID interno único
      data.jugadores[nombre] = {
        id,
        password,
        trigo: parseFloat(trigo),
        hierro: parseFloat(hierro),
        entregas: 5,
        proceso: null,
        trigoProd: 0,
        hierroProd: 0,
      };
      io.to(sala).emit("actualizarEstado", data);
      console.log(`👤 Jugador creado: ${nombre} (${sala})`);
    }
  });

  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const data = salas[sala];
    if (data && data.jugadores[nombre] && data.jugadores[nombre].password === password) {
      socket.join(sala);
      socket.emit("jugadorEntrado", { sala, nombre });
      io.to(sala).emit("actualizarEstado", data);
    } else {
      socket.emit("error", "Sala o jugador no encontrado o contraseña incorrecta");
    }
  });

  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const data = salas[sala];
    if (!data || !data.entregasAbiertas) return;
    const emisor = data.jugadores[de];
    const receptor = data.jugadores[para];
    if (emisor && receptor && emisor.entregas > 0) {
      trigo = parseFloat(trigo) || 0;
      hierro = parseFloat(hierro) || 0;
      if (trigo <= emisor.trigo && hierro <= emisor.hierro) {
        emisor.trigo -= trigo;
        emisor.hierro -= hierro;
        receptor.trigo += trigo;
        receptor.hierro += hierro;
        emisor.entregas -= 1;
        data.historial.push({
          de,
          para,
          trigo,
          hierro,
          hora: new Date().toLocaleTimeString(),
        });
        io.to(sala).emit("actualizarEstado", data);
      }
    }
  });

  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    if (!data.produccionAbierta) {
      data.produccionAbierta = true;
    } else {
      data.produccionAbierta = false;

      // Aplicar producción usando las cantidades finales tras entregas
      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];
        let trigoNuevo = 0;
        let hierroNuevo = 0;

        if (j.proceso === 1) {
          const factor = Math.min(j.trigo / 280, j.hierro / 12);
          trigoNuevo = 575 * factor;
          hierroNuevo = 0;
        } else if (j.proceso === 2) {
          const factor = Math.min(j.trigo / 120, j.hierro / 8);
          trigoNuevo = 0;
          hierroNuevo = 20 * factor;
        } else {
          trigoNuevo = j.trigo / 2;
          hierroNuevo = j.hierro / 2;
        }

        j.trigoProd = trigoNuevo;
        j.hierroProd = hierroNuevo;
        j.trigo = trigoNuevo;
        j.hierro = hierroNuevo;
        j.entregas = 5;
        j.proceso = null;
      }
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (data && data.produccionAbierta && data.jugadores[nombre] && data.jugadores[nombre].proceso === null) {
      data.jugadores[nombre].proceso = proceso;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => console.log("Servidor iniciado en http://localhost:3000"));
