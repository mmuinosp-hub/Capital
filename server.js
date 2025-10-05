const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Función simple para generar IDs únicos
function generarId() {
  return Math.random().toString(36).substring(2, 10); // 8 caracteres
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
      io.to(sala).emit("actualizarEstado", data);
    } else {
      socket.emit("error", "Sala o contraseña incorrecta");
    }
  });

  // Crear jugador
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const data = salas[sala];
    if (data) {
      const id = generarId();
      data.jugadores[nombre] = {
        id,
        password,
        trigo: parseFloat(trigo),
        hierro: parseFloat(hierro),
        entregas: 5,
        proceso: null,
        trigoProd: 0,
        hierroProd: 0,
        trigoActual: parseFloat(trigo),
        hierroActual: parseFloat(hierro),
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
      trigo = parseFloat(trigo) || 0;
      hierro = parseFloat(hierro) || 0;
      if (trigo <= emisor.trigoActual && hierro <= emisor.hierroActual) {
        emisor.trigoActual -= trigo;
        emisor.hierroActual -= hierro;
        receptor.trigoActual += trigo;
        receptor.hierroActual += hierro;
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

  // Abrir/Cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Abrir/Cerrar producción
  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    if (!data.produccionAbierta) {
      // Abrir producción
      data.produccionAbierta = true;
    } else {
      // Cerrar producción y aplicar cálculos
      data.produccionAbierta = false;

      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];

        // Determinar proceso aplicado
        const procesoAplicado = j.proceso || 3;

        let trigoNuevo = 0;
        let hierroNuevo = 0;

        if (procesoAplicado === 1) {
          const factor = Math.min(j.trigoActual / 280, j.hierroActual / 12);
          trigoNuevo = 575 * factor;
          hierroNuevo = 0;
        } else if (procesoAplicado === 2) {
          const factor = Math.min(j.trigoActual / 120, j.hierroActual / 8);
          trigoNuevo = 0;
          hierroNuevo = 20 * factor;
        } else { // proceso 3
          trigoNuevo = j.trigoActual / 2;
          hierroNuevo = j.hierroActual / 2;
        }

        // Guardar producción
        j.trigoProd = trigoNuevo;
        j.hierroProd = hierroNuevo;

        // Actualizar recursos del jugador
        j.trigo = trigoNuevo;
        j.hierro = hierroNuevo;

        // Guardar proceso aplicado
        j.proceso = procesoAplicado;

        // Reiniciar entregas y cantidades actuales para siguiente ronda
        j.entregas = 5;
        j.trigoActual = trigoNuevo;
        j.hierroActual = hierroNuevo;
      }
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  // Elegir proceso de producción
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
