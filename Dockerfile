FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

WORKDIR /home/user/app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV MODELSCOPE_CACHE=/home/user/.cache/modelscope
ENV HF_HOME=/home/user/.cache/modelscope/hf
ENV TRANSFORMERS_CACHE=/home/user/.cache/modelscope/hf
ENV UVICORN_HOST=0.0.0.0
ENV UVICORN_PORT=7860

# 安装依赖
COPY aether_engine/requirements.txt /home/user/app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY aether_engine /home/user/app/aether_engine
COPY app.py /home/user/app/app.py

# 创建必要的目录
RUN mkdir -p /home/user/.cache/modelscope
RUN mkdir -p /home/user/app/aether_engine/data/documents
RUN mkdir -p /home/user/app/aether_engine/data/chroma_store

# 设置权限
RUN chmod -R 755 /home/user/.cache
RUN chmod -R 755 /home/user/app

EXPOSE 7860

ENTRYPOINT ["python", "-u", "app.py"]
