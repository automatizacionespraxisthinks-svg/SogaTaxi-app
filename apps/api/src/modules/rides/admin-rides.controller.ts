import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MEDIOS_DE_PAGO_ACEPTADOS,
  RIDE_STATUSES,
  crearCarreraOficinaSchema,
  pointSchema,
  telefonoColombiano,
  type MedioDePago,
  type RideStatus,
} from '@tax/shared';
import { zodBody } from '../../common/zod.pipe';
import { AppError } from '../../common/problem';
import { RequierePermiso, SessionGuard } from '../identity/guards';
import { LINEA_OFICINA, RidesService, type Actor } from './rides.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { FotosService } from './fotos.service';

const ubicarSchema = z.object({ text: z.string().trim().min(3).max(200) });

const clienteSchema = z.object({
  telefono: z
    .string()
    .trim()
    .transform((v) => telefonoColombiano(v))
    .refine((v) => /^\+\d{8,15}$/.test(v), 'Escribe el celular completo'),
});

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .filter((s): s is RideStatus => RIDE_STATUSES.includes(s as RideStatus)),
    ),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const addressSchema = z.object({
  text: z.string().min(3),
  reference: z.string().optional(),
  point: pointSchema.optional(),
  link: z.string().max(2000).optional(),
});

const cancelSchema = z.object({ reason: z.string().min(3, 'El motivo es obligatorio') });
const assignSchema = z.object({ driverId: z.string().uuid() });
/**
 * El medio de pago nuevo: el exacto (`medioPago`) o, de un cliente sin
 * actualizar, la marca de antes (`pagoElectronico`).
 */
const pagoSchema = z
  .object({
    pagoElectronico: z.boolean().optional(),
    medioPago: z.enum(MEDIOS_DE_PAGO_ACEPTADOS).optional(),
  })
  .refine((v) => v.medioPago !== undefined || v.pagoElectronico !== undefined, 'Falta el medio de pago');
const medioDe = (body: { pagoElectronico?: boolean; medioPago?: MedioDePago }): MedioDePago =>
  body.medioPago ?? (body.pagoElectronico ? 'electronico' : 'efectivo');

/**
 * Carreras vistas desde el panel de oficina.
 *
 * Mismos casos de uso que el contrato de n8n, pero autenticados con la sesión
 * de la oficina en vez de la clave de API, y con el actor marcado como
 * `operator`: la máquina de estados permite a un operador cosas que al agente
 * no —reasignar, relanzar— y la bitácora tiene que distinguir quién fue.
 */
@Controller('v1/admin/rides')
@UseGuards(SessionGuard)
export class AdminRidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly dispatch: DispatchService,
    private readonly fotos: FotosService,
  ) {}

  /**
   * Una carrera registrada por la oficina (24/11/2026): el cliente llamó o
   * llegó en persona. Pasa por la misma creación que las de WhatsApp
   * —dirección resuelta con el catálogo o el geocodificador, municipio,
   * cupo por teléfono, bitácora— y se despacha por oleadas: el conductor la
   * recibe y la acepta igual que cualquier otra. Queda con la línea
   * «Oficina» y con la operadora como actor.
   */
  @Post()
  @RequierePermiso('carreras.crear')
  crear(
    @Req() request: FastifyRequest,
    @Body(zodBody(crearCarreraOficinaSchema)) body: z.infer<typeof crearCarreraOficinaSchema>,
  ) {
    return this.rides.create(
      { ...body, numeroEnPedido: 1, line: LINEA_OFICINA },
      operator(request),
    );
  }

  /**
   * Dónde queda la dirección que la operadora está escribiendo, para que el
   * mapa de «Nueva carrera» la muestre con los taxis del sector antes de
   * crear nada. `null` si Google no la ubica: no es un error, la carrera se
   * puede crear igual.
   */
  @Post('ubicar')
  @HttpCode(200)
  @RequierePermiso('carreras.crear')
  async ubicar(@Body(zodBody(ubicarSchema)) body: z.infer<typeof ubicarSchema>) {
    return { hallada: await this.rides.ubicarParaLaOficina(body.text) };
  }

  /** El cliente que llama, por su celular: nombre y últimas recogidas. */
  @Post('cliente')
  @HttpCode(200)
  @RequierePermiso('carreras.crear')
  async cliente(@Body(zodBody(clienteSchema)) body: z.infer<typeof clienteSchema>) {
    return { cliente: await this.rides.clienteParaLaOficina(body.telefono) };
  }

  @Get()
  list(@Query(zodBody(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.rides.list(query.status, query.limit);
  }

  @Get(':rideId')
  detail(@Param('rideId', ParseUUIDPipe) rideId: string) {
    return this.rides.detail(rideId);
  }

  /** La foto del lugar, para la ficha de la carrera. */
  @Get(':rideId/photo')
  async photo(@Param('rideId', ParseUUIDPipe) rideId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const foto = await this.fotos.leer(rideId);
    if (!foto) throw new AppError('NOT_FOUND', 'Esta carrera no tiene foto');
    void reply.header('content-type', foto.mimeType).header('cache-control', 'private, no-store');
    return foto.content;
  }

  @Patch(':rideId/address')
  @RequierePermiso('carreras.corregir')
  updateAddress(
    @Req() request: FastifyRequest,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(zodBody(addressSchema)) body: z.infer<typeof addressSchema>,
  ) {
    return this.rides.updateAddress(rideId, body, operator(request));
  }

  /** Efectivo o pago electrónico, con la carrera sin asignar. */
  @Patch(':rideId/payment')
  @RequierePermiso('carreras.corregir')
  cambiarMedioDePago(
    @Req() request: FastifyRequest,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(zodBody(pagoSchema)) body: z.infer<typeof pagoSchema>,
  ) {
    return this.rides.cambiarMedioDePago(rideId, medioDe(body), operator(request));
  }

  @Post(':rideId/cancel')
  @RequierePermiso('carreras.cancelar')
  cancel(
    @Req() request: FastifyRequest,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(zodBody(cancelSchema)) body: z.infer<typeof cancelSchema>,
  ) {
    return this.rides.cancel(rideId, body.reason, operator(request));
  }

  /** Relanzar el despacho desde la oleada 1 (§5.3). */
  @Post(':rideId/redispatch')
  @RequierePermiso('carreras.despachar')
  async redispatch(@Req() request: FastifyRequest, @Param('rideId', ParseUUIDPipe) rideId: string) {
    await this.dispatch.redispatch(rideId, operator(request));
    return { ok: true };
  }

  /** Asignación manual a un conductor concreto (RF-41). */
  @Post(':rideId/assign')
  @RequierePermiso('carreras.despachar')
  assign(
    @Req() request: FastifyRequest,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body(zodBody(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    return this.dispatch.assignManually(rideId, body.driverId, operator(request));
  }
}

function operator(request: FastifyRequest): Actor {
  const user = request.user;
  if (!user) throw new AppError('UNAUTHORIZED', 'Sin usuario en la petición');
  return { kind: 'operator', name: user.name, id: user.id, role: user.role, ip: request.ip };
}
