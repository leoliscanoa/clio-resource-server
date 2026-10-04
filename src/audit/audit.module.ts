import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { AuditIngestionService } from './services/audit-ingestion.service';
import { AuditQueryService } from './services/audit-query.service';
import { DynamicTenantCollectionResolver } from './services/dynamic-tenant-collection-resolver.service';
import { SecurityIncidentService } from './services/security-incident.service';
import { AuditEventsConsumer } from './consumers/audit-events.consumer';
import { AuditQueryController } from './controllers/audit-query.controller';
import { SecurityAlertsController } from './controllers/security-alerts.controller';
import { RebacAuditAuthorizer } from './security/rebac-audit.authorizer';
import {
  SecurityIncident,
  SecurityIncidentSchema,
} from './schemas/security-incident.schema';
import {
  M2mSecurityEnvelopeValidator,
  JwksAuthGuard,
} from '@lliscano/node-rest-commons';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SecurityIncident.name, schema: SecurityIncidentSchema },
    ]),
    RabbitMQModule.forRoot({
      exchanges: [
        {
          name: process.env.RABBITMQ_AUDIT_EXCHANGE || 'clio.topic.exchange',
          type: 'topic',
        },
        {
          name: process.env.RABBITMQ_AUDIT_DLX || 'x-clio-events-dlq',
          type: 'direct',
        },
      ],
      uri: process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672',
      connectionInitOptions: { wait: false },
    }),
  ],
  controllers: [AuditQueryController, SecurityAlertsController],
  providers: [
    DynamicTenantCollectionResolver,
    AuditIngestionService,
    AuditQueryService,
    SecurityIncidentService,
    RebacAuditAuthorizer,
    AuditEventsConsumer,
    {
      provide: M2mSecurityEnvelopeValidator,
      useFactory: () => {
        const jwksUri =
          process.env.JWKS_URI ||
          'http://cerbos-authorization-server:8080/oauth2/sso/jwks';
        const expectedIssuer =
          process.env.JWT_ISSUER || 'http://localhost:8080';
        return new M2mSecurityEnvelopeValidator(jwksUri, expectedIssuer);
      },
    },
    JwksAuthGuard,
  ],
  exports: [
    DynamicTenantCollectionResolver,
    AuditQueryService,
    AuditIngestionService,
    SecurityIncidentService,
  ],
})
export class AuditModule {}
