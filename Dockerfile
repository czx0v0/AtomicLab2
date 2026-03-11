FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

WORKDIR /home/user/app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UVICORN_HOST=0.0.0.0
ENV UVICORN_PORT=7860
# 注意：模型缓存路径在 app.py 中根据环境自动设置

# 安装基础依赖（先安装，避免与 mineru 冲突）
COPY aether_engine/requirements.txt /home/user/app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 单独安装 mineru（依赖复杂，先固定 sniffio 防止拉取损坏版本）
# sniffio-0.0.0 是 PyPI 上的残损占位包，会导致 pip 安装失败
RUN pip install --no-cache-dir "sniffio>=1.3.0" && \
    pip install --no-cache-dir mineru || echo "MinerU 安装失败，PDF 功能将不可用"

# 复制应用代码
COPY aether_engine /home/user/app/aether_engine
COPY app.py /home/user/app/app.py

# 创建必要的目录
# 注意：/mnt/workspace 是 ModelScope 创空间的持久化存储目录
RUN mkdir -p /home/user/app/aether_engine/data/documents
RUN mkdir -p /home/user/app/aether_engine/data/chroma_store

# 设置权限
RUN chmod -R 755 /home/user/app

EXPOSE 7860

ENTRYPOINT ["python", "-u", "app.py"]
