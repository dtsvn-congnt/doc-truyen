FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root user to avoid permission issues
USER root

WORKDIR /app

# Optional: set npm cache to avoid further EACCES
ENV NPM_CONFIG_CACHE=/tmp/.npm

COPY package*.json ./
RUN npm install --omit=optional --legacy-peer-deps

COPY . .

CMD ["npm", "start"]
