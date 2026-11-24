"""Resume un monitor-*.tsv de scripts/monitor-posiciones.sh.

Para cada muestra calcula la edad de la última posición (hora del PC menos
hora de la posición) y cuenta los tramos sin posiciones nuevas.

    python -I scripts/analizar-monitor.py monitor-prueba2.tsv
"""
import sys
from datetime import datetime

filas = []
with open(sys.argv[1], encoding='utf-8') as f:
    next(f)
    for linea in f:
        partes = linea.strip().split('\t')
        if len(partes) == 2 and partes[1].isdigit():
            filas.append((int(partes[0]), int(partes[1])))

if not filas:
    sys.exit('Sin muestras')

hora = lambda ms: datetime.fromtimestamp(ms / 1000).strftime('%H:%M:%S')
edades = [(pc - at) / 1000 for pc, at in filas]
distintas = sorted({at for _, at in filas})
huecos = [(b - a) / 1000 for a, b in zip(distintas, distintas[1:])]
peor = max(range(len(huecos)), key=huecos.__getitem__) if huecos else None

print(f'Muestras: {len(filas)} · de {hora(filas[0][0])} a {hora(filas[-1][0])} '
      f'({(filas[-1][0] - filas[0][0]) / 60000:.1f} min)')
print(f'Posiciones distintas recibidas: {len(distintas)}')
if huecos:
    huecos_ordenados = sorted(huecos)
    mediana = huecos_ordenados[len(huecos) // 2]
    print(f'Separación entre posiciones: mediana {mediana:.1f} s · máxima {huecos[peor]:.1f} s '
          f'(de {hora(distintas[peor])} a {hora(distintas[peor + 1])})')
    for umbral in (10, 30, 60):
        n = sum(1 for h in huecos if h > umbral)
        print(f'  huecos de más de {umbral} s: {n}')
print(f'Edad de la última posición vista por la oficina: máxima {max(edades):.1f} s')
