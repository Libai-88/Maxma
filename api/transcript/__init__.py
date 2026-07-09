"""后台任务 Transcript — JSONL 格式的透明抄本。

设计参考 Halo 的 session-store.ts：
- 后台运行（事件钩子/自治）把每条聚合消息 appendFileSync 到 JSONL
- 观察者按需轮询读取（仅在视图打开时）
- 无人观看的 run 对前端零开销
"""
from api.transcript.jsonl_writer import TranscriptWriter

__all__ = ["TranscriptWriter"]
