FROM node:24.22.1-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@10.29.1 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Nitro externalizes some runtime packages (including React for SSR). Keep the
# production dependency tree available in the runtime image as well as .output.
# Derive this from the build stage so native production dependencies can use the
# build toolchain and the same frozen lockfile.
FROM build AS production-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24.22.1-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.output .output

USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
