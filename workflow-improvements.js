/* Import quality, review guidance and analysis comparison. */
(() => {
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat('vi-VN',{style:'currency',currency:'USD',maximumFractionDigits:0});
  function quality(inspection, valid, select) {
    const seen = new Set(), groups = {valid:[], duplicate:[], date:[], order:[], customer:[]};
    const f = inspection.fieldMap;
    inspection.rows.forEach((row,index) => {
      const id = String(row[f.order_id] ?? '').trim();
      const duplicate = id && seen.has(id);
      if (id) seen.add(id);
      const missingDate = !dateToISO(row[f.date]), missingCustomer = !String(row[f.customer_id] ?? '').trim();
      if (duplicate) groups.duplicate.push(index);
      if (missingDate) groups.date.push(index);
      if (!id) groups.order.push(index);
      if (missingCustomer) groups.customer.push(index);
      if (valid && !duplicate && !missingDate) groups.valid.push(index);
    });
    const host = $('importQuality');
    host.replaceChildren();
    for (const [key,label] of Object.entries({valid:'Qua kiểm tra cấu trúc và ngày',duplicate:'Trùng mã đơn',date:'Ngày thiếu hoặc lỗi',order:'Thiếu mã đơn',customer:'Thiếu mã khách'})) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.textContent = label + ' · ' + groups[key].length;
      button.addEventListener('click', () => select(groups[key]));
      host.append(button);
    }
    const all = document.createElement('button');
    all.type='button'; all.className='btn btn-secondary'; all.textContent='Xem tất cả';
    all.addEventListener('click',()=>select(null)); host.append(all);
  }
  const iso = ms => new Date(ms).toISOString().slice(0,10);
  function comparison() {
    const range = AppState.analytics.dateRange;
    if (!$('comparePrevious').checked || !range.from || !range.to || AppState.analytics.crossFilters?.bucket) return null;
    const start = Date.parse(range.from), end = Date.parse(range.to), day=86400000;
    const previous={from:iso(start-(end-start+day)),to:iso(start-day)};
    const totals = selected => {
      const result={orders:0,revenue:0,series:{}};
      AppState.cleanRows.forEach(row=>{
        const f=AppState.fieldMap, date=dateToISO(row[f.date]);
        if (!date || !rowInDateRange(row[f.date],selected) || !Workbench.linkedMatch(row)) return;
        if (AppState.analytics.excludeCanceled && classifyStatusMeta(row[f.status]).key==='Canceled') return;
        const revenue=Number(row[f.revenue])||0;
        result.orders++; result.revenue+=revenue;
        const dayIndex=(Date.parse(date)-Date.parse(selected.from))/day;
        result.series[dayIndex]=(result.series[dayIndex]||0)+revenue;
      });
      return result;
    };
    return {range,previous,current:totals(range),prior:totals(previous)};
  }
  let chart;
  function renderComparison() {
    const data=comparison(), host=$('comparisonResult');
    host.hidden=!$('comparePrevious').checked;
    chart?.destroy(); chart=null;
    $('comparisonChart').hidden=!data;
    if (!data) {
      $('comparisonSummary').textContent='Chọn đủ ngày bắt đầu và kết thúc, rồi bỏ bộ lọc mốc thời gian từ biểu đồ nếu đang dùng.';
      return;
    }
    const {range,previous,current,prior}=data;
    const delta = (a,b,format) => (a>b?'+':a<b?'−':'')+format(Math.abs(a-b));
    $('comparisonSummary').textContent=range.from+' – '+range.to+' so với '+previous.from+' – '+previous.to+
      ' · Doanh thu '+money.format(current.revenue)+' / '+money.format(prior.revenue)+' ('+delta(current.revenue,prior.revenue,n=>money.format(n))+')'+
      ' · Số đơn '+current.orders+' / '+prior.orders+' ('+delta(current.orders,prior.orders,String)+')';
    const days=(Date.parse(range.to)-Date.parse(range.from))/86400000+1;
    const size=Math.ceil(days/30), count=Math.ceil(days/size);
    function values(period) {
      const buckets=Array(count).fill(0);
      Object.entries(period.series).forEach(([index,value])=>{buckets[Math.floor(index/size)]+=value;});
      return buckets;
    }
    const labels=Array.from({length:count},(_,i)=>size===1?String(i+1):(i*size+1)+'–'+Math.min(days,(i+1)*size));
    const canvas=$('comparisonChart');
    const options=chartInteractionOptions();
    options.scales.x.title={display:true,text:'Ngày thứ mấy trong mỗi kỳ'};
    options.maintainAspectRatio=false;
    const config={type:'bar',data:{labels,datasets:[
      {label:'Kỳ đang xem',data:values(current),backgroundColor:'#9f6235'},
      {label:'Kỳ trước',data:values(prior),backgroundColor:'#d6ae78'}
    ]},options};
    chart=window.SmoothMotion?.createChart(canvas,config) || new Chart(canvas,config);
  }
  const key='codekit-analysis-presets-v1';
  function presets() {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }
  function showPresets(selected='') {
    const select=$('analysisPreset');
    select.replaceChildren(new Option('Chọn bộ lọc đã lưu',''));
    presets().forEach((preset,index)=>select.add(new Option(preset.name,String(index))));
    select.value=selected;
    $('deleteAnalysisPreset').disabled=select.value==='';
  }
  function savePresets(entries, selected) {
    try { localStorage.setItem(key,JSON.stringify(entries)); showPresets(selected); return true; }
    catch { $('analysisPresetStatus').textContent='Trình duyệt không cho phép lưu bộ lọc.'; return false; }
  }
  function init() {
    showPresets();
    $('comparePrevious').addEventListener('change',renderComparison);
    $('saveAnalysisPreset').addEventListener('click',()=>{
      const name=$('analysisPresetName').value.trim();
      if (!name) { $('analysisPresetStatus').textContent='Nhập tên bộ lọc trước khi lưu.'; $('analysisPresetName').focus(); return; }
      const entries=presets();
      const preset={name,range:{...AppState.analytics.dateRange},filters:structuredClone(AppState.analytics.crossFilters||{})};
      const match=entries.findIndex(item=>item.name===name);
      const index=match<0?entries.length:match;
      entries[index]=preset;
      if (savePresets(entries,String(index))) $('analysisPresetStatus').textContent='Đã lưu bộ lọc “'+name+'”.';
    });
    $('analysisPreset').addEventListener('change',event=>{
      const value=event.target.value;
      $('deleteAnalysisPreset').disabled=value==='';
      if (value==='') return;
      const preset=presets()[Number(value)];
      if (!preset) return;
      $('analyticsDateFrom').value=preset.range.from;
      $('analyticsDateTo').value=preset.range.to;
      $('analyticsTimePreset').value=preset.range.from||preset.range.to?'custom':'all';
      AppState.analytics.crossFilters=structuredClone(preset.filters);
      $('analyticsApplyTime').click();
      $('analysisPresetStatus').textContent='Đang dùng “'+preset.name+'”.';
    });
    $('deleteAnalysisPreset').addEventListener('click',()=>{
      const selected=$('analysisPreset').value;
      if (selected==='') return;
      if (savePresets(presets().filter((_,index)=>index!==Number(selected)))) $('analysisPresetStatus').textContent='Đã xóa bộ lọc đã lưu.';
    });
    document.addEventListener('pipeline:data',()=>{
      if (!AppState.workflow.dataApproved) {
        chart?.destroy(); chart=null;
        $('comparePrevious').checked=false;
        $('comparisonResult').hidden=true;
        showPresets();
      }
    });
  }
  window.WorkflowImprovements={quality,renderComparison};
  document.addEventListener('DOMContentLoaded',init);
})();
