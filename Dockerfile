FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package*.json ./
COPY apps/gateway/package*.json ./apps/gateway/
COPY packages/core-schema/package*.json ./packages/core-schema/
COPY packages/prompt/package*.json ./packages/prompt/
COPY packages/gram-engine/package*.json ./packages/gram-engine/
COPY packages/resolver/package*.json ./packages/resolver/
COPY packages/totals/package*.json ./packages/totals/
COPY packages/confidence/package*.json ./packages/confidence/
COPY packages/repair/package*.json ./packages/repair/
COPY packages/goals/package*.json ./packages/goals/
COPY packages/db-adapter/package*.json ./packages/db-adapter/

RUN npm install --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY apps/gateway ./apps/gateway
COPY packages ./packages

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["npx", "tsx", "apps/gateway/src/index.ts"]
