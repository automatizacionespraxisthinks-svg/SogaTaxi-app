import { Banknote, CreditCard, PackageCheck } from 'lucide-react';
import type { MedioDePago as Medio, Servicio } from '@tax/shared';
import { MEDIO_DE_PAGO_LABEL, SERVICIO_PARA_EL_CONDUCTOR } from '@tax/shared';
import { cn } from '@tax/ui';

/**
 * Cómo paga el cliente y, si lo hay, qué servicio es.
 *
 * El pago que no es efectivo va resaltado en el tono de marca, porque es lo
 * que el conductor tiene que tener listo (el QR de Nequi, la llave); el
 * efectivo, en gris, es lo de siempre. Desde el 27/11/2026 dice el medio
 * exacto —Nequi, Daviplata o Llave—, y avisa aparte si la carrera es de
 * mascota, licorera o cables de inicio. Ícono y texto, nunca solo el color.
 */
export function MedioDePago({
  electronico,
  medio,
  servicio,
  grande = false,
}: {
  electronico: boolean;
  /** El medio exacto; de una API sin actualizar no llega y vale `electronico`. */
  medio?: Medio;
  servicio?: Servicio;
  grande?: boolean;
}) {
  const cual: Medio = medio ?? (electronico ? 'electronico' : 'efectivo');
  const resaltado = cual !== 'efectivo';
  const Icono = resaltado ? CreditCard : Banknote;
  return (
    <div className="space-y-2">
      {servicio && SERVICIO_PARA_EL_CONDUCTOR[servicio] ? (
        <div className={cn('tone-warning flex items-center gap-3 rounded-lg border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4', grande ? 'py-4' : 'py-3')}>
          <PackageCheck className={cn('shrink-0 text-[var(--tone-ink)]', grande ? 'size-7' : 'size-5')} />
          <div className="min-w-0">
            <p className="text-micro font-semibold uppercase tracking-[0.07em] text-ink-muted">Servicio</p>
            <p className={cn('font-semibold leading-tight text-[var(--tone-ink)]', grande ? 'text-2xl' : 'text-xl')}>
              {SERVICIO_PARA_EL_CONDUCTOR[servicio]}
            </p>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border px-4',
          grande ? 'py-4' : 'py-3',
          resaltado ? 'tone-info border-[var(--tone-line)] bg-[var(--tone-bg)]' : 'border-line bg-surface-sunk',
        )}
      >
        <Icono
          className={cn('shrink-0', grande ? 'size-7' : 'size-5', resaltado ? 'text-[var(--tone-ink)]' : 'text-ink-muted')}
        />
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-[0.07em] text-ink-muted">El cliente paga con</p>
          <p
            className={cn(
              'font-semibold leading-tight',
              grande ? 'text-2xl' : 'text-xl',
              resaltado ? 'text-[var(--tone-ink)]' : 'text-ink',
            )}
          >
            {MEDIO_DE_PAGO_LABEL[cual] ?? (resaltado ? 'Pago electrónico' : 'Efectivo')}
          </p>
        </div>
      </div>
    </div>
  );
}
