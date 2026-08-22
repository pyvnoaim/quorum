FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The ladder lives in this file, so it belongs on a volume, not in the layer.
ENV DB_PATH=/data/pug.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
# --experimental-sqlite is what node:sqlite needs on 22; drop it on node 24.
CMD ["node", "--experimental-sqlite", "dist/index.js"]
