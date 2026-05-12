"""SleepTech 로고 생성기

다크 + 퍼플 그라데이션 배경, 반달(수면), 음파(오디오 분석),
별(밤) 요소로 구성된 미니멀 로고를 모든 필요한 사이즈로 생성한다.

생성 파일:
    assets/images/icon.png                       (1024x1024)
    assets/images/splash-icon.png                (1024x1024)
    assets/images/favicon.png                    (96x96)
    assets/images/android-icon-foreground.png    (1024x1024 transparent)
    assets/images/android-icon-background.png    (1024x1024 solid bg)
    assets/images/android-icon-monochrome.png    (1024x1024)
    assets/adaptive-icon.png                     (1024x1024)
"""

import os
from PIL import Image, ImageDraw

import numpy as np

ASSETS = "assets"
SUPER = 4           # supersampling factor (anti-aliasing)
TARGET = 1024
W = TARGET * SUPER  # working canvas size


def make_gradient_bg(w: int) -> Image.Image:
    """대각선 그라데이션 배경 (다크 네이비 → 딥 보라)."""
    y, x = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, w), indexing="ij")
    t = (x * 0.55 + y * 0.45)  # diagonal blend
    c0 = np.array([13, 17, 23], dtype=np.float32)       # #0D1117 (top-left)
    c1 = np.array([46, 19, 88], dtype=np.float32)       # #2E1358 (mid)
    c2 = np.array([107, 33, 168], dtype=np.float32)     # #6B21A8 (bottom-right)
    mask1 = t < 0.55
    mask2 = ~mask1

    bg = np.zeros((w, w, 4), dtype=np.float32)
    bg[..., 3] = 255

    tt1 = (t[mask1] / 0.55)
    tt2 = ((t[mask2] - 0.55) / 0.45)
    for c in range(3):
        ch = np.zeros((w, w), dtype=np.float32)
        ch[mask1] = c0[c] * (1 - tt1) + c1[c] * tt1
        ch[mask2] = c1[c] * (1 - tt2) + c2[c] * tt2
        bg[..., c] = ch
    return Image.fromarray(bg.clip(0, 255).astype(np.uint8), "RGBA")


def draw_crescent_moon(img: Image.Image, w: int,
                       cx_ratio: float = 0.50,
                       cy_ratio: float = 0.41,
                       r_ratio: float = 0.20,
                       color=(255, 255, 255, 255)) -> None:
    """반달/초승달을 합성한다 (외부 흰 원 - 내부 어두운 원)."""
    moon_layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    md = ImageDraw.Draw(moon_layer)
    cx = int(w * cx_ratio)
    cy = int(w * cy_ratio)
    r = int(w * r_ratio)
    # 외부 흰 원
    md.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=color)
    # 내부 잘라낼 원 (오른쪽 위로 약간 이동)
    cut_cx = cx + int(r * 0.42)
    cut_cy = cy - int(r * 0.10)
    cut_r = int(r * 0.93)
    md.ellipse(
        [(cut_cx - cut_r, cut_cy - cut_r), (cut_cx + cut_r, cut_cy + cut_r)],
        fill=(0, 0, 0, 0),
    )
    img.alpha_composite(moon_layer)


def draw_sound_waves(draw: ImageDraw.ImageDraw, w: int,
                     cx_ratio: float = 0.50,
                     cy_start_ratio: float = 0.66,
                     color=(167, 139, 250)) -> None:
    """달 아래 음파 라인 3개 (점점 길어지면서 흐려짐)."""
    cx = int(w * cx_ratio)
    thickness = max(int(w * 0.022), 4)
    config = [
        (0.13, 0.000, 255),  # 가장 짧고 진함
        (0.22, 0.055, 220),
        (0.30, 0.110, 170),  # 가장 길고 흐림
    ]
    for half_ratio, offset_ratio, alpha in config:
        half_w = int(w * half_ratio)
        y = int(w * (cy_start_ratio + offset_ratio))
        r, g, b = color
        draw.line(
            [(cx - half_w, y), (cx + half_w, y)],
            fill=(r, g, b, alpha),
            width=thickness,
        )
        # 둥근 끝
        endcap = thickness // 2
        for px, py in [(cx - half_w, y), (cx + half_w, y)]:
            draw.ellipse(
                [(px - endcap, py - endcap), (px + endcap, py + endcap)],
                fill=(r, g, b, alpha),
            )


def draw_stars(draw: ImageDraw.ImageDraw, w: int) -> None:
    """작은 별들 (조용한 밤 분위기)."""
    stars = [
        (0.18, 0.21, 1.2, 200),
        (0.82, 0.17, 0.9, 180),
        (0.78, 0.55, 0.7, 150),
        (0.16, 0.62, 0.8, 170),
        (0.86, 0.78, 0.6, 130),
        (0.12, 0.86, 0.6, 130),
    ]
    for sx, sy, sr_mult, alpha in stars:
        cx = int(w * sx)
        cy = int(w * sy)
        r = int(w * 0.006 * sr_mult)
        draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)],
                     fill=(255, 255, 255, alpha))


def build_logo(transparent: bool = False, monochrome: bool = False) -> Image.Image:
    """완성된 로고 이미지 생성."""
    if transparent:
        img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    else:
        img = make_gradient_bg(W)

    draw = ImageDraw.Draw(img)

    if monochrome:
        # 단색 (Android monochrome icon) — 모두 흰색 반투명
        draw_stars(draw, W)
        draw_crescent_moon(img, W, color=(255, 255, 255, 255))
        draw_sound_waves(draw, W, color=(255, 255, 255))
    else:
        draw_stars(draw, W)
        draw_crescent_moon(img, W, color=(255, 255, 255, 255))
        draw_sound_waves(draw, W, color=(167, 139, 250))

    # 다운샘플 (anti-aliasing)
    return img.resize((TARGET, TARGET), Image.LANCZOS)


def make_solid_bg(w: int = TARGET) -> Image.Image:
    """Android adaptive icon용 단색 배경."""
    sup_w = w * SUPER
    bg = make_gradient_bg(sup_w)
    return bg.resize((w, w), Image.LANCZOS)


def main():
    os.makedirs(f"{ASSETS}/images", exist_ok=True)

    # 1. 메인 아이콘 (1024x1024, 그라데이션 배경 + 로고)
    main_icon = build_logo()
    main_icon.save(f"{ASSETS}/images/icon.png")
    print(f"saved: {ASSETS}/images/icon.png")

    # 2. Splash 화면 아이콘 (1024x1024, 동일)
    main_icon.save(f"{ASSETS}/images/splash-icon.png")
    print(f"saved: {ASSETS}/images/splash-icon.png")

    # 3. Favicon (96x96, 동일 디자인)
    favicon = main_icon.resize((96, 96), Image.LANCZOS)
    favicon.save(f"{ASSETS}/images/favicon.png")
    print(f"saved: {ASSETS}/images/favicon.png")

    # 4. Adaptive icon foreground (투명 배경, 로고만)
    fg = build_logo(transparent=True)
    # 안전영역(66%) 고려 — 로고는 이미 적당한 크기지만 약간 축소
    safe = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    scale = 0.80
    scaled = fg.resize((int(TARGET * scale), int(TARGET * scale)), Image.LANCZOS)
    offset = (TARGET - scaled.width) // 2
    safe.paste(scaled, (offset, offset), scaled)
    safe.save(f"{ASSETS}/images/android-icon-foreground.png")
    safe.save(f"{ASSETS}/adaptive-icon.png")
    print(f"saved: {ASSETS}/images/android-icon-foreground.png")
    print(f"saved: {ASSETS}/adaptive-icon.png")

    # 5. Adaptive icon background (그라데이션만)
    bg = make_solid_bg()
    bg.save(f"{ASSETS}/images/android-icon-background.png")
    print(f"saved: {ASSETS}/images/android-icon-background.png")

    # 6. Monochrome icon (Android 13+ themed icon)
    mono = build_logo(transparent=True, monochrome=True)
    mono.save(f"{ASSETS}/images/android-icon-monochrome.png")
    print(f"saved: {ASSETS}/images/android-icon-monochrome.png")

    print("\nAll logo assets generated successfully.")


if __name__ == "__main__":
    main()
