import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwksAuthGuard, ResponseDTO, CurrentUser } from '@lliscano/node-rest-commons';
import {
  SecurityIncidentService,
  PaginatedIncidents,
} from '../services/security-incident.service';
import { RejectionReason, SecurityIncident } from '../schemas/security-incident.schema';

export class ResolveIncidentDto {
  resolutionNotes: string;
}

@ApiTags('Seguridad e Incidentes AMQP')
@ApiBearerAuth()
@Controller(['api/v1/audit/security-alerts', 'v1/audit/security-alerts'])
@UseGuards(JwksAuthGuard)
export class SecurityAlertsController {
  private readonly logger = new Logger(SecurityAlertsController.name);

  constructor(private readonly incidentService: SecurityIncidentService) {}

  @Get()
  @ApiOperation({ summary: 'Listado paginado de incidentes de seguridad AMQP' })
  @ApiResponse({ status: 200, description: 'Incidentes de seguridad recuperados exitosamente.' })
  async getSecurityAlerts(
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('reason') reason?: RejectionReason,
    @Query('resolved') resolved?: boolean,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Req() req?: any,
  ): Promise<ResponseDTO<PaginatedIncidents>> {
    const correlationId =
      req?.headers?.['x-correlation-id'] ||
      req?.headers?.['X-Correlation-ID'] ||
      `trace-${Date.now()}`;

    const data = await this.incidentService.findIncidents({
      page,
      size,
      reason,
      resolved,
      startDate,
      endDate,
    });

    return {
      success: true,
      code: 'SECURITY_ALERTS_RETRIEVED',
      message: 'Incidentes de seguridad de auditoría recuperados exitosamente.',
      data,
      timestamp: new Date().toISOString(),
      correlationId,
    };
  }

  @Patch(':incidentId/resolve')
  @ApiOperation({ summary: 'Resolución y cierre forense de un incidente de seguridad' })
  @ApiResponse({ status: 200, description: 'Incidente de seguridad resuelto exitosamente.' })
  async resolveAlert(
    @Param('incidentId') incidentId: string,
    @Body() body: ResolveIncidentDto,
    @CurrentUser() user: any,
    @Req() req?: any,
  ): Promise<ResponseDTO<SecurityIncident>> {
    const correlationId =
      req?.headers?.['x-correlation-id'] ||
      req?.headers?.['X-Correlation-ID'] ||
      `trace-${Date.now()}`;

    const resolvedBy = user?.sub || user?.username || user?.preferred_username || 'SECURITY_ADMIN';
    const updated = await this.incidentService.resolveIncident(
      incidentId,
      body?.resolutionNotes,
      resolvedBy,
    );

    return {
      success: true,
      code: 'SECURITY_INCIDENT_RESOLVED',
      message: 'Incidente de seguridad resuelto exitosamente.',
      data: updated.toObject ? updated.toObject() : (updated as any),
      timestamp: new Date().toISOString(),
      correlationId,
    };
  }
}
