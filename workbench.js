/* Browser-local persistence, import preview, review editing and linked analysis. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let worker=null,jobId=0,saveTimer=null,dbPromise=null,writeQueue=Promise.resolve(),epoch=0,restoring=false;
  let preview=null,workbook=null,pendingDraft=null,undoStack=[],redoStack=[],edit=null,linkedPage=1,reportsLimit=8,sheetRequest=0,selectingSheet=false;
  let reportPage=1,reportRecords=[],reportReviewer='',reportQuery='',reportBusy=false,reportsRead=0;
  const reportSelected=new Set();
  const jobs=new Map();
  const status=message=>{if($('sessionSaveStatus'))$('sessionSaveStatus').textContent=message;};
  const reportStatus=message=>{if($('reportHistoryStatus'))$('reportHistoryStatus').textContent=message;};
  function db() {
    if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('Trình duyệt chưa cho phép lưu phiên trên thiết bị này.'));return;}
      const request=indexedDB.open('CodeKitDataAgent',1);
      request.onupgradeneeded=()=>{const d=request.result;if(!d.objectStoreNames.contains('session'))d.createObjectStore('session');if(!d.objectStoreNames.contains('reports'))d.createObjectStore('reports',{keyPath:'id'});};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Không mở được bộ nhớ phiên.'));
      request.onblocked=()=>reject(new Error('Đóng các tab CodeKit cũ để mở bộ nhớ phiên.'));
    });
    return dbPromise;
  }
  async function store(name,mode,operation) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction(name,mode),request=operation(tx.objectStore(name));let result;
      request.onsuccess=()=>result=request.result;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('Không lưu được dữ liệu.'));tx.onabort=()=>reject(tx.error||new Error('Giao dịch lưu bị hủy.'));
    });
  }
  const queue=operation=>{const task=writeQueue.then(operation);writeQueue=task.catch(()=>{});return task;};
  function snapshot() {
    return {version:1,savedAt:new Date().toISOString(),fileName:AppState.fileName,sheetName:AppState.sheetName||'',rawRows:AppState.rawRows.slice(),
      cleanRows:AppState.cleanRows.slice(),baseline:AppState.step2BackupCleanRows.slice(),headers:[...AppState.headers],fieldMap:{...AppState.fieldMap},schema:structuredClone(AppState.requiredSchema),
      workflow:{...AppState.workflow,finalApproved:false},step:AppState.currentStep,step3:{...AppState.step3,feedbackHistory:AppState.step3.feedbackHistory.slice(),selectedRows:[]},
      analytics:{...AppState.analytics,dateRange:{...AppState.analytics.dateRange},crossFilters:structuredClone(AppState.analytics.crossFilters||{}),lastMetrics:null},analysisFeedbackHistory:AppState.analysisFeedbackHistory.slice(),audit:AppState.cleaningAudit,
      feedback3:$('feedbackInputStep3')?.value||'',feedback6:$('feedbackInputStep6')?.value||'',reviewer:$('reviewerName')?.value||'',undoStack:undoStack.slice(),redoStack:redoStack.slice()};
  }
  function saveSoon() {
    if(restoring)return;
    clearTimeout(saveTimer);const generation=epoch;
    status('Đang chờ lưu phiên…');
    saveTimer=setTimeout(()=>{
      if(generation!==epoch)return;
      if(!AppState.workflow.importValid || !AppState.rawRows.length)return;
      const state=snapshot();status('Đang lưu phiên trên thiết bị…');
      queue(()=>generation===epoch?store('session','readwrite',s=>s.put(state,'current')):null)
        .then(()=>{if(generation===epoch)status('Đã lưu phiên lúc '+new Date().toLocaleTimeString('vi-VN'));})
        .catch(error=>status('Chưa lưu được phiên: '+error.message));
    },450);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if(restoring || !AppState.workflow.importValid || !AppState.rawRows.length)return;
    const generation=epoch,state=snapshot();status('Đang lưu phiên…');
    try {await queue(()=>generation===epoch?store('session','readwrite',s=>s.put(state,'current')):null);if(generation===epoch)status('Đã lưu phiên lúc '+new Date().toLocaleTimeString('vi-VN'));}
    catch(error){status('Chưa lưu được phiên: '+error.message);}
  }
  function stopWorker() {
    worker?.terminate();worker=null;
    jobs.forEach(job=>job.reject(new Error('Tác vụ đã bị hủy vì dữ liệu thay đổi.')));jobs.clear();
  }
  function runWorker(type,payload,transfers=[],progress=()=>{}) {
    if(!worker) {
      worker=new Worker('data-worker.js?v=19.0-workflow');
      worker.onmessage=event=>{const job=jobs.get(event.data.id);if(!job)return;if(event.data.progress!==undefined){job.progress(event.data.progress);return;}jobs.delete(event.data.id);event.data.error?job.reject(new Error(event.data.error)):job.resolve(event.data.result);};
      worker.onerror=()=>{jobs.forEach(job=>job.reject(new Error('Không khởi chạy được xử lý nền.')));jobs.clear();worker?.terminate();worker=null;};
    }
    return new Promise((resolve,reject)=>{const id=++jobId;jobs.set(id,{resolve,reject,progress});worker.postMessage({id,type,payload},transfers);});
  }
  function newDataset() {
    stopWorker();sheetRequest++;selectingSheet=false;preview=null;workbook=null;edit=null;undoStack=[];redoStack=[];linkedPage=1;
    if($('importPreviewPanel'))$('importPreviewPanel').hidden=true;
    if($('cellEditorDialog'))$('cellEditorDialog').hidden=true;
    if(restoring)return;
    epoch++;pendingDraft=null;clearTimeout(saveTimer);
    if($('restoreSessionBanner'))$('restoreSessionBanner').hidden=true;
    queue(()=>store('session','readwrite',s=>s.delete('current'))).catch(()=>{});
    status('Chưa có phiên dữ liệu để lưu');syncUndo();
  }
  function beginChange(){return AppState.cleanRows.slice();}
  function recordChange(before,label) {
    if(!before)return;
    const after=AppState.cleanRows.slice();
    if(before.length===after.length && before.every((row,i)=>row===after[i] || (Object.keys(row).length===Object.keys(after[i]).length && Object.keys(row).every(key=>Object.is(row[key],after[i][key])))))return;
    undoStack.push({before,after,label});redoStack=[];
    while(undoStack.length>20 || undoStack.length>1 && undoStack.reduce((n,item)=>n+item.before.length+item.after.length,0)>1000000)undoStack.shift();
    syncUndo();saveSoon();
  }
  function syncUndo() {
    if($('btnUndoBulkDelete')){$('btnUndoBulkDelete').disabled=!undoStack.length;$('btnUndoBulkDelete').textContent='Hoàn tác'+(undoStack.length?' ('+undoStack.length+')':'');}
    if($('btnRedoReview'))$('btnRedoReview').disabled=!redoStack.length;
    if($('reviewHistoryStatus'))$('reviewHistoryStatus').textContent=`${undoStack.length} thao tác có thể hoàn tác · ${redoStack.length} thao tác có thể làm lại`;
  }
  function travel(isRedo) {
    const source=isRedo?redoStack:undoStack,target=isRedo?undoStack:redoStack,entry=source.pop();if(!entry)return;
    target.push(entry);AppState.cleanRows=(isRedo?entry.after:entry.before).slice();AppState.lastBulkDelete=null;AppState.step3.selectedRows.clear();cancelBulkDelete();
    AppState.step3.feedbackHistory.push({time:new Date().toLocaleTimeString(),text:(isRedo?'Làm lại: ':'Hoàn tác: ')+entry.label,delta:`${AppState.cleanRows.length} dòng`});
    invalidateAnalysis(true);renderStep3View();syncUndo();document.dispatchEvent(new CustomEvent('pipeline:data'));
    showInlineToast('step3FeedbackToast',(isRedo?'Đã làm lại: ':'Đã hoàn tác: ')+entry.label+'. Cần kiểm duyệt lại.','info');
  }
  function stageImport(rows,name,metadata={}) {
    const inspection=inspectDataset(rows,AppState.requiredSchema),errors=[...(metadata.errors||[]),...inspection.errors];
    preview={name,...metadata,rows:inspection.rows,valid:errors.length===0};
    $('importPreviewPanel').hidden=false;
    $('importPreviewSummary').textContent=`${name}${metadata.sheetName?' · Sheet: '+metadata.sheetName:''} · ${rows.length} dòng · ${inspection.headers.length} cột`;
    const select=$('importSheetSelect');select.innerHTML=(metadata.sheetNames||[]).map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');select.value=metadata.sheetName||'';
    $('importSheetControl').hidden=!(metadata.sheetNames||[]).length;
    const showRows = indices => {
      const list = indices ?? inspection.rows.map((_,index)=>index);
      $('importPreviewTable').innerHTML='<thead><tr><th>Dòng nguồn</th>'+inspection.headers.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr></thead><tbody>'+list.slice(0,50).map(index=>'<tr><td>'+(index+2)+'</td>'+inspection.headers.map(h=>'<td>'+escapeHtml(String(inspection.rows[index][h]??''))+'</td>').join('')+'</tr>').join('')+'</tbody>';
      if ($('importQualityStatus')) $('importQualityStatus').textContent=list.length?'Hiển thị '+Math.min(50,list.length)+' / '+list.length+' dòng':'Không có dòng trong nhóm này.';
    };
    showRows(null);
    window.WorkflowImprovements?.quality(inspection,preview.valid,showRows);
    $('importPreviewStatus').textContent=errors.length?errors.join(' '):'Cấu trúc hợp lệ. Xác nhận nhập bảng này để bắt đầu làm sạch.';
    $('btnConfirmImport').disabled=errors.length>0;
    if(errors.length){setFailedFileContext(name,rows,inspection.headers,inspection.missingFields,inspection.fieldMap,Boolean(metadata.errors?.length));AppState.failedFile.sheetName=metadata.sheetName||'';showBigRedError(errors);}
    window.SmoothMotion?.reveal($('importPreviewPanel'));
  }
  function stageWorkbook(book,name,sheetName=book.SheetNames[0]) {
    workbook=book;
    const sheet=book.Sheets[sheetName];if(!sheet)throw new Error('Excel không có sheet dữ liệu.');
    const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}),names=(matrix[0]||[]).map(normalizeHeaderKey);
    stageImport(XLSX.utils.sheet_to_json(sheet,{defval:''}),name,{sheetNames:book.SheetNames,sheetName,errors:names.some((v,i)=>v && names.indexOf(v)!==i)?['Sheet có tiêu đề trùng nhau.']:[]});
  }
  function confirmImport() {
    if(!preview?.valid || selectingSheet)return false;
    const pending=preview;
    const accepted=validateFileSchema(pending.rows,pending.name);
    if(accepted){AppState.sheetName=pending.sheetName||'';saveSoon();}return accepted;
  }
  async function parseLargeFile(file,generation) {
    status('Đang đọc file ở nền…');
    const buffer=await file.arrayBuffer();if(generation!==fileReadGeneration)return;
    const result=await runWorker('parse',{name:file.name,buffer},[buffer]);
    if(generation!==fileReadGeneration)return;
    stageImport(result.rows,file.name,{...result,background:true});status('Đã đọc xong file. Hãy kiểm tra bản xem trước.');
  }
  async function changeSheet() {
    if(!preview)return;
    const old=preview,generation=fileReadGeneration,name=$('importSheetSelect').value;
    const ticket=++sheetRequest;selectingSheet=true;
    $('btnConfirmImport').disabled=true;
    $('importPreviewStatus').textContent='Đang đọc sheet được chọn…';
    try {
      if(old.background){const result=await runWorker('sheet',{name});if(generation===fileReadGeneration && ticket===sheetRequest)stageImport(result.rows,old.name,{...result,background:true});}
      else stageWorkbook(workbook,old.name,name);
    } catch(error){if(generation===fileReadGeneration && ticket===sheetRequest){$('importSheetSelect').value=old.sheetName;$('btnConfirmImport').disabled=!old.valid;showBigRedError([error.message]);}}
    finally {if(ticket===sheetRequest)selectingSheet=false;}
  }
  function renderAudit() {
    const audit=AppState.cleaningAudit;
    if(!audit || !$('cleaningAuditPanel'))return;
    $('cleaningAuditPanel').hidden=false;
    $('cleaningAuditSummary').textContent=`${audit.changedCells} ô thay đổi · ${audit.duplicates} đơn trùng bị loại · ${audit.unresolvedDates} ngày cần kiểm tra`;
    $('cleaningAuditRows').innerHTML=audit.changes.slice(0,100).map(c=>`<tr><td>${escapeHtml(c.orderId)}</td><td>${escapeHtml(c.column)}</td><td class="diff-before">${escapeHtml(String(c.before))||'∅'}</td><td class="diff-after">${escapeHtml(String(c.after))||'∅'}</td><td>${escapeHtml(c.reason || 'Chuẩn hóa dữ liệu')}</td></tr>`).join('') || '<tr><td colspan="5">Không có ô nào thay đổi giá trị.</td></tr>';
    $('cleaningAuditRemoved').textContent = audit.removed?.length
      ? 'Dòng nguồn bị loại do trùng mã đơn: '+audit.removed.map(row=>row.rowNumber+' ('+row.orderId+')').join(', ')+(audit.duplicates>audit.removed.length?'…':'')
      : '';
    $('cleaningAuditLimit').textContent=`Hiển thị ${Math.min(100,audit.changes.length)} / ${audit.changedCells} thay đổi. Dòng trùng được thống kê riêng.`;
  }
  function openCell(index,column) {
    if(!AppState.workflow.cleaned || AppState.workflow.cleaning || !AppState.headers.includes(column))return;
    const row=AppState.cleanRows[index];if(!row)return;
    edit={index,column,row};const f=AppState.fieldMap,input=$('cellEditorInput');
    $('cellEditorTitle').textContent='Sửa '+column;
    $('cellEditorDescription').textContent='Đơn '+row[f.order_id]+'. Thay đổi sẽ cần được kiểm duyệt lại.';
    input.type=column===f.revenue?'number':column===f.date?'date':'text';input.step='any';input.min='0';
    input.value=column===f.date?dateToISO(row[column]):String(row[column]??'');
    $('cellEditorError').textContent='';$('cellEditorDialog').hidden=false;input.focus();
  }
  function saveCell() {
    if(!edit)return;
    const {index,column,row}=edit,f=AppState.fieldMap;let value=$('cellEditorInput').value.trim();
    const fail=message=>{$('cellEditorError').textContent=message;return false;};
    if(AppState.cleanRows[index]!==row)return fail('Bảng đã thay đổi. Đóng và chọn lại ô.');
    if((column===f.order_id || column===f.customer_id || column===f.status) && !value)return fail('Trường này không được để trống.');
    if(column===f.order_id && AppState.cleanRows.some((r,i)=>i!==index && String(r[column]).trim()===value))return fail('Mã đơn này đã tồn tại.');
    if(column===f.revenue){if(value==='' || !Number.isFinite(Number(value)) || Number(value)<0)return fail('Doanh thu phải là số không âm.');value=Number(value);}
    if(column===f.date && value){const normalized=normalizeDateCell(value);if(!normalized.value)return fail('Ngày không hợp lệ.');value=normalized.value;}
    if(Object.is(row[column],value)){$('cellEditorDialog').hidden=true;edit=null;return true;}
    const before=beginChange();AppState.cleanRows=AppState.cleanRows.map((r,i)=>i===index?{...r,[column]:value}:r);
    AppState.step3.selectedRows.clear();AppState.lastBulkDelete=null;cancelBulkDelete();invalidateAnalysis(true);
    recordChange(before,'Sửa '+column+' của đơn '+row[f.order_id]);
    AppState.step3.feedbackHistory.push({time:new Date().toLocaleTimeString(),text:'Sửa '+column,delta:'1 ô'});
    $('cellEditorDialog').hidden=true;edit=null;renderStep3View();document.dispatchEvent(new CustomEvent('pipeline:data'));return true;
  }
  function baseRows() {return AppState.cleanRows.filter(row=>rowInDateRange(row[AppState.fieldMap.date],AppState.analytics.dateRange));}
  function linkedMatch(row) {
    const f=AppState.fieldMap,filters=AppState.analytics.crossFilters||{};
    if(filters.status!=null && String(row[f.status])!==filters.status)return false;
    const product=detectOptionalColumn(['san pham','product','dich vu','item','mat hang']),region=detectOptionalColumn(['khu vuc','region','tinh thanh','thanh pho']);
    if(filters.product!=null && (!product || String(row[product]||'Chưa phân loại')!==filters.product))return false;
    if(filters.region!=null && (!region || String(row[region]||'Chưa xác định')!==filters.region))return false;
    if(filters.customer!=null && String(row[f.customer_id])!==filters.customer)return false;
    if(filters.bucket && getTimeBucketMeta(row[f.date],filters.bucket.period).key!==filters.bucket.key)return false;
    if(filters.range){const n=Number(row[f.revenue]);if(n<filters.range.from || (filters.range.inclusive?n>filters.range.to:n>=filters.range.to))return false;}
    return true;
  }
  function applyFilter(type,value) {
    if(!AppState.workflow.dataApproved || !['status','product','region','customer','range','bucket'].includes(type))return;
    const filters=AppState.analytics.crossFilters||(AppState.analytics.crossFilters={});
    if(JSON.stringify(filters[type])===JSON.stringify(value))delete filters[type];else if(value==null)delete filters[type];else filters[type]=value;
    linkedPage=1;invalidateAnalysis();runDeepAnalytics();saveSoon();
    if($('linkedRowsPanel'))$('linkedRowsPanel').open=true;
  }
  function renderLinked() {
    if(!$('linkedFilterChips'))return;
    const names={status:'Trạng thái',product:'Sản phẩm',region:'Khu vực',customer:'Khách hàng',range:'Giá trị đơn',bucket:'Mốc thời gian'},filters=AppState.analytics.crossFilters||{};
    const entries=Object.entries(filters).filter(([,value])=>value!=null);
    $('linkedFilterChips').innerHTML=entries.map(([key,value])=>`<button type="button" class="linked-chip" data-clear-linked="${key}">${names[key]}: ${escapeHtml(key==='range'?`$${value.from}–$${value.to}`:key==='bucket'?value.key:String(value))} ×</button>`).join('') || '<span>Chưa lọc liên kết. Bấm điểm, cột, lát tròn hoặc bong bóng để lọc toàn bộ báo cáo.</span>';
    $('linkedFilterChips').querySelectorAll('[data-clear-linked]').forEach(button=>button.addEventListener('click',()=>applyFilter(button.dataset.clearLinked,null)));
    $('btnClearLinkedFilters').disabled=!entries.length;
    const rows=getAnalysisRows().filter(row=>!AppState.analytics.excludeCanceled || classifyStatusMeta(row[AppState.fieldMap.status]).key!=='Canceled');
    const maxPage=Math.max(1,Math.ceil(rows.length/20));linkedPage=Math.min(linkedPage,maxPage);
    $('linkedRowsSummary').textContent=`Xem ${rows.length} đơn hàng đang được tính trong báo cáo`;
    const cols=AppState.headers;
    $('linkedRowsTable').innerHTML='<thead><tr>'+cols.map(c=>'<th>'+escapeHtml(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice((linkedPage-1)*20,linkedPage*20).map(row=>'<tr>'+cols.map(c=>'<td>'+escapeHtml(String(row[c]??''))+'</td>').join('')+'</tr>').join('')+'</tbody>';
    $('linkedRowsPage').textContent=`Trang ${linkedPage} / ${maxPage}`;$('btnLinkedPrev').disabled=linkedPage<=1;$('btnLinkedNext').disabled=linkedPage>=maxPage;
  }
  async function archiveReport() {
    if(!canExport())return;
    const metrics=structuredClone(AppState.analytics.lastMetrics),reviewer=$('reviewerName')?.value.trim()||'Người kiểm duyệt';
    const payload={metrics,fileName:AppState.fileName,sheetName:AppState.sheetName||'',dateRange:{...AppState.analytics.dateRange},excludeCanceled:AppState.analytics.excludeCanceled,
      generatedAt:new Date().toLocaleString('vi-VN'),feedback:[...AppState.analysisFeedbackHistory],reviewer,linkedFilters:structuredClone(AppState.analytics.crossFilters||{})};
    reportStatus('Đang lưu phiên bản đã nghiệm thu…');
    try {const html=buildStandaloneReport(payload);await queue(async()=>{
      const database=await db();
      await new Promise((resolve,reject)=>{
        const tx=database.transaction('reports','readwrite'),records=tx.objectStore('reports'),list=records.getAll();
        list.onsuccess=()=>{const number=list.result.reduce((max,r)=>Math.max(max,r.number),0)+1;records.put({id:Date.now()+'-'+Math.random().toString(36).slice(2),number,savedAt:new Date().toISOString(),fileName:payload.fileName,reviewer,rows:metrics.orderCount,total:metrics.totalRev,html});};
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Không lưu được phiên bản.'));tx.onabort=()=>reject(tx.error||new Error('Lưu phiên bản bị hủy.'));
      });
    });await renderReports();reportStatus('Đã lưu phiên bản báo cáo và người nghiệm thu trên thiết bị.');}
    catch(error){reportStatus('Chưa lưu được phiên bản: '+error.message);}
  }
  const reviewerKey=name=>String(name||'Người kiểm duyệt').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');
  function matchingReports() {
    const query=normalizeHeaderKey(reportQuery);
    return reportRecords.filter(r=>(!reportReviewer || reviewerKey(r.reviewer)===reportReviewer) && (!query || normalizeHeaderKey(r.fileName+' '+r.reviewer).includes(query)));
  }
  function syncReportActions() {
    const matching=matchingReports();
    $('reportSelectionCount').textContent=reportSelected.size+' phiên bản đã chọn';
    for(const [id,disabled] of [['btnDeleteSelectedReports',!reportSelected.size],['btnDeleteReviewerReports',!reportReviewer || !reportRecords.some(r=>reviewerKey(r.reviewer)===reportReviewer)],['btnDeleteAllReports',!reportRecords.length],['btnSelectAllReports',!matching.length]])$(id).disabled=reportBusy || disabled;
  }
  function renderReportList() {
    const matching=matchingReports(),pages=Math.max(1,Math.ceil(matching.length/reportsLimit));reportPage=Math.min(Math.max(1,reportPage),pages);
    const shown=matching.slice((reportPage-1)*reportsLimit,reportPage*reportsLimit);
    $('reportVersionList').innerHTML=shown.map(report=>'<div class="report-version"><label class="report-version-choice"><input type="checkbox" data-report-select="'+escapeHtml(report.id)+'" aria-label="Chọn phiên bản '+report.number+'" '+(reportSelected.has(report.id)?'checked':'')+'><span><strong>V'+report.number+' · '+escapeHtml(report.fileName)+'</strong><small><span class="report-reviewer-name">'+escapeHtml(report.reviewer)+'</span> · '+escapeHtml(new Date(report.savedAt).toLocaleString('vi-VN'))+' · '+report.rows+' đơn</small></span></label><div class="report-version-actions"><button type="button" class="btn btn-secondary" data-download-version="'+escapeHtml(report.id)+'">Tải HTML</button><button type="button" data-delete-action data-delete-report="'+escapeHtml(report.id)+'" aria-label="Xóa phiên bản '+report.number+'">Xóa phiên bản</button></div></div>').join('') || '<div class="report-history-empty">'+(reportRecords.length?'Không có phiên bản phù hợp với bộ lọc.':'Chưa có phiên bản đã nghiệm thu.')+'</div>';
    $('reportPageSummary').textContent=matching.length?'Trang '+reportPage+' / '+pages+' · '+matching.length+' phiên bản':'Chưa có phiên bản phù hợp';
    $('btnReportPagePrev').disabled=reportPage<=1;$('btnReportPageNext').disabled=reportPage>=pages;
    $('selectReportPage').checked=shown.length>0 && shown.every(r=>reportSelected.has(r.id));$('selectReportPage').indeterminate=shown.some(r=>reportSelected.has(r.id)) && !$('selectReportPage').checked;$('selectReportPage').disabled=!shown.length;
    $('reportVersionList').querySelectorAll('[data-report-select]').forEach(input=>input.addEventListener('change',()=>{input.checked?reportSelected.add(input.dataset.reportSelect):reportSelected.delete(input.dataset.reportSelect);renderReportList();}));
    $('reportVersionList').querySelectorAll('[data-download-version]').forEach(button=>button.addEventListener('click',async()=>{const record=await store('reports','readonly',s=>s.get(button.dataset.downloadVersion));if(record)downloadBlob(record.html,'CodeKit_BaoCao_v'+record.number+'.html','text/html;charset=utf-8;');}));
    $('reportVersionList').querySelectorAll('[data-delete-report]').forEach(button=>button.addEventListener('click',()=>deleteReports([button.dataset.deleteReport])));
    window.DeleteMotion?.decorate($('reportVersionList'));syncReportActions();
  }
  async function renderReports() {
    const request=++reportsRead;
    try {
      const reports=(await store('reports','readonly',s=>s.getAll())).sort((a,b)=>b.number-a.number);
      if(request!==reportsRead)return;reportRecords=reports;
      const known=new Set(reports.map(r=>r.id));for(const id of reportSelected)if(!known.has(id))reportSelected.delete(id);
      const groups=new Map();reports.forEach(r=>{const key=reviewerKey(r.reviewer);if(!groups.has(key))groups.set(key,{key,name:r.reviewer||'Người kiểm duyệt',count:0,last:r.savedAt});const group=groups.get(key);group.count++;if(r.savedAt>group.last)group.last=r.savedAt;});
      if(reportReviewer && !groups.has(reportReviewer))reportReviewer='';
      $('reportTotalCount').textContent=reports.length.toLocaleString('vi-VN');$('reportReviewerCount').textContent=groups.size.toLocaleString('vi-VN');$('reportLastDate').textContent=reports.length?new Date(reports[0].savedAt).toLocaleDateString('vi-VN'):'Chưa có';
      $('reportReviewerSummaryCount').textContent=groups.size+' người';
      $('reportReviewerSummary').innerHTML=[...groups.values()].map(group=>'<button type="button" class="report-person" data-reviewer-key="'+escapeHtml(group.key)+'"><span class="report-person-avatar">'+escapeHtml(group.name.trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(group.name)+'</strong><small>'+group.count+' phiên bản · gần nhất '+escapeHtml(new Date(group.last).toLocaleDateString('vi-VN'))+'</small></span></button>').join('') || '<p class="workflow-help">Tên người nghiệm thu sẽ được tổng hợp tại đây sau khi lưu báo cáo.</p>';
      $('reportReviewerFilter').innerHTML='<option value="">Tất cả người nghiệm thu</option>'+[...groups.values()].map(group=>'<option value="'+escapeHtml(group.key)+'">'+escapeHtml(group.name)+' ('+group.count+')</option>').join('');$('reportReviewerFilter').value=reportReviewer;
      $('reportReviewerSummary').querySelectorAll('[data-reviewer-key]').forEach(button=>button.addEventListener('click',()=>{reportReviewer=button.dataset.reviewerKey;reportPage=1;$('reportReviewerFilter').value=reportReviewer;renderReportList();}));
      renderReportList();
    }catch(error){reportStatus(error.message);}
  }
  async function deleteReports(scope) {
    if(reportBusy)return false;
    const targets=Array.isArray(scope)?reportRecords.filter(r=>scope.includes(r.id)):scope==='selected'?reportRecords.filter(r=>reportSelected.has(r.id)):scope==='reviewer'?reportRecords.filter(r=>reviewerKey(r.reviewer)===reportReviewer):scope==='all'?reportRecords:[];
    if(!targets.length)return false;
    const description=scope==='reviewer'?' của '+targets[0].reviewer:'';
    if(!confirm('Xóa '+targets.length+' phiên bản báo cáo'+description+'? Các bản lưu này sẽ bị xóa khỏi lịch sử trên thiết bị.'))return false;
    reportBusy=true;reportStatus('Đang xóa '+targets.length+' phiên bản…');syncReportActions();
    try {
      await queue(async()=>{const database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('reports','readwrite'),records=tx.objectStore('reports');targets.forEach(r=>records.delete(r.id));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Chưa xóa được báo cáo.'));tx.onabort=()=>reject(tx.error||new Error('Xóa báo cáo bị hủy.'));});});
      targets.forEach(r=>reportSelected.delete(r.id));await renderReports();reportStatus('Đã xóa '+targets.length+' phiên bản. Dữ liệu đang phân tích được giữ nguyên.');return true;
    } catch(error) {reportStatus(error.message);return false;}
    finally {reportBusy=false;syncReportActions();}
  }
  async function restoreSession() {
    const state=pendingDraft;if(!state)return;
    if(state.version!==1 || !Array.isArray(state.rawRows) || !Array.isArray(state.cleanRows))return status('Bản nháp không đúng định dạng.');
    const schema=state.schema||getDefaultRequiredSchema(),inspection=inspectDataset(state.rawRows,schema);
    if(!getDefaultRequiredSchema().every(field=>schema.some(saved=>saved.key===field.key)))return status('Bản nháp thiếu cấu hình cột cốt lõi.');
    if(inspection.errors.length)return status('Bản nháp không còn hợp lệ: '+inspection.errors.join(' '));
    if(state.cleanRows.length && inspectDataset(state.cleanRows,schema).errors.length)return status('Bảng sạch trong bản nháp bị lỗi cấu trúc.');
    restoring=true;
    try {
      clearImportedData();AppState.requiredSchema=schema;AppState.rawRows=inspection.rows;AppState.headers=inspection.headers;AppState.fieldMap=inspection.fieldMap;
      AppState.fileName=state.fileName;AppState.sheetName=state.sheetName||'';AppState.cleanRows=state.cleanRows;AppState.step2BackupCleanRows=state.baseline||[];
      AppState.analytics={...AppState.analytics,...state.analytics,lastMetrics:null,crossFilters:state.analytics?.crossFilters||{}};
      const {categoryColumn,categoryValue,statusFilter,...review}=state.step3||{};
      AppState.step3={...AppState.step3,...review,selectedRows:new Set(),
        categoryFilters:review.categoryFilters ?? (categoryColumn && categoryValue ? [{column:categoryColumn,values:[categoryValue]}] : []),
        statusFilters:review.statusFilters ?? (statusFilter && statusFilter!=='ALL' ? [statusFilter] : [])
      };
      $('tableFilterInput').value=AppState.step3.searchQuery;
      AppState.analysisFeedbackHistory=state.analysisFeedbackHistory||[];AppState.cleaningAudit=state.audit;
      Object.assign(AppState.workflow,state.workflow,{importValid:true,cleaning:false,analysisRunning:false,analysisReady:false,finalApproved:false,resultsViewed:false});
      undoStack=state.undoStack||[];redoStack=state.redoStack||[];
      $('feedbackInputStep3').value=state.feedback3||'';$('feedbackInputStep6').value=state.feedback6||'';$('reviewerName').value=state.reviewer||'';
      $('paramProfitMargin').value=AppState.analytics.profitMargin*100;$('paramProfitMarginVal').textContent=Math.round(AppState.analytics.profitMargin*100)+'%';
      $('paramFocusStrategy').value=AppState.analytics.focusStrategy;$('paramExcludeCanceled').checked=AppState.analytics.excludeCanceled;
      resetTimeSlicerInputs('analytics');$('analyticsDateFrom').value=AppState.analytics.dateRange?.from||'';$('analyticsDateTo').value=AppState.analytics.dateRange?.to||'';
      if($('analyticsDateFrom').value || $('analyticsDateTo').value)$('analyticsTimePreset').value='custom';
      renderRequiredKeysPills();renderAudit();syncUndo();$('restoreSessionBanner').hidden=true;pendingDraft=null;
      if(!AppState.workflow.cleaned){setStep(2);startAICleaning();}
      else if(AppState.workflow.dataApproved && !AppState.workflow.dataFeedbackPending){startAnalysis();}
      else setStep(3);
      document.dispatchEvent(new CustomEvent('pipeline:data'));status('Đã khôi phục phiên. Kết quả cần được nghiệm thu lại trước khi xuất.');
    } finally {restoring=false;}
  }
  async function init() {
    $('btnConfirmImport').addEventListener('click',confirmImport);$('importSheetSelect').addEventListener('change',changeSheet);
    $('btnSaveSessionNow')?.addEventListener('click',saveNow);
    $('btnCancelImport').addEventListener('click',()=>{newDataset();});$('btnRedoReview').addEventListener('click',()=>travel(true));
    $('btnCellSave').addEventListener('click',saveCell);$('btnCellCancel').addEventListener('click',()=>{$('cellEditorDialog').hidden=true;edit=null;});
    $('btnRestoreSession').addEventListener('click',restoreSession);
    $('btnDiscardSession').addEventListener('click',()=>{epoch++;pendingDraft=null;$('restoreSessionBanner').hidden=true;queue(()=>store('session','readwrite',s=>s.delete('current'))).catch(error=>status(error.message));});
    $('btnClearLinkedFilters').addEventListener('click',()=>{AppState.analytics.crossFilters={};invalidateAnalysis();runDeepAnalytics();saveSoon();});
    $('btnLinkedPrev').addEventListener('click',()=>{linkedPage=Math.max(1,linkedPage-1);renderLinked();});$('btnLinkedNext').addEventListener('click',()=>{linkedPage++;renderLinked();});
    $('btnSaveReportVersion').addEventListener('click',archiveReport);$('btnRefreshReportVersions').addEventListener('click',renderReports);
    $('reportHistorySearch').addEventListener('input',event=>{reportQuery=event.target.value;reportPage=1;renderReportList();});
    $('reportReviewerFilter').addEventListener('change',event=>{reportReviewer=event.target.value;reportPage=1;renderReportList();});
    $('btnReportPagePrev').addEventListener('click',()=>{reportPage--;renderReportList();});$('btnReportPageNext').addEventListener('click',()=>{reportPage++;renderReportList();});
    $('selectReportPage').addEventListener('change',event=>{matchingReports().slice((reportPage-1)*reportsLimit,reportPage*reportsLimit).forEach(r=>event.target.checked?reportSelected.add(r.id):reportSelected.delete(r.id));renderReportList();});
    $('btnSelectAllReports').addEventListener('click',()=>{matchingReports().forEach(r=>reportSelected.add(r.id));renderReportList();});
    $('btnDeleteSelectedReports').addEventListener('click',()=>deleteReports('selected'));$('btnDeleteReviewerReports').addEventListener('click',()=>deleteReports('reviewer'));$('btnDeleteAllReports').addEventListener('click',()=>deleteReports('all'));
    document.addEventListener('pipeline:data',saveSoon);document.addEventListener('pipeline:step',saveSoon);
    document.addEventListener('input',event=>{if(['feedbackInputStep3','feedbackInputStep6','reviewerName','paramProfitMargin'].includes(event.target.id))saveSoon();});
    document.addEventListener('change',event=>{if(['paramFocusStrategy','paramExcludeCanceled'].includes(event.target.id))saveSoon();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveNow();});
    window.addEventListener('pagehide',saveNow);
    document.addEventListener('keydown',event=>{
      if(!$('cellEditorDialog').hidden){
        if(event.key==='Escape'){$('cellEditorDialog').hidden=true;edit=null;}
        if(event.key==='Enter' && event.target===$('cellEditorInput')){event.preventDefault();saveCell();}
        if(event.key==='Tab') {
          const controls=[$('cellEditorInput'),$('btnCellCancel'),$('btnCellSave')];
          if(event.shiftKey && document.activeElement===controls[0]){event.preventDefault();controls[2].focus();}
          else if(!event.shiftKey && document.activeElement===controls[2]){event.preventDefault();controls[0].focus();}
        }
      }
    });
    const initialEpoch=epoch;
    try {const saved=await store('session','readonly',s=>s.get('current'));if(initialEpoch===epoch && saved && !AppState.rawRows.length){pendingDraft=saved;$('restoreSessionBanner').hidden=false;$('restoreSessionDescription').textContent=`${saved.fileName} · ${saved.workflow?.cleaned ? saved.cleanRows?.length||0 : saved.rawRows?.length||0} dòng · ${new Date(saved.savedAt).toLocaleString('vi-VN')}`;status('Có phiên đã lưu. Chọn Tiếp tục để khôi phục.');}else status('Tự lưu phiên trên thiết bị đã sẵn sàng.');}
    catch(error){status(error.message);}
    renderReports();
  }
  window.Workbench={init,renderReports,deleteReports,runWorker,workerAvailable:()=>typeof Worker==='function',newDataset,beginChange,recordChange,undo:()=>travel(false),redo:()=>travel(true),syncUndo,stageImport,stageWorkbook,confirmImport,parseLargeFile,renderAudit,openCell,saveCell,baseRows,linkedMatch,applyFilter,renderLinked,archiveReport,saveSoon,saveNow,restoreSession};
})();
