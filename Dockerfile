# Stage 1: build the React front end
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the Express server, which also serves the built front end
FROM node:22-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/*.js ./
COPY --from=web /app/web/dist ../web/dist
RUN mkdir uploads && chown node:node uploads
USER node
EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/healthz || exit 1
CMD ["node", "index.js"]
