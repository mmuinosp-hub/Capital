import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const salas = {};

// === CREAR SALA ===
io.on("connection", (socket) => {
  socket.on("crearSala", ({ sala, password }) => {
    if (salas[sala]) {
      socket.emit("salaExiste");
      return;
    }
    salas[sala] = {
      password,
      admin: socket.id,
      jugadores: {},
      entregasAbiertas: false,
      produccionAbierta: false,
      historial: [],
    };
    socket.join(sala);
    socket.emit("salaCreada", sala);
  });

  // === ADMIN ENTRA ===
  socket.on("entrarAdmin", ({ sala, password }) => {
    if (!salas[sala]) return socket.emit("error", "Sala no existe");
    if (salas[sala].password !== password)
      return socket.emit("error", "Contraseña incorrecta");
    socket.join(sala);
    salas[sala].admin = socket.id;
    socket.emit("adminEntrado", sala);
    socket.emit("actualizarEstado", salas[sala]);
  });

  // === CREAR JUGADOR ===
  socket.on("crearJugador", ({ sala, nombre, password, trigo, hierro }) => {
    const room = salas[sala];
    if (!room) return socket.emit("error", "Sala no existe");
    if (room.jugadores[nombre]) return socket.emit("error", "Jugador ya existe");

    room.jugadores[nombre] = {
      password,
      trigoInsumo: parseFloat(trigo) || 0,
      hierroInsumo: parseFloat(hierro) || 0,
      trigo: parseFloat(trigo) || 0,
      hierro: parseFloat(hierro) || 0,
      trigoProd: parseFloat(trigo) || 0,
      hierroProd: parseFloat(hierro) || 0,
      entregas: 0,
      proceso: null,
    };
    io.to(sala).emit("actualizarEstado", room);
  });

  // === JUGADOR ENTRA ===
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const room = salas[sala];
    if (!room) return socket.emit("error", "Sala no existe");
    const jugador = room.jugadores[nombre];
    if (!jugador) return socket.emit("error", "Jugador no existe");
    if (jugador.password !== password)
      return socket.emit("error", "Contraseña incorrecta");
    socket.join(sala);
    socket.emit("actualizarEstado", room);
  });

  // === ENTREGAS ===
  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const room = salas[sala];
    if (!room) return;
    if (!room.entregasAbiertas)
      return socket.emit("error", "Las entregas están cerradas");
    const jDe = room.jugadores[de];
    const jPara = room.jugadores[para];
    if (!jDe || !jPara) return;

    trigo = parseFloat(trigo) || 0;
    hierro = parseFloat(hierro) || 0;
    if (trigo < 0 || hierro < 0) return;

    if (jDe.trigo < trigo || jDe.hierro < hierro)
      return socket.emit("error", "No tienes suficientes recursos");

    jDe.trigo -= trigo;
    jDe.hierro -= hierro;
    jPara.trigo += trigo;
    jPara.hierro += hierro;

    jDe.trigoInsumo = jDe.trigo;
    jDe.hierroInsumo = jDe.hierro;
    jPara.trigoInsumo = jPara.trigo;
    jPara.hierroInsumo = jPara.hierro;

    jDe.entregas++;

    room.historial.push({
      de,
      para,
      trigo,
      hierro,
      hora: new Date().toLocaleTimeString(),
    });

    io.to(sala).emit("actualizarEstado", room);
  });

  // === PROCESO ELEGIDO ===
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const room = salas[sala];
    if (!room || !room.produccionAbierta) return;
    const jugador = room.jugadores[nombre];
    if (!jugador) return;
    jugador.proceso = proceso;
    io.to(sala).emit("actualizarEstado", room);
  });

  // === ADMIN: TOGGLE ENTREGAS ===
  socket.on("toggleEntregas", (sala) => {
    const room = salas[sala];
    if (!room) return;
    room.entregasAbiertas = !room.entregasAbiertas;
    io.to(sala).emit("actualizarEstado", room);
  });

  // === ADMIN: TOGGLE PRODUCCION ===
  socket.on("toggleProduccion", (sala) => {
    const room = salas[sala];
    if (!room) return;
    room.produccionAbierta = !room.produccionAbierta;

    // Si se abre la producción, aplicar cálculos
    if (room.produccionAbierta) {
      for (const jugador of Object.values(room.jugadores)) {
        let { trigoInsumo, hierroInsumo, proceso } = jugador;

        if (trigoInsumo === undefined) trigoInsumo = jugador.trigo;
        if (hierroInsumo === undefined) hierroInsumo = jugador.hierro;

        let prodTrigo = 0;
        let prodHierro = 0;

        switch (proceso) {
          case 1:
            prodTrigo = trigoInsumo + hierroInsumo * 0.1;
            prodHierro = hierroInsumo * 0.9;
            break;
          case 2:
            prodHierro = hierroInsumo + trigoInsumo * 0.1;
            prodTrigo = trigoInsumo * 0.9;
            break;
          case 3:
            prodTrigo = trigoInsumo * 0.5;
            prodHierro = hierroInsumo * 0.5;
            break;
          default:
            prodTrigo = trigoInsumo;
            prodHierro = hierroInsumo;
        }

        jugador.trigoProd = prodTrigo;
        jugador.hierroProd = prodHierro;
        jugador.trigo = prodTrigo;
        jugador.hierro = prodHierro;
      }
    }

    io.to(sala).emit("actualizarEstado", room);
  });

  // === ADMIN: NUEVA SESIÓN (mantener producción) ===
  socket.on("reiniciarSesion", (sala) => {
    const room = salas[sala];
    if (!room) return;

    for (const jugador of Object.values(room.jugadores)) {
      jugador.trigoInsumo =
        jugador.trigoProd ?? jugador.trigoInsumo ?? jugador.trigo;
      jugador.hierroInsumo =
        jugador.hierroProd ?? jugador.hierroInsumo ?? jugador.hierro;

      jugador.trigo = jugador.trigoInsumo;
      jugador.hierro = jugador.hierroInsumo;

      jugador.entregas = 0;
      jugador.proceso = null;
      jugador.trigoProd = jugador.trigoInsumo;
      jugador.hierroProd = jugador.hierroInsumo;
    }

    room.historial = [];
    io.to(sala).emit("actualizarEstado", room);
  });
});

server.listen(3000, () => console.log("Servidor en puerto 3000"));
