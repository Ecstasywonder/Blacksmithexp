FROM node:24.14.0-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tests/e2e/package.json tests/e2e/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chairly/e2e exec playwright install --with-deps chromium
COPY . .
RUN pnpm build
CMD ["node", "tooling/booking-slice/start.mjs"]
