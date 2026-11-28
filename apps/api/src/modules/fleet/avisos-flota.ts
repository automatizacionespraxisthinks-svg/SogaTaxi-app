import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodBody } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { FleetService } from './fleet.service';
import { sql } from 'drizzle-orm';
import {
  DIAS_DE_AVISO_DE_VENCIMIENTO,
  ZONA_HORARIA_LOCAL,
  type AvisoDeFlota,
  type AvisosDeFlota,
  type GrupoDeAvisosDeFlota,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import { RequierePermiso, SessionGuard } from '../identity/guards';

const bloqueoSchema = z.object({ activo: z.boolean() });

/**
 * Los avisos de la flota (26/11/2026): los vencimientos de los conductores y
 * los carros activos —licencia, SOAT, revisión técnico-mecánica y los campos
 * adicionales de tipo fecha—. Solo
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
      license_expires_on: string | null;
      extra: Record<string, string> | null;
    }>(sql`
      select d.id, d.code, d.name, d.license_expires_on::text as license_expires_on, d.extra
        from drivers d
       where d.active and not d.es_prueba
       order by d.name
    `);
    const carros = await this.db.execute<{
      id: string;
      plate: string;
      internal_number: string | null;
      soat_expires_on: string | null;
      rto_expires_on: string | null;
      extra: Record<string, string> | null;
    }>(sql`
      select v.id, v.plate, v.internal_number,
             v.soat_expires_on::text as soat_expires_on, v.rto_expires_on::text as rto_expires_on, v.extra
        from vehicles v
       where v.active
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

    // Los campos adicionales de tipo fecha que definió la oficina (la tarjeta de
    // operación, por ejemplo) también vencen: cada uno trae su par de grupos.
    const campos = await this.db.execute<{ id: string; entidad: 'conductor' | 'vehiculo'; nombre: string }>(sql`
      select c.id, c.entidad, c.nombre from campos_extra c
       where c.activo and c.tipo = 'fecha'
       order by c.nombre
    `);
    const extras = campos.rows.map((c) => ({
      ...c,
      vencido: grupo(`extra_vencido:${c.id}`, `${c.nombre}: vencido`, `Actualice la fecha en la ficha del ${c.entidad === 'conductor' ? 'conductor' : 'vehículo'}.`, 'critical'),
      porVencer: grupo(`extra_por_vencer:${c.id}`, `${c.nombre}: por vencer`, `Vence en los próximos ${DIAS_DE_AVISO_DE_VENCIMIENTO} días.`, 'warning'),
    }));
    const esFecha = (valor: unknown): valor is string => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);

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
      for (const c of extras) {
        const valor = c.entidad === 'conductor' ? d.extra?.[c.id] : null;
        if (esFecha(valor)) vencimiento(base, valor, c.vencido, c.porVencer);
      }
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
      for (const c of extras) {
        const valor = c.entidad === 'vehiculo' ? v.extra?.[c.id] : null;
        if (esFecha(valor)) vencimiento(base, valor, c.vencido, c.porVencer);
      }
    }

    // Lo que vence primero, primero.
    const porFecha = (a: AvisoDeFlota, b: AvisoDeFlota) => a.dias - b.dias;
    const grupos = [...Object.values(g), ...extras.flatMap((c) => [c.vencido, c.porVencer])]
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
  constructor(
    private readonly avisos: AvisosDeFlotaService,
    private readonly fleet: FleetService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * El bloqueo por documentos vencidos: si está activado y a cuántos
   * conductores y carros dejaría hoy sin trabajar. El número se da siempre,
   * también con el bloqueo apagado: es lo que hay que mirar antes de prenderlo.
   */
  @Get('bloqueo')
  async bloqueo() {
    const [activo, avisos] = await Promise.all([this.fleet.bloqueoPorDocumentos(), this.avisos.calcular()]);
    const vencidos = avisos.grupos.filter((g) => ['licencia_vencida', 'soat_vencido', 'tecnomecanica_vencida'].includes(g.clase));
    const de = (clase: 'conductor' | 'vehiculo') =>
      new Set(vencidos.flatMap((g) => g.avisos.filter((a) => a.de === clase).map((a) => a.id))).size;
    return { activo, conductores: de('conductor'), vehiculos: de('vehiculo') };
  }

  @Post('bloqueo')
  @HttpCode(200)
  @RequierePermiso('conductores.suspender')
  async fijarBloqueo(@Req() request: FastifyRequest, @Body(zodBody(bloqueoSchema)) body: z.infer<typeof bloqueoSchema>) {
    const antes = await this.fleet.bloqueoPorDocumentos();
    await this.fleet.fijarBloqueoPorDocumentos(body.activo);
    const user = request.user!;
    if (antes !== body.activo) {
      await this.audit.record({
        actorId: user.id,
        actorName: user.name,
        role: user.role,
        action: body.activo ? 'Activó el bloqueo por documentos vencidos' : 'Desactivó el bloqueo por documentos vencidos',
        entity: 'fleet_rules',
        entityId: 'bloquear_por_documentos',
        before: { activo: antes },
        after: { activo: body.activo },
        ip: request.ip,
      });
    }
    return this.bloqueo();
  }

  @Get()
  ver(): Promise<AvisosDeFlota> {
    return this.avisos.calcular();
  }
}
