// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let salas = {};

io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  socket.on("crearSala", ({ sala }) => {
    if (!salas[sala]) {
      salas[sala] = {
        jugadores: {},
        entregasAbiertas: false,
        produccionAbierta: false,
        historialEntregas: [],
      };
      console.log(`🆕 Sala creada: ${sala}`);
      socket.emit("salaCreada", sala);
    }
  });

  socket.on("crearJugador", ({ sala, jugador, password }) => {
    if (salas[sala]) {
      salas[sala].jugadores[jugador] = {
        password,
        trigo: 1000,
        hierro: 500,
        entregas: 2,
        proceso: null,
        prodTrigo: 0,
        prodHierro: 0,
      };
      io.emit("jugadoresActualizados", salas[sala].jugadores);
    }
  });

  socket.on("loginJugador", ({ sala, jugador, password }) => {
    const s = salas[sala];
    if (!s || !s.jugadores[jugador]) {
      socket.emit("loginError", "Sala o jugador no encontrado");
      return;
    }
    if (s.jugadores[jugador].password !== password) {
      socket.emit("loginError", "Contraseña incorrecta");
      return;
    }
    socket.join(sala);
    socket.emit("loginExitoso", { sala, jugador });
    socket.emit("estadoInicial", s);
  });

  socket.on("abrirEntregas", (sala) => {
    if (salas[sala]) {
      salas[sala].entregasAbiertas = true;
      salas[sala].produccionAbierta = false;
      io.to(sala).emit("estadoActualizado", salas[sala]);
    }
  });

  socket.on("cerrarEntregasAbrirProduccion", (sala) => {
    if (salas[sala]) {
      salas[sala].entregasAbiertas = false;
      salas[sala].produccionAbierta = true;
      io.to(sala).emit("estadoActualizado", salas[sala]);
    }
  });

  socket.on("enviarRecurso", ({ sala, origen, destino, recurso, cantidad }) => {
    const s = salas[sala];
    if (!s || !s.entregasAbiertas) return;

    const o = s.jugadores[origen];
    const d = s.jugadores[destino];
    cantidad = parseFloat(cantidad);

    if (o && d && o.entregas > 0 && cantidad > 0 && o[recurso] >= cantidad) {
      o[recurso] -= cantidad;
      d[recurso] += cantidad;
      o.entregas--;
      const entrega = {
        origen,
        destino,
        recurso,
        cantidad,
        hora: new Date().toLocaleTimeString(),
      };
      s.historialEntregas.push(entrega);
      io.to(sala).emit("historialActualizado", s.historialEntregas);
      io.to(sala).emit("jugadoresActualizados", s.jugadores);
    }
  });

  // 🔧 PROCESO DE PRODUCCIÓN CORREGIDO
  socket.on("iniciarProduccion", (sala) => {
    const s = salas[sala];
    if (!s || !s.produccionAbierta) return;

    for (const [nombre, j] of Object.entries(s.jugadores)) {
      let trigoInsumo = j.trigo;
      let hierroInsumo = j.hierro;
      let trigoProd = 0;
      let hierroProd = 0;

      switch (j.proceso) {
        case 1:
          trigoProd = 575 * Math.min(trigoInsumo / 280, hierroInsumo / 12);
          hierroProd = 0;
          break;
        case 2:
          trigoProd = 0;
          hierroProd = 20 * Math.min(trigoInsumo / 120, hierroInsumo / 8);
          break;
        case 3:
          trigoProd = trigoInsumo / 2;
          hierroProd = hierroInsumo / 2;
          break;
        default:
          trigoProd = 0;
          hierroProd = 0;
      }

      // Guardamos producción calculada
      j.prodTrigo = trigoProd;
      j.prodHierro = hierroProd;

      // Sumamos a los inventarios
      j.trigo += trigoProd;
      j.hierro += hierroProd;
    }

    io.to(sala).emit("jugadoresActualizados", s.jugadores);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));
