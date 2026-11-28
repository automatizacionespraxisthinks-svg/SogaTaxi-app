import { AlertTriangle, FileWarning } from 'lucide-react';
import { cn } from '@tax/ui';

/** Lo que manda la API en `/v1/driver/rides/me` por cada documento vencido o por vencer. */
export interface AvisoDeDocumentos {
  clase: 'licencia' | 'soat' | 'tecnomecanica';
  vencido: boolean;
  dias: number;
  texto: string;
  /** Con esto vencido no puede abrir turno: la empresa activó el bloqueo. */
  bloquea: boolean;
}

/**
 * Los papeles que se le vencen (27/11/2026): licencia, SOAT y revisión
 * técnico-mecánica. Se muestran al entrar, antes de abrir turno, para que el
 * conductor se entere con tiempo y no el día que ya no puede trabajar.
 *
 * Lo vencido va en rojo; lo que está por vencer, en naranja. Ícono y texto,
 * nunca solo el color.
 */
export function AvisosDeDocumentos({ avisos }: { avisos: AvisoDeDocumentos[] }) {
  if (avisos.length === 0) return null;
  const bloqueado = avisos.some((a) => a.bloquea);
  return (
    <div className="w-full space-y-2 text-left" role="status">
      {avisos.map((a) => (
        <div
          key={`${a.clase}-${a.texto}`}
          className={cn(
            a.vencido ? 'tone-critical' : 'tone-warning',
            'flex items-start gap-3 rounded-lg border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3',
          )}
        >
          {a.vencido ? (
            <FileWarning className="mt-0.5 size-6 shrink-0 text-[var(--tone-ink)]" />
          ) : (
            <AlertTriangle className="mt-0.5 size-6 shrink-0 text-[var(--tone-ink)]" />
          )}
          <p className="text-lg font-semibold leading-snug text-ink">{a.texto}</p>
        </div>
      ))}
      <p className="px-1 text-base leading-snug text-ink-secondary">
        {bloqueado
          ? 'Con un documento vencido no puede abrir turno. Lleve el documento nuevo a la oficina para que lo actualicen.'
          : 'Lleve el documento renovado a la oficina para que actualicen la fecha.'}
      </p>
    </div>
  );
}
