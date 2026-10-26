/* Browser-only OCR. All runtime and language files are served by this site. */
(function () {
  'use strict';
  const base = new URL('../assets/vendor/ocr/', document.currentScript.src).href;
  let runtime;
  let busy = false;

  function loadRuntime() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!runtime) {
      runtime = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = base + 'tesseract.min.js';
        script.onload = function () { resolve(window.Tesseract); };
        script.onerror = function () {
          script.remove();
          runtime = null;
          reject(new Error('本地识别组件未加载，请检查文件后重试'));
        };
        document.head.append(script);
      });
    }
    return runtime;
  }

  async function recognize(image, options) {
    const opts = options || {};
    if (busy) throw new Error('已有图片正在识别，请稍候');
    if (!(image instanceof Blob) || !/^image\//.test(image.type)) {
      throw new Error('请选择图片文件');
    }
    if (image.size > 20 * 1024 * 1024) throw new Error('图片超过20 MB，请先裁剪题目区域');
    busy = true;
    let worker;
    let timer;
    let stopped = false;
    try {
      const T = await loadRuntime();
      const job = (async function () {
        worker = await T.createWorker(['chi_sim', 'eng'], 1, {
          workerPath: base + 'worker.min.js',
          corePath: base + 'core/',
          langPath: base + 'lang',
          workerBlobURL: false,
          cacheMethod: 'none',
          logger: function (message) {
            if (!stopped && opts.onProgress) {
              if (message.status === 'recognizing text') opts.onProgress(message.progress);
              else opts.onProgress({ status: '正在加载本地识别模型…' });
            }
          }
        });
        if (stopped) { await worker.terminate(); throw new Error('识别已结束'); }
        await worker.setParameters({ user_defined_dpi: '300' });
        const result = await worker.recognize(image);
        return { text: result.data.text.trim() };
      })();
      const timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          stopped = true;
          if (worker) worker.terminate().catch(function () {});
          reject(new Error('识别用时较长，请裁剪图片后重试'));
        }, 90000);
      });
      return await Promise.race([job, timeout]);
    } finally {
      stopped = true;
      clearTimeout(timer);
      if (worker) await worker.terminate().catch(function () {});
      busy = false;
    }
  }

  window.LocalOCR = { recognize: recognize };
})();
