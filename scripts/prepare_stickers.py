"""Phase 1: 表情包资源准备脚本。

从 emoji_labels.csv 提取已标注表情，清洗标签，映射到 12 情绪分类，
转换为 WebP 格式，缩放到 256x256px，放入 config/stickers/ 目录。

用法：
    .venv/Scripts/python scripts/prepare_stickers.py
"""

import csv
import os
import re
import shutil
from pathlib import Path

from PIL import Image, ImageSequence

# ── 配置 ──────────────────────────────────────────────────────

SOURCE_DIR = Path(r"D:\Maxma\私聊_九曜山的小猪\media\emojis")
CSV_FILE = Path(r"D:\Maxma\emoji_labels.csv")
OUTPUT_DIR = Path(r"D:\Maxma\MaxmaHere\config\stickers")

TARGET_SIZE = 256  # 目标尺寸 256x256
WEBP_QUALITY = 80  # WebP 质量

# 12 情绪分类
EMOTION_CATEGORIES = [
    "开心", "无语", "委屈", "悲伤", "害羞", "生气",
    "惊讶", "尴尬", "撒娇", "得意", "爱心", "日常",
]

# 标签 → 情绪分类 映射表
TAG_TO_EMOTION = {
    # 直接匹配
    "开心": "开心",
    "无语": "无语",
    "委屈": "委屈",
    "悲伤": "悲伤",
    "害羞": "害羞",
    "生气": "生气",
    "惊讶": "惊讶",
    "尴尬": "尴尬",
    "撒娇": "撒娇",
    "得意": "得意",
    "爱心": "爱心",
    "日常": "日常",
    # 同义/近义映射
    "搞笑": "开心",
    "庆祝": "开心",
    "鼓励": "开心",
    "祝福": "爱心",
    "问候": "日常",
    "打招呼": "日常",
    "晚安": "日常",
    "表白": "爱心",
    "思念": "爱心",
    "回复": "日常",
    "节日": "日常",
    "沙雕": "搞笑",  # 搞笑→开心
}


def parse_tags(tag_string: str) -> list[str]:
    """解析标签字符串，统一分隔符，返回标签列表。"""
    if not tag_string or tag_string.strip() == "":
        return []
    # 统一分隔符：逗号、分号、斜杠、空格
    tags = re.split(r'[,;/\s]+', tag_string)
    return [t.strip() for t in tags if t.strip()]


def map_to_emotion(tags: list[str]) -> str | None:
    """从标签列表中映射到情绪分类。返回情绪分类名或 None。"""
    for tag in tags:
        if tag in TAG_TO_EMOTION:
            mapped = TAG_TO_EMOTION[tag]
            if mapped in EMOTION_CATEGORIES:
                return mapped
    return None


def convert_to_webp(src: Path, dst: Path, size: int = TARGET_SIZE) -> bool:
    """将图片转换为 WebP 格式，缩放到指定尺寸。

    支持静态图（PNG/JPG）和动图（GIF→动画 WebP）。
    返回是否成功。
    """
    try:
        if src.suffix.lower() == '.gif':
            # 动图：提取所有帧，转换为动画 WebP
            frames = []
            durations = []
            img = Image.open(src)
            for frame in ImageSequence.Iterator(img):
                frame = frame.convert('RGBA')
                # 缩放
                frame.thumbnail((size, size), Image.LANCZOS)
                frames.append(frame)
                # 获取帧延迟（毫秒）
                dur = frame.info.get('duration', 100)
                durations.append(max(dur, 50))  # 最小 50ms

            if frames:
                frames[0].save(
                    str(dst),
                    'WEBP',
                    save_all=True,
                    append_images=frames[1:],
                    duration=durations,
                    loop=0,
                    quality=WEBP_QUALITY,
                )
                return True
        else:
            # 静态图
            img = Image.open(src)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGBA')
            else:
                img = img.convert('RGB')
            img.thumbnail((size, size), Image.LANCZOS)
            img.save(str(dst), 'WEBP', quality=WEBP_QUALITY)
            return True
    except Exception as e:
        print(f"  [ERROR] 转换失败 {src.name}: {e}")
        return False


def main():
    print("=" * 60)
    print("Phase 1: 表情包资源准备")
    print("=" * 60)

    # 1. 读取 CSV
    print("\n[1/6] 读取标签 CSV...")
    records = []
    with open(CSV_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            filename = row.get('filename', '').strip()
            tags_str = row.get('tags', '').strip()
            if not filename:
                continue
            records.append({'filename': filename, 'tags_str': tags_str})
    print(f"  读取 {len(records)} 条记录")

    # 2. 清洗标签并映射情绪
    print("\n[2/6] 清洗标签并映射情绪分类...")
    emotion_counts = {cat: 0 for cat in EMOTION_CATEGORIES}
    unmapped = []
    categorized = {}  # {emotion: [filename, ...]}

    for rec in records:
        tags = parse_tags(rec['tags_str'])
        emotion = map_to_emotion(tags)
        if emotion:
            if emotion not in categorized:
                categorized[emotion] = []
            categorized[emotion].append(rec['filename'])
            emotion_counts[emotion] += 1
        else:
            unmapped.append(rec['filename'])

    print(f"  已映射: {sum(emotion_counts.values())} 个")
    print(f"  未映射: {len(unmapped)} 个（将归入'日常'分类）")

    # 未映射的归入"日常"
    for fn in unmapped:
        if "日常" not in categorized:
            categorized["日常"] = []
        categorized["日常"].append(fn)
        emotion_counts["日常"] += 1

    # 打印分布
    print("\n  情绪分布:")
    for cat in EMOTION_CATEGORIES:
        count = emotion_counts.get(cat, 0)
        bar = "█" * (count // 2)
        print(f"    {cat:4s}: {count:3d} {bar}")

    # 3. 创建输出目录
    print("\n[3/6] 创建输出目录...")
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    for cat in EMOTION_CATEGORIES:
        (OUTPUT_DIR / cat).mkdir(parents=True, exist_ok=True)
    print(f"  已创建 {OUTPUT_DIR}")

    # 4-6. 转换、缩放、复制
    print("\n[4/6] 转换 WebP + 缩放 + 复制...")
    total_success = 0
    total_fail = 0
    skipped = 0

    for emotion, filenames in categorized.items():
        out_dir = OUTPUT_DIR / emotion
        print(f"\n  [{emotion}] 处理 {len(filenames)} 个文件...")

        for i, filename in enumerate(filenames):
            src = SOURCE_DIR / filename
            if not src.exists():
                skipped += 1
                continue

            # 生成输出文件名
            dst_name = f"{Path(filename).stem}.webp"
            dst = out_dir / dst_name

            if convert_to_webp(src, dst):
                total_success += 1
                if (i + 1) % 20 == 0:
                    print(f"    已处理 {i + 1}/{len(filenames)}")
            else:
                total_fail += 1

    # 统计
    print("\n" + "=" * 60)
    print("完成!")
    print(f"  成功转换: {total_success}")
    print(f"  转换失败: {total_fail}")
    print(f"  文件缺失: {skipped}")

    # 计算总大小
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.rglob("*.webp"))
    print(f"  总大小: {total_size / 1024 / 1024:.1f} MB")

    # 各分类文件数
    print("\n  各分类文件数:")
    for cat in EMOTION_CATEGORIES:
        count = len(list((OUTPUT_DIR / cat).glob("*.webp")))
        size = sum(f.stat().st_size for f in (OUTPUT_DIR / cat).glob("*.webp"))
        print(f"    {cat:4s}: {count:3d} 张 ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
