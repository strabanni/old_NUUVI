# NUUVI has no npm dependencies, so the image is just Node + the source.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/nuuvi.db \
    PORT=3000
COPY package.json ./
COPY server ./server
COPY public ./public
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
