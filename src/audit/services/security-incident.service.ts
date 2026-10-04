import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  SecurityIncident,
  SecurityIncidentDocument,
  RejectionReason,
} from '../schemas/security-incident.schema';

export interface FindIncidentsQuery {
  page?: number;
  size?: number;
  reason?: RejectionReason;
  resolved?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedIncidents {
  content: SecurityIncident[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  isLast: boolean;
}

@Injectable()
export class SecurityIncidentService {
  private readonly logger = new Logger(SecurityIncidentService.name);

  constructor(
    @InjectModel(SecurityIncident.name)
    private readonly incidentModel: Model<SecurityIncidentDocument>,
  ) {}

  public async recordIncident(
    data: Partial<SecurityIncident>,
  ): Promise<SecurityIncidentDocument> {
    const incident = new this.incidentModel({
      incidentId: data.incidentId || randomUUID(),
      timestamp: data.timestamp || new Date(),
      rejectionReason: data.rejectionReason,
      exchange: data.exchange || 'clio.topic.exchange',
      routingKey: data.routingKey || 'audit.unknown',
      correlationId: data.correlationId || randomUUID(),
      sourceIp: data.sourceIp || null,
      rawHeaders: data.rawHeaders || {},
      payloadSnippet: data.payloadSnippet || null,
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
    });

    const saved = await incident.save();
    this.logger.warn(
      `[SECURITY_INCIDENT_RECORDED] ID: ${saved.incidentId} | Reason: ${saved.rejectionReason} | Correlation: ${saved.correlationId}`,
    );
    return saved;
  }

  public async findIncidents(query: FindIncidentsQuery): Promise<PaginatedIncidents> {
    const page = Math.max(0, Number(query.page) || 0);
    const size = Math.min(100, Math.max(1, Number(query.size) || 20));

    const filter: Record<string, any> = {};

    if (query.reason) {
      filter.rejectionReason = query.reason;
    }

    if (query.resolved !== undefined) {
      filter.resolved = query.resolved === true || String(query.resolved) === 'true';
    }

    if (query.startDate || query.endDate) {
      filter.timestamp = {};
      if (query.startDate) {
        filter.timestamp.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.timestamp.$lte = new Date(query.endDate);
      }
    }

    const [content, totalElements] = await Promise.all([
      this.incidentModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(page * size)
        .limit(size)
        .lean()
        .exec(),
      this.incidentModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.ceil(totalElements / size);
    const isLast = page >= totalPages - 1;

    return {
      content: content as SecurityIncident[],
      page,
      size,
      totalElements,
      totalPages,
      isLast,
    };
  }

  public async resolveIncident(
    incidentId: string,
    resolutionNotes: string,
    resolvedBy: string,
  ): Promise<SecurityIncidentDocument> {
    const updated = await this.incidentModel
      .findOneAndUpdate(
        { incidentId },
        {
          $set: {
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: resolvedBy || 'SYSTEM',
            resolutionNotes: resolutionNotes || 'Resolved by security administrator',
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException(`Incidente de seguridad con ID '${incidentId}' no fue encontrado.`);
    }

    this.logger.log(`[SECURITY_INCIDENT_RESOLVED] ID: ${incidentId} por ${resolvedBy}`);
    return updated;
  }
}
