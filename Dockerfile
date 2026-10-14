# NUUVI's one npm package is Anthropic's SDK (for fan comments that look at the pictures).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/nuuvi.db \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
