"""Skills API — manage anthropic_skills/ directory."""
from fastapi import APIRouter, HTTPException
from pathlib import Path

router = APIRouter()
SKILLS_DIR = Path("anthropic_skills")

@router.get("/skills")
async def list_skills():
    if not SKILLS_DIR.exists() or not SKILLS_DIR.is_dir():
        return []
    skills = []
    for entry in sorted(SKILLS_DIR.iterdir()):
        if not entry.is_dir(): continue
        skill_file = entry / "SKILL.md"
        disabled_file = entry / "SKILL.md.disabled"
        if skill_file.exists() or disabled_file.exists():
            skills.append({"name": entry.name, "enabled": skill_file.exists()})
    return skills

@router.get("/skills/{name}")
async def get_skill(name: str):
    for ext in ["SKILL.md", "SKILL.md.disabled"]:
        path = SKILLS_DIR / name / ext
        if path.exists():
            return {"name": name, "content": path.read_text("utf-8"), "enabled": ext == "SKILL.md"}
    raise HTTPException(404, "Skill not found")

@router.post("/skills/{name}/toggle")
async def toggle_skill(name: str):
    skill_path = SKILLS_DIR / name / "SKILL.md"
    disabled_path = SKILLS_DIR / name / "SKILL.md.disabled"
    if skill_path.exists():
        skill_path.rename(disabled_path)
        return {"name": name, "enabled": False}
    elif disabled_path.exists():
        disabled_path.rename(skill_path)
        return {"name": name, "enabled": True}
    raise HTTPException(404, "Skill not found")
