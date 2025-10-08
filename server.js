const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Configuración de Express ---
app.use(express.static(__dirname));
app.use(express.json());

// --- Estructura principal de datos ---
let salas = {}; // { sala: { jugadores:{}, historial:[] } }

// --- Rutas principales ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// 🔹 (Opcional) Ruta para listar historiales guardados
app.get("/api/historiales", (req, res) => {
  const histDir = path.join(__dirname, "historiales");
  if (!fs.existsSync(histDir)) return res.json([]);
  const archivos = fs.readdirSync(histDir).filter(f => f.endsWith(".json"));
  res.json(archivos);
});

// --- Manejo de Socket.IO ---
io.on("connection", socket => {
  console.log("🟢 Nueva conexión");

  // Un jugador entra en una sala
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    if (!salas[sala]) salas[sala] = { jugadores: {}, historial: [] };
    const data = salas[sala];
    if (!data.jugadores[nombre]) {
      data.jugadores[nombre] = {
        trigo: 0,
        hierro: 0,
        trigoProd: 0,
        hierroProd: 0,
        proceso: null,
        trigoInsumo: 0,
        hierroInsumo: 0,
        password
      };
    }
    socket.join(sala);
    data.jugadores[nombre].socketId = socket.id;
    io.to(sala).emit("actualizarEstado", data);
  });

  // Recibir entrega
  socket.on("enviarEntrega", ({ sala, de, para, trigo, hierro }) => {
    const data = salas[sala];
    if (!data) return;

    const jd = data.jugadores[de];
    const jp = data.jugadores[para];
    if (!jd || !jp) return;

    // Actualizar recursos
    jd.trigo -= trigo;
    jd.hierro -= hierro;
    jp.trigo += trigo;
    jp.hierro += hierro;

    // Registrar en historial
    const hora = new Date().toLocaleTimeString();
    data.historial.push({ de, para, trigo, hierro, hora });

    io.to(sala).emit("actualizarEstado", data);
  });

  // Producción o proceso
  socket.on("actualizarProduccion", ({ sala, nombre, trigo, hierro, proceso }) => {
    const data = salas[sala];
    if (!data) return;

    const j = data.jugadores[nombre];
    if (!j) return;

    j.trigo = trigo;
    j.hierro = hierro;
    j.proceso = proceso;

    io.to(sala).emit("actualizarEstado", data);
  });

  // Guardar historial de la sala
  socket.on("guardarHistorial", sala => {
    guardarHistorial(sala);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Cliente desconectado");
  });
});

// --- Función para guardar historial de sesiones ---
function guardarHistorial(sala) {
  const data = salas[sala];
  if (!data) return;

  const histDir = path.join(__dirname, "historiales");
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir);

  const fecha = new Date().toISOString().replace(/:/g, "-");

  try {
    // 🔹 Guardar entregas completas de esta sesión
    fs.writeFileSync(
      path.join(histDir, `entregas_${sala}_${fecha}.json`),
      JSON.stringify(data.historial, null, 2)
    );

    // 🔹 Guardar producción (estado final de jugadores)
    const produccion = {};
    for (const n in data.jugadores) {
      const j = data.jugadores[n];
      produccion[n] = {
        trigo: j.trigo,
        hierro: j.hierro,
        trigoProd: j.trigoProd,
        hierroProd: j.hierroProd,
        proceso: j.proceso,
        trigoInsumo: j.trigoInsumo,
        hierroInsumo: j.hierroInsumo
      };
    }

    fs.writeFileSync(
      path.join(histDir, `produccion_${sala}_${fecha}.json`),
      JSON.stringify(produccion, null, 2)
    );

    // 🔹 Registrar también un log general (historial global)
    const resumenGlobal = {
      fecha,
      sala,
      entregas: data.historial.length,
      jugadores: Object.keys(data.jugadores),
      totalTrigo: Object.values(data.jugadores).reduce((acc, j) => acc + j.trigo, 0),
      totalHierro: Object.values(data.jugadores).reduce((acc, j) => acc + j.hierro, 0)
    };

    const logFile = path.join(histDir, `resumen_global.json`);
    let logData = [];
    if (fs.existsSync(logFile)) {
      try { logData = JSON.parse(fs.readFileSync(logFile)); } catch {}
    }
    logData.push(resumenGlobal);
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));

    console.log(`💾 Historial guardado para la sala "${sala}"`);

  } catch (err) {
    console.error("❌ Error al guardar historial:", err);
  }
}

// --- Iniciar servidor ---
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
