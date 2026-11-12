/**
 * MÜLK Spor Kulübü - Bulut Veritabanı & Çoklu Cihaz Senkronizasyon Ayarı
 * ----------------------------------------------------------------------
 * Bu dosya index.html, kayit.html ve panel.html tarafından ortak kullanılır.
 * Kurulum sonrasında 'apiUrl' alanına Google Apps Script Web Uygulaması URL'nizi
 * yazarak GitHub Pages üzerinden tüm antrenör, veli ve yönetici cihazlarının
 * ortak veritabanında gerçek zamanlı buluşmasını sağlayabilirsiniz.
 */
window.MULK_CLOUD_CONFIG = {
  mode: 'local', // Bulut aktifleştiğinde 'cloud' olur
  apiUrl: ''     // Örn: 'https://script.google.com/macros/s/AKfycb.../exec'
};

window.isValidMulkCloudUrl = function(url) {
  if (!url || typeof url !== 'string') return false;
  var u = url.trim();
  return /^https:\/\/script\.google\.com\/(?:a\/(?:macros\/[^/]+|[^/]+\/macros)\/|macros\/)s\/[^/]+\/exec/.test(u) ||
         (u.indexOf('https://script.google.com/') === 0 && u.indexOf('/macros/s/') !== -1);
};

(function initMulkCloudAutoConfig() {
  try {
    var params = new URLSearchParams(window.location.search);
    var cloudParam = params.get('cloud');
    if (cloudParam) {
      var decodedUrl = cloudParam.trim();
      try { decodedUrl = decodeURIComponent(decodedUrl); } catch (e) {}
      // Yalnızca resmi Google Apps Script alan adını kabul et (güvenlik kuralı)
      if (window.isValidMulkCloudUrl(decodedUrl)) {
        localStorage.setItem('mulk_cloud_api_url', decodedUrl);
        localStorage.setItem('mulk_cloud_mode', 'cloud');
      }
      params.delete('cloud');
      var cleanSearch = params.toString();
      var newUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '') + window.location.hash;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', newUrl);
      }
    }
  } catch (e) {}
})();

window.getMulkCloudState = function() {
  var savedUrl = '';
  var savedMode = '';
  try {
    savedUrl = (localStorage.getItem('mulk_cloud_api_url') || '').trim();
    savedMode = (localStorage.getItem('mulk_cloud_mode') || '').trim();
  } catch (e) {}

  var cfgUrl = (window.MULK_CLOUD_CONFIG && window.MULK_CLOUD_CONFIG.apiUrl ? window.MULK_CLOUD_CONFIG.apiUrl : '').trim();
  var cfgMode = (window.MULK_CLOUD_CONFIG && window.MULK_CLOUD_CONFIG.mode ? window.MULK_CLOUD_CONFIG.mode : 'local').trim();

  var finalUrl = savedUrl || cfgUrl;
  var finalMode = savedMode || cfgMode;
  if (cfgUrl && !savedUrl) {
    finalMode = 'cloud';
  }
  var isValidUrl = window.isValidMulkCloudUrl(finalUrl);
  var isCloudActive = (finalMode === 'cloud' && isValidUrl);

  return {
    mode: isCloudActive ? 'cloud' : 'local',
    apiUrl: finalUrl,
    isCloudActive: isCloudActive
  };
};

window.mulkCloudRequest = async function(action, payload) {
  var state = window.getMulkCloudState();
  if (!state.isCloudActive || !state.apiUrl) {
    throw new Error('CLOUD_NOT_CONFIGURED');
  }
  var token = '';
  try {
    token = sessionStorage.getItem('mulk_cloud_token') || localStorage.getItem('mulk_cloud_token_remember') || '';
  } catch (e) {}

  var bodyObj = Object.assign({}, payload || {}, { action: action, token: token });
  var resp = await fetch(state.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(bodyObj)
  });

  if (!resp.ok) {
    throw new Error('HTTP_' + resp.status);
  }
  var data = await resp.json();
  if (data && data.authError) {
    throw new Error('AUTH_EXPIRED');
  }
  return data;
};

window.mulkSha256 = async function(str) {
  if (window.crypto && window.crypto.subtle && window.TextEncoder) {
    try {
      var data = new TextEncoder().encode(str);
      var buf = await window.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(function(b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    } catch (e) {}
  }
  // file:// veya eski tarayıcılar için saf JS SHA-256 yedeği
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j, result = '';
  var words = [];
  var utf8Str = unescape(encodeURIComponent(str));
  var asciiBitLength = utf8Str[lengthProperty] * 8;
  var hash = [];
  var k = [];
  var primeCounter = 0;
  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  utf8Str += '\x80';
  while (utf8Str[lengthProperty] % 64 - 56) utf8Str += '\x00';
  for (i = 0; i < utf8Str[lengthProperty]; i++) {
    j = utf8Str.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength);
  for (j = 0; j < words[lengthProperty];) {
    var w = words.slice(j, j += 16);
    var oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var temp1 = hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ ((~e) & hash[6])) +
        k[i] +
        (w[i] = (i < 16) ? w[i] : (
          w[i - 16] +
          (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
          w[i - 7] +
          (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
};

// Türkiye (+90 5XX XXX XX XX) Telefon Biçimlendirici
window.normalizeTrPhoneDigits = function(raw) {
  var s = String(raw || '').trim();
  if (s === '+9' || s === '+' || s === '+90' || s === '9') return '';
  var d = s.replace(/\D/g, '');
  if (d.indexOf('90') === 0) {
    d = d.slice(2);
  }
  while (d.indexOf('0') === 0) {
    d = d.slice(1);
  }
  return d.slice(0, 10);
};

window.formatTrPhoneValue = function(raw, keepPrefixIfEmpty) {
  var d = window.normalizeTrPhoneDigits(raw);
  if (!d.length) return keepPrefixIfEmpty ? '+90 ' : '';
  var parts = [
    d.slice(0, 3),
    d.slice(3, 6),
    d.slice(6, 8),
    d.slice(8, 10)
  ].filter(Boolean);
  return '+90 ' + parts.join(' ');
};

window.attachTrPhoneMask = function(selector) {
  var els = document.querySelectorAll(selector);
  els.forEach(function(el) {
    if (el.dataset.trPhoneMasked === '1') return;
    el.dataset.trPhoneMasked = '1';
    el.setAttribute('maxlength', '17');
    el.setAttribute('inputmode', 'tel');
    if (!el.getAttribute('placeholder') || el.getAttribute('placeholder').indexOf('05') === 0) {
      el.setAttribute('placeholder', '+90 5XX XXX XX XX');
    }

    el.addEventListener('focus', function() {
      if (!el.value || !el.value.trim()) {
        el.value = '+90 ';
      } else {
        el.value = window.formatTrPhoneValue(el.value, true);
      }
      setTimeout(function() {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
      }, 0);
    });

    el.addEventListener('keydown', function(e) {
      var start = el.selectionStart || 0;
      var end = el.selectionEnd || 0;
      if (e.key === 'Backspace' && start <= 4 && end <= 4) {
        e.preventDefault();
      }
    });

    el.addEventListener('input', function() {
      var formatted = window.formatTrPhoneValue(el.value, true);
      if (el.value !== formatted) {
        el.value = formatted;
      }
    });

    el.addEventListener('blur', function() {
      el.value = window.formatTrPhoneValue(el.value, false);
    });
  });
};


