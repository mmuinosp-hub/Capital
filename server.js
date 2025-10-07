const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

function generarId() {
  return Math.random().toString(36).substring(2, 10);
}

const salas = {};

io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  // Crear sala
  socket.on("crearSala", ({ sala, password }) => {
    if (!salas[sala]) {
      salas[sala] = {
        adminPassword: password,
        jugadores: {},
        entregasAbiertas: true,
        produccionAbierta: false,
        historial: [],
        historialProduccion: []
      };
      socket.emit("salaCreada", sala);
      console.log(`🆕 Sala creada: ${sala}`);
    } else {
      socket.emit("salaExiste");
    }
  });

  // Entrar como administrador
  socket.on("entrarAdmin", ({ sala, password }) => {
    const data = salas[sala];
    if (data && data.adminPassword === password) {
      socket.join(sala);
      socket.emit("adminEntrado", sala);
      socket.emit("actualizarEstado", data);
    } else {
      socket.emit("error", "Sala o contraseña incorrecta");
    }
  });

  // Crear jugador
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const data = salas[sala];
    if (data) {
      const t = parseFloat(trigo);
      const h = parseFloat(hierro);
      data.jugadores[nombre] = {
        id: generarId(),
        password,
        trigo: t,
        hierro: h,
        entregas: 5,
        proceso: null,
        trigoProd: null,
        hierroProd: null,
        trigoInsumo: t,
        hierroInsumo: h
      };
      io.to(sala).emit("actualizarEstado", data);
      console.log(`👤 Jugador creado: ${nombre} (${sala})`);
    }
  });

  // Entrar como jugador
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

  // Enviar entrega
  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const data = salas[sala];
    if (!data || !data.entregasAbiertas) return;
    const emisor = data.jugadores[de];
    const receptor = data.jugadores[para];
    if (emisor && receptor && emisor.entregas > 0) {
      trigo = Math.min(parseFloat(trigo) || 0, emisor.trigo);
      hierro = Math.min(parseFloat(hierro) || 0, emisor.hierro);
      emisor.trigo -= trigo;
      emisor.hierro -= hierro;
      receptor.trigo += trigo;
      receptor.hierro += hierro;
      emisor.entregas -= 1;
      data.historial.push({
        de, para, trigo, hierro, hora: new Date().toLocaleTimeString()
      });
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Abrir/Cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (!data) return;
    data.entregasAbiertas = !data.entregasAbiertas;
    if (!data.entregasAbiertas) {
      for (const j of Object.values(data.jugadores)) {
        j.trigoInsumo = j.trigo;
        j.hierroInsumo = j.hierro;
      }
    }
    io.to(sala).emit("actualizarEstado", data);
  });

  // Abrir/Cerrar producción
  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;
    if (!data.produccionAbierta) {
      // Abrir producción
      data.produccionAbierta = true;
      for (const j of Object.values(data.jugadores)) {
        j.proceso = null;
        j.trigoProd = null;
        j.hierroProd = null;
      }
    } else {
      // Cerrar producción
      data.produccionAbierta = false;
      for (const [nombre, j] of Object.entries(data.jugadores)) {
        const p = j.proceso || 3;
        let trigoProd = 0, hierroProd = 0;
        if (p === 1) {
          const factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          trigoProd = 575 * factor;
        } else if (p === 2) {
          const factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          hierroProd = 20 * factor;
        } else {
          trigoProd = j.trigoInsumo / 2;
          hierroProd = j.hierroInsumo / 2;
        }
        j.trigoProd = trigoProd;
        j.hierroProd = hierroProd;
        j.trigo = trigoProd;
        j.hierro = hierroProd;
        j.entregas = 5;
        data.historialProduccion.push({
          jugador: nombre,
          trigoInsumo: j.trigoInsumo,
          hierroInsumo: j.hierroInsumo,
          proceso: p,
          trigoProd,
          hierroProd
        });
      }
    }
    io.to(sala).emit("actualizarEstado", data);
  });

  // Elegir proceso
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (data && data.produccionAbierta && data.jugadores[nombre] && data.jugadores[nombre].proceso === null) {
      data.jugadores[nombre].proceso = proceso;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Nueva sesión
  socket.on("nuevaSesion", (sala) => {
    const data = salas[sala];
    if (!data) return;
    for (const j of Object.values(data.jugadores)) {
      j.trigoInsumo = j.trigo;
      j.hierroInsumo = j.hierro;
      j.entregas = 5;
      j.proceso = null;
      j.trigoProd = null;
      j.hierroProd = null;
    }
    data.entregasAbiertas = true;
    data.produccionAbierta = false;
    io.to(sala).emit("actualizarEstado", data);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => console.log("Servidor iniciado en http://localhost:3000"));
