# Shader Playground — 着色器热重载编辑器

基于 **WebGL + Canvas + Web Worker + IndexedDB + DOM** 的在线 GLSL 编辑器，
支持实时编辑、热重载、编译错误行列定位、运行时错误捕获与上下文丢失恢复。

## 运行

纯静态页面，无构建步骤。任意静态服务器指向本目录即可：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> 需要通过 http(s) 访问（而不是 file://），否则浏览器会拒绝加载 Web Worker。

## 功能与验收标准对应

| 验收标准 | 实现 |
| --- | --- |
| 热重载正确 | 编辑去抖 400ms 后自动编译；先在 Worker 中用 OffscreenCanvas 独立 GL 上下文预校验，通过后才在主线程编译并原子切换 program，失败绝不影响当前画面 |
| 编译错误定位准确 | `js/glsl-errors.js` 解析 ANGLE / Mesa / WebKit 等多种 infoLog 格式，提取行号、列号；行号槽标红，控制台错误可点击跳转到对应行列 |
| 链接失败有提示 | 链接日志单独解析，控制台以 `[链接]` 前缀展示，两个文件标签同时标记错误 |
| 运行时错误可捕获 | 渲染循环 try/catch + `window.onerror` / `unhandledrejection` + 可选的每帧 `gl.getError()` 检测（工具栏开关） |
| 上下文丢失可恢复 | 监听 `webglcontextlost` / `webglcontextrestored`，丢失时显示浮层并暂停渲染，恢复后自动重建 GL 资源并重新编译当前着色器；工具栏可一键模拟丢失 |
| 降级到默认着色器 | 用户着色器失败且当前无可用 program 时，自动回退到内置默认着色器并提示 |
| 浏览器差异 | WebGL2 → WebGL1 → experimental-webgl 逐级降级；Worker 内 WebGL 不可用（如部分 Safari）时自动改为主线程直接编译；GLSL 使用 ES 1.00 保证最大兼容 |

## 文件结构

```
index.html            页面骨架（工具栏 / 编辑器 / 控制台 / 预览）
style.css             样式
js/main.js             主入口：热重载调度、Worker 通信、控制台、持久化、运行时错误捕获
js/renderer.js         WebGL 渲染器：program 生命周期、上下文丢失恢复、默认着色器降级
js/shader-worker.js    Web Worker：OffscreenCanvas 后台预编译/预链接
js/editor.js           编辑器组件：行号槽、错误行高亮、行列跳转
js/glsl-errors.js      各驱动 infoLog 解析（行号/列号提取）
js/db.js               IndexedDB 持久化（刷新后恢复源码）
js/default-shaders.js  内置默认着色器（兜底）
```

## 可用 uniform

- `u_time` (float)：运行秒数
- `u_resolution` (vec2)：画布像素尺寸
- `u_mouse` (vec2)：鼠标位置（像素）

顶点着色器需声明 `attribute vec2 a_position;`（全屏三角形，3 个顶点）。

## 快捷键

- `Ctrl/Cmd + S`：立即应用当前着色器
- `Tab`：插入两个空格
