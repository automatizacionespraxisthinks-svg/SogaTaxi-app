#!/usr/bin/env bash
# Mide, desde el servidor, cada cuánto llegan las posiciones de un conductor.
# Lee de Redis la hora de su última posición (`tax:driver:<id>:meta`, campo
# `at`) cada 2 s y la anota con la hora del PC. Independiente de la app.
#
#   bash scripts/monitor-posiciones.sh <driverId> <minutos> > monitor.tsv
id="$1"; minutos="${2:-20}"
vueltas=$(( minutos * 30 ))
printf 'hora_pc\tultima_posicion_ms\n'
for ((i = 0; i < vueltas; i++)); do
  at=$(docker exec sogataxi-dev-redis-1 redis-cli hget "tax:driver:${id}:meta" at | tr -d '\r')
  printf '%s\t%s\n' "$(date +%s%3N)" "$at"
  sleep 2
done
