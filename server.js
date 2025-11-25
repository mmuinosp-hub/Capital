/*
© 2025 Manuel Muiños
Licencia: CC BY-NC-ND 4.0
https://creativecommons.org/licenses/by-nc-nd/4.0/
*/

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
// const bcrypt = require("bcrypt"); // << opcional: descomenta e instala si quieres hashing

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// --- UTILIDADES ---
function generarId() {
  return Math.random().toString(36).substring(2, 10);
}

function saneaNombre(n = "") {
  // Permitir solo caracteres seguros y limitar longitud
  return String(n).replace(/[^\w\-]/g, "").slice(0, 40);
}

function fechaSafe() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(filePath) + "." + crypto.randomBytes(6).toString("hex"));
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, filePath);
}

// --- ALMACENAMIENTO DE SALAS ---
const salas = {};

// --- CARGA AUTOMÁTICA DEL ESTADO SI EXISTE ---
const estadoFile = path.join(__dirname, "estado_actual.json");

(async function cargarEstado() {
  if (fs.existsSync(estadoFile)) {
    try {
      const raw = await fsp.readFile(estadoFile, "utf8");
      const data = JSON.parse(raw);
      Object.assign(salas, data);
      console.log("✅ Estado recuperado desde disco");
    } catch (err) {
      console.error("⚠️ Error al cargar estado guardado:", err);
    }
  }
})();

// --- FUNCIÓN PARA GUARDAR ESTADO (atómico, async) ---
async function guardarEstado() {
  try {
    await writeAtomic(estadoFile, JSON.stringify(salas, null, 2));
  } catch (err) {
    console.error("Error al guardar estado actual:", err);
  }
}

// --- FUNCIÓN PARA GUARDAR HISTORIAL DE SESIÓN ---
async function guardarHistorial(sala) {
  const data = salas[sala];
  if (!data) return;
  const histDir = path.join(__dirname, "historiales");
  const fecha = fechaSafe();

  try {
    await fsp.mkdir(histDir, { recursive: true });

    await writeAtomic(
      path.join(histDir, `entregas_${sala}_${fecha}.json`),
      JSON.stringify(data.historial || [], null, 2)
    );

    const produccion = {};
    for (const n in data.jugadores) {
      const j = data.jugadores[n];
      produccion[n] = {
        trigo: j.trigo,
        hierro: j.hierro,
        proceso: j.proceso
      };
    }

    await writeAtomic(
      path.join(histDir, `produccion_${sala}_${fecha}.json`),
      JSON.stringify(produccion, null, 2)
    );
  } catch (err) {
    console.error("Error al guardar historial:", err);
  }
}

// --- HELPERS para validar entradas ---
function parseNumberSafe(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // Crear sala
  socket.on("crearSala", async ({ sala, password }) => {
    sala = saneaNombre(sala);
    if (!sala) return socket.emit("error", "Nombre de sala no válido");
    if (!salas[sala]) {
      // opcional: hash de password
      // const hashed = await bcrypt.hash(password, 10);
      salas[sala] = {
        adminPassword: password, // <<< si activas bcrypt guarda hashed
        jugadores: {},
        entregasAbiertas: true,
        produccionAbierta: false,
        historial: [],
        adminId: null
      };
      await guardarEstado();
      socket.emit("salaCreada", sala);
      console.log(`Sala creada: ${sala}`);
    } else {
      socket.emit("salaExiste");
    }
  });

  // Entrar admin
  socket.on("entrarAdmin", async ({ sala, password }) => {
    sala = saneaNombre(sala);
    const data = salas[sala];
    if (data /*&& await bcrypt.compare(password, data.adminPassword)*/ && data.adminPassword === password) {
      socket.join(sala);
      data.adminId = socket.id; // <<< registramos admin
      socket.emit("adminEntrado", sala);
      io.to(sala).emit("actualizarEstado", data);
      await guardarEstado();
    } else {
      socket.emit("error", "Sala o contraseña incorrecta");
    }
  });

  // Crear jugador
  socket.on("crearJugador", async ({ sala, nombre, password, trigo, hierro }) => {
    sala = saneaNombre(sala);
    nombre = String(nombre || "").trim();
    if (!nombre) return socket.emit("error", "Nombre de jugador no válido");
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");
    if (nombre === "__viewer__") return socket.emit("error", "Nombre reservado");
    if (data.jugadores[nombre]) {
      socket.emit("error", "Jugador ya existe");
      return;
    }
    const id = generarId();
    const trigoN = parseNumberSafe(trigo, 0);
    const hierroN = parseNumberSafe(hierro, 0);

    data.jugadores[nombre] = {
      id,
      password, // <<< considera guardar hash si lo deseas
      trigo: trigoN,
      hierro: hierroN,
      entregas: 0,
      proceso: null,
      trigoInsumo: trigoN,
      hierroInsumo: hierroN,
      trigoProd: 0,
      hierroProd: 0
    };
    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  // Entrar jugador / espectador
  socket.on("entrarJugador", ({ sala, nombre, password }) => {
    sala = saneaNombre(sala);
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");

    if (nombre === "__viewer__") {
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

  // Importar jugadores
  socket.on("importarJugadores", async ({ sala, jugadores }) => {
    sala = saneaNombre(sala);
    const s = salas[sala];
    if (!s) return socket.emit("error", "Sala no encontrada");

    if (!Array.isArray(jugadores)) return socket.emit("error", "Formato de jugadores incorrecto");

    jugadores.forEach(j => {
      const nombre = String(j.nombre || "").trim();
      if (!nombre) return;
      if (!s.jugadores[nombre]) {
        const trigoN = parseNumberSafe(j.trigo, 0);
        const hierroN = parseNumberSafe(j.hierro, 0);
        s.jugadores[nombre] = {
          id: generarId(), // <<< asignar id consistente
          password: j.password || "",
          trigo: trigoN,
          hierro: hierroN,
          entregas: Number.isInteger(j.entregas) ? j.entregas : 0,
          proceso: null,
          trigoInsumo: trigoN,
          hierroInsumo: hierroN,
          trigoProd: 0,
          hierroProd: 0
        };
      }
    });

    await guardarEstado();
    io.to(sala).emit("actualizarEstado", s);
  });

  // --- Helper: check admin for admin-only actions ---
  function esAdminParaSala(sala) {
    const data = salas[sala];
    return data && data.adminId === socket.id;
  }

  // Enviar entrega
  socket.on("enviarEntrega", async ({ sala, de, para, trigo, hierro }) => {
    sala = saneaNombre(sala);
    const data = salas[sala];
    if (!data || !data.entregasAbiertas) return socket.emit("error", "Entregas cerradas o sala no encontrada");
    const emisor = data.jugadores[de];
    const receptor = data.jugadores[para];
    if (!emisor || !receptor) return socket.emit("error", "Jugador emisor o receptor no encontrado");

    trigo = Math.min(parseNumberSafe(trigo, 0), emisor.trigo);
    hierro = Math.min(parseNumberSafe(hierro, 0), emisor.hierro);
    emisor.trigo -= trigo;
    emisor.hierro -= hierro;
    receptor.trigo += trigo;
    receptor.hierro += hierro;
    emisor.entregas += 1;

    data.historial = data.historial || [];
    data.historial.push({ de, para, trigo, hierro, hora: new Date().toLocaleTimeString() });
    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  // Abrir/cerrar entregas (admin only)
  socket.on("toggleEntregas", async (sala) => {
    sala = saneaNombre(sala);
    if (!esAdminParaSala(sala)) return socket.emit("error", "Acción restringida al admin");
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");
    data.entregasAbiertas = !data.entregasAbiertas;
    if (!data.entregasAbiertas) {
      for (const n in data.jugadores) {
        const j = data.jugadores[n];
        j.trigoInsumo = j.trigo;
        j.hierroInsumo = j.hierro;
      }
    }
    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  // === Producción completa (aplica productos) === (admin only)
  socket.on("toggleProduccion", async (sala) => {
    sala = saneaNombre(sala);
    if (!esAdminParaSala(sala)) return socket.emit("error", "Acción restringida al admin");
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");

    if (!data.produccionAbierta) {
      data.produccionAbierta = true;
    } else {
      // se cierra -> aplicamos producción
      data.produccionAbierta = false;

      for (const n in data.jugadores) {
        const j = data.jugadores[n];
        const proceso = j.proceso || 3;
        let factor;

        if (proceso === 1) {
          factor = Math.min(j.trigoInsumo / 280, j.hierroInsumo / 12);
          j.trigoProd = 575 * factor;
          j.hierroProd = 0;
        } else if (proceso === 2) {
          factor = Math.min(j.trigoInsumo / 120, j.hierroInsumo / 8);
          j.trigoProd = 0;
          j.hierroProd = 20 * factor;
        } else {
          j.trigoProd = j.trigoInsumo / 2;
          j.hierroProd = j.hierroInsumo / 2;
        }

        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;
        j.entregas = 0;
      }

      // guardar historial de esta producción
      await guardarHistorial(sala);
    }

    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  // === alternar solo la bandera produccionAbierta (admin only) ===
  socket.on("toggleProduccionAbierta", async (sala) => {
    sala = saneaNombre(sala);
    if (!esAdminParaSala(sala)) return socket.emit("error", "Acción restringida al admin");
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");
    data.produccionAbierta = !data.produccionAbierta;
    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  // Elegir proceso (jugador)
  socket.on("elegirProceso", async ({ sala, nombre, proceso }) => {
    sala = saneaNombre(sala);
    const data = salas[sala];
    if (!data || !data.produccionAbierta) return socket.emit("error", "Producción cerrada o sala no encontrada");
    if (data.jugadores[nombre] && data.jugadores[nombre].proceso === null) {
      data.jugadores[nombre].proceso = proceso;
      await guardarEstado();
      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Nueva sesión (admin only) -> reinicia insumos y estado
  socket.on("nuevaSesion", async (sala) => {
    sala = saneaNombre(sala);
    if (!esAdminParaSala(sala)) return socket.emit("error", "Acción restringida al admin");
    const data = salas[sala];
    if (!data) return socket.emit("error", "Sala no encontrada");

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

    await guardarEstado();
    io.to(sala).emit("actualizarEstado", data);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
    // Si era admin de alguna sala, limpiar adminId
    for (const sName of Object.keys(salas)) {
      const s = salas[sName];
      if (s.adminId === socket.id) {
        s.adminId = null;
      }
    }
  });
});

// --- PUERTO ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Servidor iniciado en http://localhost:${PORT}`)
);
