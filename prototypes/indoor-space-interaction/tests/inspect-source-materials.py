from pxr import Usd, UsdGeom, UsdShade
stage=Usd.Stage.Open('测试模型/scene000002.usdz')
n=0
for p in Usd.PrimRange(stage.GetPseudoRoot(),Usd.TraverseInstanceProxies()):
 if not p.IsA(UsdGeom.Mesh): continue
 material,_=UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()
 if not material: continue
 print('MESH',p.GetPath(),'MATERIAL',material.GetPath())
 print('UV',[(str(v.GetPrimvarName()),str(v.GetInterpolation()),len(v.ComputeFlattened() or [])) for v in UsdGeom.PrimvarsAPI(p).GetPrimvars() if 'st' in str(v.GetPrimvarName()).lower()])
 shader=material.ComputeSurfaceSource()[0]
 if shader:
  print('SHADER',shader.GetIdAttr().Get())
  for i in shader.GetInputs():
   print('INPUT',i.GetBaseName(),i.Get(),i.GetConnectedSource())
 n+=1
 if n>=5: break
