FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
# só npm ci: o build respeita o lockfile ou falha (sem cair em "npm install", que ignoraria o lock)
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# nginx estável (1.30.x) na variante sem root: escuta na 8080 como usuário nginx (uid 101)
FROM nginxinc/nginx-unprivileged:1.30.6-alpine
COPY --from=build /web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
