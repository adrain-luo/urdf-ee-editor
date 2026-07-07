![项目截图](./docs/screenshot.png)

# URDF 末端执行器编辑器

[English](./README_EN.md)

一个轻量级 Web URDF 末端执行器编辑器，用于裁剪机器人末端子树、添加固定连杆/TCP，并导出修改后的 URDF。

本项目基于 [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer) 继续开发，保留上游 Apache-2.0 License 与 attribution。当前重点是让已有机器人 URDF + meshes 能稳定导入、查看和进行末端链路编辑。

## 主要能力

- 拖拽导入完整 URDF 描述文件夹，例如 `g1_d_description/`。
- 自动读取 `.urdf` 与同目录 `meshes/` 中的 STL 等 mesh 文件。
- 支持常见 mesh 路径形式：
  - `meshes/xxx.STL`
  - `./meshes/xxx.STL`
  - `../meshes/xxx.STL`
  - `package://xxx/meshes/xxx.STL`
- 按 URDF link / joint tree 加载机器人模型。
- 默认渲染 `visual`，可解析 `collision`。
- 支持 `fixed`、`revolute`、`continuous`、`prismatic` joint。
- 使用 URDF / ROS 坐标语义：
  - `+Z` up
  - `+X` forward
  - `+Y` left
- 支持 3D 点击选中 link，并同步结构树。
- 支持查看 selected link 的：
  - parent joint
  - child joints
  - descendants 数量
  - descendants 列表
- 支持末端子树操作：
  - Preview descendants
  - Hide descendants
  - Restore hidden
  - Trim after this link
- 支持添加固定 child link。
- 支持添加 `tcp_link`。
- 支持 Direct pose 与 Guided pose 两种 origin 输入方式。
- 支持导出修改后的 URDF。

## 末端编辑工作流

典型使用方式：

1. 拖入机器人 URDF 描述文件夹。
2. 在 3D 视图或结构树中选中 wrist / mount link。
3. 打开 `End Effector` 面板。
4. 查看当前 link、parent joint、child joints 和 descendants。
5. 使用 `Preview descendants` 检查会被影响的下游链路。
6. 使用 `Hide descendants` / `Restore hidden` 做临时查看。
7. 使用 `Trim after this link` 裁剪当前 link 下游所有 descendants。
8. 使用 `Add child link` 添加新的固定连杆。
9. 使用 `Add tcp_link` 添加 TCP。
10. 导出修改后的 URDF。

## Trim after this link 语义

`Trim after this link` 是面向末端工具链裁剪的安全操作：

- 保留当前 selected link。
- 删除 selected link 下游所有 descendant links。
- 删除连接这些 descendants 的 joints。
- 不删除 selected link 本身。
- 不允许对 root link 执行。
- 执行前需要二次确认。

该操作会修改 URDF XML。

## Add child link

`Add child link` 用于在 selected link 下添加一个新的固定关节和子 link。

第一版只支持 fixed joint，不添加 visual/collision，不写入任何 editor-only helper。

输入项：

- joint name
- child link name
- origin xyz，单位 m
- origin rpy，单位 rad

添加后会：

- 更新内部 URDF XML；
- 重新加载模型；
- 自动选中新添加的 child link；
- 允许继续添加下一段 fixed joint/link。

## Add TCP link

`Add tcp_link` 会在 selected link 下添加一个 fixed joint 和 `tcp_link`。

它与 `Add child link` 使用一致的 origin 输入交互。当前不会生成 TCP 可视化 helper，也不会添加 visual/collision。

## Origin 输入方式

Add child link 和 Add TCP link 都支持两种输入模式。

### Direct pose

直接输入 URDF `<origin>` 的真实值：

- `xyz` 单位为 m；
- `rpy` 单位为 rad；
- 必须各为 3 个数字。

### Guided pose

通过按钮更新同一组 Direct pose 文本值：

- translation distance 单位为 mm；
- rotation angle 单位为 deg；
- `+X` 表示 `xyz.x += distance_m`；
- `-X` 表示 `xyz.x -= distance_m`；
- `+Y` / `-Y` / `+Z` / `-Z` 同理；
- `+Roll` 表示 `rpy.roll += angle_rad`；
- `+Pitch` 表示 `rpy.pitch += angle_rad`；
- `+Yaw` 表示 `rpy.yaw += angle_rad`。

第一版 Guided pose 全部基于 parent link frame / URDF origin 语义，不做 local/world frame 切换，也不做 3D 拖拽编辑。

## 本地运行

安装依赖：

```bash
pnpm install
```

启动开发服务：

```bash
pnpm run dev --host 127.0.0.1 --port 5173
```

打开：

```text
http://127.0.0.1:5173/
```

构建生产版本：

```bash
pnpm run build
```

构建产物会输出到 `dist/`。

## 部署

本项目可以作为纯静态网页部署。`pnpm run build` 后生成的 `dist/` 目录包含可直接托管的静态文件，不需要 Node.js 服务端。

静态部署注意事项：

- `vite.config.js` 当前使用 `base: './'`，适合部署到 GitHub Pages 仓库子路径，例如 `/urdf-ee-editor/`，也适合 Vercel 这类任意路径托管。
- 项目运行时不依赖 `127.0.0.1`、本机绝对路径或 `C:/Users/...`。
- URDF 文件夹拖拽导入通过浏览器 File API 工作，mesh 文件通过 `URL.createObjectURL` 从用户本地选择的文件读取，不需要服务器文件系统。
- 不要提交 `node_modules/`、`dist/`、大型机器人样例目录，例如 `g1_d_description/`，除非后续明确把它作为 sample data 管理。
- USD / MuJoCo 等上游高级功能可能需要 COOP/COEP 响应头；URDF + STL 导入、末端裁剪、添加 fixed/TCP link、导出 URDF 不依赖这些响应头。

### 推荐方式：Vercel

推荐优先使用 Vercel，原因是配置简单、适合 Vite 静态站点，并且不会要求把 `dist/` 提交到仓库。

Vercel 配置：

- Framework Preset: `Vite`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm run build`
- Output Directory: `dist`

部署流程：

1. 将仓库导入 Vercel。
2. 保持默认 Vite 配置或按上面的配置填写。
3. 部署完成后，直接访问 Vercel 分配的域名。
4. 在网页中拖入本地 URDF 描述文件夹测试导入。

### GitHub Pages

GitHub Pages 也可以部署。由于当前 `base: './'`，构建产物可以在仓库子路径下正常加载静态资源。

建议使用 GitHub Actions 构建并发布 `dist/`，不要把 `dist/` 提交到主分支。

典型流程：

1. 在 GitHub 仓库 Settings -> Pages 中选择 GitHub Actions 作为发布源。
2. 添加 Pages workflow，执行：
   - `pnpm install --frozen-lockfile`
   - `pnpm run build`
   - 上传 `dist/` 作为 Pages artifact
3. 部署完成后访问：

```text
https://<username>.github.io/urdf-ee-editor/
```

如果未来把 `base` 改成仓库绝对路径，也可以使用：

```js
base: '/urdf-ee-editor/'
```

但当前 `base: './'` 更灵活，适合 GitHub Pages、Vercel、静态文件服务器和本地预览。

## 本地测试建议

基础回归：

1. 拖入完整 `g1_d_description/` 文件夹。
2. 确认 `g1_d.urdf` 和同目录 `meshes/` 被识别。
3. 确认机器人模型正常显示。
4. 确认 Z-up / X-forward / Y-left 语义正确。
5. 确认拖拽旋转、缩放、平移和视图切换正常。

末端编辑回归：

1. 选中 wrist / mount link。
2. 查看 End Effector 面板中的 link / joint / descendants 信息。
3. 点击 `Preview descendants`。
4. 点击 `Hide descendants`，再点击 `Restore hidden`。
5. 点击 `Trim after this link`，确认第一次只是进入确认态。
6. 再次确认后，检查 selected link 保留，下游 descendants 被删除。
7. 使用 `Add child link` 添加一段 fixed joint/link。
8. 切换 Guided pose，输入 `80 mm` 后点击 `+X`，确认 Direct xyz 为 `0.08 0 0`。
9. 输入 `90 deg` 后点击 `+Yaw`，确认 Direct rpy 第三个值约为 `1.570796`。
10. 连续添加两段 fixed joint/link。
11. 添加 `tcp_link`。
12. 导出 URDF 后重新导入，确认结构仍正确。

## 当前限制

- 不支持删除 selected link 本身。
- 不支持删除单个 joint。
- 不支持中间节点删除后自动重接子树。
- 不支持右键菜单。
- 不支持 TransformControls。
- 不支持 3D 拖拽编辑 origin。
- 暂未实现 suction / gripper template。
- 暂未实现 TCP 坐标轴可视化。
- editor-only visual helper 不会写入导出的 URDF。
- URDF 中 transmissions、gazebo extensions、plugins、sensors 等复杂标签会尽量保留，但还不是结构化编辑对象。

## 技术栈

- Vite
- Three.js
- urdf-loader
- xacro-parser
- CodeMirror
- D3

项目仍保留上游 Robot Viewer 中的 MJCF、USD、MuJoCo 等能力，但当前产品主线是 URDF + meshes 的导入、末端编辑和导出。

## 上游来源与致谢

本项目基于 [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer) 开发。感谢原作者和相关开源项目：

- [urdf-loader](https://github.com/gkjohnson/urdf-loaders)
- [xacro-parser](https://github.com/gkjohnson/xacro-parser)
- [mujoco_wasm](https://github.com/zalo/mujoco_wasm)
- [usd-viewer](https://github.com/needle-tools/usd-viewer)
- [mechaverse](https://github.com/jurmy24/mechaverse)

## License

本项目保留上游 Apache License 2.0。详见 [LICENSE](./LICENSE)。
