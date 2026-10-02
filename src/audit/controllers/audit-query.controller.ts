import { Controller, Get, Param, UseGuards, NotFoundException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwksAuthGuard, ResponseDTO } from '@lliscano/node-rest-commons';
import { AuditQueryService } from '../services/audit-query.service';
import { EntityAuditTrail } from '../schemas/entity-audit-trail.schema';

@ApiTags('Auditoría Forense')
@ApiBearerAuth()
@Controller('v1')
@UseGuards(JwksAuthGuard) // Protegido mediante RS256 contra cerbos-jwks
export class AuditQueryController {
  private readonly logger = new Logger(AuditQueryController.name);

  constructor(private readonly queryService: AuditQueryService) {}

  @Get('entities/:entityId')
  @ApiOperation({ summary: 'Consultar la línea de tiempo completa de una entidad por su ID/UUID' })
  @ApiResponse({ status: 200, description: 'Línea de tiempo cronológica recuperada exitosamente' })
  @ApiResponse({ status: 404, description: 'No se encontraron eventos para la entidad solicitada' })
  async getEntityTimeline(@Param('entityId') entityId: string): Promise<ResponseDTO<EntityAuditTrail>> {
    this.logger.log(`REST_QUERY: Consultando auditoría forense para entidad [${entityId}]`);

    const timeline = await this.queryService.findTimelineByEntityId(entityId);
    if (!timeline) {
      throw new NotFoundException(`No se encontraron trazas de auditoría para la entidad con identificador: ${entityId}`);
    }

    return {
      time: new Date().toISOString(),
      message: 'Línea de tiempo de auditoría recuperada exitosamente',
      correlationId: 'trace-' + Date.now(),
      data: timeline,
    };
  }
}
