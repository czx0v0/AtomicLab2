"""
课题规划 API：研究待办生成等。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from service.project_planner import generate_research_todos

router = APIRouter(prefix="/projects", tags=["projects"])


class PlanTodosRequest(BaseModel):
    title: str = ""
    target_journal: str = ""
    goal: str = ""
    status: str = ""


class PlanTodosResponse(BaseModel):
    items: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("/plan_todos", response_model=PlanTodosResponse)
def post_plan_todos(body: PlanTodosRequest) -> PlanTodosResponse:
    items = generate_research_todos(
        title=body.title,
        target_journal=body.target_journal,
        goal=body.goal,
        status=body.status,
    )
    return PlanTodosResponse(items=items)
