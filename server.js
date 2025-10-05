// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const salas = {}; // roomId -> { adminPassword, jugadores, fase, historial, produccionHist }

function num(x){ return (x === undefined || x === null) ? 0 : Number(x); }

io.on("connection", socket => {
  console.log("🔗 conectado:", socket.id);

  socket.on("loginAdmin", ({ roomId, password }, cb) => {
    if (!roomId) return cb && cb({ success:false, message:"roomId requerido" });
    roomId = String(roomId).trim();
    if (!salas[roomId]) {
      salas[roomId] = { adminPassword: password, jugadores: {}, fase: "inicio", historial: [], produccionHist: [] };
      console.log(`🆕 Sala creada: ${roomId}`);
    } else if (salas[roomId].adminPassword !== password) {
      return cb && cb({ success:false, message:"Contraseña incorrecta" });
    }
    socket.join(roomId);
    console.log(`Admin entró en sala ${roomId}`);
    actualizar(roomId);
    cb && cb({ success:true });
  });

  socket.on("crearJugador", ({ roomId, nombre, password, trigo, hierro }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala) return cb && cb({ success:false, message:"Sala no encontrada" });
    if (!nombre) return cb && cb({ success:false, message:"Nombre requerido" });
    nombre = String(nombre).trim();
    sala.jugadores[nombre] = {
      password: String(password || ""),
      trigo: num(trigo),
      hierro: num(hierro),
      entregas: 0,
      proceso: null,
      trigoProd: 0,
      hierroProd: 0
    };
    console.log(`👤 Jugador creado: ${nombre} (${roomId}) trigo=${sala.jugadores[nombre].trigo} hierro=${sala.jugadores[nombre].hierro}`);
    actualizar(roomId);
    cb && cb({ success:true });
  });

  socket.on("loginJugador", ({ roomId, nombre, password }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala || !sala.jugadores[nombre]) return cb && cb({ success:false, message:"Sala o jugador no encontrado" });
    if (sala.jugadores[nombre].password !== String(password || "")) return cb && cb({ success:false, message:"Contraseña incorrecta" });
    socket.join(roomId);
    socket.data = { roomId, nombre };
    console.log(`🎮 Jugador ${nombre} entró en ${roomId}`);
    actualizar(roomId);
    cb && cb({ success:true, jugador: sala.jugadores[nombre], fase: sala.fase });
  });

  socket.on("setFase", ({ roomId, fase }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala) return cb && cb({ success:false, message:"Sala no encontrada" });
    sala.fase = fase;
    // cuando abrimos entregas, no hacemos más
    console.log(`⚙️ Fase en ${roomId} -> ${fase}`);
    actualizar(roomId);
    cb && cb({ success:true });
  });

  // entrega recibe ambos valores (trigo y hierro) y los aplica juntos
  socket.on("entregar", ({ roomId, from, to, trigo, hierro }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala) return cb && cb({ success:false, message:"Sala no encontrada" });
    if (sala.fase !== "entregas") return cb && cb({ success:false, message:"Las entregas no están abiertas" });

    const jFrom = sala.jugadores[from];
    const jTo = sala.jugadores[to];
    if (!jFrom || !jTo) return cb && cb({ success:false, message:"Jugador origen o destino no existe" });

    const t = num(trigo);
    const h = num(hierro);

    if (jFrom.trigo < t || jFrom.hierro < h) return cb && cb({ success:false, message:"Recursos insuficientes" });

    jFrom.trigo = Number((jFrom.trigo - t));
    jFrom.hierro = Number((jFrom.hierro - h));
    jTo.trigo = Number((jTo.trigo + t));
    jTo.hierro = Number((jTo.hierro + h));
    jFrom.entregas = (jFrom.entregas || 0) + 1;

    sala.historial.push({
      from, to, trigo: t, hierro: h, timestamp: new Date().toLocaleTimeString()
    });

    console.log(`[ENTREGA] ${roomId}: ${from} -> ${to} t=${t} h=${h}`);
    actualizar(roomId);
    cb && cb({ success:true });
  });

  socket.on("elegirProceso", ({ roomId, nombre, proceso }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala) return cb && cb({ success:false, message:"Sala no encontrada" });
    if (sala.fase !== "produccion") return cb && cb({ success:false, message:"No está abierta la producción" });
    const j = sala.jugadores[nombre];
    if (!j) return cb && cb({ success:false, message:"Jugador no encontrado" });
    if (j.proceso) return cb && cb({ success:false, message:"Ya elegiste proceso" });
    proceso = Number(proceso);
    if (![1,2,3].includes(proceso)) return cb && cb({ success:false, message:"Proceso inválido" });
    j.proceso = proceso;
    console.log(`[PROCESO] ${roomId}: ${nombre} eligió proceso ${proceso}`);
    actualizar(roomId);
    cb && cb({ success:true });
  });

  // cálculo de producción: **Usar insumos finales tras entregas**
  socket.on("concluirProduccion", ({ roomId }, cb) => {
    roomId = String(roomId || "").trim();
    const sala = salas[roomId];
    if (!sala) return cb && cb({ success:false, message:"Sala no encontrada" });

    sala.produccionHist = []; // registro de esta producción

    for (const nombre in sala.jugadores) {
      const j = sala.jugadores[nombre];

      // proceso por defecto si no eligió
      if (!j.proceso) j.proceso = 3;

      // --- insumos actuales (tras entregas) ---
      const trigoInsumo = num(j.trigo);
      const hierroInsumo = num(j.hierro);

      // cálculo usando las fórmulas exactas
      let trigoProd = 0;
      let hierroProd = 0;

      if (j.proceso === 1) {
        const factor = Math.min(trigoInsumo / 280, hierroInsumo / 12);
        trigoProd = 575 * factor;
        hierroProd = 0;
      } else if (j.proceso === 2) {
        const factor = Math.min(trigoInsumo / 120, hierroInsumo / 8);
        trigoProd = 0;
        hierroProd = 20 * factor;
      } else { // proceso 3
        trigoProd = trigoInsumo / 2;
        hierroProd = hierroInsumo / 2;
      }

      // Normalizamos a número (evitamos NaN)
      trigoProd = Number(trigoProd) || 0;
      hierroProd = Number(hierroProd) || 0;

      // Guardamos productos por separado
      j.trigoProd = trigoProd;
      j.hierroProd = hierroProd;

      // Actualizamos recursos del jugador como indican las reglas (insumos son reemplazados por productos)
      j.trigo = trigoProd;
      j.hierro = hierroProd;

      // Registro para enviar a clientes (útil en admin)
      sala.produccionHist.push({
        jugador: nombre,
        proceso: j.proceso,
        trigoInsumo,
        hierroInsumo,
        trigoProd,
        hierroProd
      });

      // Log detallado para depuración
      console.log(`[PRODUCCION] ${roomId} ${nombre} | insumos t=${trigoInsumo} h=${hierroInsumo} | proc=${j.proceso} => trigoProd=${trigoProd} hierroProd=${hierroProd}`);
    }

    // cerramos la fase y emitimos resultados
    sala.fase = "fin";
    actualizar(roomId);

    // emitimos también el detalle de producción
    io.to(roomId).emit("produccionResultados", sala.produccionHist);

    cb && cb({ success:true });
  });

  socket.on("disconnect", () => {
    console.log("❌ desconectado:", socket.id);
  });
});

// helper para emitir estado
function actualizar(roomId){
  const sala = salas[roomId];
  if (!sala) return;
  io.to(roomId).emit("updatePlayers", sala.jugadores);
  io.to(roomId).emit("updateHistorial", sala.historial);
  io.to(roomId).emit("updateFase", sala.fase);
  // si hay produccionHist, enviarla también (útil si admin pulsa ver después)
  if (sala.produccionHist) io.to(roomId).emit("produccionResultados", sala.produccionHist);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🚀 server listening on", PORT));
