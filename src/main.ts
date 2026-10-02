import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  GlobalExceptionFilter,
  CorrelationIdInterceptor,
} from '@lliscano/node-rest-commons';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/clio-resource-server');
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Clio Resource Server')
    .setDescription('Microservicio consumidor y consulta de auditoría forense inmutable sobre MongoDB')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/clio-resource-server/docs', app, document);

  const port = process.env.PORT || 8080;
  await app.listen(port);
  logger.log(`Clio Resource Server iniciado exitosamente en el puerto ${port}`);
}

bootstrap();
