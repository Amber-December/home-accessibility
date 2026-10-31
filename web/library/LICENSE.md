# 素材库家具数据的说明

`catalog.json`、`img/` 和 `models/` 来自团队整理的宜家家具数据集（`$HA_DATA/ikea-model`），由 `web/tools/make_catalog.py` 生成。

- `img/*-ref.jpg`、`img/*-in*.jpg`：宜家中国官网商品页的商品图、尺寸图和功能图，版权归宜家所有，这里只用于内部非商业演示，展示时附商品页链接。
- `img/*.jpg`（渲染图）、`img/*-open.jpg`、`models/*.glb`：按商品图用 Aholo Lux3D 生成或按商品结构建模，再按标称尺寸缩放；带活动部件的家具加了关节骨骼。生成结果仅用于内部非商业演示。
- 价格是样例价格，不是报价。

本仓库其余文件不受这份说明约束。
