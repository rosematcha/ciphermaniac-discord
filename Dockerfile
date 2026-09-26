FROM node:24-slim
ENV NODE_ENV=production DATABASE_PATH=/app/data/bot.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
