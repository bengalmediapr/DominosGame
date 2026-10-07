# Builds public/models/revolver.glb from the revolver OBJ, keeping the cylinder (and hammer, trigger)
# as separate nodes so the game can animate them. Run after scripts/pack-revolver-textures.py, with
# Blender (or the bpy module):
#   python scripts/blender/export-revolver.py -- assets-src/revolver/source/rev_anim.obj.obj \
#     assets-src/revolver/packed public/models/revolver.glb
import bpy, sys, math
from mathutils import Vector, Matrix
args = sys.argv[sys.argv.index('--') + 1:]
obj, texdir, out = args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=obj, use_split_groups=True)
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active = bpy.context.scene.objects[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
objs = {o.name.split('_')[0]: o for o in bpy.context.scene.objects}
# One PBR material for every part.
m = bpy.data.materials.new('revolver'); m.use_nodes = True
nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
def img(name, non_color=False):
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(f'{texdir}/{name}')
    if non_color: n.image.colorspace_settings.name = 'Non-Color'
    return n
nt.links.new(img('revolver_color.jpg').outputs['Color'], bsdf.inputs['Base Color'])
orm = img('revolver_orm.jpg', True); sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(img('revolver_normal.jpg', True).outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
for o in objs.values():
    o.data.materials.clear(); o.data.materials.append(m)
# Pivots, in source coordinates (+Y toward the muzzle, +X toward the grip).
def bounds(o):
    vs = [v.co for v in o.data.vertices]
    return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])
tmn, tmx = bounds(objs['trigger'])
# The cylinder turns on its axis (the origin); the hammer on the pin screw at the back of the frame.
pivots = {'tumbler': Vector((0, 0, 0)), 'hammer': Vector((-15.4, -27.0, 0)), 'trigger': Vector((tmn.x + 3, tmx.y - 4, 0))}
# Muzzle along +X, top of the gun along +Z (glTF +Y), about 9 units long.
s = 9 / 248
R = Matrix(((0, 1, 0), (0, 0, -1), (-1, 0, 0))).to_4x4() @ Matrix.Scale(s, 4)
for key, o in objs.items():
    p = pivots.get(key, Vector((0, 0, 0)))
    o.data.transform(Matrix.Translation(-p)); o.location = p
    o.data.transform(Matrix(R.to_3x3()).to_4x4()); o.location = R @ o.location
    o.data.update()
# Static parts become one "frame" mesh.
bpy.ops.object.select_all(action='DESELECT')
for k in ('main', 'latch', 'swing'): objs[k].select_set(True)
bpy.context.view_layer.objects.active = objs['main']; bpy.ops.object.join()
objs['main'].name = 'frame'; objs['tumbler'].name = 'cylinder'
for o in bpy.context.scene.objects: print('OUT', o.name, tuple(round(x, 2) for x in o.location), flush=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_image_format='AUTO', export_apply=False)
