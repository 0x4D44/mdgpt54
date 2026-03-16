# Stage 1: Build the Vite frontend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Relay server (runs TypeScript via tsx)
FROM node:22-slim AS relay
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx
COPY server/ server/
COPY src/traffic/trafficTypes.ts src/traffic/trafficTypes.ts
EXPOSE 3210
CMD ["node", "--import", "tsx", "server/trafficRelay.ts"]

# Stage 3: Nginx frontend
FROM nginx:alpine AS frontend
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
