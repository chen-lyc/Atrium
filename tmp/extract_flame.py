import re, os, sys

os.chdir("flame/before_opt/svg")

targets = {
    'flame_me.svg': 'Fastest API (me)',
    'flame_conv-messages.svg': 'Slowest API (conv-messages)',
    'flame_rooms-create.svg': 'High latency creation (rooms-create)',
    'flame_login.svg': 'bcrypt-dominated (login)',
    'flame_rooms-delete.svg': 'Bimodal latency (rooms-delete)',
    'flame_friend-requests-create.svg': 'High tail latency (friend-req-create)',
    'flame_friends-delete.svg': 'Fast delete (friends-delete)',
    'flame_invitations-respond.svg': 'Bimodal latency (invitations-respond)',
}

for fname, desc in targets.items():
    if not os.path.exists(fname):
        print(f"=== {fname} ({desc}) — FILE NOT FOUND ===")
        print()
        continue
    with open(fname) as f:
        content = f.read()
    
    h_match = re.search(r'height="(\d+)"', content[:500])
    svg_h = h_match.group(1) if h_match else '?'
    
    # total samples from top <text> or subtitle
    total_s = None
    tm = re.search(r'total\s+samples[:\s]*([\d,]+)', content[:2000], re.I)
    if tm:
        total_s = int(tm.group(1).replace(',',''))
    
    frames = []
    pattern = r'<g\s*>\s*<title>([^<]+)\s*\(([\d,]+)\s*samples,\s*([\d.]+)%\)</title><rect[^>]*?width="([\d.]+)"'
    
    for m in re.finditer(pattern, content):
        name = m.group(1).strip()
        samples = int(m.group(2).replace(',', ''))
        pct = float(m.group(3))
        width = float(m.group(4))
        frames.append((width, samples, pct, name))
    
    frames.sort(key=lambda x: -x[0])
    
    print(f"=== {fname} ({desc}) ===")
    print(f"SVG height: {svg_h}px, total frames: {len(frames)}")
    if total_s:
        print(f"Total samples (from header): {total_s:,}")
    print(f"Top 20 widest frames:")
    for i, (w, s, p, name) in enumerate(frames[:20]):
        short_name = name[:130]
        print(f"  #{i+1:2d} | width={w:>7.1f} | {s:>12,} ({p:5.2f}%) | {short_name}")
    print()
