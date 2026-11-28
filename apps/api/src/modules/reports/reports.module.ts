import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { EXPORTS_QUEUE, ExportsService } from './exports.service';
import { ExportsProcessor } from './exports.processor';
import { ExportsController } from './exports.controller';
import { OperadorasService } from './operadoras.service';
import { OperadorasController } from './operadoras.controller';

/** Reportes: vistas de lectura y exportaciones asíncronas (§4.1). */
@Module({
  imports: [BullModule.registerQueue({ name: EXPORTS_QUEUE })],
  providers: [ReportsService, OperadorasService, ExportsService, ExportsProcessor],
  controllers: [ReportsController, OperadorasController, ExportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
