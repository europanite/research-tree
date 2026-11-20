FROM node:24-bookworm-slim

WORKDIR /app

COPY frontend/app/package.json ./package.json

RUN npm install --no-audit --no-fund

COPY frontend/app/ ./

CMD ["npm", "run", "start"]
