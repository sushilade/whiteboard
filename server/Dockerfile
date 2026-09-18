FROM node:20-alpine AS builder
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server/index.js ./server/

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/server ./server
COPY --from=builder /app/server/node_modules ./server/node_modules
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server/index.js"]
