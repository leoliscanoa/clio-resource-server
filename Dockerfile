FROM node:20-alpine AS builder

WORKDIR /workspace

# 1. Compilar librería transversal node-rest-commons
COPY node-rest-commons/package*.json ./node-rest-commons/
WORKDIR /workspace/node-rest-commons
RUN npm install
COPY node-rest-commons/ ./
RUN npm run build

# 2. Compilar microservicio clio-resource-server
WORKDIR /workspace/clio-resource-server
COPY clio-resource-server/package*.json ./
RUN npm install
COPY clio-resource-server/ ./
RUN npm run build

# 3. Runner stage ligero
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /workspace/node-rest-commons /workspace/node-rest-commons
COPY --from=builder /workspace/clio-resource-server/package*.json ./
COPY --from=builder /workspace/clio-resource-server/node_modules ./node_modules
COPY --from=builder /workspace/clio-resource-server/dist ./dist

EXPOSE 8080

CMD ["node", "dist/main.js"]
