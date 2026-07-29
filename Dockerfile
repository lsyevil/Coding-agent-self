# ProCoder Agent - 生产镜像
# 单进程同时托管前端静态资源与后端 API（Express + OpenAI 兼容模型）

# 基础镜像可通过构建参数覆盖，便于在无法访问 Docker Hub 的环境改用镜像源
# 例如：docker compose build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:20-slim
ARG NODE_IMAGE=node:20-slim
FROM ${NODE_IMAGE}

WORKDIR /app

# better-sqlite3 需要原生编译，安装构建工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖（利用层缓存）
# 如所在网络无法访问 npm 官方源，可改用国内镜像（npmmirror）
COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install

# 复制源码并构建前端
COPY . .
RUN npm run build \
    && npm install -g tsx \
    && npm prune --production

ENV NODE_ENV=production

EXPOSE 3000

# 服务会自行托管 dist/ 下的前端；监听 0.0.0.0:3000
CMD ["sh", "-c", "tsx server/index.ts"]
