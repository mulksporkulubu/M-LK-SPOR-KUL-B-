/**
 * ==============================================================================
 * MÜLK SPOR KULÜBÜ - GÜVENLİ BULUT VERİTABANI VE SENKRONİZASYON MOTORU
 * ==============================================================================
 * Bu Google Apps Script kodu, GitHub Pages (mulksporkulubu.com) üzerinden çalışan
 * admin paneli, antrenör yoklama ekranları ve veli QR ön kayıt formlarını
 * doğrudan kendi kulüp Google E-Tablo dosyanıza güvenli şekilde bağlar.
 *
 * KURULUM ADIMLARI (Tek Seferlik ~2 Dakika):
 * 1. mulksporkulubu@gmail.com hesabıyla https://sheets.new açın ve tabloya ad verin.
 * 2. Üst menüden "Uzantılar" > "Apps Script" seçeneğine tıklayın.
 * 3. Açılan editördeki her şeyi silip bu dosyanın tamamını yapıştırın ve Kaydedin.
 * 4. Sağ üstten "Dağıt" > "Yeni dağıtım" > Tür: "Web uygulaması" seçin:
 *    - Açıklama: "MÜLK SK Bulut DB"
 *    - Yürütme şekli: "Ben (mulksporkulubu@gmail.com)"
 *    - Erişimi olanlar: "Herkes (Anyone)"
 * 5. İzinleri onaylayın ve çıkan Web Uygulaması URL'sini kopyalayın.
 * 6. Panelinizdeki "Kulüp Ayarları" ekranına bu URL'yi yapıştırıp kaydedin.
 * ==============================================================================
 */

var DEFAULT_ADMIN_SHA256 = 'a6d6e2883baa41d3a082dd48dbd7b7c22dbc74b81b8b98eae2c600dd9a114d15';

var COACH_PROFILES = {
  'futbol': {
    hashes: ['6fe09b3e3b2094a56fa7ff4fe46c42b8f97d117147886c016deb3ed6b65e7671', '138dffff330acd521e5ca2afc441e082c22d38797e24bc5f37f26afd7cab1ee9'],
    branch: 'Futbol', icon: '⚽', title: 'Futbol Antrenörü', email: 'futbol@mulksporkulubu.com'
  },
  'voleybol': {
    hashes: ['8cfb15225c20f09aac4adfa0a5d85084cad9a35eef2dcdc1ff2f9416dce104ed', '639ec39a4b0dcaffabb018d4d79498193d9e47789bc8f7ba408144b894e8659d'],
    branch: 'Voleybol', icon: '🏐', title: 'Voleybol Antrenörü', email: 'voleybol@mulksporkulubu.com'
  },
  'basketbol': {
    hashes: ['6d51f8c7b21107b0cc54aad67ee106dd2d2eaf04c447057767b7d8fb1a5a5d8ab', '5c726deccb3c7df58a53f6f2432606b6977494b78be01c16934d0ac63eb0bfff'],
    branch: 'Basketbol', icon: '🏀', title: 'Basketbol Antrenörü', email: 'basketbol@mulksporkulubu.com'
  },
  'jimnastik': {
    hashes: ['7ba9aac979de5617a7547d62ce39d36e6952e509d08d9a7ba11357769d01e51e', 'a84847c709803abeea908459d88c2a41181061b09f3ee13efccd818328c52489'],
    branch: 'Jimnastik', icon: '🤸', title: 'Jimnastik Antrenörü', email: 'jimnastik@mulksporkulubu.com'
  },
  'okculuk': {
    hashes: ['a104fa8a7b2fca4cb5f7fd1fb8f96b9e6af8882384b550a6aef251f87e22d0fc', '7916861f86b629fde384b71a0eb78474270943abb75529ef570a8899421987a7'],
    branch: 'Okçuluk', icon: '🏹', title: 'Okçuluk Antrenörü', email: 'okculuk@mulksporkulubu.com'
  },
  'kros': {
    hashes: ['8a769b502d879257177889c44ffd042d489c8d6e9989674e3e7532ee89deccac', 'a853a87973283e7673c64662276b41b9357e3cdf99842d2bdfac4d7855b8eeb7'],
    branch: 'Kros', icon: '🏃', title: 'Kros & Kondisyon Antrenörü', email: 'kros@mulksporkulubu.com'
  }
};

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
  if (action === 'ping') {
    return jsonResponse({
      ok: true,
      service: 'MÜLK Spor Kulübü Bulut Veritabanı',
      version: '2.0',
      timestamp: new Date().toISOString()
    });
  }
  return jsonResponse({ ok: false, error: 'Kişisel veriler güvenlik gereği yalnızca şifreli POST oturumu ile iletilir.' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Boş istek gövdesi.' });
    }
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || '';

    // 1. HERKESE AÇIK YAZMA: QR Kayıt Formu ve Web Ön Kayıt (Yalnızca yazma hakkı, okuma yok)
    if (action === 'public_add_lead') {
      return handlePublicAddLead(payload.lead || payload);
    }

    // 2. SUNUCU TARAFLI KİMLİK DOĞRULAMA
    if (action === 'login') {
      return handleLogin(payload);
    }

    // 3. KORUMALI İŞLEMLER (Geçerli Oturum Token'ı Zorunlu)
    var session = verifyToken(payload.token);
    if (!session) {
      return jsonResponse({ ok: false, authError: true, error: 'Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.' });
    }

    if (action === 'sync_all') {
      return handleSyncAll(session, payload);
    }

    if (action === 'save_attendance') {
      return handleSaveAttendance(session, payload);
    }

    // Yalnızca Yönetici (Admin) Yetkisi Gerektiren İşlemler
    if (session.role !== 'admin') {
      return jsonResponse({ ok: false, error: 'Bu işlem için Yönetici yetkisi gereklidir.' });
    }

    if (action === 'save_athletes') {
      writeSheetObjects('Sporcular', ['id', 'name', 'birthDate', 'age', 'school', 'branch', 'parent', 'phone', 'email', 'refCode', 'fee', 'status', 'payDate', 'kvkkDate', 'notes', 'updatedAt'], payload.athletes || []);
      return jsonResponse({ ok: true });
    }

    if (action === 'save_leads') {
      var normalizedLeads = (payload.leads || []).map(function(l) {
        return {
          id: l.id,
          name: l.name || '',
          age: l.age || '',
          birthDate: l.birthDate || '',
          branch: l.branch || '',
          school: l.school || '',
          parent: l.parent || '',
          phone: l.phone || '',
          email: l.email || '',
          notes: (typeof l.notes === 'object' && l.notes !== null) ? JSON.stringify(l.notes) : (l.notes || ''),
          source: l.source || '',
          date: l.date || '',
          status: l.status || 'Yeni',
          updatedAt: l.updatedAt || new Date().toISOString()
        };
      });
      writeSheetObjects('Adaylar_CRM', ['id', 'name', 'age', 'birthDate', 'branch', 'school', 'parent', 'phone', 'email', 'notes', 'source', 'date', 'status', 'updatedAt'], normalizedLeads);
      return jsonResponse({ ok: true });
    }

    if (action === 'save_schools') {
      writeSheetObjects('Okullar_Branslar', ['id', 'name', 'district', 'address', 'phone', 'branchesJson', 'updatedAt'], (payload.schools || []).map(function(s) {
        return {
          id: s.id,
          name: s.name,
          district: s.district,
          address: s.address || '',
          phone: s.phone || '',
          branchesJson: JSON.stringify(s.branches || []),
          updatedAt: new Date().toISOString()
        };
      }));
      return jsonResponse({ ok: true });
    }

    if (action === 'change_admin_password') {
      return handleChangeAdminPassword(payload);
    }

    if (action === 'fetch_gmail') {
      return jsonResponse({ ok: true, emails: readRecentGmailMessages() });
    }

    return jsonResponse({ ok: false, error: 'Bilinmeyen işlem: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/* ==================== KİMLİK DOĞRULAMA & GÜVENLİK ==================== */

function getServerSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('MULK_SERVER_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('MULK_SERVER_SECRET', secret);
  }
  return secret;
}

function getAdminHash() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('MULK_ADMIN_SHA256') || DEFAULT_ADMIN_SHA256;
}

function getTokenVersion() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('MULK_TOKEN_VER') || '1';
}

function sha256Hex(str) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    if (h.length === 1) h = '0' + h;
    out += h;
  }
  return out;
}

function signToken(sessionObj) {
  var jsonStr = JSON.stringify(sessionObj);
  var b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(jsonStr).getBytes());
  var sigBytes = Utilities.computeHmacSha256Signature(b64, getServerSecret());
  var sigB64 = Utilities.base64EncodeWebSafe(sigBytes);
  return b64 + '.' + sigB64;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var b64 = parts[0];
  var sig = parts[1];
  var expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(b64, getServerSecret()));
  if (sig !== expectedSig) return null;
  try {
    var jsonStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString();
    var obj = JSON.parse(jsonStr);
    if (!obj || !obj.exp || Date.now() > obj.exp) return null;
    if (obj.ver !== getTokenVersion()) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function handleLogin(payload) {
  var rawUser = String(payload.username || '').trim().toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace('@mulksporkulubu.com', '').trim();
  var pass = String(payload.password || '').trim();
  var passHash = sha256Hex(pass);

  var ttlMs = payload.remember ? (7 * 24 * 60 * 60 * 1000) : (12 * 60 * 60 * 1000);
  var ver = getTokenVersion();

  if (rawUser === 'info' && passHash === getAdminHash()) {
    var adminSession = {
      role: 'admin',
      user: 'info',
      ver: ver,
      exp: Date.now() + ttlMs
    };
    return jsonResponse({
      ok: true,
      role: 'admin',
      token: signToken(adminSession)
    });
  }

  var coachKey = rawUser;
  if (coachKey === 'okçuluk') coachKey = 'okculuk';
  if (coachKey === 'cimnastik') coachKey = 'jimnastik';

  var coach = COACH_PROFILES[coachKey];
  if (coach && coach.hashes.indexOf(passHash) !== -1) {
    var coachSession = {
      role: 'coach',
      coachKey: coachKey,
      branch: coach.branch,
      icon: coach.icon,
      title: coach.title,
      email: coach.email,
      ver: ver,
      exp: Date.now() + ttlMs
    };
    return jsonResponse({
      ok: true,
      role: 'coach',
      coachKey: coachKey,
      branch: coach.branch,
      icon: coach.icon,
      title: coach.title,
      email: coach.email,
      token: signToken(coachSession)
    });
  }

  return jsonResponse({ ok: false, error: 'Kullanıcı adı veya parola hatalı.' });
}

function handleChangeAdminPassword(payload) {
  var newPass = String(payload.newPassword || '').trim();
  if (!newPass || newPass.length < 6) {
    return jsonResponse({ ok: false, error: 'Parola en az 6 karakter olmalıdır.' });
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('MULK_ADMIN_SHA256', sha256Hex(newPass));
  var nextVer = String(parseInt(getTokenVersion(), 10) + 1);
  props.setProperty('MULK_TOKEN_VER', nextVer);
  var newSession = { role: 'admin', user: 'info', ver: nextVer, exp: Date.now() + (12 * 60 * 60 * 1000) };
  return jsonResponse({ ok: true, token: signToken(newSession) });
}

/* ==================== E-TABLO VERİTABANI İŞLEMLERİ ==================== */

function getClubSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('MULK_SPREADSHEET_ID');
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {}
  }
  ss = SpreadsheetApp.create('MÜLK Spor Kulübü Bulut Veritabanı');
  props.setProperty('MULK_SPREADSHEET_ID', ss.getId());
  return ss;
}

function getOrCreateSheet(name, headers) {
  var ss = getClubSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f5f9');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function readSheetObjects(name, headers) {
  var sheet = getOrCreateSheet(name, headers);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var cols = values[0];
  var list = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0] && row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < cols.length; c++) {
      var cell = row[c];
      if (cell instanceof Date) {
        obj[cols[c]] = Utilities.formatDate(cell, 'Europe/Istanbul', cols[c] === 'updatedAt' ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
      } else {
        obj[cols[c]] = (cell === undefined || cell === null) ? '' : String(cell);
      }
    }
    list.push(obj);
  }
  return list;
}

function writeSheetObjects(name, headers, items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateSheet(name, headers);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f5f9');
    if (items && items.length > 0) {
      var rows = items.map(function(item) {
        return headers.map(function(h) {
          var v = item[h];
          if (h === 'updatedAt' && !v) return new Date().toISOString();
          return (v === undefined || v === null) ? '' : String(v);
        });
      });
      sheet.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }
}

function handlePublicAddLead(lead) {
  if (!lead || !lead.name || !lead.phone) {
    return jsonResponse({ ok: false, error: 'Sporcu adı ve telefon zorunludur.' });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var leadId = String(lead.id || ('LEAD-' + Date.now()));
  try {
    var headers = ['id', 'name', 'age', 'birthDate', 'branch', 'school', 'parent', 'phone', 'email', 'notes', 'source', 'date', 'status', 'updatedAt'];
    var sheet = getOrCreateSheet('Adaylar_CRM', headers);
    var notesVal = lead.notes || '';
    if (typeof notesVal === 'object') {
      notesVal = JSON.stringify(notesVal);
    } else if (typeof notesVal === 'string' && notesVal.trim() !== '') {
      notesVal = JSON.stringify([{
        type: lead.source || 'Web Formu',
        text: notesVal.trim().slice(0, 500),
        date: Utilities.formatDate(new Date(), 'Europe/Istanbul', 'dd.MM.yyyy')
      }]);
    }
    var row = [
      leadId,
      String(lead.name || '').slice(0, 120),
      String(lead.age || 'Gelişim Grubu').slice(0, 40),
      String(lead.birthDate || '').slice(0, 30),
      String(lead.branch || 'Genel').slice(0, 50),
      String(lead.school || '').slice(0, 120),
      String(lead.parent || '').slice(0, 120),
      String(lead.phone || '').slice(0, 40),
      String(lead.email || '').slice(0, 120),
      String(notesVal).slice(0, 1000),
      String(lead.source || 'Web Formu').slice(0, 80),
      String(lead.date || Utilities.formatDate(new Date(), 'Europe/Istanbul', 'dd.MM.yyyy')),
      String(lead.status || 'Yeni'),
      new Date().toISOString()
    ];
    // En yeni kayıt 2. satıra eklenir
    if (sheet.getLastRow() <= 1 && sheet.getMaxRows() < 2) {
      sheet.appendRow(row);
      sheet.getRange(sheet.getLastRow(), 1, 1, headers.length).setNumberFormat('@');
    } else {
      sheet.insertRowBefore(2);
      sheet.getRange(2, 1, 1, headers.length).setNumberFormat('@').setValues([row]);
    }
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, id: leadId });
}

function handleSaveAttendance(session, payload) {
  var records = payload.records || [];
  if (!records || records.length === 0) {
    return jsonResponse({ ok: false, error: 'Kaydedilecek yoklama verisi bulunamadı.' });
  }
  var headers = ['key', 'date', 'branch', 'id', 'athleteName', 'status', 'note', 'coachName', 'updatedAt'];
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var existing = readSheetObjects('Yoklama', headers);
    var map = {};
    existing.forEach(function(item) {
      if (item.key) map[item.key] = item;
    });

    records.forEach(function(rec) {
      // Antrenör yalnızca kendi branşını kaydedebilir
      var targetBranch = (session.role === 'coach') ? session.branch : (rec.branch || 'Genel');
      var dateStr = String(rec.date || Utilities.formatDate(new Date(), 'Europe/Istanbul', 'yyyy-MM-dd'));
      var athId = String(rec.id || '');
      if (!athId) return;
      var key = dateStr + '__' + athId;
      map[key] = {
        key: key,
        date: dateStr,
        branch: targetBranch,
        id: athId,
        athleteName: String(rec.athleteName || ''),
        status: String(rec.status || 'Geldi'),
        note: String(rec.note || ''),
        coachName: (session.role === 'coach') ? session.title : 'Yönetici (info)',
        updatedAt: new Date().toISOString()
      };
    });

    var merged = Object.keys(map).map(function(k) { return map[k]; });
    // Tarihe göre yeniden eskiye sırala
    merged.sort(function(a, b) {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    var sheet = getOrCreateSheet('Yoklama', headers);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f5f9');
    if (merged.length > 0) {
      var rows = merged.map(function(m) {
        return headers.map(function(h) { return m[h] || ''; });
      });
      sheet.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
    }

    var visibleAtt = merged;
    if (session.role === 'coach') {
      visibleAtt = merged.filter(function(m) {
        return (m.branch || '').toLowerCase().indexOf(session.branch.toLowerCase()) !== -1;
      });
    }
    return jsonResponse({ ok: true, attendance: visibleAtt });
  } finally {
    lock.releaseLock();
  }
}

function handleSyncAll(session, payload) {
  var athletes = readSheetObjects('Sporcular', ['id', 'name', 'birthDate', 'age', 'school', 'branch', 'parent', 'phone', 'email', 'refCode', 'fee', 'status', 'payDate', 'kvkkDate', 'notes', 'updatedAt']);
  var attendance = readSheetObjects('Yoklama', ['key', 'date', 'branch', 'id', 'athleteName', 'status', 'note', 'coachName', 'updatedAt']);
  var schoolsRaw = readSheetObjects('Okullar_Branslar', ['id', 'name', 'district', 'address', 'phone', 'branchesJson', 'updatedAt']);

  var schools = schoolsRaw.map(function(s) {
    var branches = [];
    try { branches = JSON.parse(s.branchesJson || '[]'); } catch (e) {}
    return { id: s.id, name: s.name, district: s.district, address: s.address || '', phone: s.phone || '', branches: branches };
  });

  if (session.role === 'coach') {
    var branchLower = session.branch.toLowerCase();
    var filteredAthletes = athletes.filter(function(a) {
      return (a.branch || '').toLowerCase().indexOf(branchLower) !== -1;
    }).map(function(a) {
      // KVKK: Antrenöre yalnızca sporcu adı, yaş, branş, okul, acil veli/telefon ve sağlık/özel durum notu görünür; aidat/ücret bilgisi gizlenir
      return {
        id: a.id, name: a.name, age: a.age, school: a.school, branch: a.branch,
        parent: a.parent, phone: a.phone, notes: a.notes || '', status: 'Gizli'
      };
    });
    var filteredAtt = attendance.filter(function(att) {
      return (att.branch || '').toLowerCase().indexOf(branchLower) !== -1;
    });
    return jsonResponse({
      ok: true,
      role: 'coach',
      athletes: filteredAthletes,
      attendance: filteredAtt,
      leads: [],
      schools: schools,
      emails: [],
      serverTime: new Date().toISOString()
    });
  }

  // Admin için tüm veriler
  var leadsRaw = readSheetObjects('Adaylar_CRM', ['id', 'name', 'age', 'birthDate', 'branch', 'school', 'parent', 'phone', 'email', 'notes', 'source', 'date', 'status', 'updatedAt']);
  var leads = leadsRaw.map(function(l) {
    if (l.notes && typeof l.notes === 'string') {
      try {
        var parsed = JSON.parse(l.notes);
        if (Array.isArray(parsed)) l.notes = parsed;
      } catch (e) {
        if (l.notes.trim() !== '') {
          l.notes = [{ type: l.source || 'Not', text: l.notes, date: l.date || '' }];
        } else {
          l.notes = [];
        }
      }
    } else if (!l.notes) {
      l.notes = [];
    }
    return l;
  });
  var gmailEmails = [];
  if (payload && payload.includeGmail) {
    gmailEmails = readRecentGmailMessages();
  }

  return jsonResponse({
    ok: true,
    role: 'admin',
    athletes: athletes,
    leads: leads,
    attendance: attendance,
    schools: schools,
    emails: gmailEmails,
    serverTime: new Date().toISOString()
  });
}

function readRecentGmailMessages() {
  var list = [];
  try {
    var threads = GmailApp.getInboxThreads(0, 15);
    for (var i = 0; i < threads.length; i++) {
      var msgs = threads[i].getMessages();
      var lastMsg = msgs[msgs.length - 1];
      var fromRaw = lastMsg.getFrom() || '';
      var fromName = fromRaw;
      var fromEmail = fromRaw;
      var match = fromRaw.match(/^(.*?)<(.+?)>$/);
      if (match) {
        fromName = match[1].replace(/"/g, '').trim() || match[2];
        fromEmail = match[2].trim();
      }
      list.push({
        id: 'GMAIL-' + lastMsg.getId(),
        account: 'mulksporkulubu@gmail.com',
        folder: 'inbox',
        fromName: fromName,
        fromEmail: fromEmail,
        to: lastMsg.getTo() || 'mulksporkulubu@gmail.com',
        subject: lastMsg.getSubject() || '(Konu Yok)',
        date: Utilities.formatDate(lastMsg.getDate(), 'Europe/Istanbul', 'dd.MM.yyyy HH:mm'),
        unread: lastMsg.isUnread(),
        starred: lastMsg.isStarred(),
        athleteName: '',
        body: (lastMsg.getPlainBody() || '').slice(0, 3000)
      });
    }
  } catch (e) {
    // Gmail izni verilmemişse sessizce boş dön
  }
  return list;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
