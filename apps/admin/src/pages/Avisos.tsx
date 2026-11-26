import { useState } from 'react';
import { BellRing, CarFront, ChevronDown, UserRound } from 'lucide-react';
import type { AvisoDeFlota, GrupoDeAvisosDeFlota } from '@tax/shared';
import { Card, EmptyState, Input, StatusPill, cn } from '@tax/ui';
import { useAvisosDeFlota } from '../api/queries';

/**
 * Avisos de la flota (26/11/2026).
 *
 * Lo que hay que resolver sobre conductores y carros: licencias, SOAT y
 * revisiones vencidas o por vencer. Los «datos por completar» (sin cédula,
 * sin celular…) se quitaron a pedido de la empresa: no eran avisos. Vive aparte de los
 * avisos rojos de la operación a propósito: esto se atiende con calma, y
 * mezclado con «una carrera sin taxi» nadie lo miraría.
 */
export function Avisos() {
  const { data, isLoading, isError } = useAvisosDeFlota();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  if (isLoading) {
    return <p className="p-5 text-caption text-ink-muted">Revisando la flota…</p>;
  }
  if (isError || !data) {
    return (
      <div className="p-5">
        <Card>
          <EmptyState
            icon={<BellRing className="size-4" />}
            title="No se pudieron cargar los avisos"
            description="Revise la conexión y vuelva a entrar a esta sección."
          />
        </Card>
      </div>
    );
  }

  if (data.grupos.length === 0) {
    return (
      <div className="p-5">
        <Card>
          <EmptyState
            icon={<BellRing className="size-4" />}
            title="Todo al día"
            description="Ningún conductor ni carro activo tiene vencimientos cercanos."
          />
        </Card>
      </div>
    );
  }

  const vencidos = data.grupos.filter((g) => g.tono === 'critical');
  const porVencer = data.grupos.filter((g) => g.tono === 'warning');
  const cuenta = (grupos: GrupoDeAvisosDeFlota[]) => grupos.reduce((n, g) => n + g.avisos.length, 0);
  const texto = busca.trim().toLowerCase();

  const seccion = (titulo: string, grupos: GrupoDeAvisosDeFlota[]) =>
    grupos.length === 0 ? null : (
      <section className="space-y-2">
        <h2 className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{titulo}</h2>
        {grupos.map((grupo) => (
          <Grupo
            key={grupo.clase}
            grupo={grupo}
            filtro={texto}
            abierto={abierto === grupo.clase || Boolean(texto)}
            onToggle={() => setAbierto(abierto === grupo.clase ? null : grupo.clase)}
          />
        ))}
      </section>
    );

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Resumen tono="critical" numero={cuenta(vencidos)} titulo="Vencidos" ayuda="No pueden esperar" />
        <Resumen
          tono="warning"
          numero={cuenta(porVencer)}
          titulo="Por vencer"
          ayuda={`En los próximos ${data.diasDeAviso} días`}
        />
      </div>

      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nombre, código, placa o móvil…"
        aria-label="Buscar en los avisos"
        className="max-w-md"
      />

      {seccion('Vencidos', vencidos)}
      {seccion('Por vencer', porVencer)}

      <p className="text-micro text-ink-muted">
        Solo cuentan los conductores y los carros activos que tienen la fecha registrada. Al actualizar la fecha en Flota, el aviso desaparece.
      </p>
    </div>
  );
}

const TONO = { critical: 'tone-critical', warning: 'tone-warning' } as const;

function Resumen({
  tono,
  numero,
  titulo,
  ayuda,
}: {
  tono: keyof typeof TONO;
  numero: number;
  titulo: string;
  ayuda: string;
}) {
  return (
    <div className={cn(TONO[tono], 'rounded-md border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3')}>
      <p className="tnum text-[2rem] font-bold leading-none text-[var(--tone-ink)]">{numero}</p>
      <p className="mt-1 text-base font-semibold text-ink">{titulo}</p>
      <p className="text-micro text-ink-muted">{ayuda}</p>
    </div>
  );
}

function Grupo({
  grupo,
  filtro,
  abierto,
  onToggle,
}: {
  grupo: GrupoDeAvisosDeFlota;
  filtro: string;
  abierto: boolean;
  onToggle: () => void;
}) {
  const filas = filtro
    ? grupo.avisos.filter((a) => `${a.titulo} ${a.detalle ?? ''}`.toLowerCase().includes(filtro))
    : grupo.avisos;
  if (filtro && filas.length === 0) return null;

  return (
    <Card flush className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunk"
      >
        <StatusPill tone={grupo.tono} dot={false}>
          <span className="tnum">{filas.length}</span>
        </StatusPill>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{grupo.titulo}</span>
          <span className="block text-micro text-ink-muted">{grupo.ayuda}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-muted transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto ? (
        <ul className="max-h-96 overflow-y-auto border-t border-line">
          {filas.map((aviso) => (
            <Fila key={`${aviso.de}-${aviso.id}`} aviso={aviso} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Fila({ aviso }: { aviso: AvisoDeFlota }) {
  const Icono = aviso.de === 'conductor' ? UserRound : CarFront;
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
      <Icono className="size-3.5 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-ink">{aviso.titulo}</span>
        {aviso.detalle ? <span className="block text-micro text-ink-muted">{aviso.detalle}</span> : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="tnum block text-caption text-ink">{fechaCorta(aviso.fecha)}</span>
        <span className="block text-micro text-ink-muted">{cuanto(aviso.dias)}</span>
      </span>
    </li>
  );
}

/** `2026-12-05` → `05/12/2026`. */
const fechaCorta = (iso: string) => iso.split('-').reverse().join('/');

function cuanto(dias: number): string {
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  if (dias > 1) return `en ${dias} días`;
  if (dias === -1) return 'venció ayer';
  const hace = -dias;
  if (hace < 60) return `hace ${hace} días`;
  if (hace < 730) return `hace ${Math.round(hace / 30)} meses`;
  return `hace ${Math.round(hace / 365)} años`;
}
