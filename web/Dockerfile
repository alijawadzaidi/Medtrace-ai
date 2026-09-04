# syntax=docker/dockerfile:1

FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* variables are inlined into the client bundle at *build* time,
# not read at runtime. This is the single most common way a deployed Next.js
# app ends up calling http://localhost:4000 from a phone: the variable was set
# on the service but not on the build. Declared here so a missing value fails
# visibly rather than silently baking in the development default.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Next's standalone server binds to localhost unless told otherwise, which
    # is invisible locally and fatal in a container: the platform's health
    # check comes from outside the loopback interface and gets connection
    # refused, so the deploy is marked unhealthy while the app is running fine.
    HOSTNAME=0.0.0.0

# The standalone output ships only the files the server actually needs.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
