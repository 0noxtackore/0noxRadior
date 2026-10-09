/* ============================================================
   RADAR INTERACTIVO - Fase 2: lógica de la interfaz web
   Formato de datos recibidos:   angulo,distancia   (ej. 90,45)
   ============================================================ */

(() => {
  "use strict";

  // ---------------- Constantes ----------------
  const RANGO_MAX_CM   = 400;   // alcance del HC-SR04
  const VIDA_ECO_MS    = 2600;  // cuánto persiste un eco en pantalla
  const VELOCIDAD_SPU  = 95;    // grados por segundo del barrido
  const TOLERANCIA_OBJ = 4;     // grados de tolerancia del objeto simulado
  const MAX_LINEAS     = 40;    // líneas del monitor de datos

  // ---------------- Estado ----------------
  const estado = {
    modo: "sim",          // "sim" | "serial"
    corriendo: true,
    alerta: false,        // estado de la alerta roja
    angulo: 0,            // posición de la línea de barrido
    direccion: 1,         // 1 = sube (0->180), -1 = baja
    ecos: [],             // {angulo, distancia, t}
    objetos: [            // obstáculos de la simulación
      { angulo: 45,  distancia: 210 },
      { angulo: 110, distancia: 145 },
      { angulo: 165, distancia: 300 }
    ],
    ultimoDato: null,     // {angulo, distancia}
    ultimaSerial: 0,      // marca de tiempo del último dato recibido por serie
    sonido: true,         // estado del sonido del barrido
    puerto: null,
    lector: null,
    conectado: false
  };

  // ---------------- Utilidades del DOM ----------------
  const $ = (id) => document.getElementById(id);

  const canvas = $("radar");
  const ctx = canvas.getContext("2d");

  const ui = {
    btnSimulacion:  $("btnSimulacion"),
    btnSerial:      $("btnSerial"),
    btnConectar:    $("btnConectar"),
    btnIniciar:     $("btnIniciar"),
    btnLimpiar:     $("btnLimpiar"),
    btnSonido:      $("btnSonido"),
    btnAlerta:      $("btnAlerta"),
    btnAgregar:     $("btnAgregar"),
    inpObjeto:      $("inpObjeto"),
    msjError:       $("msjError"),
    txtEstado:      $("txtEstado"),
    punto:          document.querySelector(".punto"),
    txtAngulo:      $("txtAngulo"),
    txtDistancia:   $("txtDistancia"),
    txtObjetivo:    $("txtObjetivo"),
    datoBruto:      $("datoBruto"),
    consola:        $("consola"),
    listaObjetos:   $("listaObjetos"),
    contador:       $("contadorObjetos"),
    modalConexion:   $("modalConexion"),
    btnCerrarModal:  $("btnCerrarModal"),
    btnTabSerial:    $("btnTabSerial"),
    btnTabRed:       $("btnTabRed"),
    tabSerial:       $("tabSerial"),
    tabRed:          $("tabRed"),
    btnBuscarPuerto: $("btnBuscarPuerto"),
    inpPuertoElegido:$("inpPuertoElegido"),
    listaPuertos:    $("listaPuertos"),
    txtEstadoSerial: $("txtEstadoSerial"),
    btnConectarSerial:$("btnConectarSerial"),
    inpWsUrl:        $("inpWsUrl"),
    txtEstadoRed:    $("txtEstadoRed"),
    btnConectarRed:  $("btnConectarRed")
  };

  // ---------------- Geometría del lienzo ----------------
  let W = 0, H = 0, cx = 0, cy = 0, R = 0;

  function redimensionar() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    W = rect.width;
    H = rect.height;
    cx = W / 2;
    cy = H - 34;
    R  = Math.min(W / 2 - 52, H - 74);
  }

  // Convierte (ángulo del servomotor, distancia) -> coordenadas de pantalla
  // 0° a la derecha, 90° arriba, 180° a la izquierda.
  function polar(angulo, distanciaCm) {
    const r = (distanciaCm / RANGO_MAX_CM) * R;
    const rad = (180 - angulo) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }

  // ---------------- Registro en el monitor de datos ----------------
  function log(texto, clase) {
    const linea = document.createElement("div");
    linea.textContent = texto;
    if (clase) linea.className = clase;
    ui.consola.appendChild(linea);
    while (ui.consola.children.length > MAX_LINEAS) {
      ui.consola.removeChild(ui.consola.firstChild);
    }
    ui.consola.scrollTop = ui.consola.scrollHeight;
  }

  // ---------------- Procesamiento de la cadena "angulo,distancia" ----------------
  function procesarDato(cadena) {
    const limpio = String(cadena).trim();
    const partes = limpio.split(",");

    if (partes.length !== 2) return null;

    const angulo    = Number(partes[0]);
    const distancia = Number(partes[1]);

    if (!Number.isFinite(angulo) || !Number.isFinite(distancia)) return null;
    if (angulo < 0 || angulo > 180) return null;

    return {
      angulo,
      distancia: Math.max(0, Math.min(RANGO_MAX_CM, distancia))
    };
  }

  // Punto de entrada de toda la data (simulada o serie)
  function recibirDato(cadenaCruda, desdeSerial) {
    const dato = procesarDato(cadenaCruda);

    if (!dato) {
      log(`[ERROR] cadena no válida: "${cadenaCruda}"`, "linea-error");
      return;
    }

    estado.ultimoDato = dato;
    ui.datoBruto.textContent = `${dato.angulo} , ${dato.distancia}`;
    ui.txtAngulo.textContent    = `${dato.angulo}°`;
    ui.txtDistancia.textContent = `${dato.distancia} cm`;

    const hayObjeto = dato.distancia < RANGO_MAX_CM;
    ui.txtObjetivo.textContent = hayObjeto ? "Objetivo adquirido" : "Sin objetivo";
    ui.txtObjetivo.style.color = hayObjeto ? "var(--verde)" : "var(--texto-apag)";

    if (hayObjeto) {
      estado.ecos.push({ angulo: dato.angulo, distancia: dato.distancia, t: performance.now() });
      radio.lock();                       // confirmación de contacto por radio
      desbloquearLogro("operador");
    }

    // Sincronización: en modo serie la línea de barrido sigue al servomotor real
    if (desdeSerial) {
      if (dato.angulo < estado.angulo) estado.direccion = -1;
      else if (dato.angulo > estado.angulo) estado.direccion = 1;
      estado.angulo = dato.angulo;
      estado.ultimaSerial = performance.now();
    }

    log(`${desdeSerial ? "[RX]" : "[SIM]"} ${dato.angulo},${dato.distancia}`,
        hayObjeto ? "linea-nueva" : "");
  }

  // ---------------- Simulación de la lectura del HC-SR04 ----------------
  function simularLectura(angulo) {
    let mejor = null;
    let mejorDiff = Infinity;

    for (const obj of estado.objetos) {
      const diff = Math.abs(obj.angulo - angulo);
      if (diff < mejorDiff) { mejorDiff = diff; mejor = obj; }
    }

    if (mejor && mejorDiff <= TOLERANCIA_OBJ) {
      const ruido = (Math.random() * 4) - 2;            // ±2 cm de ruido
      return Math.round(Math.max(2, Math.min(RANGO_MAX_CM, mejor.distancia + ruido)));
    }
    return RANGO_MAX_CM;                                 // sin eco: fuera de alcance
  }

  // Genera una lectura por cada grado que avanza el barrido simulado
  function pasoSimulacion(anterior, actual) {
    const de = Math.floor(Math.min(anterior, actual));
    const a = Math.floor(Math.max(anterior, actual));
    for (let ang = de; ang <= a; ang++) {
      recibirDato(`${ang},${simularLectura(ang)}`, false);
    }
  }

  // Colores del radar: verde militar normal / rojo durante la ALERTA ROJA
  function colorRadar(alfa) {
    return estado.alerta ? `rgba(255, 76, 92, ${alfa})` : `rgba(45, 255, 135, ${alfa})`;
  }

  function colorTexto(alfa) {
    return estado.alerta ? `rgba(255, 219, 223, ${alfa})` : `rgba(185, 247, 211, ${alfa})`;
  }

  // ---------------- Dibujo del radar ----------------
  function dibujarCuadricula() {
    ctx.save();

    // Disco base
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = estado.alerta ? "rgba(70, 12, 18, .55)" : "rgba(10, 40, 25, .45)";
    ctx.fill();

    // Círculos de distancia
    ctx.strokeStyle = colorRadar(.28);
    ctx.lineWidth = 1;
    const anillos = [100, 200, 300, 400];

    for (const cm of anillos) {
      const r = (cm / RANGO_MAX_CM) * R;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = colorRadar(.55);
      ctx.font = "11px Consolas, monospace";
      ctx.letterSpacing = "2px";
      ctx.textAlign = "center";
      ctx.fillText(`${cm}cm`, cx, cy - r - 5);
    }
    ctx.letterSpacing = "";

    // Radios cada 30°
    for (let ang = 0; ang <= 180; ang += 30) {
      const p = polar(ang, RANGO_MAX_CM);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      const pl = polar(ang, RANGO_MAX_CM + 34);
      ctx.fillStyle = colorRadar(.75);
      ctx.font = "11px Consolas, monospace";
      ctx.letterSpacing = "2px";
      ctx.textAlign = pl.x > cx + 5 ? "left" : pl.x < cx - 5 ? "right" : "center";
      ctx.textBaseline = pl.y < cy - 5 ? "bottom" : "top";
      ctx.fillText(`${ang}°`, pl.x, pl.y);
    }
    ctx.letterSpacing = "";

    // Eje horizontal del barrido
    ctx.strokeStyle = colorRadar(.5);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.stroke();

    // Base del servomotor
    ctx.fillStyle = colorRadar(.8);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function dibujarBarrido() {
    const rad = (180 - estado.angulo) * Math.PI / 180;
    const PASOS = 26;          // estela del barrido
    const AMPLITUD = 42;       // grados hacia atrás

    ctx.save();
    for (let i = 0; i < PASOS; i++) {
      const proporcion = i / PASOS;
      const ang = estado.angulo - estado.direccion * AMPLITUD * proporcion;
      const r2 = (180 - ang) * Math.PI / 180;
      ctx.strokeStyle = colorRadar((1 - proporcion) * 0.28);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(r2), cy - R * Math.sin(r2));
      ctx.stroke();
    }

    // Línea principal
    ctx.strokeStyle = colorRadar(.95);
    ctx.lineWidth = 2;
    ctx.shadowColor = colorRadar(.9);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(rad), cy - R * Math.sin(rad));
    ctx.stroke();
    ctx.restore();
  }

  function dibujarEcos(ahora) {
    ctx.save();
    for (const eco of estado.ecos) {
      const edad = ahora - eco.t;
      const vida = 1 - edad / VIDA_ECO_MS;
      if (vida <= 0) continue;

      const p = polar(eco.angulo, eco.distancia);

      // Halo expansivo
      const halo = (1 - vida) * 18 + 6;
      ctx.strokeStyle = colorRadar(vida * 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.stroke();

      // Núcleo del eco
      ctx.fillStyle = colorRadar(vida);
      ctx.shadowColor = colorRadar(1);
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Etiqueta de distancia
      if (vida > 0.45) {
        ctx.fillStyle = colorTexto(vida);
        ctx.font = "11px Consolas, monospace";
        ctx.letterSpacing = "1.5px";
        ctx.textAlign = "left";
        ctx.fillText(`${eco.distancia}cm`, p.x + 9, p.y - 7);
      }
    }
    ctx.restore();

    estado.ecos = estado.ecos.filter((e) => ahora - e.t < VIDA_ECO_MS);
  }

  function dibujarEncabezado() {
    ctx.save();
    ctx.fillStyle = colorRadar(.5);
    ctx.font = "12px Consolas, monospace";
    ctx.letterSpacing = "3px";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`MODO: ${estado.modo === "sim" ? "SIMULACIÓN" : "SERIE 9600 baudios"}`, 14, 12);
    ctx.fillText(`BARRIDO: ${estado.corriendo ? "ACTIVO" : "DETENIDO"}`, 14, 34);
    if (estado.modo === "serial" && estado.corriendo) {
      const sincronizado = performance.now() - estado.ultimaSerial <= 1500;
      ctx.fillStyle = sincronizado ? colorRadar(.95)
          : (estado.alerta ? colorRadar(.75) : "rgba(255,190,60,.9)");
      ctx.fillText(`LINK: ${sincronizado ? "SINCRONIZADO CON DATOS" : "SIN DATOS (BARRIDO LOCAL)"}`, 14, 56);
    }
    ctx.restore();
  }

  // ---------------- Bucle de animación ----------------
  let ultimoTiempo = performance.now();
  let ultimoSeg = 0;

  function actualizarReloj(ahora) {
    if (ahora - ultimoSeg < 1000) return;
    ultimoSeg = ahora;

    const hora = document.getElementById("horaMision");
    const fecha = document.getElementById("fechaMision");
    if (!hora && !fecha) return;

    const f = new Date();
    if (hora) hora.textContent = f.toLocaleTimeString("es-MX", { hour12: false });
    if (fecha) fecha.textContent =
        `${f.getFullYear()}/${String(f.getMonth() + 1).padStart(2, "0")}/${String(f.getDate()).padStart(2, "0")}`;
  }

  function avanzarBarrido(dt) {
    estado.angulo += estado.direccion * VELOCIDAD_SPU * dt;
    if (estado.angulo >= 180) { estado.angulo = 180; estado.direccion = -1; }
    if (estado.angulo <= 0)   { estado.angulo = 0;   estado.direccion = 1;  }
  }

  function bucle(ahora) {
    const dt = Math.min(0.05, (ahora - ultimoTiempo) / 1000);
    ultimoTiempo = ahora;
    actualizarReloj(ahora);

    if (estado.corriendo) {
      if (estado.modo === "sim") {
        const anterior = estado.angulo;
        avanzarBarrido(dt);
        pasoSimulacion(anterior, estado.angulo);
      } else if (ahora - estado.ultimaSerial > 1500) {
        // Serie sin datos: barrido local de respaldo para que el radar siga vivo.
        // Al llegar un dato, la línea salta a la posición real (sincronización).
        avanzarBarrido(dt);
      }
    }

    ctx.clearRect(0, 0, W, H);
    dibujarCuadricula();
    dibujarEcos(ahora);
    if (estado.corriendo) dibujarBarrido();
    dibujarEncabezado();

    requestAnimationFrame(bucle);
  }

  // ---------------- Comunicación: puerto serie (Web Serial) y red (WebSocket) ----------------

  // Abre un puerto serie ya elegido y arranca el lector
  async function abrirPuerto(puerto) {
    if (!("serial" in navigator)) {
      log("[ERROR] Tu navegador no soporta Web Serial (usa Chrome/Edge).", "linea-error");
      ui.txtEstado.textContent = "Navegador sin soporte Web Serial";
      return false;
    }

    try {
      ui.txtEstado.textContent = "Abriendo puerto serie...";
      await puerto.open({ baudRate: 9600 });

      estado.puerto = puerto;
      estado.red = null;
      estado.conectado = true;

      ui.txtEstado.textContent = "Arduino conectado (9600 baudios)";
      ui.btnConectar.textContent = "Desconectar";
      ui.txtEstadoSerial.textContent = "Conectado";
      ui.punto.classList.remove("rojo");
      desbloquearLogro("enlace");
      log(`[SYS] Puerto serie abierto (${estado.puertoElegido || "com0com/COM"}) a 9600 baudios`, "linea-nueva");

      const decodificador = new TextDecoder();
      let buffer = "";
      estado.lector = puerto.readable.getReader();

      // Sin salto de línea al final: se vacía el búfer periódicamente
      const soltarBuffer = () => {
        if (!estado.conectado) return;
        if (buffer.trim() !== "") {
          if (estado.corriendo) recibirDato(buffer.trim(), true);
          else log(`[PAUSA] ${buffer.trim()}`);
          buffer = "";
        }
      };
      const temporizador = setInterval(soltarBuffer, 400);

      while (estado.conectado) {
        const { value, done } = await estado.lector.read();
        if (done) break;

        buffer += decodificador.decode(value, { stream: true });
        const lineas = buffer.split(/\r?\n/);
        buffer = lineas.pop();

        for (const linea of lineas) {
          if (linea.trim() === "") continue;
          if (estado.corriendo) recibirDato(linea.trim(), true);
          else log(`[PAUSA] ${linea.trim()}`);
        }
      }

      clearInterval(temporizador);
      soltarBuffer();
    } catch (error) {
      log(`[ERROR] ${error.message}`, "linea-error");
      ui.txtEstado.textContent = "Error de conexión";
    } finally {
      try { estado.lector && estado.lector.releaseLock(); } catch (_) {}
      if (estado.puerto === puerto) {
        estado.conectado = false;
        estado.puerto = null;
        ui.btnConectar.textContent = "Conectar";
        ui.txtEstadoSerial.textContent = "Desconectado";
      }
    }
  }

  // Abre el selector nativo y muestra el puerto elegido en el modal
  function buscarPuertoSerie() {
    if (!("serial" in navigator)) {
      log("[ERROR] Tu navegador no soporta Web Serial (usa Chrome/Edge).", "linea-error");
      return;
    }
    navigator.serial.requestPort()
      .then((puerto) => {
        estado.puertoElegido = puerto;
        ui.inpPuertoElegido.value = "PUERTO ELEGIDO ✓";
        ui.txtEstadoSerial.textContent = "Listo para conectar";
        listarPuertosConcedidos();
      })
      .catch(() => { /* el usuario canceló el selector */ });
  }

  // Muestra los puertos que Chrome ya nos dejó usar (acceso directo)
  function listarPuertosConcedidos() {
    if (!("serial" in navigator)) return;
    navigator.serial.getPorts().then((puertos) => {
      ui.listaPuertos.innerHTML = "";
      const vacio = document.createElement("li");
      if (puertos.length === 0) {
        vacio.innerHTML = `<span>Sin puertos concedidos aún — usa BUSCAR</span>`;
        ui.listaPuertos.appendChild(vacio);
        return;
      }
      puertos.forEach((puerto) => {
        const li = document.createElement("li");
        const info = puerto.getInfo();
        const nombre = (info.usbVendorId && info.usbProductId)
          ? `USB ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)}`
          : "com0com / puerto del sistema";
        li.innerHTML = `<span>${nombre}</span>`;
        li.addEventListener("click", () => {
          estado.puertoElegido = puerto;
          ui.inpPuertoElegido.value = "PUERTO ELEGIDO ✓";
          ui.txtEstadoSerial.textContent = "Listo para conectar";
          ui.listaPuertos.querySelectorAll("li").forEach((x) => x.classList.remove("pick"));
          li.classList.add("pick");
        });
        ui.listaPuertos.appendChild(li);
      });
    });
  }

  function conectarSerial() {
    if (!estado.puertoElegido) {
      ui.txtEstadoSerial.textContent = "Elige un puerto con BUSCAR primero";
      log("[ERROR] No hay puerto elegido: usa BUSCAR", "linea-error");
      return;
    }
    cerrarModal();
    abrirPuerto(estado.puertoElegido);
  }

  // Conexión por red: radar_bridge.py lee el Arduino y emite por WebSocket
  function conectarRed() {
    const url = ui.inpWsUrl.value.trim();
    if (!url) {
      log("[ERROR] Escribe la dirección del puente WebSocket (ws://IP:8765)", "linea-error");
      return;
    }
    if (!/^wss?:\/\//i.test(url)) {
      log("[ERROR] Formato esperado: ws://192.168.1.100:8765", "linea-error");
      return;
    }
    cerrarModal();

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      log(`[ERROR] ${error.message}`, "linea-error");
      return;
    }

    estado.red = ws;
    ui.txtEstadoRed.textContent = "Conectando...";
    ui.txtEstado.textContent = "Conectando por red...";

    ws.onopen = () => {
      estado.puerto = null;
      estado.conectado = true;
      ui.txtEstado.textContent = `Red conectada (${url})`;
      ui.txtEstadoRed.textContent = "Conectado";
      ui.btnConectar.textContent = "Desconectar";
      ui.punto.classList.remove("rojo");
      desbloquearLogro("enlace");
      log(`[SYS] Conectado por red: ${url}`, "linea-nueva");
    };

    ws.onmessage = (evento) => {
      const linea = String(evento.data).trim();
      if (!linea) return;
      if (estado.corriendo) recibirDato(linea, true);
      else log(`[PAUSA] ${linea}`);
    };

    ws.onclose = () => {
      if (estado.red !== ws) return;
      estado.red = null;
      estado.conectado = false;
      ui.txtEstado.textContent = "Red desconectada";
      ui.txtEstadoRed.textContent = "Desconectado";
      ui.btnConectar.textContent = "Conectar";
      log("[SYS] Enlace de red cerrado");
    };

    ws.onerror = () => {
      log("[ERROR] No se pudo conectar por red; revisa radar_bridge.py", "linea-error");
      ui.txtEstadoRed.textContent = "Sin enlace";
    };
  }

  async function desconectarSerie() {
    estado.conectado = false;

    if (estado.red) {
      const ws = estado.red;
      estado.red = null;
      try { ws.close(); } catch (_) {}
      ui.txtEstado.textContent = "Red desconectada";
      ui.txtEstadoRed.textContent = "Desconectado";
      log("[SYS] Enlace de red cerrado");
    } else {
      try { estado.lector && await estado.lector.cancel(); } catch (_) {}
      try { estado.puerto && await estado.puerto.close(); } catch (_) {}
      estado.puerto = null;
      ui.txtEstado.textContent = "Puerto desconectado";
      log("[SYS] Puerto serie cerrado");
    }

    ui.btnConectar.textContent = "Conectar";
  }

  // ---------------- Modal de conexión ----------------
  function abrirModal() {
    if (!ui.modalConexion.classList.contains("oculto")) return;
    ui.modalConexion.classList.remove("oculto");
    ui.inpWsUrl.value = `ws://${window.location.hostname || "192.168.1.100"}:8765`;
    listarPuertosConcedidos();
  }

  function cerrarModal() {
    ui.modalConexion.classList.add("oculto");
  }

  // ---------------- Panel de objetos simulados ----------------
  function pintarObjetos() {
    ui.listaObjetos.innerHTML = "";
    estado.objetos.forEach((obj, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${obj.angulo}° &middot; ${obj.distancia} cm</span>`;
      const btn = document.createElement("button");
      btn.textContent = "✕";
      btn.title = "Eliminar objeto";
      btn.addEventListener("click", () => {
        estado.objetos.splice(i, 1);
        pintarObjetos();
        log(`[SIM] objeto eliminado (${obj.angulo},${obj.distancia})`);
      });
      li.appendChild(btn);
      ui.listaObjetos.appendChild(li);
    });
    ui.contador.textContent = estado.objetos.length;
  }

  // ---------------- Sonido del radar ----------------
  // Sonido principal: sound/radar.mp3
  // Si radar.mp3 falla -> sound/alerta.mp3
  // Si alerta.mp3 también falla -> alert() del navegador
  const sonido = {
    radar:  new Audio("sound/radar.mp3"),
    radio:  new Audio("sound/radio.mp3"),   // mezcla ambiente en modo normal
    alerta: new Audio("sound/alerta.mp3"),
    actual: null,
    avisado: false,
    sinRadio: false,
    reproduciendo: false,   // verdadero cuando el audio está sonando de verdad
    pendienteGesto: false,  // autoplay bloqueado: espera una interacción
    avisadoBlock: false
  };

  for (const pista of [sonido.radar, sonido.radio, sonido.alerta]) {
    pista.loop = true;
    pista.preload = "auto";
  }
  sonido.radar.volume  = 0.4;
  sonido.radio.volume  = 0.15;   // ambiente de radio, de fondo
  sonido.alerta.volume = 0.4;

  sonido.radar.addEventListener("error",  () => fallarSonido(sonido.radar,  "error de carga"));
  sonido.alerta.addEventListener("error", () => fallarSonido(sonido.alerta, "error de carga"));

  // radio.mp3 es un añadido opcional: si falta, el radar sigue igual.
  sonido.radio.addEventListener("error", () => {
    if (sonido.sinRadio) return;
    sonido.sinRadio = true;
    log("[AVISO] radio.mp3 no disponible; se reproduce solo radar.mp3", "linea-error");
  });

  // ---------------- Sonido de radio (Web Audio API) ----------------
  // Ping sintetizado estilo radio/sonar: se sobrepone a los mp3 y no
  // depende de archivos. Si el navegador no soporta AudioContext, se ignora.
  const radio = {
    ctx: null,

    iniciar() {
      if (this.ctx) return this.ctx;
      const Actx = (typeof window !== "undefined") &&
        (window.AudioContext || window.webkitAudioContext);
      if (!Actx) return null;
      try { this.ctx = new Actx(); } catch (_) { this.ctx = null; }
      return this.ctx;
    },

    // "KHUNG" de sonar: barrido descendente corto
    ping() {
      if (estado.alerta) return;                       // bajo alerta: silencio total de radio
      if (!estado.sonido || !estado.corriendo) return;
      const ctx = this.iniciar();
      if (!ctx) return;
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (_) {} }

      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1250, t0);
      osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.16);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    },

    // Doble bip agudo: "bloqueo de objetivo" por radio
    lock() {
      if (estado.alerta) return;                       // también silencio los "lock" de radio
      if (!estado.sonido) return;
      const ctx = this.iniciar();
      if (!ctx) return;
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (_) {} }

      const t0 = ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.12;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(i ? 1900 : 1450, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.13);
      }
    }
  };

  function intentarReproducir(pista) {
    let intento;
    try {
      intento = pista.play();
    } catch (error) {
      manejarFalloReproduccion(pista, error);
      return;
    }
    if (intento && typeof intento.catch === "function") {
      intento
        .then(() => { sonido.reproduciendo = true; })
        .catch((error) => manejarFalloReproduccion(pista, error));
    } else {
      sonido.reproduciendo = true;
    }
  }

  // Un rechazo por NotAllowedError es autoplay bloqueado (falta gesto), NO un
  // archivo roto: se reintenta en autoplay sin pasar a la cadena de respaldo.
  function manejarFalloReproduccion(pista, error) {
    const nombre = (error && error.name) || "rechazo";
    if (nombre === "NotAllowedError") {
      sonido.reproduciendo = false;
      sonido.pendienteGesto = true;
      if (!sonido.avisadoBlock) {
        sonido.avisadoBlock = true;
        log("[SYS] el navegador bloqueó el audio automático; sonará en la primera interacción", "linea-error");
      }
      return;
    }
    sonido.reproduciendo = false;
    fallarSonido(pista, nombre);
  }

  function fallarSonido(pista, motivo) {
    if (pista !== sonido.actual) return;          // ya se cambió de pista

    if (pista === sonido.radar) {                 // radar.mp3 no funciona -> alerta.mp3
      log(`[AVISO] radar.mp3 no funciona (${motivo}); se usa alerta.mp3`, "linea-error");
      sonido.actual = sonido.alerta;
      intentarReproducir(sonido.alerta);
      return;
    }

    // Tampoco funcionó alerta.mp3 -> se corta el sonido y se avisa
    sonido.actual = null;
    for (const pista2 of [sonido.radar, sonido.radio, sonido.alerta]) {
      try { pista2.pause(); pista2.currentTime = 0; } catch (_) {}
    }
    if (!sonido.avisado) {
      sonido.avisado = true;
      log("[ERROR] sin sonido: ningún archivo mp3 reproducible", "linea-error");
      window.alert(
        "No se pudo reproducir el sonido del radar.\n\n" +
        "Verifique que existan los archivos:\n" +
        "sound/radar.mp3\n" +
        "sound/alerta.mp3"
      );
    }
  }

  function reproducirSonido() {
    if (!estado.sonido || !estado.corriendo) return;
    if (estado.alerta) { reproducirAlerta(); return; }  // bajo alerta: solo sirena
    radio.ping();                                   // toque de radio/sonar
    if (!sonido.actual) sonido.actual = sonido.radar;   // primer intento: radar.mp3
    intentarReproducir(sonido.actual);
    if (!sonido.sinRadio) intentarReproducir(sonido.radio);  // mezcla ambiente de radio
  }

  // Sirena de ALERTA ROJA: alerta.mp3 sustituye al radar y silencia los demás
  function reproducirAlerta() {
    if (!estado.sonido) return;
    pausarSonido();
    sonido.actual = sonido.alerta;
    intentarReproducir(sonido.alerta);
  }

  function pausarSonido() {
    sonido.reproduciendo = false;
    for (const pista of [sonido.radar, sonido.radio, sonido.alerta]) {
      try { pista.pause(); } catch (_) {}
    }
  }

  // ---------------- Eventos de interfaz ----------------
  function seleccionarModo(modo) {
    estado.modo = modo;
    const esSim = modo === "sim";

    ui.btnSimulacion.classList.toggle("activo", esSim);
    ui.btnSerial.classList.toggle("activo", !esSim);
    ui.btnConectar.classList.toggle("oculto", esSim);

    ui.punto.classList.toggle("rojo", !esSim && !estado.conectado);
    ui.txtEstado.textContent = esSim
      ? "Modo simulación activo"
      : (estado.conectado ? "Arduino conectado" : "Esperando conexión con Arduino");

    log(esSim ? "[SYS] modo simulación" : "[SYS] modo serie (9600 baudios)", "linea-nueva");
  }

  ui.btnSimulacion.addEventListener("click", () => seleccionarModo("sim"));
  ui.btnSerial.addEventListener("click", () => seleccionarModo("serial"));
  ui.btnConectar.addEventListener("click", () => {
    if (estado.conectado) { desconectarSerie(); return; }
    abrirModal();
  });

  ui.btnCerrarModal.addEventListener("click", cerrarModal);
  ui.modalConexion.addEventListener("click", (evento) => {
    if (evento.target === ui.modalConexion) cerrarModal();
  });

  ui.btnTabSerial.addEventListener("click", () => {
    ui.btnTabSerial.classList.add("activo");
    ui.btnTabRed.classList.remove("activo");
    ui.tabSerial.classList.remove("oculto");
    ui.tabRed.classList.add("oculto");
  });

  ui.btnTabRed.addEventListener("click", () => {
    ui.btnTabRed.classList.add("activo");
    ui.btnTabSerial.classList.remove("activo");
    ui.tabRed.classList.remove("oculto");
    ui.tabSerial.classList.add("oculto");
  });

  ui.btnBuscarPuerto.addEventListener("click", buscarPuertoSerie);
  ui.btnConectarSerial.addEventListener("click", conectarSerial);
  ui.btnConectarRed.addEventListener("click", conectarRed);

  ui.btnIniciar.addEventListener("click", () => {
    estado.corriendo = !estado.corriendo;
    ui.btnIniciar.textContent = estado.corriendo ? "Detener barrido" : "Iniciar barrido";
    ui.btnIniciar.classList.toggle("pausa", !estado.corriendo);
    log(estado.corriendo ? "[SYS] barrido reanudado" : "[SYS] barrido detenido");

    if (estado.corriendo) {
      reproducirSonido();
      desbloquearLogro("recluta");
    } else {
      pausarSonido();
    }
  });

  ui.btnSonido.addEventListener("click", () => {
    estado.sonido = !estado.sonido;
    ui.btnSonido.textContent = `Sonido: ${estado.sonido ? "ON" : "OFF"}`;
    ui.btnSonido.classList.toggle("activo", estado.sonido);
    log(estado.sonido ? "[SYS] sonido activado" : "[SYS] sonido silenciado");

    if (estado.sonido) reproducirSonido();
    else pausarSonido();
  });

  ui.btnLimpiar.addEventListener("click", () => {
    desbloquearLogro("limpieza");
    estado.ecos = [];
    ui.consola.innerHTML = "";
    ui.datoBruto.textContent = "-- , --";
    ui.txtObjetivo.textContent = "Sin objetivo";
    log("[SYS] ecos y monitor limpiados");
  });

  ui.btnAlerta.addEventListener("click", () => {
    estado.alerta = !estado.alerta;
    document.body.classList.toggle("alerta-roja", estado.alerta);
    ui.btnAlerta.classList.toggle("activada", estado.alerta);
    ui.btnAlerta.textContent = `⚠ ALERTA ROJA: ${estado.alerta ? "ON" : "OFF"}`;
    log(`[SYS] ALERTA ROJA ${estado.alerta ? "ACTIVADA" : "DESACTIVADA"}`,
        estado.alerta ? "linea-error" : "linea-nueva");

    if (estado.alerta) {
      reproducirAlerta();      // suena la sirena y silencia radar/radio
      desbloquearLogro("alerta");
      log("[SYS] sirena de alerta activada", "linea-error");
    } else {
      pausarSonido();
      sonido.actual = null;
      if (estado.sonido && estado.corriendo) reproducirSonido();  // vuelve el radar
    }
  });

  function mostrarErrorObj(texto) {
    ui.msjError.textContent = texto;
    ui.msjError.hidden = false;
    ui.inpObjeto.classList.add("invalido");
  }

  function limpiarErrorObj() {
    ui.msjError.hidden = true;
    ui.msjError.textContent = "";
    ui.inpObjeto.classList.remove("invalido");
  }

  // Acepta "90,120", "90, 120", "90 · 120" o "90;120"
  function parsearObjeto(cadena) {
    const limpio = String(cadena).trim();
    const partes = limpio.split(/[,;\u00B7|]/).map((p) => p.trim());

    if (partes.length !== 2 || partes.some((p) => p === "")) return null;

    const angulo = Number(partes[0]);
    const distancia = Number(partes[1]);

    if (!Number.isInteger(angulo) || !Number.isFinite(angulo)) return { error: "El ángulo debe ser un número entero (0-180)" };
    if (!Number.isInteger(distancia) || !Number.isFinite(distancia)) return { error: "La distancia debe ser un número entero" };

    if (angulo < 0 || angulo > 180) return { error: "El ángulo debe estar entre 0 y 180 grados" };
    if (distancia < 2 || distancia > 400) return { error: "La distancia debe estar entre 2 y 400 cm" };

    return { angulo, distancia };
  }

  function agregarObjeto() {
    const resultado = parsearObjeto(ui.inpObjeto.value);

    if (!resultado) {
      mostrarErrorObj('Formato no válido. Escribe "ángulo,distancia", ej. 90,120');
      ui.inpObjeto.focus();
      return;
    }
    if (resultado.error) {
      mostrarErrorObj(resultado.error);
      ui.inpObjeto.focus();
      return;
    }

    estado.objetos.push({ angulo: resultado.angulo, distancia: resultado.distancia });
    estado.objetos.sort((a, b) => a.angulo - b.angulo);
    pintarObjetos();
    ui.inpObjeto.value = "";
    limpiarErrorObj();
    log(`[SIM] objeto agregado (${resultado.angulo},${resultado.distancia})`, "linea-nueva");
    desbloquearLogro("tecnico");
  }

  ui.btnAgregar.addEventListener("click", agregarObjeto);
  ui.inpObjeto.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      agregarObjeto();
    }
  });
  ui.inpObjeto.addEventListener("input", limpiarErrorObj);

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
      e.preventDefault();
      ui.btnIniciar.click();
    }
  });

  // ---------------- Méritos (notificaciones infinitas) ----------------
  // La lista larga de méritos vive en js/logros.json (solo para notificaciones,
  // no se muestra en ninguna interfaz). Los soldados se eligen al azar.
  const IMG_SOLDADOS = ["img/s1.avif", "img/s2.avif", "img/s3.webp", "img/s4.webp", "img/s5.webp"];
  const MERITOS_FALLBACK = [
    { n: "RECLUTA", d: "Primer paso en la estación de vigilancia" },
    { n: "OPERADOR RADAR", d: "Contacto adquirido en el sector" },
    { n: "VIGÍA", d: "Turno de guardia iniciado" }
  ];
  const ETIQUETAS_TRIGGER = {
    recluta:   "ACCIONES DE BARRIDO",
    enlace:    "ENLACE ESTABLECIDO",
    operador:  "CONTACTO ADQUIRIDO",
    alerta:    "ALERTA ACTIVA",
    tecnico:   "ALTA DE OBJETIVO",
    limpieza:  "SECTOR LIMPIO"
  };

  let meritos = [];
  let meritosUsados = new Set(cargarMeritosUsados());

  function cargarMeritosUsados() {
    try {
      const guardado = JSON.parse(localStorage.getItem("nox_meritos") || "[]");
      if (Array.isArray(guardado)) return guardado.filter((x) => typeof x === "string");
    } catch (_) { /* sin localStorage: ciclo solo en sesión */ }
    return [];
  }

  function guardarMeritosUsados() {
    try { localStorage.setItem("nox_meritos", JSON.stringify([...meritosUsados])); } catch (_) {}
  }

  // Carga la lista grande desde js/logros.json; si falla, usa la corta.
  function cargarMeritos() {
    if (typeof fetch !== "function") { meritos = [...MERITOS_FALLBACK]; return; }
    fetch("js/logros.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        if (datos && Array.isArray(datos.meritos) && datos.meritos.length) {
          meritos = datos.meritos;
        } else if (meritos.length === 0) {
          meritos = [...MERITOS_FALLBACK];
        }
      })
      .catch(() => { if (meritos.length === 0) meritos = [...MERITOS_FALLBACK]; });
  }

  // Siguiente mérito sin repetir; al agotar la lista vuelve a rotar (infinito).
  function proximoMerito() {
    if (meritos.length === 0) return { n: "MÉRITO EN CAMPO", d: "Servicio distinguido en el sector" };
    const disponibles = meritos.filter((m) => !meritosUsados.has(m.n));
    const pool = disponibles.length ? disponibles : meritos;
    const elegido = pool[Math.floor(Math.random() * pool.length)];
    meritosUsados.add(elegido.n);
    guardarMeritosUsados();
    return elegido;
  }

  function sonarMerito() {
    const ctx = radio.ctx && radio.ctx.state === "running" ? radio.ctx : null;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.setValueAtTime(1320, t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  }

  // Cada acción del usuario otorga un mérito al azar con un soldado aleatorio.
  function desbloquearLogro(tipo) {
    const m = proximoMerito();
    const img = IMG_SOLDADOS[Math.floor(Math.random() * IMG_SOLDADOS.length)];
    const etiqueta = ETIQUETAS_TRIGGER[tipo] || "MISIVA DE CAMPO";
    log(`[MÉRITO] ${m.n} (${tipo})`, "linea-nueva");

    if (document && document.body) {
      const toast = document.createElement("div");
      toast.className = "mensaje-logro";
      toast.innerHTML = `<img src="${img}" alt="">
        <div><p class="ml-tit">★ MÉRITO CONCEDIDO · ${etiqueta}</p>
        <p class="ml-nombre">${m.n}</p>
        <p class="ml-desc">${m.d}</p></div>`;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("mostrar"));
      setTimeout(() => {
        toast.classList.remove("mostrar");
        setTimeout(() => toast.remove(), 500);
      }, 4500);
    }
    sonarMerito();
  }

  cargarMeritos();

  // ---------------- Arranque ----------------
  window.addEventListener("resize", redimensionar);
  redimensionar();
  pintarObjetos();

  // Activación automática del audio al cargar (sin tocar la pantalla).
  // Chrome suele permitirlo por autoplay si el sitio tiene historial de uso;
  // si lo bloquea, se reintenta unos segundos y luego el gesto sirve de respaldo.
  function iniciarAudioAutomatico() {
    if (!estado.sonido || !estado.corriendo) return;
    reproducirSonido();
  }

  iniciarAudioAutomatico();

  if (typeof setInterval === "function") {
    const reintentosAudio = setInterval(() => {
      if (!estado.sonido || !estado.corriendo) return;
      if (estado.alerta) { if (!sonido.actual) reproducirAlerta(); return; }
      if (sonido.actual && sonido.reproduciendo) { clearInterval(reintentosAudio); return; }
      if (sonido.pendienteGesto) return;   // ya se avisó: espera al gesto
      reproducirSonido();
    }, 600);
    setTimeout(() => clearInterval(reintentosAudio), 6000);
  }

  // Último recurso: si el navegador bloqueó el autoplay, cualquier
  // interacción (clic, tecla) desbloquea el audio automáticamente.
  const primerGesto = () => {
    reproducirSonido();
    document.removeEventListener("pointerdown", primerGesto);
    document.removeEventListener("keydown", primerGesto);
  };
  document.addEventListener("pointerdown", primerGesto);
  document.addEventListener("keydown", primerGesto);

  log("[SYS] interfaz lista - formato angulo,distancia", "linea-nueva");
  requestAnimationFrame(bucle);
})();
