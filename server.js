const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Generador simple de IDs únicos
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
      const t = parseFloat(trigo);
      const h = parseFloat(hierro);
      data.jugadores[nombre] = {
        id,
        password,
        entregas: 5,
        proceso: null,
        trigo: t,
        hierro: h,
        trigoInsumo: t,
        hierroInsumo: h,
        trigoProd: 0,
        hierroProd: 0,
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

      // Evitar envíos mayores a lo disponible
      if (trigo > emisor.trigo) trigo = emisor.trigo;
      if (hierro > emisor.hierro) hierro = emisor.hierro;

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
  });

  // Abrir/Cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;

      // Al cerrar entregas, fijar insumos
      if (!data.entregasAbiertas) {
        for (const nombre in data.jugadores) {
          const j = data.jugadores[nombre];
          j.trigoInsumo = j.trigo;
          j.hierroInsumo = j.hierro;
          j.proceso = null; // resetear selección
        }
      }

      io.to(sala).emit("actualizarEstado", data);
    }
  });


  
socket.on("reiniciarSesion", (sala) => {
  const room = salas[sala];
  if (!room) return;

  for (const jugador of Object.values(room.jugadores)) {
    jugador.trigoInsumo = jugador.trigoProd ?? jugador.trigoInsumo ?? jugador.trigo;
    jugador.hierroInsumo = jugador.hierroProd ?? jugador.hierroInsumo ?? jugador.hierro;

    jugador.trigo = jugador.trigoInsumo;
    jugador.hierro = jugador.hierroInsumo;

    jugador.entregas = 0;
    jugador.proceso = null;
    jugador.trigoProd = jugador.trigoInsumo;
    jugador.hierroProd = jugador.hierroInsumo;
  }

  room.historial = []; // Limpiar historial

  io.to(sala).emit("actualizarEstado", room);
});



  
  // Abrir/Cerrar producción
  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    if (!data.produccionAbierta) {
      // Abrir fase de producción
      data.produccionAbierta = true;
    } else {
      // Cerrar producción y aplicar cálculos
      data.produccionAbierta = false;

      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];
        const proceso = j.proceso || 3; // por defecto el 3

        // Calcular producción según insumos
        if (proceso === 1) {
          // 280 trigo + 12 hierro → 575 trigo
          const factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          j.trigoProd = 575 * factor;
          j.hierroProd = 0;
        } else if (proceso === 2) {
          // 120 trigo + 8 hierro → 20 hierro
          const factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          j.trigoProd = 0;
          j.hierroProd = 20 * factor;
        } else {
          // Proceso 3: se reduce a la mitad
          j.trigoProd = j.trigoInsumo / 2;
          j.hierroProd = j.hierroInsumo / 2;
        }

        // Actualizar inventario con los productos obtenidos
        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;

        // Reiniciar entregas para siguiente ronda
        j.entregas = 5;
      }
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  // Elegir proceso
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (data && data.produccionAbierta && data.jugadores[nombre]) {
      data.jugadores[nombre].proceso = proceso;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => console.log("Servidor iniciado en http://localhost:3000"));

