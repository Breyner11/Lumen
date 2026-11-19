"""Analiza YouTube, GitHub y referencias (DOI / ArXiv / PDF) y produce texto para RAG."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

UA = "TallerBot/1.0 (educational; +https://taller.apps.grok.bot)"


def extract_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s<>\")\]]+", text)


async def analyze_link(url: str) -> dict[str, Any]:
    host = urlparse(url).netloc.lower()
    if "youtube.com" in host or "youtu.be" in host:
        return await analyze_youtube(url)
    if "github.com" in host:
        return await analyze_github(url)
    if "doi.org" in host or "arxiv.org" in host or url.lower().endswith(".pdf"):
        return await analyze_reference(url)
    return await analyze_generic_page(url)


async def analyze_youtube(url: str) -> dict[str, Any]:
    video_id = youtube_id(url)
    if not video_id:
        return {"ok": False, "kind": "youtube", "error": "No reconocí el id del video."}
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception:
        return {
            "ok": False,
            "kind": "youtube",
            "error": "Falta youtube-transcript-api. Instálalo en el motor Python.",
            "url": url,
        }
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=["es", "en", "es-419"])
        text = " ".join(item.get("text", "") for item in transcript).strip()
        summary = text[:2500]
        return {
            "ok": True,
            "kind": "youtube",
            "url": url,
            "title": f"YouTube {video_id}",
            "text": summary,
            "facts": [f"Video id: {video_id}", f"Caracteres de transcripción: {len(text)}"],
        }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "kind": "youtube", "error": str(error), "url": url}


def youtube_id(url: str) -> str | None:
    if "youtu.be/" in url:
        return url.rstrip("/").split("youtu.be/")[-1].split("?")[0]
    match = re.search(r"[?&]v=([\w-]{6,})", url)
    return match.group(1) if match else None


async def analyze_github(url: str) -> dict[str, Any]:
    parts = [p for p in urlparse(url).path.split("/") if p]
    if len(parts) < 2:
        return {"ok": False, "kind": "github", "error": "URL de GitHub incompleta."}
    owner, repo = parts[0], parts[1].removesuffix(".git")
    api = f"https://api.github.com/repos/{owner}/{repo}"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers={"user-agent": UA, "accept": "application/vnd.github+json"}) as client:
            meta = await client.get(api)
            readme = await client.get(f"{api}/readme")
            tree = await client.get(f"{api}/contents")
        if meta.status_code != 200:
            return {"ok": False, "kind": "github", "error": f"GitHub {meta.status_code}", "url": url}
        info = meta.json()
        readme_text = ""
        if readme.status_code == 200:
            import base64

            content = readme.json().get("content") or ""
            readme_text = base64.b64decode(content).decode("utf-8", errors="replace")[:6000]
        structure: list[str] = []
        if tree.status_code == 200 and isinstance(tree.json(), list):
            for item in tree.json()[:40]:
                structure.append(f"{item.get('type')}: {item.get('name')}")
        text = "\n".join(
            [
                f"# {info.get('full_name')}",
                info.get("description") or "",
                f"Stars: {info.get('stargazers_count')} · Language: {info.get('language')}",
                "",
                "## Estructura",
                *structure,
                "",
                "## README",
                readme_text,
            ]
        )
        return {
            "ok": True,
            "kind": "github",
            "url": url,
            "title": info.get("full_name") or f"{owner}/{repo}",
            "text": text[:8000],
            "facts": [
                f"Repo: {owner}/{repo}",
                f"Lenguaje: {info.get('language')}",
                f"Stars: {info.get('stargazers_count')}",
            ],
        }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "kind": "github", "error": str(error), "url": url}


async def analyze_reference(url: str) -> dict[str, Any]:
    doi = None
    if "doi.org/" in url:
        doi = url.split("doi.org/")[-1].strip()
    arxiv = None
    if "arxiv.org" in url:
        arxiv = re.search(r"(\d{4}\.\d{4,5})", url)
        arxiv = arxiv.group(1) if arxiv else None

    title = "Referencia"
    authors: list[str] = []
    abstract = ""
    year = ""
    try:
        async with httpx.AsyncClient(timeout=25.0, headers={"user-agent": UA}) as client:
            if doi:
                cross = await client.get(f"https://api.crossref.org/works/{doi}")
                if cross.status_code == 200:
                    msg = cross.json().get("message") or {}
                    title = (msg.get("title") or ["Referencia"])[0]
                    authors = [
                        f"{a.get('family', '')}, {a.get('given', '')}".strip(", ")
                        for a in (msg.get("author") or [])[:8]
                    ]
                    year = str((msg.get("issued") or {}).get("date-parts", [[""]])[0][0] or "")
                    abstract = re.sub(r"<[^>]+>", "", msg.get("abstract") or "")[:2000]
            elif arxiv:
                atom = await client.get(f"https://export.arxiv.org/api/query?id_list={arxiv}")
                if atom.status_code == 200:
                    xml = atom.text
                    title_m = re.search(r"<title>([\s\S]*?)</title>", xml)
                    summary_m = re.search(r"<summary>([\s\S]*?)</summary>", xml)
                    title = re.sub(r"\s+", " ", (title_m.group(1) if title_m else "ArXiv")).strip()
                    abstract = re.sub(r"\s+", " ", (summary_m.group(1) if summary_m else "")).strip()[:2000]
                    authors = re.findall(r"<name>([^<]+)</name>", xml)[:8]
                    year = arxiv[:4]
            elif url.lower().endswith(".pdf"):
                pdf = await client.get(url)
                if pdf.status_code == 200:
                    try:
                        from pypdf import PdfReader
                        import io

                        reader = PdfReader(io.BytesIO(pdf.content))
                        pages = []
                        for page in reader.pages[:4]:
                            pages.append(page.extract_text() or "")
                        abstract = "\n".join(pages)[:2500]
                        title = url.rstrip("/").split("/")[-1]
                    except Exception as error:  # noqa: BLE001
                        return {"ok": False, "kind": "reference", "error": f"PDF: {error}", "url": url}
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "kind": "reference", "error": str(error), "url": url}

    author_str = "; ".join(authors) if authors else "s. f."
    apa = f"{author_str} ({year or 's. f.'}). {title}. {url}"
    ieee = f"{author_str}, \"{title},\" {year or 'n.d.'}. [Online]. Available: {url}"
    text = "\n".join(
        [
            f"# {title}",
            f"Autores: {author_str}",
            f"Año: {year or 's. f.'}",
            "",
            "## Resumen",
            abstract or "(sin abstract)",
            "",
            "## Cita APA",
            apa,
            "",
            "## Cita IEEE",
            ieee,
        ]
    )
    return {
        "ok": True,
        "kind": "reference",
        "url": url,
        "title": title,
        "text": text,
        "facts": [apa, ieee],
        "apa": apa,
        "ieee": ieee,
    }


async def analyze_generic_page(url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=20.0, headers={"user-agent": UA}, follow_redirects=True) as client:
            response = await client.get(url)
        if response.status_code != 200:
            return {"ok": False, "kind": "web", "error": f"HTTP {response.status_code}", "url": url}
        html = response.text
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "nav", "footer"]):
                tag.decompose()
            title = (soup.title.string if soup.title else url) or url
            text = " ".join(soup.get_text(" ").split())[:4000]
        except Exception:
            title = url
            text = re.sub(r"<[^>]+>", " ", html)[:4000]
        return {
            "ok": True,
            "kind": "web",
            "url": url,
            "title": str(title).strip()[:200],
            "text": text,
            "facts": [f"URL: {url}"],
        }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "kind": "web", "error": str(error), "url": url}
