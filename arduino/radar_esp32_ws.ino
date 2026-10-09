/*
 * 0NOXRADIOR ESP32 — radar autonomo sin PC.
 *
 * El propio ESP32 barre con el servomotor, mide con el HC-SR04 y
 * sirve la pagina del radar + un WebSocket (sirve TODO; cualquier
 * dispositivo de la misma red solo abre http://<IP-del-modulo>).
 *
 * ELIMINA: PC, com0com, pyserial/websockets, Web Serial.
 *
 * Hardware:
 *   - ESP32 (devkit) con WiFi.
 *   - Servo SG90 sobre GPIO13.
 *   - HC-SR04: TRIG en GPIO14, ECHO en GPIO27 (con divisor 5V->3.3V o echo de 3.3V).
 *
 * Librerias (Arduino IDE -> Administrador de librerias):
 *   - "WebSockets" by Markus Sattler (Links2004)   [WebSocketsServer]
 *   (el resto son propias del nucleo ESP32)
 *
 * Configura: SSID, PASS y, si quieres, el nombre mDNS "radar".
 * Sube el sketch y abre http://radar.local (o la IP del modulo).
 */
#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <Servo.h>
#include <MDNSResponder.h>

#define SSID     "TU-WIFI"
#define PASS     "TU-CLAVE"

#define SERVO_PIN  13
#define TRIG_PIN   14
#define ECHO_PIN   27

#define MIN_ANGULO    0
#define MAX_ANGULO  180
#define PASO_GRADO    2
#define PASO_MS       35        // ms por paso -> ~3 s por barrido
#define SIN_OBSTACULO 400       // cm

Servo motor;
WebServer http(80);
WebSocketsServer ws(81);
MDNSResponder mdns;

int angulo = MIN_ANGULO;
int direccion = 1;
unsigned long proxPaso = 0;

/* ------------------------- medicion ------------------------- */
int medirDistancia() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long us = pulseIn(ECHO_PIN, HIGH, 30000L);   // espera max 30 ms
  if (us == 0) return SIN_OBSTACULO;
  int cm = us / 58;
  return cm > SIN_OBSTACULO ? SIN_OBSTACULO : cm;
}

/* ------------------------- barrido ------------------------- */
void barrido() {
  if (millis() < proxPaso) return;
  proxPaso = millis() + PASO_MS;

  int dist = medirDistancia();
  ws.broadcastTXT(String(angulo) + "," + String(dist));

  angulo += direccion * PASO_GRADO;
  if (angulo >= MAX_ANGULO) { angulo = MAX_ANGULO; direccion = -1; }
  if (angulo <= MIN_ANGULO) { angulo = MIN_ANGULO; direccion = 1; }
}

/* ------------------------- pagina embebida ------------------------- */
const char PAGINA[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>0NOXRADIOR · ESP32</title>
<style>
 body{margin:0;background:#020605;color:#3dff84;font-family:Consolas,monospace}
 .top{display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1e6b3a;
      letter-spacing:3px;font-size:12px;align-items:center}
 .led{display:inline-block;width:10px;height:10px;border-radius:50%;background:#3dff84;
      box-shadow:0 0 8px #3dff84}
 .off{background:#ff4d63;box-shadow:0 0 8px #ff4d63}
 canvas{display:block;margin:20px auto;border:1px solid #1e6b3a;background:radial-gradient(circle,#06170d,#020605)}
 .datos{text-align:center;font-size:14px;letter-spacing:2px;margin:2px auto 14px}
 .datos b{font-size:18px;text-shadow:0 0 8px rgba(61,255,132,.6)}
</style></head><body>
<div class="top"><span>◈ 0NOXRADIOR · ESP32</span>
<span><span class="led" id="led"></span> <span id="estado">BARRIDO AUTÓNOMO</span></span></div>
<canvas id="radar" width="320" height="320"></canvas>
<div class="datos">ÁNGULO <b id="a">--</b>° · DISTANCIA <b id="d">--</b> cm</div>
<script>
var cv=document.getElementById('radar'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height,cx=W/2,cy=H/2;
var eco=[],n=0;
function estado(on){document.getElementById('led').className='led'+(on?'':' off');
 document.getElementById('estado').textContent=on?'ENLACE ACTIVO':'BARRIDO LOCAL';}
var ws=new WebSocket('ws://'+location.host+':81');
ws.onopen=function(){estado(true)};
ws.onclose=function(){estado(false)};
ws.onmessage=function(e){var p=e.data.split(',');n++;
 eco.push({a:+p[0],d:+p[1],v:1});
 document.getElementById('a').textContent=p[0];
 document.getElementById('d').textContent=p[1];};
setInterval(function(){
 eco.forEach(function(p){p.v-=.015}); eco=eco.filter(function(p){return p.v>0});
 ctx.fillStyle='#020605';ctx.fillRect(0,0,W,H);
 ctx.strokeStyle='#0f2f1c';ctx.lineWidth=1;
 for(var r=1;r<=4;r++){ctx.beginPath();ctx.arc(cx,cy,r*38,0,7);ctx.stroke();}
 ctx.strokeStyle='#0f2f1c';
 for(var g=0;g<180;g+=30){var rad=g*Math.PI/180;
  ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(rad)*150,cy-Math.sin(rad)*150);ctx.stroke();}
 eco.forEach(function(p){var px=cx+Math.cos(p.a*Math.PI/180)*p.d/2.6;
   var py=cy-Math.sin(p.a*Math.PI/180)*p.d/2.6;
   ctx.strokeStyle='rgba(61,255,132,'+(p.v*.6+0.15)+')';ctx.lineWidth=2;
   ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(px,py);ctx.stroke();
   ctx.fillStyle='rgba(255,77,99,'+p.v+')';
   ctx.beginPath();ctx.arc(px,py,2.5,0,7);ctx.fill();});
 var barrido=(Date.now()%3600)*0.05,rad=barrido*Math.PI/180;
 ctx.strokeStyle='#3dff84';ctx.lineWidth=1;ctx.globalAlpha=.25;
 ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(rad)*150,cy-Math.sin(rad)*150);ctx.stroke();ctx.globalAlpha=1;
},33);
</script></body></html>)rawliteral";

/* ------------------------- servidor web ------------------------- */
void inicioWeb() {
  http.on("/", []() {
    http.sendHeader("Cache-Control", "no-cache");
    http.send(200, "text/html; charset=utf-8", PAGINA);
  });
  http.begin();
  ws.begin();
  ws.onEvent([](uint8_t, WStype_t tipo, uint8_t*, size_t) {
    // no hay mensajes entrantes que procesar; solo broadcast
  });
}

/* ------------------------- arranque ------------------------- */
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  motor.attach(SERVO_PIN);
  motor.write(MIN_ANGULO);

  Serial.println("conectando a WiFi...");
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  if (mdns.begin("radar")) {
    mdns.addService("http", "tcp", 80);
    Serial.println("mDNS: http://radar.local");
  }

  inicioWeb();
  Serial.println("radar ESP32 listo");
}

void loop() {
  http.handleClient();
  ws.loop();
  barrido();
}