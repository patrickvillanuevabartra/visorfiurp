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
var ENTITY_COM  = 'dcOabkW4LcTykaW77dJ8kb';   // tabla "Comentarios" (URP)
var ENTITY_USR  = 'aBpCk9ssbnW79XWRfmWOmO';   // tabla "Usuarios" (destinatarios de notificaciones)
var ENTITY_TPL  = 'bmcZNdHmjihykyW47dHCkC';   // tabla "Plantillas" (correos editables)

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
  video:              'dcGCkghgTpiyFdSCkWWPjJ',
  likes:              'cmatn1CSjgaOoZmqzplCkJ',
  embed:              'aDCSkof8jhuOoEoh7cMmk5',
  tipo_ro:            'a8bSk-W79cS5XgW4zrmSoQ',
  probabilidad:       'dcPmoxw8jjvOk2qCk3W7jJ',
  impacto:            'besmocW7bdt7u-eSoJq8ou',
  indice_ro:          'ddSxjcW7XcH4kNW7e5d8kk',
  nivel_ro:           'c-W5hdGtjdW4FdI2xdNSoo',
  email:              'dcOsiKocrdM4kswSkbW689',
  likers:             'ddH8oTWOTlxyona8kUaSof'   // <-- campo Texto "likers" en la tabla Alertas
};
// Mapa inverso field_id -> nombre, para leer las respuestas de QuintaDB.
var F_INV = (function(){ var o={}; for (var k in F) o[F[k]] = k; return o; })();

// ====== MAPEO de campos de la tabla Comentarios =============================
var FC = {
  id:       'ddUv_dJCnbiOb6WPz2zxPU',
  norma_id: 'cNfCkrumnfWPpdLmoaCh5x',
  padre_id: 'clEmoetM1mW4lcUqKzWRfs',
  autor:    'dcSge5b8jdD4kLWOtcKXGK',
  texto:    'a-W7lcPvXdKApdNmkQDSkg',
  fecha:    'buWOOhW6PdOykpW4BdPqqK',   // tipo "Fecha y hora", devuelve d/m/Y H:M
  aprobado: 'b9mmkjW71pW5dcHCoLwSk5',
  likes:    'cQgmk9W5XcWQLPW7FdSX1_',
  email:    'dcQq8OB8jgW5DXAComkCkD',
  likers:   'PEGAR_FIELD_ID_LIKERS_COMENTARIOS'   // <-- campo Texto "likers" en la tabla Comentarios
};

// Mapeo de la tabla Usuarios (destinatarios de notificaciones)
var FU = {
  email:  'cdWORcN8nnm4kKnY7dSmkt',
  nombre: 'cyW6FcHtXcWQVdQthdLW4p',
  activo: 'c5qColAHXcQOoLW57cOmky'
};

// Mapeo de la tabla Plantillas (correos editables)
var FT = {
  clave:  'cabmobW7noA4kaWR7dLtvL',
  asunto: 'c0W6eXWOXdMikmWOxcLSkB',
  cuerpo: 'dcNuuOzJ9cWQFcVh95n8oD'
};

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
      // Nota: al EDITAR no reenviamos notificaciones masivas para no saturar.
      // El aviso a usuarios (Tipo 1) se envía solo al CREAR (ver params.payload).
      return r;
    }));
  }
  if (params.payload) {
    return jsonp(cb, withLock(function(){
      var norma = JSON.parse(decodeURIComponent(params.payload));
      return guardarNormaConAvisos(norma);
    }));
  }
  // ---- COMENTARIOS ----
  if (params.com_listar) {                  // listar comentarios de una norma
    return jsonp(cb, obtenerComentarios(String(params.com_listar)));
  }
  if (params.com_conteos) {                 // conteo de comentarios por cada norma
    return jsonp(cb, contarComentariosPorNorma());
  }
  if (params.like_norma) {
    var emN = params.email ? decodeURIComponent(String(params.email)) : '';
    var nmN = params.nombre ? decodeURIComponent(String(params.nombre)) : '';
    return jsonp(cb, withLock(function(){ return toggleLikeNorma(String(params.like_norma), emN, nmN); }));
  }
  if (params.like_comentario) {
    var emC = params.email ? decodeURIComponent(String(params.email)) : '';
    var nmC = params.nombre ? decodeURIComponent(String(params.nombre)) : '';
    return jsonp(cb, withLock(function(){ return toggleLikeComentario(String(params.like_comentario), emC, nmC); }));
  }
  if (params.com_guardar) {
    return jsonp(cb, withLock(function(){
      var com = JSON.parse(decodeURIComponent(params.com_guardar));
      var res = guardarComentario(com);
      if (res && res.ok) {
        var textoCorto = (com.texto || '').substring(0, 200);
        // TIPO 2: avisar a admin del nuevo comentario
        notificarAdmin('Nuevo comentario', '"' + textoCorto + '"', com.autor || com.email);
        // TIPO 3: confirmar al autor (si dejó su correo)
        if (com.email) {
          notificarUsuarioConfirmacion(com.email, 'Comentario', '"' + textoCorto + '"');
        }
      }
      return res;
    }));
  }
  if (params.com_eliminar) {
    return jsonp(cb, withLock(function(){ return eliminarComentario(String(params.com_eliminar)); }));
  }
  if (params.com_editar) {
    return jsonp(cb, withLock(function(){
      var d = JSON.parse(decodeURIComponent(params.com_editar));
      return editarComentario(d.id, d.texto);
    }));
  }

  if (params.usr_listar) {
    return jsonp(cb, listarUsuarios());
  }
  if (params.usr_guardar) {
    return jsonp(cb, withLock(function(){
      var u = JSON.parse(decodeURIComponent(params.usr_guardar));
      return guardarUsuario(u);
    }));
  }
  if (params.usr_eliminar) {
    return jsonp(cb, withLock(function(){ return eliminarUsuario(String(params.usr_eliminar)); }));
  }
  if (params.tpl_listar) {
    return jsonp(cb, listarPlantillas());
  }
  if (params.tpl_guardar) {
    return jsonp(cb, withLock(function(){
      var p = JSON.parse(decodeURIComponent(params.tpl_guardar));
      return guardarPlantilla(p);
    }));
  }

  if (params.callback) {                    // listar todas las normas
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
// Guarda una norma y dispara los avisos por correo. Reutilizable (GET y POST).
function guardarNormaConAvisos(norma) {
  var res = guardarNorma(norma);
  if (res && res.ok) {
    notificarUsuariosRO(norma);
    if (norma.email) notificarUsuarioConfirmacion(norma.email, 'Publicación', norma.titulo || '');
    notificarAdmin('Nueva publicación', (norma.titulo || 'Sin título'), norma.autorNombre || norma.email);
  }
  return res;
}

function doPost(e) {
  var cb = (e.parameter && e.parameter.callback) || '_cb';
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.accion === 'subirArchivo') {
      return jsonp(cb, subirArchivoDrive(data.nombre, data.mime, data.base64));
    }
    // Guardar noticia nueva por POST (permite contenido enriquecido largo)
    if (data.accion === 'guardarNorma') {
      return jsonp(cb, withLock(function(){ return guardarNormaConAvisos(data.norma); }));
    }
    // Actualizar noticia por POST
    if (data.accion === 'actualizarNorma') {
      return jsonp(cb, withLock(function(){ return actualizarNorma(data.norma); }));
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
  vals[F.embed]              = norma.embed || '';
  vals[F.tipo_ro]            = norma.tipo_ro || '';
  if (norma.probabilidad) vals[F.probabilidad] = String(norma.probabilidad);
  if (norma.impacto)      vals[F.impacto]      = String(norma.impacto);
  if (norma.indice_ro)    vals[F.indice_ro]    = String(norma.indice_ro);
  vals[F.nivel_ro]           = norma.nivel_ro || '';
  vals[F.email]              = norma.email || '';
  if (norma.likes !== undefined && norma.likes !== null && norma.likes !== '') vals[F.likes] = String(norma.likes);
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
    video:         g('video'),
    embed:         g('embed'),
    tipo_ro:       g('tipo_ro'),
    probabilidad:  parseInt(g('probabilidad'),10) || 0,
    impacto:       parseInt(g('impacto'),10) || 0,
    indice_ro:     parseInt(g('indice_ro'),10) || 0,
    nivel_ro:      g('nivel_ro'),
    email:         g('email'),
    likes:         parseInt(g('likes'),10) || 0,
    likers:        g('likers') || ''
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
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes.json';
  var vals = normaToQuintaValues(norma);
  var formData = 'rest_api_key=' + encodeURIComponent(getApiKey());
  formData += '&entity_id=' + encodeURIComponent(ENTITY_ID);
  for (var fid in vals) {
    formData += '&values[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(vals[fid]);
  }
  var resp = UrlFetchApp.fetch(url, {
    method:'post',
    contentType:'application/x-www-form-urlencoded',
    payload: formData,
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

// ---- ACTUALIZAR -------------------------------------------------------------
function actualizarNorma(norma) {
  var recId = buscarRecordId(norma.id);
  if (!recId) return {ok:false, error:'registro no encontrado'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var body = { rest_api_key: getApiKey(), values: normaToQuintaValues(norma) };
  var resp = UrlFetchApp.fetch(url, {
    method:'put',
    contentType:'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

// ---- ELIMINAR ---------------------------------------------------------------
function eliminarNorma(idApp) {
  var recId = buscarRecordId(idApp);
  if (!recId) return {ok:false, error:'registro no encontrado'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var resp = UrlFetchApp.fetch(url, {
    method:'delete',
    contentType:'application/json',
    payload: JSON.stringify({rest_api_key: getApiKey()}),
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
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

// ====== COMENTARIOS =========================================================
// Convierte un record de QuintaDB (tabla Comentarios) al objeto del front.
function quintaRecordToComentario(rec) {
  var v = (rec.values && !Array.isArray(rec.values)) ? rec.values : {};
  function g(name){ var fid = FC[name]; return v[fid] !== undefined ? v[fid] : ''; }
  return {
    quinta_record_id: rec.id || '',
    id:       String(g('id')),
    norma_id: String(g('norma_id')),
    padre_id: String(g('padre_id')),
    autor:    g('autor'),
    texto:    g('texto'),
    fecha:    g('fecha'),            // viene ya como d/m/Y H:M
    aprobado: (g('aprobado') === 'TRUE' || g('aprobado') === true),
    email:    g('email'),
    likes:    parseInt(g('likes'),10) || 0,
    likers:   g('likers') || ''
  };
}

// Devuelve un objeto { norma_id: cantidad } con el conteo de comentarios aprobados.
// ====== PLANTILLAS DE CORREO (editables) ===================================
// Textos por defecto (se usan si no hay plantilla guardada en QuintaDB).
var TPL_DEFAULT = {
  riesgo: {
    asunto: '[VISOR] Nuevo {tipo} - Nivel {nivel}',
    cuerpo: 'Se ha registrado un {tipo} de nivel {nivel} en el portal VISOR:\n\n{titulo}\n\n{descripcion}\n\nVer en el portal: {enlace}'
  },
  admin: {
    asunto: '[VISOR] {accion}',
    cuerpo: 'Hay nueva actividad en el portal VISOR:\n\n{detalle}\n\nPor: {autor}\n\nIr al portal: {enlace}'
  },
  confirmacion: {
    asunto: '[VISOR] Confirmación: {accion}',
    cuerpo: 'Tu {accion} se publicó correctamente en el portal VISOR.\n\n{detalle}\n\nGracias por participar.\n\nVer el portal: {enlace}'
  }
};

var _TPL_CACHE = null;
function leerTodasPlantillas() {
  if (_TPL_CACHE !== null) return _TPL_CACHE;
  var mapa = {};
  var page = 1;
  while (page <= 20) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_TPL
            + '.json?rest_api_key=' + encodeURIComponent(getApiKey()) + '&page=' + page;
    var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) break;
    var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ break; }
    if (!data.records || !data.records.length) break;
    for (var i=0;i<data.records.length;i++) {
      var v = data.records[i].values || {};
      var clave = v[FT.clave] || '';
      if (clave) mapa[clave] = { recordId: data.records[i].id, asunto: v[FT.asunto] || '', cuerpo: v[FT.cuerpo] || '' };
    }
    if (data.records.length < 20) break;
    page++;
  }
  _TPL_CACHE = mapa;
  return mapa;
}
function invalidarTplCache(){ _TPL_CACHE = null; }

// Obtiene una plantilla por clave; si no existe o está vacía, usa el default.
function obtenerPlantilla(clave) {
  var todas = leerTodasPlantillas();
  var t = todas[clave];
  var def = TPL_DEFAULT[clave] || {asunto:'', cuerpo:''};
  return {
    asunto: (t && t.asunto) ? t.asunto : def.asunto,
    cuerpo: (t && t.cuerpo) ? t.cuerpo : def.cuerpo
  };
}

// Reemplaza {variables} en un texto con los valores dados.
function aplicarVars(texto, vars) {
  var out = String(texto || '');
  for (var k in vars) { if (vars.hasOwnProperty(k)) out = out.split('{'+k+'}').join(vars[k] || ''); }
  return out;
}

// Convierte saltos de línea del cuerpo en HTML con la plantilla visual.
function cuerpoAHtml(titulo, cuerpoTexto) {
  var parrafos = String(cuerpoTexto).split('\n').map(function(l){
    l = l.trim();
    if (!l) return '';
    // Si la línea es un enlace suelto, hacerlo botón
    if (/^https?:\/\//.test(l)) return '<p style="margin:16px 0;"><a href="'+l+'" style="background:#7A1F2B;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Ver en el portal</a></p>';
    return '<p>'+l+'</p>';
  }).join('');
  return plantillaCorreo(titulo, parrafos);
}

// Listar/guardar plantillas para el panel de administración.
function listarPlantillas() {
  var todas = leerTodasPlantillas();
  var salida = [];
  ['riesgo','admin','confirmacion'].forEach(function(clave){
    var t = todas[clave];
    var def = TPL_DEFAULT[clave];
    salida.push({
      clave: clave,
      asunto: (t && t.asunto) ? t.asunto : def.asunto,
      cuerpo: (t && t.cuerpo) ? t.cuerpo : def.cuerpo,
      personalizada: !!(t && (t.asunto || t.cuerpo))
    });
  });
  return salida;
}

function guardarPlantilla(p) {
  var clave = String(p.clave || '').trim();
  if (!clave) return {ok:false, error:'clave vacía'};
  var todas = leerTodasPlantillas();
  var existe = todas[clave];
  if (existe) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + existe.recordId + '.json';
    var vals = {}; vals[FT.asunto] = String(p.asunto||''); vals[FT.cuerpo] = String(p.cuerpo||'');
    var body = { rest_api_key: getApiKey(), values: vals };
    var resp = UrlFetchApp.fetch(url, {method:'put', contentType:'application/json', payload: JSON.stringify(body), muteHttpExceptions:true});
    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) invalidarTplCache();
    return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code};
  } else {
    var url2 = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes.json';
    var formData = 'rest_api_key=' + encodeURIComponent(getApiKey())
                 + '&entity_id=' + encodeURIComponent(ENTITY_TPL)
                 + '&values[' + FT.clave + ']=' + encodeURIComponent(clave)
                 + '&values[' + FT.asunto + ']=' + encodeURIComponent(String(p.asunto||''))
                 + '&values[' + FT.cuerpo + ']=' + encodeURIComponent(String(p.cuerpo||''));
    var resp2 = UrlFetchApp.fetch(url2, {method:'post', contentType:'application/x-www-form-urlencoded', payload: formData, muteHttpExceptions:true});
    var code2 = resp2.getResponseCode();
    if (code2 >= 200 && code2 < 300) invalidarTplCache();
    return (code2 >= 200 && code2 < 300) ? {ok:true} : {ok:false, error:'HTTP '+code2+': '+resp2.getContentText()};
  }
}

// ====== ENVÍO DE CORREOS (NOTIFICACIONES) ==================================
var ADMIN_NOTIF_EMAILS = ['patrick.villanueva@urp.edu.pe','patricia.vega@urp.edu.pe'];
var PORTAL_PUBLIC_URL = 'https://patrickvillanuevabartra.github.io/visorfiurp/';

// Envía un correo de forma segura (no rompe el flujo si falla).
function enviarCorreo(destino, asunto, cuerpoHtml) {
  try {
    if (!destino) return false;
    MailApp.sendEmail({ to: destino, subject: asunto, htmlBody: cuerpoHtml, name: 'VISOR FI-URP' });
    return true;
  } catch (e) { return false; }
}

// Plantilla base HTML para los correos.
function plantillaCorreo(titulo, contenido) {
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">'
       + '<div style="background:#7A1F2B;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold;">VISOR &mdash; Facultad de Ingeniería URP</div>'
       + '<div style="padding:24px;color:#1F2937;font-size:15px;line-height:1.6;">'
       + '<h2 style="margin-top:0;color:#7A1F2B;font-size:19px;">' + titulo + '</h2>'
       + contenido
       + '</div>'
       + '<div style="background:#F9FAFB;padding:14px 24px;font-size:12px;color:#6B7280;">Este es un mensaje automático del portal VISOR. Facultad de Ingeniería &mdash; Universidad Ricardo Palma.</div>'
       + '</div>';
}

// TIPO 1: notifica a los usuarios de la lista cuando hay riesgo/oportunidad medio o alto.
function notificarUsuariosRO(norma) {
  try {
    var tipo = norma.tipo_ro || '';
    var nivel = norma.nivel_ro || '';
    if (tipo !== 'riesgo' && tipo !== 'oportunidad') return;
    var nivelLower = nivel.toLowerCase();
    var esBajo = (nivelLower.indexOf('bajo') > -1 || nivelLower.indexOf('baja') > -1);
    if (esBajo || !nivel) return;
    var usuarios = listarUsuarios().filter(function(u){ return u.activo && u.email; });
    if (!usuarios.length) return;
    var etiqueta = (tipo === 'riesgo') ? 'Riesgo' : 'Oportunidad';
    var link = PORTAL_PUBLIC_URL + '?abrir=' + encodeURIComponent(norma.id || '');
    var tpl = obtenerPlantilla('riesgo');
    var vars = {
      tipo: etiqueta, nivel: nivel, titulo: norma.titulo || 'Sin título',
      descripcion: norma.desc || '', enlace: link
    };
    var asunto = aplicarVars(tpl.asunto, vars);
    var html = cuerpoAHtml('Nuevo ' + etiqueta + ' de nivel ' + nivel, aplicarVars(tpl.cuerpo, vars));
    for (var i=0;i<usuarios.length;i++) enviarCorreo(usuarios[i].email, asunto, html);
  } catch (e) {}
}

// TIPO 2: avisa a los administradores cuando alguien comenta o crea algo.
function notificarAdmin(tipoAccion, detalle, autorEmail) {
  try {
    var tpl = obtenerPlantilla('admin');
    var vars = { accion: tipoAccion, detalle: detalle || '', autor: autorEmail || 'anónimo', enlace: PORTAL_PUBLIC_URL };
    var asunto = aplicarVars(tpl.asunto, vars);
    var html = cuerpoAHtml(tipoAccion, aplicarVars(tpl.cuerpo, vars));
    for (var i=0;i<ADMIN_NOTIF_EMAILS.length;i++) enviarCorreo(ADMIN_NOTIF_EMAILS[i], asunto, html);
  } catch (e) {}
}

// TIPO 3: confirma al usuario que su comentario/registro se publicó.
function notificarUsuarioConfirmacion(destino, tipoAccion, detalle) {
  try {
    if (!destino) return;
    var tpl = obtenerPlantilla('confirmacion');
    var vars = { accion: tipoAccion, detalle: detalle || '', enlace: PORTAL_PUBLIC_URL };
    var asunto = aplicarVars(tpl.asunto, vars);
    var html = cuerpoAHtml('Publicación confirmada', aplicarVars(tpl.cuerpo, vars));
    enviarCorreo(destino, asunto, html);
  } catch (e) {}
}

// ====== GESTIÓN DE USUARIOS (destinatarios de notificaciones) ==============
function listarUsuarios() {
  var lista = [];
  var page = 1;
  while (page <= 50) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_USR
            + '.json?rest_api_key=' + encodeURIComponent(getApiKey()) + '&page=' + page;
    var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) break;
    var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ break; }
    if (!data.records || !data.records.length) break;
    for (var i=0;i<data.records.length;i++) {
      var v = data.records[i].values || {};
      lista.push({
        recordId: data.records[i].id,
        email:  v[FU.email]  || '',
        nombre: v[FU.nombre] || '',
        activo: (String(v[FU.activo]).toUpperCase() !== 'FALSE')
      });
    }
    if (data.records.length < 20) break;
    page++;
  }
  return lista;
}

function guardarUsuario(u) {
  var email = String(u.email || '').trim().toLowerCase();
  if (!email) return {ok:false, error:'email vacío'};
  var existentes = listarUsuarios();
  var yaExiste = null;
  for (var i=0;i<existentes.length;i++) {
    if (existentes[i].email.toLowerCase() === email) { yaExiste = existentes[i]; break; }
  }
  var activoStr = (u.activo === false || String(u.activo).toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';
  if (yaExiste) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + yaExiste.recordId + '.json';
    var vals = {};
    vals[FU.nombre] = String(u.nombre || yaExiste.nombre || '');
    vals[FU.activo] = activoStr;
    var body = { rest_api_key: getApiKey(), values: vals };
    var resp = UrlFetchApp.fetch(url, {method:'put', contentType:'application/json', payload: JSON.stringify(body), muteHttpExceptions:true});
    var code = resp.getResponseCode();
    return (code >= 200 && code < 300) ? {ok:true, actualizado:true} : {ok:false, error:'HTTP '+code};
  } else {
    var url2 = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes.json';
    var formData = 'rest_api_key=' + encodeURIComponent(getApiKey())
                 + '&entity_id=' + encodeURIComponent(ENTITY_USR)
                 + '&values[' + FU.email + ']=' + encodeURIComponent(email)
                 + '&values[' + FU.nombre + ']=' + encodeURIComponent(String(u.nombre || ''))
                 + '&values[' + FU.activo + ']=' + encodeURIComponent(activoStr);
    var resp2 = UrlFetchApp.fetch(url2, {method:'post', contentType:'application/x-www-form-urlencoded', payload: formData, muteHttpExceptions:true});
    var code2 = resp2.getResponseCode();
    return (code2 >= 200 && code2 < 300) ? {ok:true, creado:true} : {ok:false, error:'HTTP '+code2+': '+resp2.getContentText()};
  }
}

function eliminarUsuario(recordId) {
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recordId + '.json';
  var resp = UrlFetchApp.fetch(url, {method:'delete', contentType:'application/json', payload: JSON.stringify({rest_api_key: getApiKey()}), muteHttpExceptions:true});
  var code = resp.getResponseCode();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code};
}

// === CACHÉ de comentarios (se llena una vez por ejecución) ===
var _COM_CACHE = null;
function leerTodosComentarios() {
  if (_COM_CACHE !== null) return _COM_CACHE;
  var lista = [];
  var page = 1;
  while (page <= 100) {
    var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_COM
            + '.json?rest_api_key=' + encodeURIComponent(getApiKey()) + '&page=' + page;
    var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) break;
    var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ break; }
    if (!data.records || !data.records.length) break;
    for (var i=0;i<data.records.length;i++) {
      var c = quintaRecordToComentario(data.records[i]);
      c._recordId = data.records[i].id;
      lista.push(c);
    }
    if (data.records.length < 20) break;
    page++;
  }
  _COM_CACHE = lista;
  return lista;
}
function invalidarComCache(){ _COM_CACHE = null; }

function contarComentariosPorNorma() {
  var conteos = {};
  var todos = leerTodosComentarios();
  for (var i=0;i<todos.length;i++) {
    var c = todos[i];
    if (c.aprobado && c.norma_id) conteos[c.norma_id] = (conteos[c.norma_id] || 0) + 1;
  }
  return conteos;
}

// OPCIÓN C: pide a QuintaDB SOLO los comentarios de una norma, vía búsqueda REST.
// Si la búsqueda falla por cualquier motivo, devuelve null (el llamador usa el método completo).
function buscarComentariosDeNorma(normaId) {
  try {
    var lista = [];
    var page = 1;
    // search: [[PROPERTY_ID, "VALOR", "is"]] -> igualdad exacta por norma_id
    var searchArr = [[FC.norma_id, String(normaId), "is"]];
    var searchParam = encodeURIComponent(JSON.stringify(searchArr));
    while (page <= 100) {
      var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/entity/' + ENTITY_COM
              + '.json?rest_api_key=' + encodeURIComponent(getApiKey())
              + '&search=' + searchParam + '&page=' + page;
      var resp = UrlFetchApp.fetch(url, {method:'get', muteHttpExceptions:true});
      if (resp.getResponseCode() !== 200) return null; // fallo -> fallback
      var data; try { data = JSON.parse(resp.getContentText()); } catch(ex){ return null; }
      if (!data.records) return null;
      for (var i=0;i<data.records.length;i++) {
        var c = quintaRecordToComentario(data.records[i]);
        c._recordId = data.records[i].id;
        lista.push(c);
      }
      if (data.records.length < 20) break;
      page++;
    }
    return lista;
  } catch(e) { return null; }
}

// Lista todos los comentarios APROBADOS de una norma dada.
function obtenerComentarios(normaId) {
  // Intento rápido (Opción C): pedir solo los de esta norma
  var directa = buscarComentariosDeNorma(normaId);
  var base;
  if (directa !== null) {
    // La búsqueda REST puede traer de más: filtrar por norma_id exacto Y aprobado.
    base = directa.filter(function(c){
      return String(c.norma_id) === String(normaId) && c.aprobado;
    });
  } else {
    // Fallback: usar la caché completa
    base = leerTodosComentarios().filter(function(c){
      return String(c.norma_id) === String(normaId) && c.aprobado;
    });
  }
  base.sort(function(a,b){ return String(a.id).localeCompare(String(b.id)); });
  return base;
}

function buildComFormPayload(com) {
  var vals = {};
  vals[FC.id]       = String(com.id || ('CM' + Date.now()));
  vals[FC.norma_id] = String(com.norma_id || '');
  vals[FC.padre_id] = String(com.padre_id || '');
  vals[FC.autor]    = (com.autor || 'Anónimo').substring(0, 80);
  vals[FC.texto]    = (com.texto || '').substring(0, 2000);
  vals[FC.fecha]    = com.fecha || nowFechaHora();
  vals[FC.aprobado] = 'TRUE';   // publicación directa (moderación posterior)
  var parts = ['rest_api_key=' + encodeURIComponent(getApiKey())];
  for (var fid in vals) parts.push('values[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(vals[fid]));
  return parts.join('&');
}

function guardarComentario(com) {
  if (!com.texto || !com.texto.trim()) return {ok:false, error:'comentario vacío'};
  if (!com.norma_id) return {ok:false, error:'falta norma_id'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes.json';
  var vals = comToQuintaValues(com);
  var formData = 'rest_api_key=' + encodeURIComponent(getApiKey());
  formData += '&entity_id=' + encodeURIComponent(ENTITY_COM);
  for (var fid in vals) {
    formData += '&values[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(vals[fid]);
  }
  var resp = UrlFetchApp.fetch(url, {
    method:'post',
    contentType:'application/x-www-form-urlencoded',
    payload: formData,
    muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) invalidarComCache();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

function comToQuintaValues(com) {
  var vals = {};
  vals[FC.id]       = String(com.id || ('CM' + Date.now()));
  vals[FC.norma_id] = String(com.norma_id || '');
  vals[FC.padre_id] = String(com.padre_id || '');
  vals[FC.autor]    = (com.autor || 'Anónimo').substring(0, 80);
  vals[FC.texto]    = (com.texto || '').substring(0, 2000);
  vals[FC.fecha]    = com.fecha || nowFechaHora();
  vals[FC.aprobado] = 'TRUE';
  vals[FC.email]    = com.email || '';
  return vals;
}

function buscarComRecordId(idCom) {
  var todos = leerTodosComentarios();
  for (var i=0;i<todos.length;i++) {
    if (String(todos[i].id) === String(idCom)) return todos[i]._recordId;
  }
  return null;
}

// Edita el texto de un comentario existente.
function editarComentario(idCom, nuevoTexto) {
  var recId = buscarComRecordId(idCom);
  if (!recId) return {ok:false, error:'comentario no encontrado'};
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var vals = {};
  vals[FC.texto] = String(nuevoTexto || '').substring(0, 2000);
  var body = { rest_api_key: getApiKey(), values: vals };
  var resp = UrlFetchApp.fetch(url, {
    method:'put', contentType:'application/json',
    payload: JSON.stringify(body), muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) invalidarComCache();
  return (code >= 200 && code < 300) ? {ok:true} : {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

// Elimina un comentario y todas sus respuestas (hilo completo).
function eliminarComentario(idCom) {
  var todos = leerTodosComentarios();
  // Recolectar el comentario y sus respuestas directas, con sus recordIds.
  var aBorrar = [];  // {id, recordId}
  for (var i=0;i<todos.length;i++) {
    var c = todos[i];
    if (String(c.id) === String(idCom) || String(c.padre_id) === String(idCom)) {
      aBorrar.push({id:c.id, recordId:c._recordId});
    }
  }
  var okCount = 0;
  for (var k=0;k<aBorrar.length;k++) {
    var recId = aBorrar[k].recordId;
    if (recId) {
      var u = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
      var r = UrlFetchApp.fetch(u, {
        method:'delete',
        contentType:'application/json',
        payload: JSON.stringify({rest_api_key: getApiKey()}),
        muteHttpExceptions:true
      });
      if (r.getResponseCode() >= 200 && r.getResponseCode() < 300) okCount++;
    }
  }
  invalidarComCache();
  return {ok: okCount > 0, eliminados: okCount};
}

// Fecha y hora actual en formato d/m/Y H:M (zona horaria de Lima).
function nowFechaHora() {
  return Utilities.formatDate(new Date(), 'America/Lima', 'd/M/yyyy HH:mm');
}

// ====== LIKES ===============================================================
// Incrementa en 1 el contador de likes de una norma. Devuelve el nuevo total.
// ====== LIKES CON IDENTIDAD (toggle like / unlike) =========================
// La lista de "quiénes dieron like" se guarda en el campo de texto "likers".
// Formato: cada entrada es  email␟nombre  y se separan con "|".
//   ej.:  juan@urp.edu.pe␟Juan Perez|ana@urp.edu.pe␟Ana Díaz
// El símbolo ␟ (U+241F) separa correo y nombre sin chocar con texto normal.
var LK_SEP   = '|';
var LK_SUBSEP = '␟';

function likersParse(txt) {                 // texto -> [{email, nombre}]
  var out = [];
  if (!txt) return out;
  var partes = String(txt).split(LK_SEP);
  for (var i=0;i<partes.length;i++) {
    var p = partes[i]; if (!p) continue;
    var kv = p.split(LK_SUBSEP);
    var em = (kv[0]||'').trim().toLowerCase();
    if (!em) continue;
    out.push({ email: em, nombre: (kv[1]||'').trim() });
  }
  return out;
}
function likersStringify(arr) {             // [{email, nombre}] -> texto
  return arr.map(function(x){ return x.email + LK_SUBSEP + (x.nombre||''); }).join(LK_SEP);
}
// Devuelve la lista pública de nombres (para mostrar "quiénes dieron like").
function likersNombres(arr) {
  return arr.map(function(x){ return x.nombre || x.email; });
}

// Alterna el like de una NORMA para un usuario (identificado por su correo).
// Si ya tenía like -> lo quita (unlike). Si no -> lo agrega (like).
function toggleLikeNorma(idApp, email, nombre) {
  email = (email||'').trim().toLowerCase();
  if (!email) return {ok:false, error:'Inicia sesión para dar me gusta'};
  var recId = buscarRecordId(idApp);
  if (!recId) return {ok:false, error:'norma no encontrada'};
  var n = null;
  var normas = obtenerNormas();
  for (var i=0;i<normas.length;i++) if (String(normas[i].id) === String(idApp)) { n = normas[i]; break; }
  var lista = likersParse(n ? n.likers : '');
  var idx = -1;
  for (var j=0;j<lista.length;j++) if (lista[j].email === email) { idx = j; break; }
  var yo;
  if (idx >= 0) { lista.splice(idx,1); yo = false; }        // unlike
  else { lista.push({email:email, nombre:(nombre||'').trim()}); yo = true; }  // like
  var nuevoTxt = likersStringify(lista);
  var nuevoCount = lista.length;
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var vals = {};
  vals[F.likes]  = String(nuevoCount);
  vals[F.likers] = nuevoTxt;
  var body = { rest_api_key: getApiKey(), values: vals };
  var resp = UrlFetchApp.fetch(url, {
    method:'put', contentType:'application/json',
    payload: JSON.stringify(body), muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300)
    return {ok:true, likes:nuevoCount, yo:yo, nombres:likersNombres(lista)};
  return {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

// Alterna el like de un COMENTARIO para un usuario.
function toggleLikeComentario(idCom, email, nombre) {
  email = (email||'').trim().toLowerCase();
  if (!email) return {ok:false, error:'Inicia sesión para dar me gusta'};
  var todos = leerTodosComentarios();
  var recId = null, actualLikers = '';
  for (var i=0;i<todos.length;i++) {
    if (String(todos[i].id) === String(idCom)) { recId = todos[i]._recordId; actualLikers = todos[i].likers || ''; break; }
  }
  if (!recId) return {ok:false, error:'comentario no encontrado'};
  var lista = likersParse(actualLikers);
  var idx = -1;
  for (var j=0;j<lista.length;j++) if (lista[j].email === email) { idx = j; break; }
  var yo;
  if (idx >= 0) { lista.splice(idx,1); yo = false; }
  else { lista.push({email:email, nombre:(nombre||'').trim()}); yo = true; }
  var nuevoTxt = likersStringify(lista);
  var nuevoCount = lista.length;
  var url = QUINTA_BASE + '/apps/' + APP_ID + '/dtypes/' + recId + '.json';
  var vals = {};
  vals[FC.likes]  = String(nuevoCount);
  vals[FC.likers] = nuevoTxt;
  var body = { rest_api_key: getApiKey(), values: vals };
  var resp = UrlFetchApp.fetch(url, {
    method:'put', contentType:'application/json',
    payload: JSON.stringify(body), muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) { invalidarComCache();
    return {ok:true, likes:nuevoCount, yo:yo, nombres:likersNombres(lista)}; }
  return {ok:false, error:'HTTP '+code+': '+resp.getContentText()};
}

// ====== UTILIDADES DE PRUEBA ================================================
function _test_correo() {
  // Envía un correo de prueba a tu dirección para verificar que MailApp funciona.
  var r = enviarCorreo('patrick.villanueva@urp.edu.pe', '[VISOR] Correo de prueba', plantillaCorreo('Prueba de notificación', '<p>Si recibes este correo, el envío automático funciona correctamente.</p>'));
  Logger.log('Correo enviado: ' + r);
}
function _test_buscar_com_norma() {
  // Cambia 'ID_DE_UNA_NORMA' por el id real de una noticia que tenga comentarios
  var r = buscarComentariosDeNorma('ID_DE_UNA_NORMA');
  if (r === null) { Logger.log('La búsqueda REST FALLÓ (usará fallback). Revisar sintaxis.'); }
  else { Logger.log('Búsqueda REST OK. Comentarios encontrados: ' + r.length); Logger.log(JSON.stringify(r, null, 2)); }
}
function _test_listar() {
  var n = obtenerNormas();
  Logger.log('Registros: ' + n.length);
  if (n.length) Logger.log(JSON.stringify(n[0], null, 2));
}
function _test_crear_comentario() {
  var com = {
    id: 'CMTEST'+Date.now(),
    norma_id: '1719350000001',
    padre_id: '',
    autor: 'Prueba',
    texto: 'Comentario de prueba',
    fecha: nowFechaHora()
  };
  Logger.log('Fecha generada: ' + com.fecha);
  var r = guardarComentario(com);
  Logger.log('Resultado guardarComentario: ' + JSON.stringify(r));
}
function _test_apiKey() {
  Logger.log(getApiKey() ? 'API key OK (longitud '+getApiKey().length+')' : 'FALTA REST_API_KEY en Propiedades del Script');
}
function _test_comentarios() {
  var c = obtenerComentarios('1719350000001');
  Logger.log('Comentarios de la norma 1719350000001: ' + c.length);
  Logger.log(JSON.stringify(c, null, 2));
}
