import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { CampoExtra } from '@tax/shared';
import { MAX_CAMPOS_EXTRA, TIPO_DE_CAMPO_EXTRA, valorDeCampoExtraValido } from '@tax/shared';
import { Banner, Button, Card, CardHeader, Field, Input, Select, StatusPill, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';

/**
 * Campos adicionales (26/11/2026): los datos que la oficina quiere guardar de
 * los conductores o de los vehículos y que el sistema no trae —la empresa
 * afiliadora, el número de la tarjeta de operación—. Se definen una vez y
 * aparecen en la ficha de todos.
 */
export function useCamposExtra() {
  return useQuery({
    queryKey: ['campos-extra'],
    queryFn: () => api.get<CampoExtra[]>('/v1/admin/campos-extra'),
    staleTime: 60_000,
  });
}

/** Los campos adicionales activos de una ficha, para llenarlos. Sin campos, no pinta nada. */
export function CamposExtraDeLaFicha({
  entidad,
  valores,
  onCambiar,
}: {
  entidad: CampoExtra['entidad'];
  valores: Record<string, string>;
  onCambiar: (valores: Record<string, string>) => void;
}) {
  const campos = (useCamposExtra().data ?? []).filter((c) => c.entidad === entidad && c.activo);
  if (campos.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {campos.map((campo) => {
        const valor = valores[campo.id] ?? '';
        const mal = !valorDeCampoExtraValido(campo.tipo, valor);
        return (
          <Field
            key={campo.id}
            label={campo.nombre}
            htmlFor={`extra-${campo.id}`}
            hint={mal ? (campo.tipo === 'numero' ? 'Solo números' : 'Revise el valor') : undefined}
          >
            <Input
              id={`extra-${campo.id}`}
              type={campo.tipo === 'fecha' ? 'date' : 'text'}
              inputMode={campo.tipo === 'numero' ? 'decimal' : undefined}
              maxLength={200}
              value={valor}
              onChange={(e) => onCambiar({ ...valores, [campo.id]: e.target.value })}
            />
          </Field>
        );
      })}
    </div>
  );
}

/** Solo los valores de los campos en uso: los de uno desactivado no se mandan. */
export function soloCamposEnUso(campos: CampoExtra[], entidad: CampoExtra['entidad'], valores: Record<string, string>) {
  const enUso = new Set(campos.filter((c) => c.entidad === entidad && c.activo).map((c) => c.id));
  return Object.fromEntries(Object.entries(valores).filter(([id]) => enUso.has(id)));
}

/** Si todos los valores escritos sirven para su campo. */
export function camposExtraValidos(campos: CampoExtra[], entidad: CampoExtra['entidad'], valores: Record<string, string>) {
  return campos
    .filter((c) => c.entidad === entidad && c.activo)
    .every((c) => valorDeCampoExtraValido(c.tipo, valores[c.id] ?? ''));
}

const ENTIDAD: Record<CampoExtra['entidad'], string> = { conductor: 'Conductores', vehiculo: 'Vehículos' };

/** Crear, renombrar y desactivar los campos adicionales. */
export function GestionCamposExtra({ gestionar }: { gestionar: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: campos = [], isLoading } = useCamposExtra();
  const [entidad, setEntidad] = useState<CampoExtra['entidad']>('conductor');
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<CampoExtra['tipo']>('texto');
  const [error, setError] = useState<string | null>(null);

  const refrescar = () => qc.invalidateQueries({ queryKey: ['campos-extra'] });
  const crear = useMutation({
    mutationFn: () => api.post<CampoExtra>('/v1/admin/campos-extra', { entidad, nombre: nombre.trim(), tipo }),
    onSuccess: async (campo) => {
      await refrescar();
      setNombre('');
      setError(null);
      toast.push({
        tone: 'positive',
        title: `Campo «${campo.nombre}» creado`,
        description: `Ya aparece en la ficha de ${campo.entidad === 'conductor' ? 'cada conductor' : 'cada vehículo'}.`,
      });
    },
    onError: (e) => setError((e instanceof ApiError && e.message) || 'No se pudo crear el campo.'),
  });
  const cambiar = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => api.patch(`/v1/admin/campos-extra/${id}`, { activo }),
    onSuccess: refrescar,
    onError: (e) => toast.push({ tone: 'critical', title: (e instanceof ApiError && e.message) || 'No se pudo cambiar' }),
  });

  const activosDeLaEntidad = campos.filter((c) => c.entidad === entidad && c.activo).length;

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <CardHeader
          title="Campos adicionales"
          subtitle="Un dato que quiera guardar de los conductores o de los vehículos y que el sistema no trae. Se crea una vez y aparece en la ficha de todos."
        />
        {gestionar ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_auto] sm:items-end">
              <Field label="Para" htmlFor="campo-entidad">
                <Select id="campo-entidad" value={entidad} onChange={(e) => setEntidad(e.target.value as CampoExtra['entidad'])}>
                  <option value="conductor">Conductores</option>
                  <option value="vehiculo">Vehículos</option>
                </Select>
              </Field>
              <Field label="Nombre del campo" htmlFor="campo-nombre">
                <Input
                  id="campo-nombre"
                  maxLength={40}
                  placeholder="Empresa afiliadora"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </Field>
              <Field label="Tipo de dato" htmlFor="campo-tipo">
                <Select id="campo-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as CampoExtra['tipo'])}>
                  {(Object.keys(TIPO_DE_CAMPO_EXTRA) as CampoExtra['tipo'][]).map((t) => (
                    <option key={t} value={t}>
                      {TIPO_DE_CAMPO_EXTRA[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                icon={<Plus className="size-3.5" />}
                disabled={nombre.trim().length < 2 || activosDeLaEntidad >= MAX_CAMPOS_EXTRA}
                loading={crear.isPending}
                onClick={() => crear.mutate()}
              >
                Crear campo
              </Button>
            </div>
            {error ? <Banner tone="critical">{error}</Banner> : null}
          </>
        ) : (
          <p className="text-caption text-ink-muted">Para crear campos hace falta el permiso «Gestionar conductores».</p>
        )}
      </Card>

      {(['conductor', 'vehiculo'] as const).map((e) => {
        const lista = campos.filter((c) => c.entidad === e);
        return (
          <Card key={e} flush className="overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-ink">{ENTIDAD[e]}</h2>
              <p className="text-micro text-ink-muted">
                {lista.length === 0
                  ? isLoading
                    ? 'Cargando…'
                    : 'Sin campos adicionales todavía.'
                  : `${lista.filter((c) => c.activo).length} de ${MAX_CAMPOS_EXTRA} en uso`}
              </p>
            </div>
            <ul>
              {lista.map((campo) => (
                <li key={campo.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{campo.nombre}</span>
                    <span className="block text-micro text-ink-muted">{TIPO_DE_CAMPO_EXTRA[campo.tipo]}</span>
                  </span>
                  <StatusPill tone={campo.activo ? 'positive' : 'neutral'} dot={false}>
                    {campo.activo ? 'En uso' : 'Desactivado'}
                  </StatusPill>
                  {gestionar ? (
                    <Button
                      size="sm"
                      loading={cambiar.isPending && cambiar.variables?.id === campo.id}
                      onClick={() => cambiar.mutate({ id: campo.id, activo: !campo.activo })}
                    >
                      {campo.activo ? 'Desactivar' : 'Activar'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <p className="text-micro text-ink-muted">
        Un campo no se borra: se desactiva, y lo que ya se escribió en él se conserva por si vuelve a hacer falta.
      </p>
    </div>
  );
}
