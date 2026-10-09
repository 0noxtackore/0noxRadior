"""Puente de red para 0NOXRADIOR.

Lee el puerto serie del Arduino (o un extremo del par com0com) y
reemite cada linea "angulo,distancia" por WebSocket en 0.0.0.0:8765.

Uso:
    python radar_bridge.py            # lee por defecto COM5 a 9600
    python radar_bridge.py COM7       # otro puerto
    python radar_bridge.py COM9 115200

Cualquier dispositivo de la misma red puede abrir la pagina y conectar
en el modal la pestana RED con ws://<IP-de-esta-PC>:8765
"""
import asyncio
import queue
import sys
import threading

import serial
import websockets

PUERTO = sys.argv[1] if len(sys.argv) > 1 else "COM5"
BAUDIOS = int(sys.argv[2]) if len(sys.argv) > 2 else 9600
DIRECCION = "0.0.0.0"
WS_PUERTO = 8765

clientes = set()
cola = queue.Queue()


def hilo_lector():
    """Lee el puerto en un hilo y deposita cada linea en la cola."""
    try:
        serie = serial.Serial(PUERTO, BAUDIOS, timeout=0.05)
    except Exception as exc:  # noqa: BLE001
        print(f"[puente] ERROR abriendo {PUERTO}: {exc}", file=sys.stderr)
        print(f"[puente] Aviso: cierra Termite u otro programa que use {PUERTO}")
        return
    print(f"[puente] leyendo {PUERTO} a {BAUDIOS} baudios")
    while True:
        linea = serie.readline()
        if not linea:
            continue
        datos = linea.decode(errors="replace").strip()
        if datos:
            cola.put(datos)


async def transmitir():
    while True:
        datos = await asyncio.to_thread(cola.get)
        if not clientes:
            continue
        muertos = []
        for ws in list(clientes):
            try:
                await ws.send(datos)
            except Exception:  # noqa: BLE001
                muertos.append(ws)
        for ws in muertos:
            clientes.discard(ws)


async def atender(ws):
    clientes.add(ws)
    print(f"[puente] cliente conectado ({len(clientes)} total)")
    try:
        await ws.wait_closed()
    finally:
        clientes.discard(ws)
        print(f"[puente] cliente desconectado ({len(clientes)} total)")


async def principal():
    threading.Thread(target=hilo_lector, daemon=True).start()
    print(f"[puente] escuchando en ws://{DIRECCION}:{WS_PUERTO}")
    async with websockets.serve(atender, DIRECCION, WS_PUERTO):
        await transmitir()


if __name__ == "__main__":
    try:
        asyncio.run(principal())
    except KeyboardInterrupt:
        print("\n[puente] detenido")