# WebGL 着色器热重载工作台

一个无构建依赖的 WebGL 片段着色器编辑与热重载示例，使用 Canvas、Web Worker、IndexedDB 和 DOM 实现。

## 运行

ES Module 和 Worker 需要通过 HTTP 服务打开：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/`。

运行解析器测试：

```bash
node --test tests/*.test.mjs
```

## 功能

- 实时编辑：输入后由 Worker 做 350 ms 防抖，再通知主线程热重载。
- 持久化：Worker 使用 IndexedDB 保存源码；IndexedDB 不可用时降级到 localStorage。
- 编译定位：解析 ANGLE/Chrome、macOS、Firefox/NVIDIA 等常见 `getShaderInfoLog` 格式，显示行号、列号并支持点击跳转。
- 链接失败：读取 `LINK_STATUS` 和 `getProgramInfoLog`，保留提示并降级到内置默认程序。
- 运行时错误：渲染循环对 WebGL 调用做 `try/catch` 和 `getError` 检查；用户程序运行出错时自动降级，默认程序出错则停止并报告致命错误。
- 上下文丢失：监听 `webglcontextlost` / `webglcontextrestored`，恢复后重建 buffer 和 program，并重新编译当前源码。
- 浏览器差异：按 WebGL 2、实验性 WebGL 2、WebGL 1、实验性 WebGL 1 顺序创建上下文；不支持片段着色器 highp 时自动改用 mediump 默认程序。

## 验收步骤

1. **热重载正确**：修改片段着色器中的颜色或 `u_time` 参数，停止输入约 350 ms 后画布自动更新；刷新页面后从 IndexedDB 恢复源码。
2. **编译错误定位准确**：把整个片段着色器替换为下面的代码，诊断区显示 `4 行 18 列`，点击后光标定位到 `color`。

   ```glsl
   precision highp float;
   void main() {
     gl_FragColor = color;
   }
   ```
3. **链接失败有提示**：点击“模拟链接失败”，诊断区显示 varyings 类型不匹配导致的程序链接/校验错误。
4. **运行时错误可捕获**：点击“模拟运行时错误”，诊断区显示捕获到的 `INVALID_ENUM`；渲染循环同类错误会自动切换默认程序。
5. **上下文丢失可恢复**：点击“模拟上下文丢失”后出现遮罩并释放资源；点击“恢复上下文”后自动重建默认/当前程序。
6. **降级到默认着色器**：让用户着色器编译失败，页面继续渲染内置动画，并显示“默认程序”状态。

## 文件结构

- `index.html`：页面与诊断区域。
- `src/app.js`：DOM、Worker 消息、编译触发和上下文事件编排。
- `src/shader-renderer.js`：WebGL 上下文、编译链接、渲染循环、错误捕获和资源恢复。
- `src/error-parser.js`：驱动日志的行列解析和 GL 错误名映射。
- `src/code-editor.js`：轻量源码编辑器、行号和错误行标记。
- `src/worker-shader.js`：防抖和 IndexedDB/localStorage 持久化。
- `src/default-shaders.js`：内置安全降级着色器。

## WebGL 限制说明

浏览器的安全模型不会把 GLSL 源码内部的 GPU 崩溃、驱动 TDR 或无限循环映射成 JavaScript 异常。此类情况通常表现为上下文丢失；应用会在浏览器触发 `webglcontextrestored` 后自动恢复。`getError` 能可靠捕获的是主线程 WebGL API 调用产生的同步错误，示例的运行时探针用于验证这一处理链路。
