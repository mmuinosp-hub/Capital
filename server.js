const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

let salas = {};

io.on("connection", socket => {
  console.log("🔗 Usuario conectado:", socket.id);

  // LOGIN ADMIN
  socket.on("loginAdmin", ({ roomId, password }, cb) => {
    if(!salas[roomId]){
      salas[roomId] = { adminPassword: password, jugadores: {}, fase: "inicio", historial: [] };
      console.log("🆕 Sala creada:", roomId);
      cb({ success:true });
    } else if(salas[roomId].adminPassword === password){
      cb({ success:true });
    } else cb({ success:false, message:"Contraseña incorrecta"});

    socket.join(roomId);
    actualizar(roomId);
  });

  // CREAR JUGADOR
  socket.on("crearJugador", ({ roomId, nombre, password, trigo, hierro }, cb) => {
    const sala = salas[roomId];
    if(!sala) return cb({ success:false, message:"Sala no encontrada"});
    sala.jugadores[nombre] = { 
      password, 
      trigo:parseFloat(trigo)||0, 
      hierro:parseFloat(hierro)||0, 
      entregas:0, 
      proceso:null, 
      trigoProd:0, 
      hierroProd:0 
    };
    console.log(`👤 Jugador creado: ${nombre} (${roomId})`);
    actualizar(roomId);
    cb({ success:true });
  });

  // LOGIN JUGADOR
  socket.on("loginJugador", ({ roomId, nombre, password }, cb) => {
    const sala = salas[roomId];
    if(!sala || !sala.jugadores[nombre]) return cb({ success:false, message:"Sala o jugador no encontrado"});
    if(sala.jugadores[nombre].password !== password) return cb({ success:false, message:"Contraseña incorrecta"});
    socket.join(roomId);
    socket.data = { roomId, nombre };
    cb({ success:true, jugador:sala.jugadores[nombre], fase:sala.fase });
    actualizar(roomId);
  });

  // CAMBIO DE FASE
  socket.on("setFase", ({ roomId, fase }) => {
    const sala = salas[roomId];
    if(!sala) return;
    sala.fase = fase;
    console.log(`⚙️ Fase cambiada a ${fase} en ${roomId}`);
    actualizar(roomId);
  });

  // ENTREGA
  socket.on("entregar", ({ roomId, from, to, trigo, hierro }, cb) => {
    const sala = salas[roomId];
    if(!sala || sala.fase !== "entregas") return cb({ success:false, message:"No se pueden hacer entregas ahora" });

    const jFrom = sala.jugadores[from];
    const jTo = sala.jugadores[to];
    trigo = parseFloat(trigo)||0;
    hierro = parseFloat(hierro)||0;

    if(!jFrom || !jTo) return cb({ success:false, message:"Jugador no encontrado" });
    if(jFrom.trigo < trigo || jFrom.hierro < hierro) return cb({ success:false, message:"Recursos insuficientes" });

    jFrom.trigo -= trigo;
    jFrom.hierro -= hierro;
    jTo.trigo += trigo;
    jTo.hierro += hierro;

    jFrom.entregas++;
    sala.historial.push({ from, to, trigo, hierro, timestamp:new Date().toLocaleTimeString() });

    actualizar(roomId);
    cb({ success:true });
  });

  // ELEGIR PROCESO
  socket.on("elegirProceso", ({ roomId, nombre, proceso }, cb) => {
    const sala = salas[roomId];
    if(!sala || sala.fase !== "produccion") return cb({ success:false, message:"No se puede elegir proceso ahora" });
    const j = sala.jugadores[nombre];
    if(!j) return cb({ success:false, message:"Jugador no encontrado" });
    if(j.proceso) return cb({ success:false, message:"Ya elegiste proceso" });
    j.proceso = proceso;
    actualizar(roomId);
    cb({ success:true });
  });

  // CONCLUIR PRODUCCIÓN
socket.on("concluirProduccion", ({ roomId }) => {
  const sala = salas[roomId];
  if(!sala) return;

  for(let nombre in sala.jugadores){
    const j = sala.jugadores[nombre];

    // si el jugador no eligió proceso, asignamos el proceso 3 por defecto
    if(!j.proceso) j.proceso = 3;

    // insumos tras todas las entregas
    const trigoInsumo = j.trigo;
    const hierroInsumo = j.hierro;

    let trigoProd = 0, hierroProd = 0;

    switch(j.proceso){
      case 1:
        trigoProd = 575 * Math.min(trigoInsumo/280, hierroInsumo/12);
        hierroProd = 0;
        break;
      case 2:
        trigoProd = 0;
        hierroProd = 20 * Math.min(trigoInsumo/120, hierroInsumo/8);
        break;
      case 3:
      default:
        trigoProd = trigoInsumo / 2;
        hierroProd = hierroInsumo / 2;
    }

    // Guardamos productos en variables separadas
    j.trigoProd = trigoProd;
    j.hierroProd = hierroProd;

    // Actualizamos recursos para la siguiente ronda si queremos
    j.trigo = trigoProd;
    j.hierro = hierroProd;
  }

  // Cerramos la fase de producción
  sala.fase = "fin";

  // Enviamos actualización a todos los clientes
  actualizar(roomId);
});

  socket.on("disconnect", () => console.log("❎ Desconectado:", socket.id));
});

// FUNCION ACTUALIZAR
function actualizar(roomId){
  const sala = salas[roomId];
  if(!sala) return;
  io.to(roomId).emit("updatePlayers", sala.jugadores);
  io.to(roomId).emit("updateHistorial", sala.historial);
  io.to(roomId).emit("updateFase", sala.fase);
}

server.listen(3000, ()=>console.log("🚀 Servidor escuchando en puerto 3000"));

