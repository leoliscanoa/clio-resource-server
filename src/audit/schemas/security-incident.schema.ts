import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum RejectionReason {
  MISSING_M2M_TOKEN = 'MISSING_M2M_TOKEN',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE',
  MALFORMED_HEADER = 'MALFORMED_HEADER',
  MISSING_TENANT_ID = 'MISSING_TENANT_ID',
}

@Schema({ collection: 'security_incidents', timestamps: false, versionKey: false })
export class SecurityIncident {
  @Prop({ required: true, type: String })
  incidentId: string;

  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true, enum: Object.values(RejectionReason) })
  rejectionReason: RejectionReason;

  @Prop({ required: true, type: String })
  exchange: string;

  @Prop({ required: true, type: String })
  routingKey: string;

  @Prop({ required: true, type: String })
  correlationId: string;

  @Prop({ type: String, default: null })
  sourceIp?: string | null;

  @Prop({ type: Object, default: {} })
  rawHeaders: Record<string, any>;

  @Prop({ type: String, default: null })
  payloadSnippet?: string | null;

  @Prop({ required: true, default: false })
  resolved: boolean;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: String, default: null })
  resolvedBy?: string | null;

  @Prop({ type: String, default: null })
  resolutionNotes?: string | null;
}

export type SecurityIncidentDocument = HydratedDocument<SecurityIncident>;
export const SecurityIncidentSchema = SchemaFactory.createForClass(SecurityIncident);

// Índices de consulta forense
SecurityIncidentSchema.index({ timestamp: -1 }, { name: 'ix_incidents_timestamp', background: true });
SecurityIncidentSchema.index({ rejectionReason: 1, timestamp: -1 }, { name: 'ix_incidents_reason_time', background: true });
SecurityIncidentSchema.index({ resolved: 1, timestamp: -1 }, { name: 'ix_incidents_resolved_time', background: true });
SecurityIncidentSchema.index({ correlationId: 1 }, { name: 'ix_incidents_correlation_id', background: true });
