import { Injectable, Logger } from '@nestjs/common';
import { DynamicTenantCollectionResolver } from './dynamic-tenant-collection-resolver.service';
import { AuditDocument } from '../schemas/audit-document.schema';

export interface TimelineQueryParams {
  page?: number;
  size?: number;
  serviceName?: string;
  entityName?: string;
  action?: string;
  username?: string;
  startDate?: string;
  endDate?: string;
  projectId?: string;
}

export interface PaginatedTimelineResult {
  content: AuditDocument[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  isLast: boolean;
}

@Injectable()
export class AuditQueryService {
  private readonly logger = new Logger(AuditQueryService.name);

  constructor(private readonly collectionResolver: DynamicTenantCollectionResolver) {}

  /**
   * Consulta el historial cronológico de una entidad con ReadPreference.secondaryPreferred.
   */
  async findEntityHistory(
    tenantId: string,
    entityName: string,
    entityId: string,
  ): Promise<AuditDocument[]> {
    this.logger.debug(
      `Consultando historial para tenant [${tenantId}], entidad [${entityName}], id [${entityId}] en nodos secundarios`,
    );
    const model = await this.collectionResolver.getModel(tenantId);

    const documents = await model
      .find({ entityName, entityId })
      .sort({ timestamp: -1 })
      .read('secondaryPreferred')
      .lean()
      .exec();

    return documents as AuditDocument[];
  }

  /**
   * Consulta paginada de la línea de tiempo global con filtros multicriterio y ReBAC.
   */
  async findTimeline(
    tenantId: string,
    params: TimelineQueryParams,
    allowedProjectIds?: string[] | null,
    isSuperAdmin?: boolean,
  ): Promise<PaginatedTimelineResult> {
    const page = Math.max(0, Number(params.page) || 0);
    const size = Math.min(200, Math.max(1, Number(params.size) || 50));
    const skip = page * size;

    const filter: Record<string, any> = {};

    if (params.serviceName) {
      filter.serviceName = params.serviceName;
    }
    if (params.entityName) {
      filter.entityName = params.entityName;
    }
    if (params.action) {
      filter.action = params.action;
    }
    if (params.username) {
      filter['actor.username'] = params.username;
    }

    if (params.startDate || params.endDate) {
      filter.timestamp = {};
      if (params.startDate) {
        filter.timestamp.$gte = new Date(params.startDate);
      }
      if (params.endDate) {
        filter.timestamp.$lte = new Date(params.endDate);
      }
    }

    // Regla ReBAC para proyectos:
    if (!isSuperAdmin) {
      const allowed = allowedProjectIds || [];
      if (params.projectId) {
        if (!allowed.includes(params.projectId)) {
          // El proyecto solicitado no está entre los autorizados para este usuario
          return {
            content: [],
            page,
            size,
            totalElements: 0,
            totalPages: 0,
            isLast: true,
          };
        }
        filter.projectId = params.projectId;
      } else {
        // HU-07: Inyecta automáticamente los proyectos permitidos y excluye projectId = null
        filter.projectId = { $in: allowed };
      }
    } else if (params.projectId) {
      filter.projectId = params.projectId;
    }

    const model = await this.collectionResolver.getModel(tenantId);

    const [content, totalElements] = await Promise.all([
      model
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(size)
        .read('secondaryPreferred')
        .lean()
        .exec(),
      model.countDocuments(filter).read('secondaryPreferred').exec(),
    ]);

    const totalPages = Math.ceil(totalElements / size);
    const isLast = page >= totalPages - 1;

    return {
      content: content as AuditDocument[],
      page,
      size,
      totalElements,
      totalPages,
      isLast,
    };
  }

  /**
   * Purga atómica de la colección de un tenant.
   */
  async purgeTenant(
    tenantUuid: string,
  ): Promise<{ tenantUuid: string; droppedCollection: string; executionTimeMs: number }> {
    const result = await this.collectionResolver.dropTenantCollection(tenantUuid);
    return {
      tenantUuid,
      droppedCollection: result.droppedCollection,
      executionTimeMs: result.executionTimeMs,
    };
  }
}
