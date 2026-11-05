# syntax=docker/dockerfile:1

# Build stage: compile TypeScript with the full dev dependency set.
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: only the compiled server and the files it reads at runtime.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV YGO_DATA_ROOT=/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY src ./src
COPY skills ./skills
COPY docs ./docs
COPY README.md CHANGELOG.md LICENSE NOTICE SECURITY.md ./
COPY data/templates/README.md ./data/templates/README.md

# The server writes caches and decks under this directory.
RUN mkdir -p /app/data

# stdio MCP server: the client speaks JSON-RPC over stdin/stdout.
CMD ["node", "dist/index.js"]
