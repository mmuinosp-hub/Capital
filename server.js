const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));









// Endpoint seguro para listar historiales
app.get("/api/historiales", (req, res) => {
  const dir = path.join(__dirname, "historiales");
  if (!fs.existsSync(dir)) return res.json({ entregas: [], produccion: [] });

  const files = fs.readdirSync(dir);
  const entregas = files.filter(f => f.startsWith("entregas_")).sort();
  const produccion = files.filter(f => f.startsWith("produccion_")).sort();

  res.json({ entregas, produccion });
});

// Endpoint seguro para leer un archivo específico
app.get("/api/historiales/:archivo", (req, res) => {
  const dir = path.join(__dirname, "historiales");
  const filePath = path.join(dir, req.params.archivo);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Archivo no encontrado" });

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Error leyendo archivo" });
  }
});









// Generar IDs únicos
function generarId() {
  return Math.random().toString(36).substring(2, 10);
}

// Almacenar salas
const salas = {};

// Función para guardar historial de sesiones
function guardarHistorial(sala) {
  const data = salas[sala];
  if (!data) return;
  const histDir = path.join(__dirname, "historiales");
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir);
  const fecha = new Date().toISOString().replace(/:/g, "-");

  try {
    fs.writeFileSync(
      path.join(histDir, `entregas_${sala}_${fecha}.json`),
      JSON.stringify(data.historial, null, 2)
    );

    const produccion = {};
    for (const n in data.jugadores) {
      produccion[n] = {
        trigo: data.jugadores[n].trigo,
        hierro: data.jugadores[n].hierro,
        proceso: data.jugadores[n].proceso
      };
    }

    fs.writeFileSync(
      path.join(histDir, `produccion_${sala}_${fecha}.json`),
      JSON.stringify(produccion, null, 2)
    );
  } catch (err) {
    console.error("Error al guardar historial:", err);
  }
}

// Socket.IO
io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

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
      console.log(`Sala creada: ${sala}`);
    } else {
      socket.emit("salaExiste");
    }
  });

  // Entrar admin
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
    if (!data) return;
    if (data.jugadores[nombre]) {
      socket.emit("error", "Jugador ya existe");
      return;
    }
    const id = generarId();
    data.jugadores[nombre] = {
      id,
      password,
      trigo: parseFloat(trigo),
      hierro: parseFloat(hierro),
      entregas: 0,
      proceso: null,
      trigoInsumo: parseFloat(trigo),
      hierroInsumo: parseFloat(hierro),
      trigoProd: 0,
      hierroProd: 0
    };
    io.to(sala).emit("actualizarEstado", data);
  });

  // Entrar jugador / espectador
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    const data = salas[sala];
    if (!data) return;

    if (nombre === "__viewer__") {
      // Espectador
      socket.join(sala);
      socket.emit("jugadorEntrado", { sala, nombre });
      io.to(sala).emit("actualizarEstado", data);
      return;
    }

    const jugador = data.jugadores[nombre];
    if (jugador && jugador.password === password) {
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
    if (!emisor || !receptor) return;

    trigo = Math.min(parseFloat(trigo) || 0, emisor.trigo);
    hierro = Math.min(parseFloat(hierro) || 0, emisor.hierro);
    emisor.trigo -= trigo;
    emisor.hierro -= hierro;
    receptor.trigo += trigo;
    receptor.hierro += hierro;
    emisor.entregas += 1;

    data.historial.push({ de, para, trigo, hierro, hora: new Date().toLocaleTimeString() });
    io.to(sala).emit("actualizarEstado", data);
  });

  // Abrir/cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (!data) return;
    data.entregasAbiertas = !data.entregasAbiertas;
    if (!data.entregasAbiertas) {
      for (const n in data.jugadores) {
        const j = data.jugadores[n];
        j.trigoInsumo = j.trigo;
        j.hierroInsumo = j.hierro;
      }
    }
    io.to(sala).emit("actualizarEstado", data);
  });

  // Abrir/cerrar producción
  socket.on("toggleProduccion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    if (!data.produccionAbierta) {
      data.produccionAbierta = true;
    } else {
      data.produccionAbierta = false;

      for (const n in data.jugadores) {
        const j = data.jugadores[n];
        const proceso = j.proceso || 3;
        let factor;

        if (proceso === 1) {
          factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          j.trigoProd = Math.round(575 * factor);
          j.hierroProd = 0;
        } else if (proceso === 2) {
          factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          j.trigoProd = 0;
          j.hierroProd = Math.round(20 * factor);
        } else {
          j.trigoProd = Math.round(j.trigoInsumo / 2);
          j.hierroProd = Math.round(j.hierroInsumo / 2);
        }

        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;
        j.entregas = 0;
      }

      guardarHistorial(sala);
    }

    io.to(sala).emit("actualizarEstado", data);
  });

  // Elegir proceso
  socket.on("elegirProceso", ({ sala, nombre, proceso }) => {
    const data = salas[sala];
    if (!data || !data.produccionAbierta) return;
    if (data.jugadores[nombre] && data.jugadores[nombre].proceso === null) {
      data.jugadores[nombre].proceso = proceso;
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Nueva sesión
  socket.on("nuevaSesion", (sala) => {
    const data = salas[sala];
    if (!data) return;

    for (const n in data.jugadores) {
      const j = data.jugadores[n];
      j.trigoInsumo = j.trigo;
      j.hierroInsumo = j.hierro;
      j.trigoProd = 0;
      j.hierroProd = 0;
      j.proceso = null;
      j.entregas = 0;
    }

    data.entregasAbiertas = true;
    data.produccionAbierta = false;
    data.historial = [];
    io.to(sala).emit("actualizarEstado", data);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
  });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));

