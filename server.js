const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

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

  socket.on("crearSala", ({ sala, password }) => {
    if (!salas[sala]) {
      salas[sala] = {
        adminPassword: password,
        jugadores: {},
        entregasAbiertas: true,
        produccionAbierta: false,
        historial: [],
        historialProduccion: [],
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
      const id = generarId();
      const t = parseFloat(trigo);
      const h = parseFloat(hierro);
      data.jugadores[nombre] = {
        id,
        password,
        trigo: t,
        hierro: h,
        entregasDisponibles: 5,
        proceso: null,
        trigoProd: null,
        hierroProd: null,
        trigoInsumo: t,
        hierroInsumo: h,
      };
      io.to(sala).emit("actualizarEstado", data);
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
    if (emisor && receptor && emisor.entregasDisponibles > 0) {
      trigo = parseFloat(trigo) || 0;
      hierro = parseFloat(hierro) || 0;
      if (trigo <= emisor.trigo && hierro <= emisor.hierro) {
        emisor.trigo -= trigo;
        emisor.hierro -= hierro;
        receptor.trigo += trigo;
        receptor.hierro += hierro;
        emisor.entregasDisponibles -= 1;
        data.historial.push({
          de,
          para,
          trigo,
          hierro,
          fecha: new Date().toLocaleString(),
        });
        io.to(sala).emit("actualizarEstado", data);
      }
    }
  });

  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;
      if (!data.entregasAbiertas) {
        for (const nombre in data.jugadores) {
          const j = data.jugadores[nombre];
          j.trigoInsumo = j.trigo;
          j.hierroInsumo = j.hierro;
        }
      }
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    if (!data.produccionAbierta) {
      data.produccionAbierta = true;
      for (const j of Object.values(data.jugadores)) j.proceso = null;
    } else {
      data.produccionAbierta = false;

      const registroSesion = [];

      for (const [nombre, j] of Object.entries(data.jugadores)) {
        const proceso = j.proceso || 3;

        if (proceso === 1) {
          const factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          j.trigoProd = 575 * factor;
          j.hierroProd = 0;
        } else if (proceso === 2) {
          const factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          j.trigoProd = 0;
          j.hierroProd = 20 * factor;
        } else {
          j.trigoProd = j.trigoInsumo / 2;
          j.hierroProd = j.hierroInsumo / 2;
        }

        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;
        j.entregasDisponibles = 5;

        registroSesion.push({
          jugador: nombre,
          trigoInsumo: j.trigoInsumo,
          hierroInsumo: j.hierroInsumo,
          proceso,
          trigoProd: j.trigoProd,
          hierroProd: j.hierroProd,
          fecha: new Date().toLocaleString(),
        });
      }

      data.historialProduccion.push({
        fecha: new Date().toLocaleString(),
        sesion: registroSesion,
      });
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  socket.on("nuevaSesion", (sala) => {
    const data = salas[sala];
    if (data) {
      for (const j of Object.values(data.jugadores)) {
        j.trigoInsumo = j.trigo;
        j.hierroInsumo = j.hierro;
        j.proceso = null;
        j.trigoProd = null;
        j.hierroProd = null;
        j.entregasDisponibles = 5;
      }
      data.entregasAbiertas = true;
      data.produccionAbierta = false;
      data.historial = [];
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (data && data.produccionAbierta && data.jugadores[nombre]) {
      data.jugadores[nombre].proceso = proceso;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("disconnect", () => console.log("🔴 Usuario desconectado:", socket.id));
});

app.get("/historialEntregas/:sala", (req, res) => {
  const data = salas[req.params.sala];
  if (!data) return res.send("<h3>Sala no encontrada</h3>");
  let html = `<html><head><meta charset="UTF-8"><title>Historial de Entregas - ${req.params.sala}</title></head><body>
  <a href="/">🏠 Inicio</a> | <a href="/historial_produccion.html">Historial de Producción</a> | <a href="/admin.html">Admin</a> | <a href="/player.html">Jugador</a>
  <h2>Historial de Entregas (${req.params.sala})</h2><table border="1"><tr><th>De</th><th>Para</th><th>Trigo</th><th>Hierro</th><th>Fecha</th></tr>`;
  for (const h of data.historial) {
    html += `<tr><td>${h.de}</td><td>${h.para}</td><td>${h.trigo}</td><td>${h.hierro}</td><td>${h.fecha}</td></tr>`;
  }
  html += "</table></body></html>";
  res.send(html);
});

app.get("/historialProduccion/:sala", (req, res) => {
  const data = salas[req.params.sala];
  if (!data) return res.send("<h3>Sala no encontrada</h3>");
  let html = `<html><head><meta charset="UTF-8"><title>Historial de Producción - ${req.params.sala}</title></head><body>
  <a href="/">🏠 Inicio</a> | <a href="/historial_entregas.html">Historial de Entregas</a> | <a href="/admin.html">Admin</a> | <a href="/player.html">Jugador</a>
  <h2>Historial de Producción (${req.params.sala})</h2>`;
  for (const ses of data.historialProduccion) {
    html += `<h3>Sesión ${ses.fecha}</h3><table border="1"><tr><th>Jugador</th><th>Trigo insumo</th><th>Hierro insumo</th><th>Proceso</th><th>Trigo prod.</th><th>Hierro prod.</th><th>Fecha</th></tr>`;
    for (const r of ses.sesion) {
      html += `<tr><td>${r.jugador}</td><td>${r.trigoInsumo}</td><td>${r.hierroInsumo}</td><td>${r.proceso}</td><td>${r.trigoProd}</td><td>${r.hierroProd}</td><td>${r.fecha}</td></tr>`;
    }
    html += "</table>";
  }
  html += "</body></html>";
  res.send(html);
});

server.listen(3000, () => console.log("Servidor en http://localhost:3000"));
