#!/usr/bin/env python3
"""Extract top-15 widest frames and keyword frames from flame SVG files."""
import re, os, sys

svg_dir = os.path.dirname(os.path.abspath(__file__))

svgs = [
    "flame_friend-requests-create.svg",
    "flame_friends-delete.svg",
    "flame_invitations-respond.svg",
]

keywords = {
    "nlohmann/json": r"nlohmann|json_abi",
    "MysqlPool/mysql": r"MysqlPool|mysql_|sql::|MySQL_",
    "RedisPool/redis": r"RedisPool|redis",
    "std::string": r"basic_string",
    "parseHttp/handle_/verify_": r"parseHttp|handle_|verify_",
    "write/send/writev": r"\bSSL_write\b|\bwrite\b|\bsend\b|\bwritev\b",
    "read/recv": r"\bSSL_read\b|\bread\b|\brecv\b",
    "malloc/operator new/free": r"\bmalloc\b|operator new|\bfree\b",
}

for fname in svgs:
    path = os.path.join(svg_dir, fname)
    print(f"\n{'='*70}")
    print(f"=== {fname} ===")
    print(f"{'='*70}")
    
    with open(path) as f:
        content = f.read()
    
    # Extract all frames: title text, samples, pct, width
    pattern = r'<g\s*>\s*<title>([^<]+)\s*\(([\d,]+)\s*samples,\s*([\d.]+)%\)</title><rect[^>]*?width="([\d.]+)"'
    frames = []
    for m in re.finditer(pattern, content):
        name = m.group(1).strip()
        samp_str = m.group(2).replace(',', '')
        samples = int(samp_str) if samp_str.isdigit() else 0
        pct = float(m.group(3))
        width = float(m.group(4))
        frames.append((width, samples, pct, name))
    
    # Sort by width descending
    frames.sort(key=lambda x: -x[0])
    
    total_samp = sum(s for _, s, _, _ in frames)
    print(f"\n  Total frames: {len(frames)}, Total samples: {total_samp:,}")
    print(f"\n  TOP 15 WIDEST FRAMES:")
    print(f"  {'#':>3} {'Width':>8} {'Samples':>14} {'%':>7}  Function")
    print(f"  {'-'*3} {'-'*8} {'-'*14} {'-'*7}  {'-'*60}")
    for i, (w, s, p, name) in enumerate(frames[:15]):
        # Truncate long names
        n = name[:110] + "..." if len(name) > 110 else name
        print(f"  {i+1:>3} {w:>8.1f} {s:>14,} {p:>6.2f}%  {n}")
    
    print(f"\n  KEYWORD FRAMES (all occurrences in middle of stack):")
    
    for kwname, kwpattern in keywords.items():
        matches = []
        for w, s, p, name in frames:
            if re.search(kwpattern, name, re.IGNORECASE):
                matches.append((w, s, p, name))
        if matches:
            print(f"\n  --- {kwname} ({len(matches)} frames) ---")
            for w, s, p, name in matches:
                n = name[:100] + "..." if len(name) > 100 else name
                print(f"     width={w:>7.1f}  {s:>12,} samples ({p:>6.2f}%)  {n}")
        else:
            print(f"\n  --- {kwname}: (none found) ---")
