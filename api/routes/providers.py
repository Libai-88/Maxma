"""Stub — provider CRUD 已移除。

Provider 管理已迁移至 OMP ModelRegistry（oh-my-pi Bun sidecar）。
Python 端不再管理 provider 配置。所有 provider CRUD 操作通过
OMP sidecar RPC 进行。
"""

from fastapi import APIRouter

router = APIRouter()

# 所有 provider CRUD 端点已移除。
# 前端应通过 OMP sidecar 的 /api/omp/providers/* 路由进行管理。
