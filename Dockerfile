FROM apify/actor-node-playwright-chrome:22

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --include=optional \
    && node -e "import('impit').then(m => console.log('impit OK:', Object.keys(m)))" \
    && node -e "import('playwright').then(m => console.log('playwright OK:', Object.keys(m)))" \
    && rm -rf ~/.npm

COPY . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
