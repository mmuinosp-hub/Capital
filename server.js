

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
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
      const t = Number(parseFloat(trigo) || 0);
      const h = Number(parseFloat(hierro) || 0);
      data.jugadores[nombre] = {
        id,
        password,
        trigo: t,            // recursos actuales
        hierro: h,
        entregas: 5,
        proceso: null,
        trigoProd: 0,
        hierroProd: 0,
        trigoInsumo: t,      // insumos para producción (se fijan al cerrar entregas)
        hierroInsumo: h,
        penalizado: false,   // marca de penalización para la ronda
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
      let trigoReq = Number(parseFloat(trigo) || 0);
      let hierroReq = Number(parseFloat(hierro) || 0);

      // Caso 1: suficientes recursos => envío normal
      if (trigoReq <= emisor.trigo && hierroReq <= emisor.hierro) {
        emisor.trigo -= trigoReq;
        emisor.hierro -= hierroReq;
        receptor.trigo += trigoReq;
        receptor.hierro += hierroReq;
        emisor.entregas -= 1;
        data.historial.push({
          de,
          para,
          trigo: trigoReq,
          hierro: hierroReq,
          hora: new Date().toLocaleTimeString(),
        });
        io.to(sala).emit("actualizarEstado", data);
        return;
      }

      // Caso 2: intento de enviar más de lo disponible -> enviar lo disponible y aplicar penalización
      const trigoEnviado = Math.min(trigoReq, emisor.trigo);
      const hierroEnviado = Math.min(hierroReq, emisor.hierro);

      // Transferir lo disponible
      if (trigoEnviado > 0) {
        receptor.trigo += trigoEnviado;
        emisor.trigo -= trigoEnviado;
      }
      if (hierroEnviado > 0) {
        receptor.hierro += hierroEnviado;
        emisor.hierro -= hierroEnviado;
      }

      // Penalización: marcar al emisor y quitarle las entregas restantes
      emisor.penalizado = true;
      emisor.entregas = 0;

      data.historial.push({
        de,
        para,
        trigo: trigoEnviado,
        hierro: hierroEnviado,
        hora: new Date().toLocaleTimeString(),
        nota: "Entrega parcial + penalización (se intentó enviar más del disponible)"
      });

      io.to(sala).emit("actualizarEstado", data);
    }
  });

  // Abrir/Cerrar entregas
  socket.on("toggleEntregas", (sala) => {
    const data = salas[sala];
    if (data) {
      data.entregasAbiertas = !data.entregasAbiertas;

      // Cuando se cierran las entregas, fijar insumos para producción
      if (!data.entregasAbiertas) {
        for (const nombre in data.jugadores) {
          const j = data.jugadores[nombre];
          j.trigoInsumo = Number(j.trigo);
          j.hierroInsumo = Number(j.hierro);
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
      // Abrir producción: permitir que cada jugador elija proceso
      data.produccionAbierta = true;

      // Resetear procesos (para que puedan elegir en la nueva ronda),
      // reiniciar producciones previas y quitar marca de penalización de rondas ya pasadas
      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];
        j.proceso = null;
        j.trigoProd = 0;
        j.hierroProd = 0;
        // Nota: no cambiamos recursos reales hasta el cierre de producción
        j.penalizado = false; // penalizaciones se aplican dentro de la misma ronda; se reinicia al abrir
      }

    } else {
      // Cerrar producción y aplicar cálculos
      data.produccionAbierta = false;

      for (const nombre in data.jugadores) {
        const j = data.jugadores[nombre];

        // Determinar proceso aplicado (si no eligió, por defecto 3)
        const procesoAplicado = j.proceso || 3;

        // Aplicar producción según insumos fijados al cerrar entregas
        let trigoProd = 0;
        let hierroProd = 0;

        if (procesoAplicado === 1) {
          // usar proporción 280 trigo + 12 hierro -> 575 trigo (o proporción igual)
          const factor = Math.min((j.trigoInsumo || 0) / 280, (j.hierroInsumo || 0) / 12);
          // si factor=0 -> no hay insumos suficientes => producirá 0
          trigoProd = 575 * factor;
          hierroProd = 0;
        } else if (procesoAplicado === 2) {
          // 120 trigo + 8 hierro -> 20 hierro
          const factor = Math.min((j.trigoInsumo || 0) / 120, (j.hierroInsumo || 0) / 8);
          trigoProd = 0;
          hierroProd = 20 * factor;
        } else { // proceso 3: reducir a la mitad los materiales disponibles
          trigoProd = (j.trigoInsumo || 0) / 2;
          hierroProd = (j.hierroInsumo || 0) / 2;
        }

        // Aplicar penalización si corresponde (penalización grave: mitad de la producción)
        if (j.penalizado) {
          trigoProd = trigoProd / 2;
          hierroProd = hierroProd / 2;
        }

        // Guardar producción
        j.trigoProd = Number(trigoProd);
        j.hierroProd = Number(hierroProd);

        // Actualizar recursos del jugador: después de la producción quedan solo los productos
        j.trigo = j.trigoProd;
        j.hierro = j.hierroProd;

        // Guardar proceso aplicado
        j.proceso = procesoAplicado;

        // Reiniciar entregas para siguiente ronda
        j.entregas = 5;

        // Después de aplicar la penalización, se mantiene la marca (si quieres que la penalización
        // afecte solo a esta ronda, en la apertura de producción ya reiniciamos `penalizado=false`)
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));


