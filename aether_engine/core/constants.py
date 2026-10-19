"""全局常量单一事实来源。

避免同一常量散落多处（如 demo doc_id 复制 5+ 处）导致静默漂移。
前端 `frontend/src/lib/constants.js` 的 `GLOBAL_DEMO_DOC_ID` 与此处保持一致。
"""
DEMO_DOC_ID = "global_demo_official"
