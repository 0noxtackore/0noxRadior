/*
 * ============================================================
 *  RADAR INTERACTIVO - Fase 1: Simulación en Tinkercad
 *  Asignatura: ELT-622  |  TSU en Informática - 6to semestre
 *  Docente: Ing. Héctor Manuel Mendoza Alvarado
 * ============================================================
 *
 *  Hardware (Tinkercad):
 *   - Arduino Uno R3
 *   - Protoboard pequeña
 *   - Sensor ultrasónico HC-SR04 (Trig = pin 11, Echo = pin 12)
 *   - Micro servomotor SG90   (Señal = pin 9)
 *
 *  Comportamiento:
 *   - El servomotor barre de 0 a 180 grados y regresa (bucle infinito).
 *   - En cada posición el HC-SR04 mide la distancia al objeto.
 *   - El Monitor Serie imprime el flujo estructurado:  angulo,distancia
 *     Ejemplo:  90,45   ->  ángulo 90°, distancia 45 cm
 *
 *  Comunicación: 9600 bauds (debe coincidir con la interfaz web).
 * ============================================================ */

#include <Servo.h>

// ---------- Pines ----------
const int PIN_SERVO   = 9;    // señal del servomotor
const int PIN_TRIG    = 11;   // disparo del HC-SR04
const int PIN_ECHO    = 12;   // eco del HC-SR04

// ---------- Parámetros ----------
const int   ANGULO_MIN     = 0;
const int   ANGULO_MAX     = 180;
const int   PASO           = 1;     // grados por iteración (menor = más fino)
const int   PAUSA_BARRIDO  = 15;    // ms de estabilización en cada ángulo
const float VELOCIDAD_SONIDO = 0.0343; // cm por microsegundo (20 °C)
const int   DIST_MIN       = 2;     // cm: ruido de proximidad
const int   DIST_MAX       = 400;   // cm: alcance útil del HC-SR04
const long  TIMEOUT_ECHO   = 25000; // µs: ~430 cm, evita lecturas colgadas

Servo servoRadar;

// ---------- Medición con el HC-SR04 ----------
int medirDistancia() {
  // Pulso de disparo de 10 µs
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Duración del eco en alto (pulseIn espera máximo TIMEOUT_ECHO µs)
  long duracion = pulseIn(PIN_ECHO, HIGH, TIMEOUT_ECHO);

  if (duracion == 0) {
    // Sin eco: objeto fuera de alcance
    return DIST_MAX;
  }

  int distancia = (int)((duracion * VELOCIDAD_SONIDO) / 2.0);

  // Filtrado simple de valores inválidos
  if (distancia < DIST_MIN)  return DIST_MIN;
  if (distancia > DIST_MAX)  return DIST_MAX;
  return distancia;
}

void setup() {
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  servoRadar.attach(PIN_SERVO);
  servoRadar.write(ANGULO_MIN);

  Serial.begin(9600);          // debe coincidir con el monitor serie / interfaz web
  delay(1000);                 // tiempo para que el servomotor se posicione
}

void loop() {
  // ---------- Barrido de ida: 0 -> 180 ----------
  for (int angulo = ANGULO_MIN; angulo <= ANGULO_MAX; angulo += PASO) {
    servoRadar.write(angulo);
    delay(PAUSA_BARRIDO);
    int distancia = medirDistancia();
    Serial.print(angulo);
    Serial.print(",");
    Serial.println(distancia);   // Flujo: "angulo,distancia"
  }

  // ---------- Barrido de vuelta: 180 -> 0 ----------
  for (int angulo = ANGULO_MAX; angulo >= ANGULO_MIN; angulo -= PASO) {
    servoRadar.write(angulo);
    delay(PAUSA_BARRIDO);
    int distancia = medirDistancia();
    Serial.print(angulo);
    Serial.print(",");
    Serial.println(distancia);
  }
}
