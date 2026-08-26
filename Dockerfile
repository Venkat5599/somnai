# PRISM roll runner. Deployable to Railway, Fly, a VPS — anywhere that can hold
# a process. The web app is on Vercel; this is the half Vercel cannot host,
# because carrying a position across windows needs something always awake.
FROM oven/bun:1.3.8-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY runner ./runner
COPY src/lib ./src/lib
COPY tsconfig.json ./
ENV PRISM_NETWORK=testnet
# Ships SAFE. Arm deliberately with PRISM_DRY_RUN=false.
ENV PRISM_DRY_RUN=true
CMD ["bun", "runner/index.ts"]
