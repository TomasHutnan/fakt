# One image: the built app plus the Node server that serves it (and, later, the rooms).
# The build stage runs on the CI machine's own platform; its output is plain JS/HTML,
# so only the small runtime stage is built per target platform.
FROM --platform=$BUILDPLATFORM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:26-slim
ENV NODE_ENV=production \
    PORT=8080 \
    FAKT_STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build /app/dist ./dist
# The server runs from TypeScript source through Node's type stripping, so no
# compile step and no node_modules: it only uses Node's standard library.
COPY --from=build /app/src/server ./src/server
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
