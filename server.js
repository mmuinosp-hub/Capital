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

// Historial global de todas las sesiones
const historialCompleto = {
  entregas: [],
  produccion: []
};

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
        historial: []
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
    if (data && !data.jugadores[nombre]) {
      const id = generarId();
      const t = parseFloat(trigo);
      const h = parseFloat(hierro);
      data.jugadores[nombre] = {
        id,
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
      const entrega = {
        sala,
        de,
        para,
        trigo,
        hierro,
        hora: new Date().toLocaleTimeString()
      };
      data.historial.push(entrega);
      historialCompleto.entregas.push(entrega);
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Abrir/Cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;
      if (!data.entregasAbiertas) {
        // Fijar insumos para producción
        for (const nombre in data.jugadores) {
          const j = data.jugadores[nombre];
          j.trigoInsumo = j.trigo;
          j.hierroInsumo = j.hierro;
        }
      }
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

        // Proceso aplicado (por defecto 3)
        const procesoAplicado = j.proceso || 3;

        if (procesoAplicado === 1) {
          const factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          j.trigoProd = 575 * factor;
          j.hierroProd = 0;
        } else if (procesoAplicado === 2) {
          const factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          j.trigoProd = 0;
          j.hierroProd = 20 * factor;
        } else {
          // Proceso 3: se reduce a la mitad
          j.trigoProd = j.trigoInsumo / 2;
          j.hierroProd = j.hierroInsumo / 2;
        }

        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;

        // Guardar proceso aplicado
        j.proceso = procesoAplicado;

        // Reiniciar entregas para siguiente ronda
        j.entregas = 5;

        // Guardar en historial completo de producción
        historialCompleto.produccion.push({
          sala,
          nombre,
          trigoInsumo: j.trigoInsumo,
          hierroInsumo: j.hierroInsumo,
          proceso: j.proceso,
          trigoProd: j.trigoProd,
          hierroProd: j.hierroProd
        });
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

  // Pedir históricos completos
  socket.on("pedirHistorialCompleto", () => {
    socket.emit("historialCompletoEntregas", historialCompleto.entregas);
  });

  socket.on("pedirHistorialProduccion", () => {
    socket.emit("historialCompletoProduccion", historialCompleto.produccion);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => console.log("Servidor iniciado en http://localhost:3000"));
