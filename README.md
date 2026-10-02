# Clio Resource Server

Microservicio centralizado de ingesta y consulta de auditoría forense inmutable sobre MongoDB, implementado en Node.js 20 LTS y NestJS 10+ (TypeScript).

## 1. Visión General
`clio-resource-server` es el componente auditor del ecosistema Cerberos, encargado de:
1. Consumir de manera asíncrona los eventos de cambio de estado (Audit Trail / CDC) desde la cola RabbitMQ `audit.events.queue` vinculada a `audit.topic.exchange`.
2. Validar criptográficamente el token M2M contenido en los metadatos de seguridad del sobre AMQP contra el JWKS de Cerberos SSO.
3. Persistir atómicamente los eventos en MongoDB (`entity_audit_trail`) agrupados por el identificador de la entidad bajo el patrón **Entity Timeline Document** (`_id = entityId`).
4. Proveer endpoints REST securizados para consultas forenses bajo el path `/api/v1/audit/...`.

## 2. Pila Tecnológica
* **Runtime:** Node.js 20 LTS (Alpine en Docker)
* **Framework:** NestJS 10+
* **Persistencia:** MongoDB 7.0 (Mongoose 8.x)
* **Mensajería:** RabbitMQ 3.9+ (`@golevelup/nestjs-rabbitmq`)
* **Chassis Común:** `@lliscano/node-rest-commons`

## 3. Variables de Entorno (`.env` / `.env.example`)
El microservicio se parametriza mediante variables de entorno. Puedes copiar la plantilla `.env.example`:
```bash
cp .env.example .env
```

| Variable | Descripción | Valor por Defecto / Ejemplo |
| :--- | :--- | :--- |
| `NODE_ENV` | Entorno de ejecución (`development`, `production`, `test`) | `development` |
| `PORT` | Puerto del servidor HTTP NestJS | `8080` |
| `MONGODB_URI` | Cadena de conexión URI a MongoDB | `mongodb://admin:admin12345@localhost:27017/clio?authSource=admin` |
| `RABBITMQ_URI` | URI de conexión AMQP a RabbitMQ | `amqp://guest:guest@localhost:5672` |
| `JWKS_URI` | Endpoint JWKS de Cerberos SSO para claves públicas | `http://localhost:8080/oauth2/sso/jwks` |
| `JWT_ISSUER` | Emisor esperado (`iss`) en tokens JWT y M2M | `http://localhost:8080` |

## 4. Endpoints Principales
* `GET /api/v1/audit/entities/:entityId`: Retorna la línea de tiempo completa e inmutable de la entidad consultada (requiere `ROLE_EIA_ADMIN`, `ADMIN_AUDIT` o similar).
* `GET /api/v1/audit/health`: Endpoint de monitoreo y verificación de salud de conectividad con MongoDB y RabbitMQ.

## 5. Pruebas y Compilación
```bash
npm install
npm test
npm run build
```
