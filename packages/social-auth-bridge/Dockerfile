FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/social-auth-bridge/package.json ./packages/social-auth-bridge/package.json
RUN pnpm install --frozen-lockfile --filter @social-harness/social-auth-bridge
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/social-auth-bridge ./packages/social-auth-bridge
RUN pnpm --filter @social-harness/social-auth-bridge build

FROM node:24-alpine AS runtime
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/social-auth-bridge/package.json ./packages/social-auth-bridge/package.json
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @social-harness/social-auth-bridge
COPY --from=build /workspace/packages/social-auth-bridge/dist ./packages/social-auth-bridge/dist
WORKDIR /workspace/packages/social-auth-bridge
ENV NODE_ENV=production
ENV SOCIAL_AUTH_BRIDGE_DATA_DIR=/var/lib/social-auth-bridge
RUN mkdir -p /var/lib/social-auth-bridge && chown -R node:node /var/lib/social-auth-bridge
VOLUME ["/var/lib/social-auth-bridge"]
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
