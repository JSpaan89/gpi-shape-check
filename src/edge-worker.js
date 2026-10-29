/* Runs the silhouette edge search off the main thread. */
importScripts('silhouette.js');
self.onmessage = function (e) {
  var d = e.data;
  try {
    self.postMessage({ ok: true, res: SIL.analyzeImage(d.gray, d.w, d.h, d.opts) });
  } catch (err) {
    self.postMessage({ ok: false, msg: String((err && err.message) || err) });
  }
};
