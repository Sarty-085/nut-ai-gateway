FROM node:20-alpine

WORKDIR /app

# Copy full monorepo source files for accurate workspace resolution
COPY package*.json ./
COPY tsconfig*.json ./
COPY apps/gateway ./apps/gateway
COPY packages ./packages

# Install workspace dependencies and tsx execution runner
RUN npm install --ignore-scripts && npm install -g tsx

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["tsx", "--tsconfig", "tsconfig.json", "apps/gateway/src/index.ts"]
