/* Repair invalid import headers using existing source columns; never fabricate identifiers. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const extraAliases={customer_id:['clientcode','clientid','customercode','customerkey','makhach'],order_id:['ordercode','orderno','ordernumber','sodonhang','sohoadon','donhangid'],date:['delivery','shipdate','shippingdate','ngaygiaonhan','ngayvanchuyen'],revenue:['totalamount','netrevenue','doanhthuthuan','tongthanhtien'],status:['orderstate','orderstatus','tinhtrangdon','tinhtrangdonhang']};
  let state=null;
  const note=(message,tone='info')=>{const el=$('fileRepairStatus');if(el){el.textContent=message;el.className='repair-status is-'+tone;}};
  function showDetails() {
    if($('fileRepairDetails'))$('fileRepairDetails').open=true;
    $('btnShowRepairDetails')?.setAttribute('aria-expanded','true');
  }
  function render() {
    if(!state)return;
    const unavailable=state.unavailable;
    for(const id of ['btnAutoRepairFile','btnApplyRepairFeedback','fileRepairFeedback'])if($(id))$(id).disabled=unavailable;
    $('btnConfirmRepairedFile').disabled=!state.ready;$('btnDownloadRepairedFile').disabled=!state.changes.length;
    const inspection=state.initial;
    const usedColumns = new Set([...Object.values(inspection.fieldMap), ...state.mapping.values()]);
    const mappingGrid = $('fileRepairMapping');
    mappingGrid.innerHTML = AppState.requiredSchema.map(field => {
      const recognized = inspection.fieldMap[field.key];
      const mapped = state.mapping.get(field.key);
      const source = recognized || mapped || '';
      const tone = unavailable ? 'unavailable' : recognized ? 'matched' : mapped ? 'mapped' : 'missing';
      const label = {unavailable:'Chưa đọc được file', matched:'Đã nhận diện', mapped:'Đã chọn cột', missing:'Cần chọn cột'}[tone];
      const options = inspection.headers.map(header => {
        const selected = header === source;
        const occupied = usedColumns.has(header) && !selected;
        return '<option value="' + escapeHtml(header) + '"' + (selected ? ' selected' : '') +
          (occupied ? ' disabled' : '') + '>' + escapeHtml(header) + '</option>';
      }).join('');
      return '<label class="repair-mapping-row" data-state="' + tone +
        '"><span class="repair-field-heading"><strong>' + escapeHtml(field.label) + '</strong>' +
        '<span class="repair-field-status">' + label + '</span></span>' +
        '<select aria-label="Cột nguồn cho ' + escapeHtml(field.label) +
        '" data-repair-field="' + escapeHtml(field.key) + '"' + (unavailable || recognized ? ' disabled' : '') +
        '><option value="">Chọn cột trong file</option>' + options + '</select></label>';
    }).join('');
    mappingGrid.querySelectorAll('[data-repair-field]').forEach(select => select.addEventListener('change', () => {
      const key = select.dataset.repairField;
      setMapping(key, select.value);
      [...mappingGrid.querySelectorAll('[data-repair-field]')]
        .find(control => control.dataset.repairField === key)?.focus({preventScroll:true});
    }));
    if ($('btnCheckRepairMapping')) $('btnCheckRepairMapping').disabled = unavailable || state.feedbackPending;
    $('fileRepairChanges').innerHTML=state.changes.length?state.changes.map(change=>'<tr><td>'+escapeHtml(change.from)+'</td><td>Đổi tên thành <strong>'+escapeHtml(change.to)+'</strong></td><td>'+change.rows+'</td></tr>').join(''):'<tr><td colspan="3">Chưa có chỉnh sửa. File gốc được giữ nguyên.</td></tr>';
    $('fileRepairRemaining').innerHTML=state.remaining.map(error=>'<li>'+escapeHtml(error)+'</li>').join('');
    if ($('repairRemainingSection')) $('repairRemainingSection').hidden = !state.remaining.length;
    if ($('repairConfirmHint')) $('repairConfirmHint').textContent = state.ready
      ? 'Bản sửa đã đạt yêu cầu. Bạn có thể dùng để sang Bước 2.'
      : state.feedbackPending ? 'Hãy gửi yêu cầu chỉnh sửa trước khi xác nhận.'
      : 'Bạn có thể dùng bản sửa khi file đã qua kiểm tra.';
    const notice=$('errorLockNotice');notice?.classList.toggle('repair-valid',state.ready);
    if($('errorLockNoticeText'))$('errorLockNoticeText').textContent=state.ready?'BẢN SỬA ĐÃ HỢP LỆ — XÁC NHẬN ĐỂ KIỂM TRA LẠI VÀ SANG BƯỚC 2':'ĐÃ KHÓA BƯỚC TIẾP THEO — CẦN FILE ĐẠT YÊU CẦU';
  }
  function load(file) {
    if(state?.file===file && file)return;
    const initial=inspectDataset(file?.rows||[],AppState.requiredSchema);
    state={file,initial,mapping:new Map(),candidate:[],changes:[],remaining:initial.errors,ready:false,unavailable:!file?.rows?.length || Boolean(file?.isEmptyOrInvalid)};
    if($('fileRepairFeedback'))$('fileRepairFeedback').value='';
    if($('fileRepairDetails'))$('fileRepairDetails').open=false;
    $('btnShowRepairDetails')?.setAttribute('aria-expanded','false');render();
    note(state.unavailable?'Không đọc được bảng dữ liệu đầy đủ. Hãy sửa file gốc rồi tải lại.':'Chọn tự sửa, để Agent nhận diện tên cột, hoặc gửi feedback ánh xạ cột.');
  }
  function setMapping(key,source) {
    if(!state || state.unavailable)return;
    if(source)state.mapping.set(key,source);else state.mapping.delete(key);
    state.ready=false;state.candidate=[];state.changes=[];state.remaining=state.initial.errors;
    render();note('Đã thay đổi ánh xạ. Nhấn “Kiểm tra ánh xạ” để kiểm tra lại.');
  }
  function apply(proposed=state?.mapping) {
    if(!state || state.file!==AppState.failedFile || state.unavailable)return false;
    const original=state.initial,headers=original.headers;
    // A duplicated physical header may have already lost cell data while parsing.
    if(original.errors.some(error=>/trùng|trung/i.test(error))) {note('Tên cột trùng hoặc mơ hồ cần được sửa trên file gốc để giữ đủ dữ liệu.','error');showDetails();return false;}
    const mapping=new Map(proposed),used=new Set([...Object.values(original.fieldMap),...mapping.values()]);
    for(const field of AppState.requiredSchema) {
      if(original.fieldMap[field.key])continue;
      if(mapping.has(field.key)){const source=mapping.get(field.key);if(!headers.includes(source))return reject('Không tìm thấy cột “'+source+'” trong file.');continue;}
      const aliases=new Set((extraAliases[field.key]||[]).map(normalizeHeaderKey));
      const candidates=headers.filter(header=>!used.has(header) && aliases.has(normalizeHeaderKey(header)));
      if(candidates.length===1){mapping.set(field.key,candidates[0]);used.add(candidates[0]);}
    }
    const renames=new Map(),changes=[];
    for(const [key,source] of mapping) {
      const field=AppState.requiredSchema.find(f=>f.key===key);
      if(!field || !headers.includes(source))return reject('Ánh xạ không hợp lệ. Hãy chọn lại các cột có sẵn.');
      if(original.fieldMap[key] && original.fieldMap[key]!==source)return reject('Cột “'+field.label+'” đã có dữ liệu. Hãy sửa trực tiếp file gốc nếu cần thay thế nguồn.');
      if(renames.has(source) && renames.get(source)!==field.label)return reject('Một cột không thể thay thế cho hai trường bắt buộc.');
      if(source!==field.label){renames.set(source,field.label);changes.push({from:source,to:field.label,rows:original.rows.length});}
    }
    const outputHeaders=headers.map(header=>renames.get(header)||header),normalized=outputHeaders.map(normalizeHeaderKey);
    if(normalized.some((name,index)=>normalized.indexOf(name)!==index))return reject('Ánh xạ làm trùng tên cột. Chưa áp dụng thay đổi.');
    const candidate=original.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[renames.get(key)||key,value])));
    const inspection=inspectDataset(candidate,AppState.requiredSchema);
    state.mapping=mapping;state.candidate=candidate;state.changes=changes;state.remaining=inspection.errors;state.ready=!inspection.errors.length;state.feedbackPending=false;
    render();showDetails();
    if(state.ready)note('Bản sửa đã đủ cấu trúc và khóa bắt buộc. Xem chi tiết rồi xác nhận để kiểm tra lại trước khi sang Bước 2.','success');
    else note((changes.length?'Đã sửa '+changes.length+' tên cột. ':'')+'Còn '+inspection.errors.length+' lỗi cần xử lý; các bước tiếp theo vẫn khóa. Agent không tự tạo mã khách hàng hoặc mã đơn hàng.','error');
    return state.ready;
  }
  function reject(message) {if(state){state.ready=false;render();}note(message,'error');showDetails();return false;}
  function applyFeedback() {
    if(!state || state.unavailable)return false;
    const feedback=$('fileRepairFeedback').value.trim();
    if(!feedback)return reject('Hãy nhập: Cột bắt buộc = Cột trong file. Ví dụ: Mã đơn hàng = OrderCode.');
    const proposed=new Map(state.mapping),requested=new Map();
    for(const command of feedback.split(/;|\n/).map(value=>value.trim()).filter(Boolean)) {
      const match=command.match(/^(.+?)\s*(?:=|->|→)\s*(.+?)$/);
      if(!match)return reject('Chưa hiểu yêu cầu “'+command+'”. Dùng mẫu: Mã đơn hàng = OrderCode. Chưa áp dụng thay đổi.');
      const target=match[1].trim().replace(/^["']|["']$/g,''),sourceName=match[2].trim().replace(/^["']|["']$/g,'');
      const fields=AppState.requiredSchema.filter(field=>[field.key,field.label,...(field.aliases||[])].some(alias=>normalizeHeaderKey(alias)===normalizeHeaderKey(target)));
      const sources=state.initial.headers.filter(header=>normalizeHeaderKey(header)===normalizeHeaderKey(sourceName));
      if(fields.length!==1 || sources.length!==1)return reject('Không tìm thấy cột bắt buộc hoặc cột nguồn duy nhất cho “'+command+'”. Chưa áp dụng thay đổi.');
      if(requested.has(fields[0].key) && requested.get(fields[0].key)!==sources[0])return reject('Có hai yêu cầu khác nhau cho “'+fields[0].label+'”. Hãy chỉ định một cột nguồn.');
      requested.set(fields[0].key,sources[0]);proposed.set(fields[0].key,sources[0]);
    }
    return apply(proposed);
  }
  function confirmRepair() {
    if(!state?.ready || state.feedbackPending || state.file!==AppState.failedFile)return false;
    const rows=state.candidate,file=state.file;
    const inspection=inspectDataset(rows,AppState.requiredSchema);
    if(inspection.errors.length){state.ready=false;state.remaining=inspection.errors;render();return reject('Bản sửa chưa đạt kiểm tra lại. Các bước tiếp theo vẫn khóa.');}
    const accepted=validateFileSchema(rows,file.fileName);
    if(accepted)AppState.sheetName=file.sheetName||'';
    return accepted;
  }
  function downloadRepair() {
    if(!state?.candidate.length || !state.changes.length)return;
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(state.candidate);
    XLSX.utils.book_append_sheet(workbook,sheet,'Ban_Chinh_Sua');
    const name=String(state.file.fileName||'Du_lieu').replace(/\.(csv|xlsx|xls)$/i,'').replace(/[<>:"/\\|?*]/g,'_');
    XLSX.writeFile(workbook,'Da_Chinh_Sua_'+name+'.xlsx');
  }
  function autoRepair() {return $('fileRepairFeedback')?.value.trim()?applyFeedback():apply();}
  function init() {
    $('fileRepairFeedback')?.addEventListener('input',()=>{if(!state)return;state.feedbackPending=Boolean($('fileRepairFeedback').value.trim());state.ready=!state.feedbackPending && state.candidate.length>0 && !inspectDataset(state.candidate,AppState.requiredSchema).errors.length;render();note(state.feedbackPending?'Feedback mới chưa được áp dụng. Nhấn “Gửi feedback & sửa lại” để kiểm tra.':'Đã hủy feedback chưa áp dụng.');});
    $('btnAutoRepairFile')?.addEventListener('click',()=>autoRepair());$('btnApplyRepairFeedback')?.addEventListener('click',applyFeedback);
    $('btnShowRepairDetails')?.addEventListener('click',()=>{const panel=$('fileRepairDetails');panel.open=!panel.open;$('btnShowRepairDetails').setAttribute('aria-expanded',String(panel.open));});
    $('fileRepairDetails')?.addEventListener('toggle',()=>{$('btnShowRepairDetails').setAttribute('aria-expanded',String($('fileRepairDetails').open));});
    $('btnCheckRepairMapping')?.addEventListener('click',()=>apply());
    $('btnConfirmRepairedFile')?.addEventListener('click',confirmRepair);$('btnDownloadRepairedFile')?.addEventListener('click',downloadRepair);
  }
  window.FileRepair={load,setMapping,autoRepair,applyFeedback,confirmRepair};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
