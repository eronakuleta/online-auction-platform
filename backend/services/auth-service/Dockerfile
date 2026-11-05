# Build from the repository root, because the service needs the shared packages:
#   docker build -f backend/services/auth-service/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --include-workspace-root \
      -w @auction/shared-common -w @auction/shared-auth -w @auction/auth-service
RUN npm run build -w @auction/shared-common \
    && npm run build -w @auction/shared-auth \
    && npm run build -w @auction/auth-service
RUN npm prune --omit=dev --include-workspace-root \
      -w @auction/shared-common -w @auction/shared-auth -w @auction/auth-service

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/shared ./backend/shared
COPY --from=build /app/backend/services/auth-service ./backend/services/auth-service
# Runs without root privileges.
USER node
CMD ["node", "backend/services/auth-service/dist/server.js"]
