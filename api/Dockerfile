# syntax=docker/dockerfile:1

# The API. Node 24, matching what the project is developed and tested against.
FROM node:24-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Dependencies in their own layer, so a code change does not reinstall the world.
FROM base AS deps
COPY package.json package-lock.json ./
# `npm ci` installs exactly the lockfile, which is the difference between
# deploying what was tested and deploying whatever the registry serves today.
RUN npm ci --omit=dev

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json .sequelizerc ./
COPY src ./src
COPY scripts ./scripts

# The OpenAPI document is generated here rather than copied in. It is built by
# walking the Express router, needs no database, and generating it inside the
# image guarantees the reference served at /docs describes the code in *this*
# image rather than whatever was last committed.
# Two overrides for this one command, both because generating the document
# loads the whole app:
#
#   DB_DIALECT=mysql — the app constructs a Sequelize instance, and without
#   this the config falls back to SQLite and tries to load a native driver
#   this image does not ship (and should not: sqlite3 is a development
#   convenience, not something a MySQL production image needs).
#
#   NODE_ENV=development — the production boot checks demand a real
#   JWT_SECRET, and correctly refused to let this build proceed without one.
#   A build has no secrets and must not have any baked into a layer; this
#   step only walks the router. The runtime NODE_ENV above stays production.
RUN DB_DIALECT=mysql NODE_ENV=development node scripts/generate-openapi.js --out ./docs/openapi.json

# Never root: a compromised container should not also be a privileged one.
USER node

EXPOSE 4000

# Liveness, deliberately not readiness. A database blip should not cause the
# platform to kill and restart a process that is working perfectly well.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
