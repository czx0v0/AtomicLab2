# ─── Stage 1: 构建 React 前端 ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ .
RUN npm run build

# ─── Stage 2: Python 后端 + 静态文件 ───────────────────────────────────────────
FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

WORKDIR /home/user/app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UVICORN_HOST=0.0.0.0
ENV UVICORN_PORT=7860
# 注意：模型缓存路径在 app.py 中根据环境自动设置

# 安装依赖（允许失败，创空间资源有限）
# Step 1: 核心框架（必须成功）
RUN pip install --no-cache-dir \
    "fastapi==0.115.6" \
    "uvicorn[standard]==0.32.1" \
    "python-multipart==0.0.18" \
    "httpx" \
    "python-dotenv" \
    || (echo "[Dockerfile] 核心依赖安装失败" && exit 1)

# Step 2: 可选依赖（失败不影响启动）
RUN pip install --no-cache-dir "openai>=1.30.0" tenacity networkx jieba || true
RUN pip install --no-cache-dir "sniffio>=1.3.0" "soupsieve>=2.5" "beautifulsoup4>=4.12.0" "lxml>=4.9.0" || true
RUN pip install --no-cache-dir rank-bm25 || true

# Step 3: 大包（RAG功能，允许失败）
RUN pip install --no-cache-dir chromadb || echo "[Dockerfile] chromadb 安装跳过"
RUN pip install --no-cache-dir sentence-transformers || echo "[Dockerfile] sentence-transformers 安装跳过"
RUN pip install --no-cache-dir modelscope || echo "[Dockerfile] modelscope 安装跳过"

# 复制应用代码
COPY aether_engine /home/user/app/aether_engine
COPY app.py /home/user/app/app.py
# 复制前端构建产物
COPY --from=frontend-builder /build/dist /home/user/app/static

# 创建必要的目录
# 注意：/mnt/workspace 是 ModelScope 创空间的持久化存储目录
RUN mkdir -p /home/user/app/aether_engine/data/documents
RUN mkdir -p /home/user/app/aether_engine/data/chroma_store

# 设置权限
RUN chmod -R 755 /home/user/app

EXPOSE 7860

ENTRYPOINT ["python", "-u", "app.py"]
