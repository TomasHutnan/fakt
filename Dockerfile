# One image: the built app plus the Node server that serves it and runs the rooms.
# The build stage runs on the CI machine's own platform; its output is plain JS/HTML,
# so only the small runtime stage is built per target platform.
FROM --platform=$BUILDPLATFORM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev \
    && find src -name '*.test.ts' -delete && rm -rf src/ui src/designs

FROM node:26-slim
ENV NODE_ENV=production \
    PORT=8080 \
    FAKT_STATIC_DIR=/app/dist \
    FAKT_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
# The server runs from TypeScript source through Node's type stripping (no compile
# step): its own code plus the shared engine, content checks and protocol. Its only
# runtime dependency is ws, which is plain JavaScript, so the per-platform stage
# needs no native build.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
