import json, subprocess, sys, os, copy
repo, out, bin_ = sys.argv[1], sys.argv[2], sys.argv[3]
fx = json.load(open(f'{repo}/tests/acceptance/1640/fixtures/parity/geometry/crease-edges.scene'))
look = json.load(open(f'{repo}/tests/acceptance/1640/fixtures/look.json'))
def doc(title, items):
    w = {}
    for i, (k, v) in enumerate(items.items()):
        w[k] = {'id': k, 'name': k, 'order': f'a{i:03d}', 'layer': 'main', **v}
    return {'format': 1, 'id': 'doc-1640-' + title, 'profile': 'scene', 'title': title, 'description': title + ': a #1640 look.',
            'size': [960, 640], 'camera': 'cam', 'requires': {'modules': {'scene3d': '^1'}},
            'layers': {'main': {'writer': 'agent-a', 'title': 'Main', 'order': 'a0'}}, 'items': w}
sun = {'kind': 'light.sun@1', 'params': {'illuminance': 3, 'color': [1, 1, 1], 'shadow': False}, 'at': {'rot': [-50, 30, 0]}}
def line(of, kind, extra={}, width=3, space='screen', dash=None, role='accent'):
    p = {'edges': {'of': of, 'kind': kind, **extra}, 'width': width, 'size_space': space, 'paint': {'fill': {'role': role}}}
    if dash: p['dash'] = dash
    return {'kind': 'mark.line@1', 'params': p}
base = {k: v for k, v in fx['items'].items() if not k.startswith(('cube_', 'cylinder_', 'ball_', 'plane_'))}
cr = {'crease': {'angle': 30}}
scenes = {
  'crease': {**base, 'sun': sun, 'l1': line('cube', cr), 'l2': line('cylinder', cr), 'l3': line('ball', cr), 'l4': line('plane', cr, {'border': True})},
  'all': {**base, 'sun': sun, 'l1': line('cube', 'all'), 'l2': line('cylinder', 'all'), 'l3': line('ball', 'all'), 'l4': line('plane', 'all')},
  'noborder': {**base, 'sun': sun, 'l1': line('cube', cr), 'l2': line('cylinder', cr), 'l3': line('ball', cr), 'l4': line('plane', cr, {'border': False})},
}
cam = {'kind': 'camera@1', 'params': {'projection': 'perspective', 'position': [2.4, 1.9, 3.2], 'target': [0, 0.25, 0], 'fov': 35, 'near': 0.1}}
cube = {'kind': 'slab@1', 'params': {'size': [1, 1, 1]}, 'at': {'pos': [0, 0, 0]}}
scenes['dash_screen'] = {'cam': cam, 'cube': cube, 'sun': sun, 'l1': line('cube', cr, dash=[8, 8])}
scenes['dash_world'] = {'cam': cam, 'cube': cube, 'sun': sun, 'l1': line('cube', cr, width=0.02, space='world', dash=[0.1, 0.1])}
for name, items in scenes.items():
    d = f'{out}/{name}'; os.makedirs(d, exist_ok=True)
    p = f'{d}/doc.json'; json.dump(doc(name, items), open(p, 'w'))
    call = {'call': 'view3d', 'doc': p, 'look': look, 'size': [960, 640], 'frames': 1, 'counts': True, 'targets': ['final'], 'capture': [0]}
    r = subprocess.run([bin_, 'run'], input=json.dumps({'out': d, 'calls': [call]}) + '\n', capture_output=True, text=True, cwd=repo, timeout=600)
    a = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {'stderr': r.stderr[-800:]}
    if not a.get('ok'): print(name, 'REFUSED', json.dumps(a)[:800]); continue
    f = a['replies'][0]['frames'][0]
    segs = {k: len(v) for k, v in (f.get('segments') or {}).items()}
    print(name, 'segments', segs, 'derived', f.get('edge_sets_derived'), 'files', sorted(x for x in os.listdir(d) if x.endswith('.png')))
