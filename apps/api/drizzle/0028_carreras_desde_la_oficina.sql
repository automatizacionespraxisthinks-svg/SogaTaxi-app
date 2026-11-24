-- Carreras creadas desde el panel (24/11/2026): permiso nuevo «carreras.crear».
-- El operador lo recibe al desplegar, porque crear la carrera de un cliente
-- que llamó es trabajo de todos los días de la oficina. El administrador no
-- lo necesita en la lista: tiene todos los permisos, incluidos los nuevos.
-- Los roles personalizados no lo reciben solos: se les da desde Sistema.
UPDATE "roles"
   SET "permissions" = "permissions" || '["carreras.crear"]'::jsonb,
       "updated_at" = now()
 WHERE "key" = 'operador'
   AND NOT ("permissions" ? 'carreras.crear');
