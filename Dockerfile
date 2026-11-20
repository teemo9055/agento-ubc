FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Browser-side settings are baked in at build time; Railway passes service variables as build args.
ARG NEXT_PUBLIC_CIRCLE_CLIENT_KEY
ARG NEXT_PUBLIC_CIRCLE_CLIENT_URL
ARG NEXT_PUBLIC_EXPLORER_URL
ARG NEXT_PUBLIC_NETWORK_MODE
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
EXPOSE 3000
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
