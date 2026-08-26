FROM oven/bun:1.3.8-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY sdk ./sdk
COPY services/market-data ./services/market-data
COPY tsconfig.json ./
ENV PRISM_DRY_RUN=true
CMD ["bun", "--conditions", "react-server", "services/market-data/index.ts"]
