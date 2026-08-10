# syntax=docker/dockerfile:1
#
# Trackly SPA — Angular 22, built once and served by nginx.
#
# nginx also reverse-proxies /api, /hubs and /widget.js to the API container, so
# the browser only ever sees one origin. That is not a convenience: the session
# is an HttpOnly SameSite=Strict cookie, so a split-origin deployment would drop
# it on every request (see src/environments/environment.prod.ts).
#
# Build from this directory:
#
#   docker build -t abhiraheja/trackly-web:latest frontend-angular

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Manifests before sources so `npm ci` is cached until a dependency changes. The
# workspace manifests under projects/* must come along — npm ci refuses to run
# against a lockfile whose workspaces it cannot see.
COPY package.json package-lock.json ./
COPY projects/admin/package.json     projects/admin/
COPY projects/auth/package.json      projects/auth/
COPY projects/core/package.json      projects/core/
COPY projects/dashboard/package.json projects/dashboard/
COPY projects/guest/package.json     projects/guest/
COPY projects/portal/package.json    projects/portal/
COPY projects/tickets/package.json   projects/tickets/
COPY projects/ui/package.json        projects/ui/
RUN npm ci

COPY . .

# `ng build` defaults to the production configuration, which swaps in
# environment.prod.ts (apiBaseUrl: '' — same origin, served through nginx below).
# The libraries resolve to source via tsconfig paths, so no separate build:libs.
RUN npm run build


FROM nginx:1.29-alpine AS runtime

# The SPA is one bundle of static files; nginx's own default site would shadow it.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend-angular/browser /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Derives TRACKLY_RESOLVER from /etc/resolv.conf when it isn't pinned, so the same
# image resolves the API under both Docker (127.0.0.11) and Kubernetes (kube-dns).
# Runs before nginx's own 20-envsubst-on-templates.sh — see the file's header.
COPY nginx/10-trackly-resolver.envsh /docker-entrypoint.d/10-trackly-resolver.envsh
RUN chmod +x /docker-entrypoint.d/10-trackly-resolver.envsh

# nginx's entrypoint runs envsubst over /etc/nginx/templates/*.template at start.
# The filter keeps it to TRACKLY_* only, so nginx's own $variables ($http_upgrade,
# $trackly_connection_upgrade, …) survive untouched.
#
# TRACKLY_RESOLVER is deliberately NOT given a default here: an ENV default would
# always be "set", which would defeat the auto-detection above.
ENV NGINX_ENVSUBST_FILTER="^TRACKLY_" \
    TRACKLY_API_URL="http://api:8080" \
    TRACKLY_MAX_BODY_SIZE="30m"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/healthz >/dev/null || exit 1
