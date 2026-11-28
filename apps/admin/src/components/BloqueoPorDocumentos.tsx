import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, cn, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { usePuede } from '../api/queries';

interface Bloqueo {
  activo: boolean;
  /** Conductores activos con la licencia vencida. */
  conductores: number;
  /** Carros activos con el SOAT o la técnico-mecánica vencidos. */
  vehiculos: number;
}

/**
 * El bloqueo por documentos vencidos (27/11/2026).
 *
 * Apagado, el sistema solo avisa: a la oficina aquí, y al conductor al entrar
 * a su aplicación. Encendido, quien tenga la licencia vencida no abre turno
 * ni recibe carreras, y nadie abre turno en un carro con el SOAT o la
 * técnico-mecánica vencidos.
 *
 * Nace apagado a propósito: las fechas de la carga inicial pueden estar
 * viejas. La tarjeta dice a cuántos dejaría hoy sin trabajar, que es lo que
 * hay que mirar —y corregir en Flota— antes de encenderlo.
 */
export function BloqueoPorDocumentos() {
  const toast = useToast();
  const qc = useQueryClient();
  const puede = usePuede();
  const { data } = useQuery({
    queryKey: ['bloqueo-por-documentos'],
    queryFn: () => api.get<Bloqueo>('/v1/admin/avisos-flota/bloqueo'),
    staleTime: 60_000,
  });

  const cambiar = useMutation({
    mutationFn: (activo: boolean) => api.post<Bloqueo>('/v1/admin/avisos-flota/bloqueo', { activo }),
    onSuccess: (nuevo) => {
      qc.setQueryData(['bloqueo-por-documentos'], nuevo);
      toast.push({
        tone: nuevo.activo ? 'positive' : 'info',
        title: nuevo.activo ? 'Bloqueo activado' : 'Bloqueo desactivado',
        description: nuevo.activo
          ? 'Desde ahora, con un documento vencido no se abre turno ni se reciben carreras.'
          : 'Los documentos vencidos vuelven a ser solo un aviso.',
      });
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'No se pudo cambiar',
        description: error instanceof ApiError ? error.message : undefined,
      }),
  });

  if (!data) return null;
  const afectados = data.conductores + data.vehiculos;
  const quienes = [
    data.conductores ? `${data.conductores} ${data.conductores === 1 ? 'conductor' : 'conductores'} con la licencia vencida` : '',
    data.vehiculos ? `${data.vehiculos} ${data.vehiculos === 1 ? 'carro' : 'carros'} con SOAT o técnico-mecánica vencidos` : '',
  ]
    .filter(Boolean)
    .join(' y ');

  return (
    <div
      className={cn(
        data.activo ? 'tone-positive' : 'tone-neutral',
        'flex flex-wrap items-center gap-4 rounded-lg border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3',
      )}
    >
      {data.activo ? (
        <ShieldCheck className="size-6 shrink-0 text-[var(--tone-ink)]" />
      ) : (
        <ShieldAlert className="size-6 shrink-0 text-ink-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">
          Bloqueo por documentos vencidos: {data.activo ? 'activado' : 'desactivado'}
        </p>
        <p className="text-caption text-ink-secondary">
          {data.activo
            ? 'Con la licencia, el SOAT o la técnico-mecánica vencidos no se abre turno ni se reciben carreras. Una fecha sin registrar no bloquea.'
            : 'Hoy los vencimientos solo avisan: a la oficina aquí y al conductor al entrar a su aplicación.'}{' '}
          {afectados === 0
            ? 'En este momento no dejaría a nadie sin trabajar.'
            : data.activo
              ? `Ahora mismo deja por fuera a ${quienes}.`
              : `Si lo activa ahora, deja por fuera a ${quienes}. Revise primero que esas fechas estén bien.`}
        </p>
      </div>
      {puede('conductores.suspender') ? (
        <Button
          variant={data.activo ? 'secondary' : 'primary'}
          loading={cambiar.isPending}
          onClick={() => {
            if (
              !data.activo &&
              afectados > 0 &&
              !window.confirm(`Al activarlo quedan sin poder trabajar ${quienes}.\n\n¿Activar el bloqueo?`)
            ) {
              return;
            }
            cambiar.mutate(!data.activo);
          }}
        >
          {data.activo ? 'Desactivar' : 'Activar bloqueo'}
        </Button>
      ) : null}
    </div>
  );
}
