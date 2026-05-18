import re

files = [
    'flame_me.svg',
    'flame_conv-messages.svg', 
    'flame_rooms-create.svg',
    'flame_login.svg',
    'flame_rooms-delete.svg',
    'flame_friend-requests-create.svg',
    'flame_friends-delete.svg',
    'flame_invitations-respond.svg',
]

for fname in files:
    print(f'=== {fname} ===')
    with open(fname) as f:
        content = f.read()
    
    # Get SVG height
    h_match = re.search(r'height="(\d+)"', content[:500])
    svg_h = h_match.group(1) if h_match else '?'
    
    # Extract all <g> blocks with <title> and <rect width=...>
    frames = []
    # Pattern: <g >\n<title>text (N samples, P%)</title><rect ... width="W" .../>
    # The title text format: "func_name (N,N,N samples, P.P%)"
    pattern = r'<g\s*>\s*<title>([^<]+)\s*\(([\d,]+)\s*samples,\s*([\d.]+)%\)</title><rect[^>]*?width="([\d.]+)"'
    
    for m in re.finditer(pattern, content):
        name = m.group(1).strip()
        samples = int(m.group(2).replace(',', ''))
        pct = float(m.group(3))
        width = float(m.group(4))
        frames.append((width, samples, pct, name))
    
    # Sort by width descending
    frames.sort(key=lambda x: -x[0])
    
    print(f'  SVG height: {svg_h}px, Total frames extracted: {len(frames)}')
    print(f'  Top ~20 widest frames:')
    for i, (w, s, p, name) in enumerate(frames[:20]):
        short_name = name[:120] + '...' if len(name) > 120 else name
        print(f'  {i+1:2d}. width={w:8.1f}  {s:>12,} samples ({p:6.2f}%)  {short_name}')
    print()
