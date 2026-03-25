#!/usr/bin/env python3
"""Write minimal RGBA PNGs for local dev when originals are not present."""
import struct
import zlib
from pathlib import Path


def write_png_rgba(path: Path, w: int, h: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    public = root / "public"

    pw, ph = 112, 16
    player = bytearray(pw * ph * 4)
    palette = [
        (230, 200, 210, 255),
        (240, 180, 200, 255),
        (220, 160, 190, 255),
        (200, 140, 180, 255),
        (180, 120, 160, 255),
        (160, 100, 150, 255),
        (140, 80, 140, 255),
    ]
    for i, c in enumerate(palette):
        for y in range(16):
            for x in range(16):
                px = i * 16 + x
                idx = (y * pw + px) * 4
                player[idx : idx + 4] = bytes(c)

    # Match raylib asset: 7×6 tiles at 16px (112×96).
    tw, th = 112, 96
    tilemap = bytearray(tw * th * 4)
    for ty in range(6):
        for tx in range(7):
            r = 70 + (tx * 12 + ty * 8) % 90
            g = 50 + (ty * 15) % 100
            b = 120 + (tx * 10) % 80
            c = (r, g, b, 255)
            for y in range(16):
                for x in range(16):
                    px = tx * 16 + x
                    py = ty * 16 + y
                    idx = (py * tw + px) * 4
                    tilemap[idx : idx + 4] = bytes(c)

    write_png_rgba(public / "player.png", pw, ph, bytes(player))
    write_png_rgba(public / "tilemap.png", tw, th, bytes(tilemap))
    print(f"Wrote {public / 'player.png'} and {public / 'tilemap.png'}")


if __name__ == "__main__":
    main()
