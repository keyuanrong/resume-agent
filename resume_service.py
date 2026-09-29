from __future__ import annotations

import base64
import re
import uuid
from datetime import datetime
from pathlib import Path

from product_store import RESUME_DIR, delete_resume_record, get_resume_record, save_resume_record


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp"}
MAX_RESUME_BYTES = 12 * 1024 * 1024


def _safe_filename(name: str) -> str:
    name = Path(name or "resume").name
    cleaned = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", name, flags=re.UNICODE)
    return cleaned[:120] or "resume"


def save_resume(name: str, mime_type: str, data_base64: str) -> dict:
    try:
        raw = base64.b64decode(data_base64, validate=True)
    except Exception as exc:
        raise ValueError("简历文件不是有效的 Base64 数据") from exc
    if not raw:
        raise ValueError("简历文件为空")
    if len(raw) > MAX_RESUME_BYTES:
        raise ValueError("简历文件不能超过 12MB")

    safe_name = _safe_filename(name)
    extension = Path(safe_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("仅支持 PDF、DOCX、TXT、Markdown、PNG、JPG 和 WebP")

    resume_id = uuid.uuid4().hex
    RESUME_DIR.mkdir(parents=True, exist_ok=True)
    path = RESUME_DIR / f"{resume_id}{extension}"
    path.write_bytes(raw)
    record = {
        "id": resume_id,
        "name": safe_name,
        "mimeType": mime_type or "application/octet-stream",
        "extension": extension,
        "size": len(raw),
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "path": str(path.relative_to(RESUME_DIR.parent)),
    }
    return save_resume_record(record)


def _absolute_resume_path(record: dict) -> Path:
    relative = Path(str(record.get("path") or ""))
    path = (RESUME_DIR.parent / relative).resolve()
    if RESUME_DIR.resolve() not in path.parents:
        raise ValueError("简历路径无效")
    return path


def get_resume_for_agent(resume_id: str) -> dict:
    record = get_resume_record(resume_id)
    if not record:
        raise ValueError("没有找到这份简历")
    path = _absolute_resume_path(record)
    if not path.exists():
        raise ValueError("简历文件已经不存在")
    extension = record.get("extension") or path.suffix.lower()

    if extension in {".png", ".jpg", ".jpeg", ".webp"}:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        mime = record.get("mimeType") or "image/jpeg"
        return {"kind": "image", "dataUrl": f"data:{mime};base64,{encoded}", "record": record}
    if extension in {".txt", ".md"}:
        return {"kind": "text", "text": path.read_text(encoding="utf-8", errors="ignore"), "record": record}
    if extension == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("读取 PDF 需要安装 pypdf，请重新执行 pip install -r requirements.txt") from exc
        reader = PdfReader(str(path))
        text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        if not text:
            raise ValueError("PDF 没有可提取文本；扫描版简历请上传 JPG/PNG 图片")
        return {"kind": "text", "text": text, "record": record}
    if extension == ".docx":
        try:
            from docx import Document
        except ImportError as exc:
            raise RuntimeError("读取 Word 需要安装 python-docx，请重新执行 pip install -r requirements.txt") from exc
        document = Document(str(path))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
        return {"kind": "text", "text": text, "record": record}
    raise ValueError("暂不支持这种简历格式")


def get_resume_text_local(resume_id: str) -> dict:
    """读取可在本地解析的简历；图片不使用云端 OCR，避免隐式产生费用或上传数据。"""
    resume = get_resume_for_agent(resume_id)
    if resume.get("kind") != "text":
        raise ValueError("免费本地模式暂不支持图片文字识别，请上传可复制文字的 PDF、DOCX、TXT 或 Markdown")
    return resume


def delete_resume(resume_id: str) -> dict:
    record = get_resume_record(resume_id)
    if not record:
        raise ValueError("没有找到这份简历")
    path = _absolute_resume_path(record)
    if path.exists():
        path.unlink()
    delete_resume_record(resume_id)
    return record
