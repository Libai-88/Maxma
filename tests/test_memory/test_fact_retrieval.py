from memory.fact_retrieval import SupplementaryFactRetriever
from memory.fact_store import FactStore


def test_supplementary_fact_retrieval_is_default_off(tmp_path):
    store = FactStore(db_path=str(tmp_path / "facts.db"))
    try:
        store.add(content="用户喜欢古典音乐", tags=["preference"])
        retriever = SupplementaryFactRetriever(store)

        assert retriever.enabled is False
        assert retriever.retrieve("古典音乐", tags=["preference"]) == []
    finally:
        store.close()


def test_supplementary_retrieval_combines_text_and_exact_tags_per_session(tmp_path):
    store = FactStore(db_path=str(tmp_path / "facts.db"))
    try:
        store.add(content="用户喜欢古典音乐", tags=["preference"], session_id="a")
        store.add(content="另一个会话的偏好", tags=["preference"], session_id="b")
        retriever = SupplementaryFactRetriever(store, enabled=True)

        results = retriever.retrieve("古典", tags=["preference"], session_id="a")

        assert len(results) == 1
        assert results[0]["session_id"] == "a"
        assert results[0]["content"] == "用户喜欢古典音乐"
    finally:
        store.close()
