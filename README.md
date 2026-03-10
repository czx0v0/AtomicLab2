# AtomicLab

沉浸式学术文献解析与写作工作站。

## 运行

```bash
# 后端
cd Aether-Engine
conda activate py-agent
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端
cd Lumina-UI
npm install && npm run dev

# Docker 联调
docker compose up

# 生产部署
docker build -t atomiclab . && docker run -d -p 80:80 atomiclab
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/parse-document` | 上传 PDF → Markdown |
