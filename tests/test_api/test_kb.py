"""Tests for api/routes/kb.py — 知识库 REST API。"""

import io
import json
from unittest.mock import patch, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.kb import router


@pytest.fixture
def app():
    """创建测试 FastAPI 应用。"""
    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
def client(app):
    """创建测试客户端。"""
    return TestClient(app)


class TestListDocuments:
    """GET /kb/documents 端点测试。"""

    def test_list_empty(self, client):
        """空知识库返回空列表。"""
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.list_documents.return_value = []
            response = client.get("/kb/documents")
            assert response.status_code == 200
            assert response.json() == {"items": []}

    def test_list_with_docs(self, client):
        """有文档时返回文档列表。"""
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.list_documents.return_value = [
                {"doc_id": "doc1", "filename": "test.txt", "chunk_count": 5},
            ]
            response = client.get("/kb/documents")
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1
            assert data["items"][0]["doc_id"] == "doc1"


class TestGetDocument:
    """GET /kb/documents/{doc_id} 端点测试。"""

    def test_get_existing(self, client):
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.get_document.return_value = {
                "doc_id": "doc1",
                "filename": "test.txt",
            }
            response = client.get("/kb/documents/doc1")
            assert response.status_code == 200
            assert response.json()["doc_id"] == "doc1"

    def test_get_not_found(self, client):
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.get_document.return_value = None
            response = client.get("/kb/documents/nonexistent")
            assert response.status_code == 404


class TestDeleteDocument:
    """DELETE /kb/documents/{doc_id} 端点测试。"""

    def test_delete_existing(self, client):
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.delete_document.return_value = True
            response = client.delete("/kb/documents/doc1")
            assert response.status_code == 200
            assert response.json()["status"] == "deleted"

    def test_delete_not_found(self, client):
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.delete_document.return_value = False
            response = client.delete("/kb/documents/nonexistent")
            assert response.status_code == 404


class TestIndexText:
    """POST /kb/documents/text 端点测试。"""

    def test_index_text_success(self, client):
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            mock_instance = MockIndexer.return_value
            mock_instance.index_text.return_value = {
                "doc_id": "doc1",
                "chunks": 3,
                "status": "ok",
            }
            response = client.post(
                "/kb/documents/text",
                json={"content": "测试内容", "doc_id": "doc1"},
            )
            assert response.status_code == 200
            assert response.json()["doc_id"] == "doc1"

    def test_index_text_empty_content(self, client):
        response = client.post(
            "/kb/documents/text",
            json={"content": "", "doc_id": "doc1"},
        )
        assert response.status_code == 400

    def test_index_text_empty_doc_id(self, client):
        response = client.post(
            "/kb/documents/text",
            json={"content": "content", "doc_id": ""},
        )
        assert response.status_code == 400


class TestSearch:
    """POST /kb/search 端点测试。"""

    def test_search_success(self, client):
        with patch("api.routes.kb.KBRetriever") as MockRetriever:
            mock_instance = MockRetriever.return_value
            mock_instance.retrieve.return_value = [
                {
                    "chunk_id": "c1",
                    "text": "相关内容",
                    "source_filename": "test.txt",
                    "similarity": 0.85,
                    "score_percent": 85.0,
                }
            ]
            response = client.post(
                "/kb/search",
                json={"query": "测试查询"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["count"] == 1
            assert data["items"][0]["chunk_id"] == "c1"

    def test_search_empty_query(self, client):
        response = client.post(
            "/kb/search",
            json={"query": ""},
        )
        assert response.status_code == 400

    def test_search_no_results(self, client):
        with patch("api.routes.kb.KBRetriever") as MockRetriever:
            mock_instance = MockRetriever.return_value
            mock_instance.retrieve.return_value = []
            response = client.post(
                "/kb/search",
                json={"query": "测试"},
            )
            assert response.status_code == 200
            assert response.json()["count"] == 0


class TestUploadDocument:
    """POST /kb/documents 端点测试（文件上传）。"""

    def test_upload_txt_success(self, client, tmp_path):
        content = b"Hello knowledge base"
        with patch("api.routes.kb.KBIndexer") as MockIndexer:
            with patch("app_paths.KB_DIR", tmp_path):
                mock_instance = MockIndexer.return_value
                mock_instance.index_file.return_value = {
                    "doc_id": "test",
                    "chunks": 1,
                    "status": "ok",
                }
                response = client.post(
                    "/kb/documents",
                    files={"file": ("test.txt", io.BytesIO(content), "text/plain")},
                )
                assert response.status_code == 200
                assert response.json()["doc_id"] == "test"

    def test_upload_unsupported_type(self, client):
        content = b"content"
        response = client.post(
            "/kb/documents",
            files={"file": ("test.xyz", io.BytesIO(content), "application/octet-stream")},
        )
        assert response.status_code == 400
