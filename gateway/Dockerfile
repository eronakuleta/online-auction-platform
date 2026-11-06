# API gateway image (task A-20). Build context: the gateway/ folder.
FROM nginx:1.28-alpine

# Only to create the local self-signed certificate on first start.
RUN apk add --no-cache openssl

# The nginx image runs /docker-entrypoint.d/* in name order before starting: our certificate and
# the CORS origin list first, then its own step that fills the template with the GATEWAY_* variables.
COPY --chmod=755 gen-cert.sh /docker-entrypoint.d/05-self-signed-cert.sh
COPY --chmod=755 cors-origins.sh /docker-entrypoint.d/06-cors-origins.sh
COPY cors.conf /etc/nginx/snippets/cors.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80 443
