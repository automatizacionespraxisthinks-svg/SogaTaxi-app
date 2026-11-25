#!/usr/bin/env bash
#
# Respaldo diario de la base de SogaTaxi.
#
# Saca una copia completa de PostgreSQL, comprueba que se puede leer, la
# cifra si se le da una clave, la sube a un almacenamiento FUERA del servidor
# y borra las copias locales viejas. Si algo falla termina con error, para
# que el programador de tareas lo avise.
#
# Los snapshots del proveedor no son un respaldo: viven en el mismo sitio que
# el servidor. Esto es lo que permite levantar la empresa en otro lado.
#
# Variables:
#   DATABASE_URL      (obligatoria) postgres://usuario:clave@host:puerto/base
#   RESPALDO_DIR      dónde dejar las copias locales        (./respaldos)
#   RESPALDO_DIAS     cuántos días se guardan en local      (14)
#   RESPALDO_REMOTO   destino de rclone, p. ej. b2:sogataxi-respaldos
#                     (sin esto la copia se queda SOLO en el servidor, y avisa)
#   RESPALDO_CLAVE    frase para cifrar la copia con gpg antes de subirla
#   PG_DUMP           cómo llamar a pg_dump      (pg_dump)
#   PG_RESTORE        cómo llamar a pg_restore   (pg_restore)
#
# Con PostgreSQL en un contenedor, sin herramientas en el servidor:
#   PG_DUMP="docker exec -i <contenedor> pg_dump" \
#   PG_RESTORE="docker exec -i <contenedor> pg_restore" ./scripts/respaldo.sh
#
# Restaurar (en una base vacía):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" sogataxi-AAAAMMDD-HHMM.dump
# Si está cifrada, antes: gpg -d archivo.dump.gpg > archivo.dump

set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"
RESPALDO_DIR="${RESPALDO_DIR:-./respaldos}"
RESPALDO_DIAS="${RESPALDO_DIAS:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"

mkdir -p "$RESPALDO_DIR"
# Solo el dueño lee las copias: llevan teléfonos de clientes.
chmod 700 "$RESPALDO_DIR" 2>/dev/null || true

marca="$(date +%Y%m%d-%H%M)"
archivo="$RESPALDO_DIR/sogataxi-$marca.dump"

# Si algo falla a medias, no queda un temporal ocupando disco.
trap 'rm -f "$archivo.tmp"' EXIT

echo "[respaldo] Copiando la base a $archivo"
# Formato propio de PostgreSQL: ya va comprimido y pg_restore puede
# restaurar tablas sueltas. Se escribe a un temporal: un respaldo a medias
# nunca queda con nombre de respaldo bueno.
$PG_DUMP --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$archivo.tmp"

# Una copia que no se puede leer no es una copia: se comprueba antes de darla
# por buena, y se cuentan las tablas para no guardar un archivo vacío.
tablas="$($PG_RESTORE --list < "$archivo.tmp" | grep -c ' TABLE DATA ' || true)"
if [ "${tablas:-0}" -lt 10 ]; then
  rm -f "$archivo.tmp"
  echo "[respaldo] ERROR: la copia solo trae $tablas tablas; no se guarda." >&2
  exit 1
fi
mv "$archivo.tmp" "$archivo"
echo "[respaldo] Copia legible: $tablas tablas, $(du -h "$archivo" | cut -f1)"

if [ -n "${RESPALDO_CLAVE:-}" ]; then
  # La frase entra por un descriptor, no por la línea de órdenes: ahí la
  # vería cualquiera que liste los procesos.
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 \
      --output "$archivo.gpg" "$archivo" 3<<<"$RESPALDO_CLAVE"
  rm -f "$archivo"
  archivo="$archivo.gpg"
  echo "[respaldo] Cifrada: $archivo"
fi

if [ -n "${RESPALDO_REMOTO:-}" ]; then
  rclone copy "$archivo" "$RESPALDO_REMOTO" --no-traverse
  echo "[respaldo] Subida a $RESPALDO_REMOTO"
else
  echo "[respaldo] AVISO: sin RESPALDO_REMOTO la copia solo existe en este servidor." >&2
fi

# Las locales viejas se borran; las del almacenamiento remoto las gobierna
# su propia regla de retención.
find "$RESPALDO_DIR" -name 'sogataxi-*.dump*' -type f -mtime "+$RESPALDO_DIAS" -delete
echo "[respaldo] Listo."
