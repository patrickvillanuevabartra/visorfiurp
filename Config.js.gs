/**
 * ============================================================================
 *  PROXY QUINTADB  —  Google Apps Script
 *  Aplicativo: ALERTA NORMATIVA — Facultad de Ingeniería URP
 * ============================================================================
 *
 *  ARQUITECTURA
 *    Navegador (index.html)  →  este Apps Script (proxy)  →  QuintaDB
 *
 *  QUÉ HACE
 *    - Reenvía a QuintaDB las operaciones del frontend (listar, crear,
 *      actualizar, eliminar) traduciendo nombres de campo -> field_id.
 *    - La API key NUNCA llega al navegador: vive en Propiedades del Script.
 *    - Resuelve el CORS (el navegador no puede llamar a quintadb.com directo).
 *    - Conserva las 3 funciones del backend original que NO dependían de Sheets:
 *        (1) Correo de alerta cuando una norma pasa a riesgo inminente/crítico.
 *        (2) Subida de archivos adjuntos a Google Drive.
 *        (3) Página compartible ?noticia=ID  (ahora leyendo de QuintaDB).
 *
 *  CONFIGURACIÓN (una sola vez)
 *    1. script.google.com -> Nuevo proyecto -> pega este archivo como Codigo.gs
 *    2. Engranaje (Configuración) -> Propiedades del script -> Agregar:
 *         REST_API_KEY = (tu clave de QuintaDB — ROTA la que pegaste en el chat)
 *    3. Crea un archivo HTML llamado "index" y pega ahí el index.html adaptado.
 *    4. Implementar -> Nueva implementación -> Aplicación web:
 *         Ejecutar como: Yo    |    Quién tiene acceso: Cualquier usuario
 *    5. Copia la URL /exec  (esa es la PROXY_URL del frontend).
 * ============================================================================
 */

// ====== CONFIGURACIÓN ========================================================
var QUINTA_BASE = 'https://quintadb.com';
var APP_ID      = 'bxW5nYl8nlkOokW4JcMfb2';
var ENTITY_ID   = 'dcTSkFW5jdLPVdQSo-WQT8';   // tabla "Alertas" (URP)

// Carpeta de Drive donde se guardan los adjuntos (la misma del original).
var DRIVE_FOLDER_ID = '1rYHfTiHCKmY-zHRQK6sWSop1RvX75J4d';

// Hoja de Usuarios para los destinatarios del correo de alerta.
// (Se mantiene en Google Sheets; el proxy ya corre con permisos de Gmail.)
var USUARIOS_SHEET_ID = '1LuW8BZi7ceX7naH7rWmz47fthwJde2xgera_W1Au1p8';

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('REST_API_KEY');
}

// ====== MAPEO nombre <-> field_id (tabla Alertas URP) ========================
// El front trabaja con nombres legibles; QuintaDB exige los field_id internos.
var F = {
  id:                 'bBW6VdRNnjw4ZdO8k5W40S',
  titulo:             'cMgbRcNdfdVRfyWO_dGCoQ',
  rm:                 'cUW6ZdTHTdP6rflmo5W41Z',
  estado:             'cnW4juBmjgW7fCjSkDFbf-',
  riesgo:             'bhW5X6q8jaWPW4mSoZW4rP',
  fecha:              'awW74TASnoeOkKWRzYB8kt',   // tipo Fecha en QuintaDB
  url:                'cCW4BcGSjlxioXArziWRCy',   // tipo URL en QuintaDB
  desc:               'c3W6W9W4PdMikDeSkFlmoP',
  heroTitle:          'ddPSoGoJPdNQddJCo1C8os',
  heroSub:            'cTv8oLW41cPje9CXzYh38u',
  arch:               'aPBsrHsGjmWPJdImoDWRmg',
  disposiciones_json: 'ddJ2tcLfTcIlFdPZhcIhSI',
  riesgoDetalle_json: 'dcJ2hcM0jayOVdJCkxWRjr',
  etiquetas_json:     'ddOWhdUmjopRWSWOVcUePY',
  destacado:          'dcTuXqW7PcO4oTahSEiSkv',
  relacionadas_json:  'cHWQGmW6LaW4VcISojW5qT',
  archivos_json:      'cSrCoNxSjbW5uKfmouy8o5',
  padre_id:           'cpzsldV3bmb6ZdG1tcIerD',
  hora:               'aLW4yjW7TcJOkqh2tdP1SV',
  region:             'dcV8klFx1dU4omW6DlbCk_',
  video:              'dcGCkghgTpiyFdSCkWWPjJ'
};
// Mapa inverso field_id -> nombre, para leer las respuestas de QuintaDB.
var F_INV = (function(){ var o={}; for (var k in F) o[F[k]] = k; return o; })();

// ====== CONVERSIÓN DE FECHA ==================================================
// NOTA: esta instancia de QuintaDB almacena y devuelve la fecha en formato
// d/m/Y (ej. "25/6/2026"), el MISMO que usa el front. Por eso la conversión
// es prácticamente passthrough; se normaliza por robustez ante otros formatos.
function fechaToQuinta(s) {                 // front (d/m/Y) -> QuintaDB (d/m/Y)
  if (!s) return '';
  s = String(s).trim();
  var m;
  // Si llega como Y-m-d lo pasamos a d/m/Y; si ya es d/m/Y lo dejamos igual.
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))
    return parseInt(m[3],10)+'/'+parseInt(m[2],10)+'/'+m[1];
  return s;
}
function fechaFromQuinta(s) {               // QuintaDB -> front (d/m/Y)
  if (!s) return '';
  s = String(s).trim();
  var m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))        // Y-m-d -> d/m/Y
    return parseInt(m[3],10)+'/'+parseInt(m[2],10)+'/'+m[1];
  if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/))) // d/m/Y o d.m.Y
    return parseInt(m[1],10)+'/'+parseInt(m[2],10)+'/'+m[3];
  return s;
}

// ====== ROUTER PRINCIPAL =====================================================
function doGet(e) {
  var params = e.parameter;
  var cb = params.callback || '_cb';

  // Página compartible de una noticia (no usa JSONP, devuelve HTML).
  if (params.noticia) return renderNoticia(params.noticia);

  if (params.eliminar) {
    return jsonp(cb, withLock(function(){ return eliminarNorma(String(params.eliminar)); }));
  }
  if (params.actualizar) {
    return jsonp(cb, withLock(function(){
      var norma = JSON.parse(decodeURIComponent(params.actualizar));
      var riesgoAnterior = params.riesgoAnterior || '';
      var r = actualizarNorma(norma);
      if (r.ok) verificarYEnviarAlerta(norma, riesgoAnterior);
      return r;
    }));
  }
  if (params.payload) {
    return jsonp(cb, withLock(function(){
      var norma = JSON.parse(decodeURIComponent(params.payload));
      return guardarNorma(norma);
    }));
  }
  if (params.callback) {                    // listar todas
    return jsonp(cb, obtenerNormas());
  }

  // Sin parámetros: sirve el portal (index.html).
  var tpl = HtmlService.createTemplateFromFile('index');
  tpl.PROXY_URL = ScriptApp.getService().getUrl();
  tpl.ABRIR_NOTICIA = params.abrir || '';
  return tpl.evaluate()
    .setTitle('Alerta Normativa — Facultad de Ingeniería URP')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

// doPost: para subir archivos adjuntos (multipart no cabe en GET).
function doPost(e) {
  var cb = (e.parameter && e.parameter.callback) || '_cb';
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.accion === 'subirArchivo') {
      return jsonp(cb, subirArchivoDrive(data.nombre, data.mime, data.base64));
    }
    return jsonp(cb, {ok:false, error:'acción no reconocida'});
  } catch (ex) {
    return jsonp(cb, {ok:false, error:String(ex)});
  }
}

function jsonp(cb, obj) {
  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(obj) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ====== LLAMADAS A QUINTADB ==================================================
function quintaFetch(url, method, payloadObj) {
  var opts = {
    method: method || 'get',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(payloadObj || {})
  };
  // QuintaDB acepta la api_key dentro del cuerpo JSON.
  if (!payloadObj) opts.payload = JSON.stringify({rest_api_key: getApiKey()});
  else { payloadObj.rest_api_key = getApiKey(); opts.payload = JSON.stringify(payloadObj); }
  var resp = UrlFetchApp.fetch(url, opts);
  var code = resp.getResponseCode();
  var txt = resp.getContentText();
  try { return {code:code, json: JSON.parse(txt)}; }
  catch (ex) { return {code:code, json:null, raw:txt}; }
}

// Construye el objeto de valores {field_id: valor} para crear/actualizar.
function normaToQuintaValues(norma) {
  function J(v){ return JSON.stringify(v || ([] )); }
  var vals = {};
  vals[F.id]                 = String(norma.id || '');
  vals[F.titulo]             = norma.titulo || '';
  vals[F.rm]                 = norma.rm || '';
  vals[F.estado]             = norma.estado || '';
  vals[F.riesgo]             = norma.riesgo || '';
  vals[F.fecha]              = fechaToQuinta(norma.fecha || '');
  vals[F.url]                = norma.url || '';
  vals[F.desc]               = norma.desc || '';
  vals[F.heroTitle]          = norma.heroTitle || norma.titulo || '';
  vals[F.heroSub]            = norma.heroSub || '';
  vals[F.arch]               = norma.arch ? 'TRUE' : 'FALSE';
  vals[F.disposiciones_json] = JSON.stringify(norma.disposiciones || []);
  vals[F.riesgoDetalle_json] = JSON.stringify(norma.riesgoDetalle || {});
  vals[F.etiquetas_json]     = JSON.stringify(norma.etiquetas || []);
  vals[F.destacado]          = norma.destacado ? 'TRUE' : 'FALSE';
  vals[F.relacionadas_json]  = JSON.stringify(norma.relacionadas || []);
  vals[F.archivos_json]      = JSON.stringify(norma.archivos || []);
  vals[F.padre_id]           = norma.padreId || '';
  vals[F.hora]               = norma.hora || '';
  vals[F.region]             = norma.region || '';
  vals[F.video]              = norma.video || '';
  return vals;
}

// Convierte un registro de QuintaDB (record) al objeto "norma" del front.
function quintaRecordToNorma(rec) {
  // rec.values es un objeto {field_id: valor} (o array según versión).
  var v = {};
  if (rec.values && !Array.isArray(rec.values)) v = rec.values;
  else if (rec.values && Array.isArray(rec.values)) {
    rec.values.forEach(function(pair){ v[pair[0]] = pair[1]; });
  } else { v = rec; }

  function g(name){ var fid = F[name]; return v[fid] !== undefined ? v[fid] : ''; }
  function PJ(s, fb){ try { return JSON.parse(s); } catch(ex){ return fb; } }

  return {
    quinta_record_id: rec.id || rec.record_id || '',   // id interno QuintaDB (para update/delete)
    id:            String(g('id')),
    titulo:        g('titulo'),
    rm:            g('rm'),
    estado:        g('estado'),
    riesgo:        g('riesgo'),
    fecha:         fechaFromQuinta(g('fecha')),
    url:           g('url'),
    desc:          g('desc'),
    heroTitle:     g('heroTitle'),
    heroSub:       g('heroSub'),
    arch:          g('arch') === 'TRUE' || g('arch') === true,
    disposiciones: PJ(g('disposiciones_json'), []),
    riesgoDetalle: PJ(g('riesgoDetalle_json'), {}),
    etiquetas:     PJ(g('etiquetas_json'), []),
    destacado:     g('destacado') === 'TRUE' || g('destacado') === true,
    relacionadas:  PJ(g('relacionadas_json'), []),
    archivos:      PJ(g('archivos_json'), []),
    padreId:       g('padre_id'),
    hora:          g('hora'),
    region:        g('region'),
    video:         g('video')
  };
}

// ---- LISTAR -----------------------------------------------------------------
// Ruta confirmada para esta instancia de QuintaDB:
//   GET /apps/APP_ID/dtypes/entity/ENTITY_ID.json?rest_api_key=KEY&page=N
// Respuesta: { records:[ { id, values:{field_id:valor}, ... } ] }
function obtenerNormas() {
  var todas = [];
  var page = 1;
  while (page <= 100) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_ID
            + '.json?rest_api_key=' + encodeURIComponent(getApiKey()) + '&page=' + page;
    var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) break;
    var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ break; }
    if (!data.records || !data.records.length) break;
    for (var i=0;i<data.records.length;i++) {
      try { todas.push(quintaRecordToNorma(data.records[i])); } catch(ex){}
    }
    if (data.records.length < 20) break;   // última página (QuintaDB pagina de 20)
    page++;
  }
  todas.sort(function(a,b){ return String(b.id).localeCompare(String(a.id)); });
  return todas;
}

// Busca el id interno de QuintaDB a partir del id propio del aplicativo.
function buscarRecordId(idApp) {
  var page = 1;
  while (page <= 100) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_ID
            + '.json?rest_api_key=' + encodeURIComponent(getApiKey()) + '&page=' + page;
    var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) break;
    var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ break; }
    if (!data.records || !data.records.length) break;
    for (var i=0;i<data.records.length;i++) {
      var n = quintaRecordToNorma(data.records[i]);
      if (String(n.id) === String(idApp)) return n.quinta_record_id;
    }
    if (data.records.length < 20) break;
    page++;
  }
  return null;
}

// Construye el cuerpo form-urlencoded values[field_id]=valor para crear/editar.
function buildFormPayload(norma) {
  var vals = normaToQuintaValues(norma);
  var parts = ['rest_api_key=' + encodeURIComponent(getApiKey())];
  for (var fid in vals) {
    parts.push('values[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(vals[fid]));
  }
  return parts.join('&');
}

// ---- CREAR ------------------------------------------------------------------
function guardarNorma(norma) {
  if (buscarRecordId(norma.id)) return {ok:false, error:'id ya existe'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_ID + '.json';
  var resp = UrlFetchApp.fetch(url, {
    method:'post',
    contentType:'application/x-www-form-urlencoded',
    payload: buildFormPayload(norma),
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:resp.getContentText()};
}

// ---- ACTUALIZAR -------------------------------------------------------------
function actualizarNorma(norma) {
  var recId = buscarRecordId(norma.id);
  if (!recId) return {ok:false, error:'registro no encontrado'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var resp = UrlFetchApp.fetch(url, {
    method:'put',
    contentType:'application/x-www-form-urlencoded',
    payload: buildFormPayload(norma),
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:resp.getContentText()};
}

// ---- ELIMINAR ---------------------------------------------------------------
function eliminarNorma(idApp) {
  var recId = buscarRecordId(idApp);
  if (!recId) return {ok:false, error:'registro no encontrado'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId
          + '.json?rest_api_key=' + encodeURIComponent(getApiKey());
  var resp = UrlFetchApp.fetch(url, {method:'delete', muteHttpExceptions:true});
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:resp.getContentText()};
}

// ====== (2) ARCHIVOS EN DRIVE ===============================================
function subirArchivoDrive(nombre, mime, base64) {
  try {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, nombre);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {ok:true, nombre:nombre, viewUrl:'https://drive.google.com/file/d/'+file.getId()+'/view'};
  } catch (ex) {
    return {ok:false, error:String(ex)};
  }
}

// ====== (1) CORREO DE ALERTA ================================================
// Igual que el original, pero sin el badge de "área" (eliminado en URP).
function verificarYEnviarAlerta(norma, riesgoAnterior) {
  var riesgoNuevo = norma.riesgo || '';
  var esAlerta = (riesgoNuevo === 'inminente' || riesgoNuevo === 'critico');
  var cambio = (riesgoAnterior !== riesgoNuevo);
  if (!esAlerta || !cambio) return;
  var emails = getEmailsDestinatarios();
  if (!emails.length) return;

  var portalUrl = ScriptApp.getService().getUrl();
  var rd = norma.riesgoDetalle || {};
  var nivelLabel = riesgoNuevo === 'inminente' ? 'RIESGO INMINENTE' : 'RIESGO CR&Iacute;TICO';
  var nivelLabelPlain = riesgoNuevo === 'inminente' ? 'RIESGO INMINENTE' : 'RIESGO CRITICO';
  var nivelColor = riesgoNuevo === 'critico' ? '#DC2626' : '#EA580C';
  var nivelBg = riesgoNuevo === 'critico' ? '#FEE2E2' : '#FFF7ED';
  var asunto = '[ALERTA ' + nivelLabelPlain + '] ' + norma.titulo;

  var h = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>';
  h += '<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif;">';
  h += '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">';
  h += '<table width="640" style="max-width:640px;width:100%;">';
  h += '<tr><td style="background:linear-gradient(135deg,#0A2342,#13417a);border-radius:14px 14px 0 0;padding:24px 28px;">';
  h += '<div style="font-size:12px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Alerta Normativa &mdash; Facultad de Ingenier&iacute;a &mdash; URP</div>';
  h += '<div style="font-size:24px;font-weight:700;color:white;line-height:1.3;">'+norma.titulo+'</div>';
  h += '</td></tr>';
  h += '<tr><td style="background:'+nivelBg+';border-left:6px solid '+nivelColor+';padding:18px 28px;">';
  h += '<div style="font-size:22px;font-weight:700;color:'+nivelColor+';">&#9888; '+nivelLabel+'</div>';
  h += '<div style="font-size:14px;color:#64748B;margin-top:5px;">Universidad Ricardo Palma &mdash; Facultad de Ingenier&iacute;a</div>';
  h += '</td></tr>';
  h += '<tr><td style="background:white;padding:24px 28px;">';
  h += '<div style="margin-bottom:18px;">';
  if (norma.rm) h += '<span style="background:#EFF6FF;color:#0284c7;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;display:inline-block;margin-right:6px;">Fuente: '+norma.rm+'</span>';
  h += '<span style="background:#EFF6FF;color:#0284c7;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;display:inline-block;">'+norma.fecha+(norma.hora?' '+norma.hora:'')+'</span>';
  if (norma.region) h += '<span style="background:#E0F2FE;color:#0369A1;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;display:inline-block;margin-left:6px;">'+norma.region+'</span>';
  h += '</div>';
  if (norma.desc) {
    h += '<div style="margin-bottom:20px;"><div style="font-size:12px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;border-left:3px solid #CBD5E1;padding-left:10px;margin-bottom:10px;">Descripci&oacute;n</div>';
    h += '<div style="font-size:16px;color:#334155;line-height:1.7;background:#F8FAFC;border-radius:8px;padding:16px;">'+norma.desc+'</div></div>';
  }
  var ds = norma.disposiciones || [];
  if (ds.length) {
    h += '<div style="margin-bottom:20px;"><div style="font-size:12px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;border-left:3px solid #CBD5E1;padding-left:10px;margin-bottom:10px;">Disposiciones principales</div>';
    for (var i=0;i<ds.length;i++) {
      h += '<div style="background:#F0FDF4;border-left:4px solid #059669;border-radius:0 8px 8px 0;padding:13px 16px;margin-bottom:9px;">';
      h += '<div style="font-size:16px;font-weight:700;color:#0A2342;">'+(i+1)+'. '+ds[i].t+'</div>';
      if (ds[i].d) h += '<div style="font-size:14px;color:#475569;margin-top:5px;line-height:1.6;">'+ds[i].d+'</div>';
      h += '</div>';
    }
    h += '</div>';
  }
  h += '<div style="margin-bottom:20px;"><div style="font-size:12px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:1px;border-left:3px solid '+nivelColor+';padding-left:10px;margin-bottom:10px;">An&aacute;lisis de riesgo</div>';
  h += '<div style="background:'+nivelBg+';border-left:4px solid '+nivelColor+';border-radius:0 10px 10px 0;padding:16px 18px;">';
  h += '<div style="font-size:18px;font-weight:700;color:'+nivelColor+';margin-bottom:10px;">Nivel: '+nivelLabel+'</div>';
  if (rd.conflicto) h += '<div style="font-size:15px;color:#334155;margin-bottom:10px;line-height:1.7;background:rgba(255,255,255,0.6);border-radius:6px;padding:10px 12px;"><strong>Descripci&oacute;n del riesgo:</strong> '+rd.conflicto+'</div>';
  if (rd.focos && rd.focos.length) {
    h += '<div style="margin-bottom:10px;"><strong style="font-size:14px;color:#334155;">Actores:</strong><br>';
    for (var f2=0;f2<rd.focos.length;f2++) h += '<span style="display:inline-block;background:#FEE2E2;color:#A32D2D;padding:5px 13px;border-radius:20px;font-size:13px;font-weight:700;margin:3px;">'+rd.focos[f2]+'</span>';
    h += '</div>';
  }
  if (rd.acrecom) h += '<div style="font-size:15px;color:#334155;background:#FEF9C3;border-radius:6px;padding:12px 14px;line-height:1.7;"><strong>Acci&oacute;n recomendada:</strong> '+rd.acrecom+'</div>';
  h += '</div></div>';
  if (norma.url) h += '<div style="margin-bottom:20px;"><a href="'+norma.url+'" style="color:#0284c7;font-size:15px;word-break:break-all;">'+norma.url+'</a></div>';
  h += '<div style="text-align:center;margin-top:14px;padding-top:14px;border-top:1px solid #E2E8F0;">';
  h += '<a href="'+portalUrl+'?abrir='+norma.id+'" style="display:inline-block;background:#0A2342;color:white;padding:15px 36px;border-radius:10px;font-size:18px;font-weight:700;text-decoration:none;">Ver en el Portal</a></div>';
  h += '</td></tr>';
  h += '<tr><td style="background:#F1F5F9;border-radius:0 0 14px 14px;padding:16px 28px;text-align:center;">';
  h += '<div style="font-size:13px;color:#94A3B8;">Universidad Ricardo Palma &mdash; Facultad de Ingenier&iacute;a</div></td></tr>';
  h += '</table></td></tr></table></body></html>';

  try { GmailApp.sendEmail(emails.join(','), asunto, '', {htmlBody: h}); }
  catch (ex) { Logger.log('Error correo: ' + ex.toString()); }
}

function getEmailsDestinatarios() {
  try {
    var ss = SpreadsheetApp.openById(USUARIOS_SHEET_ID);
    var sheet = ss.getSheetByName('Usuarios');
    if (!sheet) return [];
    var rows = sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues();
    var emails = [];
    for (var i=0;i<rows.length;i++) {
      var rol = String(rows[i][4]).trim(), activo = rows[i][7], email = String(rows[i][6]).trim();
      // Ajusta aquí los roles destinatarios para la URP si cambian.
      if ((rol==='esp.oaipcs'||rol==='oaipcs'||rol==='coordinador'||rol==='decanato') &&
          (activo===true||activo==='TRUE') && email) emails.push(email);
    }
    return emails;
  } catch (ex) { Logger.log('Error usuarios: '+ex.toString()); return []; }
}

// ====== (3) PÁGINA COMPARTIBLE ?noticia=ID (lee de QuintaDB) =================
function renderNoticia(id) {
  var normas = obtenerNormas();
  var n = null;
  for (var i=0;i<normas.length;i++) if (String(normas[i].id) === String(id)) { n = normas[i]; break; }
  var portalUrl = ScriptApp.getService().getUrl();
  if (!n) return HtmlService.createHtmlOutput('<meta http-equiv="refresh" content="0;url='+portalUrl+'">');

  var titulo = n.titulo || 'Alerta Normativa';
  var desc = n.desc || '';
  var fuente = n.rm || '', fecha = n.fecha || '', hora = n.hora || '', region = n.region || '';
  var ri = {bajo:'Riesgo Bajo',intermedio:'Riesgo Intermedio',inminente:'Riesgo Inminente',critico:'Riesgo Cr\u00EDtico'};
  var riesgoLabel = ri[n.riesgo] || '';
  var rd = n.riesgoDetalle || {}, ds = n.disposiciones || [];
  var imgUrl = 'https://www.urp.edu.pe/assets/images/logo-urp.png';
  var hijos = normas.filter(function(x){ return String(x.padreId) === String(id) && !x.arch; });

  var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<meta property="og:type" content="article">';
  html += '<meta property="og:title" content="'+titulo.replace(/"/g,'&quot;')+'">';
  html += '<meta property="og:description" content="'+desc.replace(/"/g,'&quot;').substring(0,200)+'">';
  html += '<meta property="og:image" content="'+imgUrl+'">';
  html += '<meta property="og:url" content="'+portalUrl+'?noticia='+id+'">';
  html += '<meta property="og:site_name" content="Alerta Normativa — FIA URP">';
  html += '<meta name="twitter:card" content="summary_large_image">';
  html += '<title>'+titulo+'</title>';
  html += '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">';
  html += '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"IBM Plex Sans",sans-serif;background:#CBD5E1;padding:20px 16px;min-height:100vh;}';
  html += '.card{background:white;border-radius:16px;box-shadow:0 20px 48px -8px rgba(0,0,0,0.22);max-width:640px;margin:0 auto;overflow:hidden;}';
  html += '.hdr{background:linear-gradient(135deg,#0A2342,#13417a);padding:20px 24px;}';
  html += '.hdr-org{font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;}';
  html += '.hdr-title{font-size:22px;font-weight:700;color:white;line-height:1.35;}';
  html += '.body{padding:20px 24px;display:flex;flex-direction:column;gap:16px;}';
  html += '.meta-row{display:flex;flex-wrap:wrap;gap:7px;}';
  html += '.badge{padding:4px 13px;border-radius:20px;font-size:14px;font-weight:600;background:#EFF6FF;color:#0284c7;}';
  html += '.badge.verde{background:#DCFCE7;color:#16A34A;}.badge.amarillo{background:#FEF9C3;color:#D97706;}';
  html += '.stitle{font-size:13px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;}';
  html += '.desc-text{font-size:16px;color:#475569;line-height:1.7;}';
  html += '.disp-item{padding:12px 14px;background:#F8FAFC;border-radius:8px;border-left:3px solid #059669;margin-bottom:7px;}';
  html += '.disp-t{font-size:15px;font-weight:700;color:#0A2342;}.disp-d{font-size:14px;color:#64748B;margin-top:3px;line-height:1.5;}';
  html += '.riesgo-box{padding:14px 16px;border-radius:8px;border-left:4px solid;}';
  html += '.inm{background:#FFF7ED;border-color:#EA580C;}.crit{background:#FEE2E2;border-color:#DC2626;}.inter{background:#FEF9C3;border-color:#D97706;}.bajo{background:#DCFCE7;border-color:#16A34A;}';
  html += '.riesgo-lbl{font-size:15px;font-weight:700;margin-bottom:5px;}.riesgo-txt{font-size:14px;color:#475569;line-height:1.6;margin-top:5px;}';
  html += '.hotspot{display:inline-flex;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;background:#FEE2E2;color:#A32D2D;margin:2px;}';
  html += '.btn-portal{display:block;text-align:center;padding:15px 20px;border-radius:10px;background:#0A2342;color:white;text-decoration:none;font-size:17px;font-weight:700;}';
  html += '.footer{background:#F1F5F9;padding:12px 24px;font-size:13px;color:#94A3B8;text-align:center;}</style></head><body><div class="card">';
  html += '<div class="hdr"><div class="hdr-org">Alerta Normativa &mdash; Facultad de Ingenier&iacute;a &mdash; URP</div><div class="hdr-title">'+titulo+'</div></div>';
  html += '<div class="body"><div class="meta-row">';
  if (fuente) html += '<span class="badge">'+fuente+'</span>';
  if (fecha) html += '<span class="badge">'+fecha+(hora?' '+hora:'')+'</span>';
  if (region) html += '<span class="badge" style="background:#E0F2FE;color:#0369A1;">'+region+'</span>';
  if (n.estado==='consulta') html += '<span class="badge amarillo">En consulta p&uacute;blica</span>';
  if (n.estado==='vigente') html += '<span class="badge verde">Vigente</span>';
  if (n.estado==='derogada') html += '<span class="badge" style="background:#F1F5F9;color:#475569;">Derogada</span>';
  html += '</div>';
  if (desc) html += '<div><div class="stitle">Descripci&oacute;n</div><div class="desc-text">'+desc+'</div></div>';
  if (ds.length) {
    html += '<div><div class="stitle">Disposiciones principales</div>';
    for (var k=0;k<ds.length;k++){ html += '<div class="disp-item"><div class="disp-t">'+(k+1)+'. '+ds[k].t+'</div>'; if (ds[k].d) html += '<div class="disp-d">'+ds[k].d+'</div>'; html += '</div>'; }
    html += '</div>';
  }
  if (rd.conflicto) html += '<div><div class="stitle">Descripci&oacute;n del riesgo</div><div class="desc-text">'+rd.conflicto+'</div></div>';
  if (riesgoLabel) {
    var rCls = n.riesgo==='critico'?'crit':(n.riesgo==='inminente'?'inm':(n.riesgo==='intermedio'?'inter':'bajo'));
    html += '<div><div class="stitle">An&aacute;lisis de riesgo</div><div class="riesgo-box '+rCls+'"><div class="riesgo-lbl">Nivel: '+riesgoLabel+'</div>';
    if (rd.focos&&rd.focos.length){ html += '<div style="margin-top:7px;"><strong style="font-size:13px;color:#64748B;">Actores:</strong><br>'; for (var f=0;f<rd.focos.length;f++) html += '<span class="hotspot">'+rd.focos[f]+'</span>'; html += '</div>'; }
    if (rd.acrecom) html += '<div class="riesgo-txt"><strong>Acci&oacute;n recomendada:</strong> '+rd.acrecom+'</div>';
    html += '</div></div>';
  }
  if (n.archivos&&n.archivos.length) {
    html += '<div><div class="stitle">Archivos adjuntos</div>';
    for (var af=0;af<n.archivos.length;af++) html += '<a href="'+n.archivos[af].viewUrl+'" target="_blank" style="display:flex;align-items:center;gap:9px;padding:10px 13px;background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;text-decoration:none;margin-bottom:6px;color:#1E293B;font-size:15px;font-weight:600;">'+n.archivos[af].nombre+'</a>';
    html += '</div>';
  }
  if (hijos.length) {
    html += '<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:16px;"><div style="font-size:14px;font-weight:700;color:#5B21B6;margin-bottom:12px;">'+hijos.length+' noticia'+(hijos.length>1?'s':'')+' en este hilo</div>';
    for (var hh=0;hh<hijos.length;hh++){ var hijo=hijos[hh]; html += '<div style="background:white;border:1px solid #E2E8F0;border-left:3px solid #8B5CF6;border-radius:8px;padding:12px 14px;margin-bottom:8px;"><div style="font-size:15px;font-weight:700;color:#1E293B;">'+(hh+1)+'. '+hijo.titulo+'</div><div style="font-size:13px;color:#94A3B8;">'+hijo.fecha+(hijo.hora?' '+hijo.hora:'')+(hijo.rm?' &middot; '+hijo.rm:'')+'</div></div>'; }
    html += '</div>';
  }
  if (n.url) html += '<div><div class="stitle">Enlace a la publicaci&oacute;n</div><a href="'+n.url+'" target="_blank" style="color:#0284c7;font-size:15px;word-break:break-all;line-height:1.6;">'+n.url+'</a></div>';
  html += '<a class="btn-portal" href="'+portalUrl+'?abrir='+id+'">Ver en el Portal &rarr;</a>';
  html += '</div><div class="footer">Universidad Ricardo Palma &mdash; Facultad de Ingenier&iacute;a</div></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(titulo).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ====== UTILIDADES DE PRUEBA ================================================
function _test_listar() {
  var n = obtenerNormas();
  Logger.log('Registros: ' + n.length);
  if (n.length) Logger.log(JSON.stringify(n[0], null, 2));
}
function _test_apiKey() {
  Logger.log(getApiKey() ? 'API key OK (longitud '+getApiKey().length+')' : 'FALTA REST_API_KEY en Propiedades del Script');
}