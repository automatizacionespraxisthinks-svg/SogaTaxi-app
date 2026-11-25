/**
 * Puntos de Sogamoso para las pruebas e2e, en un solo sitio (25/11/2026).
 *
 * Antes cada prueba traía su `CENTRO` de Paipa, y al pasar el sistema a
 * Sogamoso todas quedaban fuera de cobertura. Los demás puntos de cada prueba
 * se trasladaron con el mismo desplazamiento (centro de Paipa → plaza de
 * Sogamoso), así que las distancias entre ellos siguen siendo las que cada
 * prueba necesita.
 *
 * Es el centro de la zona «Centro» que siembra `db/datos-base.ts`.
 */
export const CENTRO = { lat: 5.7148, lng: -72.9279 };
