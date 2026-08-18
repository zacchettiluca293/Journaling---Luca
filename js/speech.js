/* Thin wrapper over the browser's speech recognition.
 *
 * A note on privacy, because it matters for a journal: this API is NOT
 * on-device in most browsers — Chrome streams audio to Google's servers, and
 * Safari uses Apple's. The keyboard's own dictation button on iOS is the
 * private option, which is why the app offers that route first.
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function supported() {
  return Boolean(Recognition);
}

/**
 * Start listening. Returns a handle with .stop().
 * onPartial(text)  – interim text, changes as you speak
 * onFinal(text)    – a settled chunk, safe to append
 * onEnd(reason)    – 'user' | 'error' | 'done'
 */
export function listen({ lang, onPartial, onFinal, onEnd, onError }) {
  if (!Recognition) {
    onError && onError('unsupported');
    return { stop() {} };
  }

  let stopped = false;
  let restarts = 0;
  let rec = null;

  const start = () => {
    rec = new Recognition();
    rec.lang = lang || navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          if (text.trim()) onFinal && onFinal(text.trim());
        } else {
          interim += text;
        }
      }
      if (interim) onPartial && onPartial(interim.trim());
    };

    rec.onerror = (event) => {
      // Safari fires 'no-speech' on a pause; that isn't a real failure.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      stopped = true;
      onError && onError(event.error);
      onEnd && onEnd('error');
    };

    rec.onend = () => {
      if (stopped) return;
      // iOS ends the session after a short silence. Restart quietly so a
      // pause mid-thought doesn't cut the recording short.
      if (restarts < 40) {
        restarts += 1;
        try {
          rec.start();
          return;
        } catch { /* fall through to a clean stop */ }
      }
      onEnd && onEnd('done');
    };

    try {
      rec.start();
    } catch (err) {
      onError && onError(err && err.message ? err.message : 'start-failed');
      onEnd && onEnd('error');
    }
  };

  start();

  return {
    stop() {
      stopped = true;
      try { rec && rec.stop(); } catch { /* already stopped */ }
      onEnd && onEnd('user');
    },
  };
}

/** Rough check for "this is an iPhone or iPad". */
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}
