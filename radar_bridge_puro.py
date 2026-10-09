"""Puente de red 0NOXRADIOR — versión SOLO estándar de Python.

Sirve la página web (HTTP) y las lecturas del puerto serie por WebSocket
(RFC 6455) sin instalar NINGUNA librería Python extra (websockets no hace
falta; pyserial ya esta instalado para leer el puerto).

Un solo comando levanta todo:
    python radar_bridge_puro.py            # pagina en :8000 , ws en :8765
    python radar_bridge_puro.py COM7       # otro puerto
    python radar_bridge_puro.py COM7 115200 8765

Cualquier dispositivo de la misma red:
    abrir http://<IP-de-esta-PC>:8000  →  CONECTAR → RED (WEBSOCKET)
    → ws://<IP-de-esta-PC>:8765
"""
import base64
import hashlib
import os
import queue
import serial
import socket
import socketserver
import struct
import sys
import threading

PUERTO_SERIE = sys.argv[1] if len(sys.argv) > 1 else "COM5"
BAUDIOS = int(sys.argv[2]) if len(sys.argv) > 2 else 9600
PUERTO_HTTP = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
PUERTO_WS = 8765
RAIZ = os.path.dirname(os.path.abspath(__file__))

cola = queue.Queue()
clientes = set()
semaforo = threading.Lock()

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
}


# ---------------- lector del puerto serie ----------------
def hilo_lector():
    try:
        serie = serial.Serial(PUERTO_SERIE, BAUDIOS, timeout=0.05)
        print(f"[puente] leyendo {PUERTO_SERIE} a {BAUDIOS} baudios")
    except Exception as exc:  # noqa: BLE001
        print(f"[puente] ERROR abriendo {PUERTO_SERIE}: {exc}", file=sys.stderr)
        print("[puente] cierra la pestana/navegador que tenga el puerto (Desconectar)")
        return
    while True:
        linea = serie.readline()
        if not linea:
            continue
        datos = linea.decode(errors="replace").strip()
        if datos:
            cola.put(datos)


# ---------------- WebSocket minimo (RF C 6455, solo serializar) ----------------
def aceptar_handshake(clave):
    nucleo = clave + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    return base64.b64encode(hashlib.sha1(nucleo.encode()).digest()).decode()


def marco_texto(texto):
    payload = texto.encode("utf-8")
    n = len(payload)
    cab = bytes([0x81])
    if n < 126:
        cab += bytes([n])
    elif n < 65536:
        cab += bytes([126]) + struct.pack(">H", n)
    else:
        cab += bytes([127]) + struct.pack(">Q", n)
    return cab + payload


def atender_ws(tcp):
    try:
        tcp.settimeout(1.0)
        datos = tcp.recv(4096)
        lineas = datos.split(b"\r\n")
        cabeceras = {}
        for ln in lineas[1:]:
            if b":" in ln:
                k, v = ln.split(b":", 1)
                cabeceras[k.strip().lower()] = v.strip()
        clave = cabeceras.get(b"sec-websocket-key", b"")
        if not clave:
            tcp.close()
            return
        tcp.sendall(
            b"HTTP/1.1 101 Switching Protocols\r\n"
            b"Upgrade: websocket\r\nConnection: Upgrade\r\n"
            b"Sec-WebSocket-Accept: "
            + aceptar_handshake(clave.decode()).encode()
            + b"\r\n\r\n"
        )
        with semaforo:
            clientes.add(tcp)
        print(f"[puente] cliente conectado ({len(clientes)} total)")

        while tcp in clientes:
            try:
                cab = tcp.recv(2)
            except socket.timeout:
                continue
            except Exception:  # noqa: BLE001
                break
            if not cab:
                break
            tam = cab[1] & 0x7F
            op = cab[0] & 0x0F
            resto = 0
            if tam == 126:
                resto = 2
            elif tam == 127:
                resto = 8
            if resto:
                tcp.recv(resto)
            if cab[1] & 0x80 and tam:
                tcp.recv(4)
                tcp.recv(tam)
            if op == 8:  # cierre
                break
    except Exception:  # noqa: BLE001
        pass
    finally:
        with semaforo:
            clientes.discard(tcp)
        try:
            tcp.close()
        except Exception:  # noqa: BLE001
            pass
        print(f"[puente] cliente desconectado ({len(clientes)} total)")


def hilo_transmisor():
    while True:
        try:
            datos = cola.get(timeout=0.2)
        except queue.Empty:
            continue
        if not clientes:
            continue
        marco = marco_texto(datos)
        with semaforo:
            vivos = list(clientes)
        for ws in vivos:
            try:
                ws.sendall(marco)
            except Exception:  # noqa: BLE001
                with semaforo:
                    clientes.discard(ws)


# ---------------- servidor estatico (la propia pagina) ----------------
class Estatico(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            peticion = self.request.recv(8192)
            if b"Upgrade: websocket" in peticion or b"upgrade: websocket" in peticion:
                atender_ws(self.request)
                return
            primera = peticion.split(b"\r\n")[0].decode(errors="replace")
            partes = primera.split()
            if len(partes) < 2 or partes[0] != "GET":
                return
            ruta = partes[1].split("?")[0]
            if ruta == "/":
                ruta = "/index.html"
            archivo = os.path.normpath(os.path.join(RAIZ, ruta.lstrip("/")))
            if not archivo.startswith(RAIZ) or not os.path.isfile(archivo):
                cuerpo = b"404"
                cabezas = b"HTTP/1.1 404 Not Found\r\n"
            else:
                with open(archivo, "rb") as f:
                    cuerpo = f.read()
                ext = os.path.splitext(archivo)[1].lower()
                tipo = TIPOS.get(ext, "application/octet-stream")
                cabezas = (
                    f"HTTP/1.1 200 OK\r\nContent-Type: {tipo}\r\n".encode()
                )
            self.request.sendall(
                cabezas
                + f"Content-Length: {len(cuerpo)}\r\nConnection: close\r\n\r\n".encode()
                + cuerpo
            )
        except Exception:  # noqa: BLE001
            pass
        finally:
            try:
                self.request.close()
            except Exception:  # noqa: BLE001
                pass


def hilo_http():
    clase = type("Srv", (socketserver.ThreadingTCPServer,), {"daemon_threads": True})
    servidor = clase(("0.0.0.0", PUERTO_HTTP), Estatico)
    print(f"[puente] pagina web en http://0.0.0.0:{PUERTO_HTTP}")
    servidor.serve_forever()


# ---------------- escuchador WebSocket dedicado ----------------
def hilo_ws():
    escucha = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    escucha.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    escucha.bind(("0.0.0.0", PUERTO_WS))
    escucha.listen(16)
    print(f"[puente] datos en ws://0.0.0.0:{PUERTO_WS}")
    while True:
        tcp, _ = escucha.accept()
        threading.Thread(target=atender_ws, args=(tcp,), daemon=True).start()


def main():
    print("== radar_bridge_puro.py ==")
    threading.Thread(target=hilo_lector, daemon=True).start()
    threading.Thread(target=hilo_http, daemon=True).start()
    threading.Thread(target=hilo_transmisor, daemon=True).start()
    hilo_ws()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[puente] detenido")