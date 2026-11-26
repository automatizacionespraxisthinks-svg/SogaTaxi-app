import { Controller, Get, Inject, Injectable, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  DIAS_DE_AVISO_DE_VENCIMIENTO,
  ZONA_HORARIA_LOCAL,
  type AvisoDeFlota,
  type AvisosDeFlota,
  type GrupoDeAvisosDeFlota,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import { SessionGuard } from '../identity/guards';

/**
 * Los avisos de la flota (26/11/2026): los vencimientos de los conductores y
 * los carros activos —licencia, SOAT y revisión técnico-mecánica—. Solo
 * vencimientos: los «datos por completar» se quitaron a pedido de la empresa.
 *
 * Se calculan al pedirlos, no se guardan: son unos cientos de filas y así
 * nunca quedan viejos —corregir la fecha de una licencia quita su aviso en el
 * acto—. No lleva cédulas ni teléfonos: solo dice a quién le vence qué.
 */
@Injectable()
export class AvisosDeFlotaService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async calcular(): Promise<AvisosDeFlota> {
    // La fecha de Sogamoso, no la del servidor: a las 8 de la noche en UTC ya es mañana.
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA_LOCAL }).format(new Date());
    const dias = (fecha: string) => Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);

    const conductores = await this.db.execute<{
      id: string;
      code: string;
      name: string;
      license_expires_on: string;
    }>(sql`
      select d.id, d.code, d.name, d.license_expires_on::text as license_expires_on
        from drivers d
       where d.active and not d.es_prueba and d.license_expires_on is not null
       order by d.name
    `);
    const carros = await this.db.execute<{
      id: string;
      plate: string;
      internal_number: string | null;
      soat_expires_on: string | null;
      rto_expires_on: string | null;
    }>(sql`
      select v.id, v.plate, v.internal_number,
             v.soat_expires_on::text as soat_expires_on, v.rto_expires_on::text as rto_expires_on
        from vehicles v
       where v.active and (v.soat_expires_on is not null or v.rto_expires_on is not null)
       order by v.plate
    `);

    const grupo = (
      clase: GrupoDeAvisosDeFlota['clase'],
      titulo: string,
      ayuda: string,
      tono: GrupoDeAvisosDeFlota['tono'],
    ): GrupoDeAvisosDeFlota => ({ clase, titulo, ayuda, tono, avisos: [] });
    const g = {
      licenciaVencida: grupo('licencia_vencida', 'Licencia vencida', 'No deberían estar trabajando hasta renovarla. Actualice la fecha en la ficha del conductor.', 'critical'),
      licenciaPorVencer: grupo('licencia_por_vencer', 'Licencia por vencer', `Vence en los próximos ${DIAS_DE_AVISO_DE_VENCIMIENTO} días: avísele al conductor.`, 'warning'),
      soatVencido: grupo('soat_vencido', 'SOAT vencido', 'El carro no debería estar rodando. Actualice la fecha en la ficha del vehículo.', 'critical'),
      soatPorVencer: grupo('soat_por_vencer', 'SOAT por vencer', `Vence en los próximos ${DIAS_DE_AVISO_DE_VENCIMIENTO} días.`, 'warning'),
      rtoVencida: grupo('tecnomecanica_vencida', 'Revisión técnico-mecánica vencida', 'El carro no debería estar rodando. Actualice la fecha en la ficha del vehículo.', 'critical'),
      rtoPorVencer: grupo('tecnomecanica_por_vencer', 'Revisión técnico-mecánica por vencer', `Vence en los próximos ${DIAS_DE_AVISO_DE_VENCIMIENTO} días.`, 'warning'),
    };

    const vencimiento = (
      base: Omit<AvisoDeFlota, 'fecha' | 'dias'>,
      fecha: string | null,
      vencido: GrupoDeAvisosDeFlota,
      porVencer: GrupoDeAvisosDeFlota,
    ) => {
      if (!fecha) return;
      const faltan = dias(fecha);
      if (faltan < 0) vencido.avisos.push({ ...base, fecha, dias: faltan });
      else if (faltan <= DIAS_DE_AVISO_DE_VENCIMIENTO) porVencer.avisos.push({ ...base, fecha, dias: faltan });
    };

    for (const d of conductores.rows) {
      const base = { id: d.id, de: 'conductor' as const, titulo: d.name, detalle: `Código ${d.code}` };
      vencimiento(base, d.license_expires_on, g.licenciaVencida, g.licenciaPorVencer);
    }
    for (const v of carros.rows) {
      const base = {
        id: v.id,
        de: 'vehiculo' as const,
        titulo: v.plate,
        detalle: v.internal_number ? `Móvil ${v.internal_number}` : null,
      };
      vencimiento(base, v.soat_expires_on, g.soatVencido, g.soatPorVencer);
      vencimiento(base, v.rto_expires_on, g.rtoVencida, g.rtoPorVencer);
    }

    // Lo que vence primero, primero.
    const porFecha = (a: AvisoDeFlota, b: AvisoDeFlota) => a.dias - b.dias;
    const grupos = Object.values(g)
      .filter((x) => x.avisos.length > 0)
      .map((x) => ({ ...x, avisos: [...x.avisos].sort(porFecha) }));
    return {
      hoy,
      diasDeAviso: DIAS_DE_AVISO_DE_VENCIMIENTO,
      grupos,
      urgentes: grupos.filter((x) => x.tono === 'critical').reduce((n, x) => n + x.avisos.length, 0),
    };
  }
}

/** Los ve cualquiera de la oficina: no llevan datos personales más allá del nombre. */
@Controller('v1/admin/avisos-flota')
@UseGuards(SessionGuard)
export class AvisosDeFlotaController {
  constructor(private readonly avisos: AvisosDeFlotaService) {}

  @Get()
  ver(): Promise<AvisosDeFlota> {
    return this.avisos.calcular();
  }
}
