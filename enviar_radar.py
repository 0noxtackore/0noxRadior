# Simula un Arduino con servomotor + HC-SR04 conectado al radar web.
# Escribe en el par com0com: python envia -> el navegador lee el otro extremo.
# Uso:  python enviar_radar.py [PUERTO]
# Ej.:  python enviar_radar.py COM5
import serial
import sys
import time

PUERTO = sys.argv[1] if len(sys.argv) > 1 else "COM5"
BAUDIOS = 9600

# Objetos simulados: angulo -> distancia (cm)
OBJETOS = {
    45: 250,
    90: 120,
    135: 300,
}
SIN_OBSTACULO = 400  # el eco "lejano" cuando la linea no apunta a un objeto


def medir(angulo):
    dist = SIN_OBSTACULO
    for objetivo, distancia in OBJETOS.items():
        if abs(angulo - objetivo) <= 3 and distancia < dist:
            dist = distancia
    return dist


def main():
    try:
        s = serial.Serial(PUERTO, BAUDIOS, timeout=0.1)
    except serial.SerialException as error:
        print(f"[ERROR] No se pudo abrir {PUERTO}: {error}")
        print("[AYUDA] Cierra el puerto en Termite u otra aplicacion (o desconecta en el navegador) y reintenta.")
        sys.exit(1)

    angulo = 0.0
    direccion = 1
    print(f"[CONEC] {PUERTO} a {BAUDIOS} baudios. Barrido 0-180 (Ctrl+C para salir)")

    try:
        while True:
            ang_int = int(round(angulo))
            linea = f"{ang_int},{medir(ang_int)}\n"
            s.write(linea.encode())
            print(f"-> {linea.rstrip()}")

            angulo += direccion * 2
            if angulo >= 180:
                angulo = 180
                direccion = -1
            elif angulo <= 0:
                angulo = 0
                direccion = 1
            time.sleep(0.06)
    except KeyboardInterrupt:
        print("\n[FIN] Envio detenido.")
    finally:
        s.close()


if __name__ == "__main__":
    main()