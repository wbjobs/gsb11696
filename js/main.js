/* 主入口：热重载调度、Worker 预校验、控制台、IndexedDB 持久化、运行时错误捕获。 */
(function () {
  'use strict';

  var HOT_RELOAD_DELAY = 400;   // 编辑后自动应用的去抖延迟
  var SAVE_DELAY = 800;         // IndexedDB 保存去抖

  var sources = {
    vert: DefaultShaders.vertex,
    frag: DefaultShaders.fragment
  };
  var activeTab = 'frag';
  var lastErrors = { vert: [], frag: [], link: [] };
  var reloadTimer = null;
  var saveTimer = null;
  var workerSeq = 0;
  var worker = null;
  var workerUnsupported = false;

  // ---------- DOM ----------
  var statusEl = document.getElementById('status');
  var glInfoEl = document.getElementById('gl-info');
  var fpsEl = document.getElementById('fps');
  var programLabelEl = document.getElementById('program-label');
  var consoleList = document.getElementById('console-list');
  var overlay = document.getElementById('context-lost-overlay');

  var editor = new Editor(
    document.getElementById('editor'),
    document.getElementById('gutter')
  );

  // ---------- 控制台 ----------
  function addConsole(level, msg, loc) {
    var li = document.createElement('li');
    li.className = level;
    if (loc) {
      var span = document.createElement('span');
      span.className = 'loc';
      span.textContent = '[' + loc.stage + ' ' + loc.line + ':' + (loc.col || 0) + '] ';
      span.title = '点击跳转到错误位置';
      span.addEventListener('click', function () {
        if (loc.stage === 'vert' || loc.stage === 'frag') switchTab(loc.stage);
        editor.jumpTo(loc.line, loc.col);
      });
      li.appendChild(span);
    }
    li.appendChild(document.createTextNode(msg));
    consoleList.appendChild(li);
    li.scrollIntoView(false);
    while (consoleList.children.length > 200) {
      consoleList.removeChild(consoleList.firstChild);
    }
  }

  function setStatus(status, label) {
    statusEl.className = 'status ' + status;
    statusEl.textContent = '● ' + label;
  }

  // ---------- 渲染器 ----------
  var renderer = new Renderer(document.getElementById('glcanvas'), {
    onLog: addConsole,
    onStatus: setStatus,
    onGLInfo: function (info) { glInfoEl.textContent = info; },
    onProgramChange: function (label) { programLabelEl.textContent = 'program: ' + label; },
    onFps: function (fps) { fpsEl.textContent = fps + ' FPS'; },
    onContextLost: function () { overlay.classList.remove('hidden'); },
    onContextRestored: function () {
      overlay.classList.add('hidden');
      // 上下文恢复后重新应用当前源码
      applyShaders('上下文恢复后重新编译');
    }
  });
  renderer.start();

  // ---------- Worker 预校验 ----------
  try {
    worker = new Worker('js/shader-worker.js');
    worker.onmessage = function (e) {
      var r = e.data;
      if (r.unsupported) {
        workerUnsupported = true;
        addConsole('warn', '[环境] Worker 内 WebGL 不可用（' + r.unsupported +
          '），改为主线程直接编译。');
        applyShaders('初始编译');
        return;
      }
      if (r.exception) {
        addConsole('error', '[Worker] 预校验异常：' + r.exception);
        return;
      }
      // Worker 预检通过 -> 主线程正式编译并热切换
      if (r.vertex.ok && r.fragment.ok && (!r.link || r.link.ok)) {
        applyShaders('热重载');
      } else {
        // 预检失败：解析日志、定位错误，主线程不切换，保持上一个可用 program
        var errors = [];
        GLSLErrors.parseInfoLog(r.vertex.log).forEach(function (x) { x.stage = 'vert'; errors.push(x); });
        GLSLErrors.parseInfoLog(r.fragment.log).forEach(function (x) { x.stage = 'frag'; errors.push(x); });
        if (r.link && !r.link.ok) {
          GLSLErrors.parseLinkLog(r.link.log).forEach(function (x) { x.stage = 'link'; errors.push(x); });
        }
        showErrors(errors);
        setStatus('err', '着色器错误（已保留上一个可用版本）');
        // 若主线程当前没有任何可用 program，应用一次以触发默认着色器降级
        if (!renderer.program) {
          renderer.applyShaders(sources.vert, sources.frag);
        }
      }
    };
    worker.onerror = function (e) {
      workerUnsupported = true;
      addConsole('warn', '[环境] Worker 加载失败：' + (e.message || '未知') + '，改为主线程编译。');
    };
  } catch (err) {
    workerUnsupported = true;
    addConsole('warn', '[环境] 无法创建 Worker，改为主线程编译。');
  }

  // ---------- 错误展示 ----------
  function showErrors(errors) {
    lastErrors = { vert: [], frag: [], link: [] };
    errors.forEach(function (e) {
      var stage = e.stage || 'link';
      if (!lastErrors[stage]) lastErrors[stage] = [];
      lastErrors[stage].push(e);
      var level = e.severity === 'WARNING' ? 'warn' : 'error';
      var prefix = stage === 'link' ? '[链接] ' : '[' + stage + '] ';
      addConsole(level, prefix + e.message,
        e.line > 0 ? { stage: stage, line: e.line, col: e.col } : null);
    });
    updateErrorMarkers();
  }

  function updateErrorMarkers() {
    document.querySelector('.tab[data-target="frag"]').classList
      .toggle('has-error', lastErrors.frag.some(isError) || lastErrors.link.some(isError));
    document.querySelector('.tab[data-target="vert"]').classList
      .toggle('has-error', lastErrors.vert.some(isError) || lastErrors.link.some(isError));
    var errs = activeTab === 'frag' ? lastErrors.frag : lastErrors.vert;
    editor.setErrors(errs);
  }

  function isError(e) { return e.severity !== 'WARNING'; }

  // ---------- 应用着色器 ----------
  function applyShaders(reason) {
    var result = renderer.applyShaders(sources.vert, sources.frag);
    if (result.ok) {
      showErrors(result.errors); // 可能只有 warning
      if (!result.errors.some(isError)) {
        addConsole('ok', '[编译] ' + reason + '：编译链接成功，已热切换。');
      }
    } else {
      showErrors(result.errors);
    }
  }

  function scheduleHotReload() {
    clearTimeout(reloadTimer);
    setStatus('warn', '编辑中…');
    reloadTimer = setTimeout(function () {
      if (workerUnsupported || !worker) {
        applyShaders('热重载');
      } else {
        worker.postMessage({
          id: ++workerSeq,
          vertex: sources.vert,
          fragment: sources.frag
        });
      }
    }, HOT_RELOAD_DELAY);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      ShaderDB.save('current', sources).catch(function (e) {
        addConsole('warn', '[存储] 保存失败：' + e.message);
      });
    }, SAVE_DELAY);
  }

  // ---------- 编辑器事件 ----------
  editor.onChange(function (value) {
    sources[activeTab] = value;
    scheduleHotReload();
    scheduleSave();
  });

  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.target === name);
    });
    editor.setValue(sources[name]);
    updateErrorMarkers();
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.target); });
  });

  // ---------- 工具栏 ----------
  document.getElementById('btn-apply').addEventListener('click', function () {
    applyShaders('手动应用');
  });
  document.getElementById('btn-reset').addEventListener('click', function () {
    sources.vert = DefaultShaders.vertex;
    sources.frag = DefaultShaders.fragment;
    editor.setValue(sources[activeTab]);
    scheduleSave();
    applyShaders('重置默认');
  });
  document.getElementById('btn-lose-context').addEventListener('click', function () {
    renderer.simulateContextLoss();
  });
  document.getElementById('btn-force-restore').addEventListener('click', function () {
    renderer.forceRestore();
  });
  document.getElementById('btn-clear-console').addEventListener('click', function () {
    consoleList.innerHTML = '';
  });
  document.getElementById('chk-gl-error').addEventListener('change', function (e) {
    renderer.checkGLErrorPerFrame = e.target.checked;
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      applyShaders('手动应用');
    }
  });

  // ---------- 运行时错误捕获 ----------
  window.addEventListener('error', function (e) {
    setStatus('err', '运行时异常');
    addConsole('error', '[运行时] ' + e.message +
      (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno + ':' + e.colno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    setStatus('err', '未处理的 Promise 拒绝');
    addConsole('error', '[运行时] unhandledrejection: ' +
      ((e.reason && e.reason.message) || e.reason));
  });

  // ---------- 启动：从 IndexedDB 恢复 ----------
  ShaderDB.load('current').then(function (saved) {
    if (saved && typeof saved.vert === 'string' && typeof saved.frag === 'string') {
      sources.vert = saved.vert;
      sources.frag = saved.frag;
      addConsole('info', '[存储] 已从 IndexedDB 恢复上次编辑的着色器。');
    }
  }).catch(function (e) {
    addConsole('warn', '[存储] IndexedDB 不可用：' + e.message + '（更改将不会持久化）');
  }).finally(function () {
    editor.setValue(sources[activeTab]);
    if (workerUnsupported || !worker) {
      applyShaders('初始编译');
    } else {
      worker.postMessage({ id: ++workerSeq, vertex: sources.vert, fragment: sources.frag });
    }
  });
})();
