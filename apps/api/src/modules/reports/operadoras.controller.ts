import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { filtrosDeOperadorasSchema, type FiltrosDeOperadoras } from '@tax/shared';
import { zodBody } from '../../common/zod.pipe';
import { RequierePermiso, SessionGuard } from '../identity/guards';
import { OperadorasService } from './operadoras.service';

/**
 * La sección Operadoras. Lleva su propio permiso (`operadoras.ver`): es el
 * trabajo de cada persona, y no todo el que abre Reportes tiene por qué verlo.
 */
@Controller('v1/reports/operadoras')
@UseGuards(SessionGuard)
@RequierePermiso('operadoras.ver')
export class OperadorasController {
  constructor(private readonly operadoras: OperadorasService) {}

  @Get()
  tablero(@Query(zodBody(filtrosDeOperadorasSchema)) filtros: FiltrosDeOperadoras) {
    return this.operadoras.tablero(filtros);
  }

  @Get(':id/carreras')
  carreras(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodBody(filtrosDeOperadorasSchema)) filtros: FiltrosDeOperadoras,
  ) {
    return this.operadoras.carreras(id, filtros);
  }
}
