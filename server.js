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

const salas = {}; // { sala: { adminPassword, jugadores, ... } }

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  // Crear sala
  socket.on("crearSala", ({ sala, password }) => {
    if (!salas[sala]) {
      salas[sala] = {
        adminPassword: password,
        jugadores: {},
        entregasAbiertas: false,
        produccionAbierta: false,
        historialEntregas: [],
        historialProduccion: [],
      };
      socket.emit("salaCreada", { sala });
      console.log(`🆕 Sala creada: ${sala}`);
    } else {
      socket.emit("error", "La sala ya existe");
    }
  });

  // Entrar como administrador
  socket.on("entrarAdmin", ({ sala, password }) => {
    const data = salas[sala];
    if (data && data.adminPassword === password) {
      socket.join(sala);
      socket.emit("adminEntrado", { sala });
      io.to(sala).emit("actualizarEstado", data);
      console.log(`🔑 Admin entró en sala: ${sala}`);
    } else {
      socket.emit("error", "Sala o contraseña incorrecta");
    }
  });

  // Crear jugador
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const data = salas[sala];
    if (!data) return socket.emit("error", "La sala no existe");

    const id = generarId();
    data.jugadores[nombre] = {
      id,
      password,
      trigo: parseFloat(trigo) || 0,
      hierro: parseFloat(hierro) || 0,
      entregas: 5,
      proceso: null,
      trigoInsumo: 0,
      hierroInsumo: 0,
      trigoProd: 0,
      hierroProd: 0,
    };
    io.to(sala).emit("actualizarEstado", data);
    console.log(`👤 Jugador creado: ${nombre} (${sala})`);
  });

  // Entrar como jugador
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const data = salas[sala];
    if (data && data.jugadores[nombre] && data.jugadores[nombre].password === password) {
      socket.join(sala);
      socket.emit("jugadorEntrado", { sala, nombre });
      io.to(sala).emit("actualizarEstado", data);
      console.log(`🎮 Jugador ${nombre} entró en sala ${sala}`);
    } else {
      socket.emit("error", "Jugador o contraseña incorrecta");
    }
  });

  // --- ENTREGAS ---
  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const data = salas[sala];
    if (!data || !data.entregasAbiertas) return;
    const emisor = data.jugadores[de];
    const receptor = data.jugadores[para];
    if (!emisor || !receptor || emisor.entregas <= 0) return;

    trigo = parseFloat(trigo) || 0;
    hierro = parseFloat(hierro) || 0;

    // No permitir entregar más de lo disponible
    if (trigo > emisor.trigo || hierro > emisor.hierro) return;

    emisor.trigo -= trigo;
    emisor.hierro -= hierro;
    receptor.trigo += trigo;
    receptor.hierro += hierro;
    emisor.entregas -= 1;

    const registro = {
      de,
      para,
      trigo,
      hierro,
      hora: new Date().toLocaleTimeString(),
      sesion: data.historialProduccion.length + 1,
    };
    data.historialEntregas.push(registro);
    io.to(sala).emit("actualizarEstado", data);
  });

  // --- CONTROL DE ENTREGAS ---
  socket.on("abrirEntregas", ({ sala, abrir }) => {
    const data = salas[sala];
    if (!data) return;
    data.entregasAbiertas = abrir;
    io.to(sala).emit("actualizarEstado", data);
  });

  // --- CONTROL DE PRODUCCIÓN ---
  socket.on("abrirProduccion", ({ sala, abrir }) => {
    const data = salas[sala];
    if (!data) return;

    // Abrir fase de producción
    if (abrir) {
      data.produccionAbierta = true;
      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];
        j.proceso = null;
        j.trigoInsumo = j.trigo;
        j.hierroInsumo = j.hierro;
        j.trigoProd = 0;
        j.hierroProd = 0;
      }
    } else {
      // Cerrar fase de producción y aplicar resultados
      data.produccionAbierta = false;
      const registroSesion = [];

      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];
        const proceso = j.proceso || 3;
        let tProd = 0;
        let hProd = 0;

        if (proceso === 1) {
          const factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          tProd = 575 * factor;
        } else if (proceso === 2) {
          const factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          hProd = 20 * factor;
        } else {
          tProd = j.trigoInsumo / 2;
          hProd = j.hierroInsumo / 2;
        }

        j.trigo = tProd;
        j.hierro = hProd;
        j.trigoProd = tProd;
        j.hierroProd = hProd;
        j.entregas = 5;

        registroSesion.push({
          jugador: nombre,
          proceso,
          trigoInsumo: j.trigoInsumo,
          hierroInsumo: j.hierroInsumo,
          trigoProd: tProd,
          hierroProd: hProd,
        });
      }

      data.historialProduccion.push({
        sesion: data.historialProduccion.length + 1,
        produccion: registroSesion,
      });
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  // --- ELEGIR PROCESO ---
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (!data || !data.produccionAbierta) return;
    const jugador = data.jugadores[nombre];
    if (jugador && jugador.proceso === null) {
      jugador.proceso = parseInt(proceso);
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // --- NUEVA SESIÓN ---
  socket.on("nuevaSesion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    for (const nombre in data.jugadores) {
      const j = data.jugadores[nombre];
      j.trigoInsumo = j.trigo;
      j.hierroInsumo = j.hierro;
      j.entregas = 5;
      j.proceso = null;
    }

    data.entregasAbiertas = false;
    data.produccionAbierta = false;
    io.to(sala).emit("actualizarEstado", data);
  });

  // --- CONSULTAR ESTADO ---
  socket.on("solicitarEstado", (sala) => {
    if (salas[sala]) socket.emit("actualizarEstado", salas[sala]);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

// --- SERVIDOR EXPRESS ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 Servidor iniciado en puerto ${PORT}`));
