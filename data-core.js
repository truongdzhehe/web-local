/* Pure data rules shared by the page and background worker. */

function normalizeHeaderKey(str) {
  return String(str || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[\s_-]+/g, '');
}

function parsePositiveNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : NaN;
  let cleanedStr = String(raw || '').trim().replace(/[^0-9.,-]+/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(cleanedStr)) {
    cleanedStr = cleanedStr.replace(/\./g, '');
  } else {
    cleanedStr = cleanedStr.replace(/,/g, '');
  }
  const num = parseFloat(cleanedStr);
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

function computeNumericMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(med * 100) / 100;
}

function normalizeDateCell(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: '', imputed: true, convertedSerial: false };
  const num = Number(raw);
  if (Number.isFinite(num) && num > 35000 && num < 65000) {
    const dt = new Date(Math.floor(num - 25569) * 86400 * 1000);
    const value = `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${dt.getUTCFullYear()}`;
    return { value, imputed: false, convertedSerial: true };
  }
  const str = String(raw).trim();
  const iso = str.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:T.*)?$/);
  const parts = parseDateParts(iso ? iso[1] : str);
  return { value: parts ? parts.label : '', imputed: !parts, convertedSerial: false };
}

function parseDateParts(raw) {
  const str = String(raw ?? '').trim();
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!dmy && !ymd) return null;
  const d = Number(dmy ? dmy[1] : ymd[3]), m = Number(dmy ? dmy[2] : ymd[2]), y = Number(dmy ? dmy[3] : ymd[1]);
  const date = new Date(Date.UTC(y,m-1,d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m-1 || date.getUTCDate() !== d) return null;
  return { d,m,y,sortKey: y*10000+m*100+d,label:`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}` };
}

function normalizeFeedback(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').trim();
}

function classifyStatusMeta(rawStatus) {
  const text = normalizeFeedback(String(rawStatus || ''));
  if (/cancel|huy/.test(text)) return { key: 'Canceled', badgeClass: 'st-canceled', label: rawStatus };
  if (/completed|hoan thanh|hoan tat|delivered|da giao/.test(text)) return { key: 'Completed', badgeClass: 'st-completed', label: rawStatus };
  if (/ship|dang giao/.test(text)) return { key: 'Shipped', badgeClass: 'st-shipped', label: rawStatus };
  if (/process|xu ly|pending|cho/.test(text)) return { key: 'Processing', badgeClass: 'st-processing', label: rawStatus };
  return { key: 'Unknown', badgeClass: 'st-processing', label: rawStatus || 'Chưa rõ' };
}

function inspectDataset(dataRows, schema) {
  const errors = [];
  if (!Array.isArray(dataRows) || !dataRows.length) errors.push('File rỗng hoặc không có bản ghi để phân tích.');
  const originalNames = Object.keys(dataRows?.[0] || {}).map(normalizeHeaderKey);
  if (originalNames.some((name,i) => originalNames.indexOf(name) !== i)) errors.push('Các tiêu đề cột trùng nhau sau khi chuẩn hóa.');
  const rows = Array.isArray(dataRows) ? dataRows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key.replace(/^\uFEFF/, '').trim(), value]))) : [];
  const rawHeaders = Object.keys(rows[0] || {});
  const fieldMapping = {}, missingFields = [], used = new Set();
  const normalized = rawHeaders.map(normalizeHeaderKey);
  if (normalized.some((h,i) => normalized.indexOf(h) !== i)) errors.push('Tên cột bị trùng sau khi chuẩn hóa. Hãy đổi tên các cột trùng.');
  schema.forEach(field => {
    const aliases = new Set([field.label, field.key, ...(field.aliases || [])].map(normalizeHeaderKey));
    const matches = rawHeaders.filter(h => aliases.has(normalizeHeaderKey(h)));
    if (!matches.length) missingFields.push(field);
    else if (matches.length > 1 || used.has(matches[0])) errors.push(`Cột "${field.label}" bị ánh xạ không rõ ràng: ${matches.join(', ')}.`);
    else { fieldMapping[field.key] = matches[0]; used.add(matches[0]); }
  });
  if (missingFields.length) errors.push(`Thiếu ${missingFields.length} cột bắt buộc: ${missingFields.map(f => f.label).join(', ')}.`);
  ['customer_id','order_id'].forEach(key => {
    if (!fieldMapping[key]) return;
    const missing = rows.flatMap((row,i) => String(row[fieldMapping[key]] ?? '').trim() ? [] : [i + 2]);
    if (missing.length) errors.push(`Cột "${fieldMapping[key]}" thiếu giá trị tại dòng ${missing.slice(0,10).join(', ')}${missing.length > 10 ? '…' : ''} (${missing.length} dòng).`);
  });
  return {rows, headers:rawHeaders, fieldMap:fieldMapping, missingFields, errors};
}

function cleanDataset(sourceRows, fMap) {
    const validRevenues = [];
    sourceRows.forEach(r => {
      const val = parsePositiveNumber(r[fMap.revenue]);
      if (!isNaN(val)) validRevenues.push(val);
    });
    const medianRevenue = computeNumericMedian(validRevenues);

    const cleaned = [];
    const seenIds = new Set();
    let dupCount = 0;
    const removed = [];
    let revFixed = 0;
    let statusFixed = 0;
    let dateFixed = 0;
    let excelSerialFixed = 0;
    let normalizedDate = 0;

    sourceRows.forEach((r,index) => {
      const orderId = String(r[fMap.order_id] ?? '').trim();
      if (orderId && seenIds.has(orderId)) {
        dupCount++;
        if (removed.length < 100) removed.push({orderId,rowNumber:index+2});
        return;
      }
      if (orderId) seenIds.add(orderId);

      const clone = Object.fromEntries(Object.entries(r).map(([key,value]) => [key, typeof value === 'string' ? value.trim() : value]));

      let num = parsePositiveNumber(clone[fMap.revenue]);
      if (isNaN(num)) {
        num = medianRevenue;
        revFixed++;
      }
      clone[fMap.revenue] = num;

      if (!clone[fMap.status] || String(clone[fMap.status]).trim() === '') {
        clone[fMap.status] = 'Processing';
        statusFixed++;
      } else {
        const meta = classifyStatusMeta(clone[fMap.status]);
        clone[fMap.status] = meta.key === 'Unknown' ? String(clone[fMap.status]).trim() : meta.key;
      }

      const dateRes = normalizeDateCell(clone[fMap.date]);
      clone[fMap.date] = dateRes.value;
      if (dateRes.imputed) dateFixed++;
      if (dateRes.convertedSerial) excelSerialFixed++;
      normalizedDate++;

      cleaned.push(clone);
    });


  const originals=new Map();
  sourceRows.forEach((row,index)=>{const key=String(row[fMap.order_id]??'').trim();if(!originals.has(key))originals.set(key,{row,index});});
  const changes=[];let changedCells=0;
  cleaned.forEach(row=>{const original=originals.get(String(row[fMap.order_id]).trim());if(!original)return;
    Object.keys(row).forEach(column=>{if(String(original.row[column]??'')!==String(row[column]??'')){changedCells++;if(changes.length<2000)changes.push({orderId:row[fMap.order_id],rowNumber:original.index+2,column,reason:
        column===fMap.revenue && Number.isNaN(parsePositiveNumber(original.row[column])) ? 'Điền doanh thu bằng trung vị' :
        column===fMap.revenue ? 'Chuẩn hóa số tiền' :
        column===fMap.date ? (normalizeDateCell(original.row[column]).imputed ? 'Ngày nguồn thiếu hoặc lỗi' : 'Chuẩn hóa ngày') :
        column===fMap.status ? (String(original.row[column]??'').trim() ? 'Chuẩn hóa trạng thái' : 'Điền trạng thái Processing') :
        'Bỏ khoảng trắng thừa',before:original.row[column]??'',after:row[column]??''});}});
  });
  return {rows:cleaned,stats:{dupCount,revFixed,statusFixed,dateFixed,excelSerialFixed,normalizedDate,medianRevenue},audit:{changes,changedCells,duplicates:dupCount,removed,unresolvedDates:dateFixed,sourceCount:sourceRows.length,resultCount:cleaned.length}};
}
