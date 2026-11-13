/* Overview presentation layer. The existing data pipeline remains the source of truth. */
(() => {
  'use strict';
  const view = { sampleRows: [], period: 'week', dateRange: { from: '', to: '' }, expanded: false, samplePromise: null, toastTimer: null };
  const $ = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  const money = value => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const safe = value => escapeHtml(String(value ?? ''));
  const icons = () => window.lucide?.createIcons();

  function notify(message) {
    $('appToast').textContent = message;
    $('appToast').hidden = false;
    clearTimeout(view.toastTimer);
    view.toastTimer = setTimeout(() => { $('appToast').hidden = true; }, 4200);
  }

  function currentData() {
    const isClean = AppState.workflow.cleaned;
    const isOwn = AppState.workflow.importValid;
    const rows = isOwn ? (isClean ? AppState.cleanRows : AppState.rawRows) : [];
    const headers = Object.keys(rows[0] || {});
    const find = candidates => headers.find(h => candidates.some(c => normalizeHeaderKey(h).includes(c))) || '';
    const mapped = isOwn ? AppState.fieldMap : {};
    return {
      rows, isOwn, isClean,
      fields: {
        customer: mapped.customer_id || find(['makhachhang', 'customerid']),
        name: find(['tenkhachhang', 'customername', 'tencongty']),
        order: mapped.order_id || find(['madonhang', 'orderid']),
        revenue: mapped.revenue || find(['doanhthu', 'revenue', 'amount']),
        status: mapped.status || find(['trangthai', 'status']),
        date: mapped.date || find(['ngaygiaohang', 'date', 'ngaydat']),
        product: find(['sanpham', 'product', 'dichvu', 'item'])
      }
    };
  }

  function datasetRows(data) {
    const f = data.fields;
    return data.rows.map(row => {
      const date = row[f.date] == null || String(row[f.date]).trim() === '' ? '—' : normalizeDateCell(row[f.date]).value;
      const parts = parseDateParts(date);
      return {
        customer: row[f.customer] || '', name: row[f.name] || row[f.customer] || 'Khách hàng',
        order: row[f.order] || '—', revenue: parsePositiveNumber(row[f.revenue]) || 0,
        status: String(row[f.status] || 'Chưa có trạng thái'), date,
        product: row[f.product] || row[f.name] || 'Đơn hàng', parts,
        dateKey: parts ? parts.sortKey : 0
      };
    }).filter(row => rowInDateRange(row.date, view.dateRange));
  }

  function seriesFor(rows, period) {
    const groups = new Map();
    rows.forEach(row => {
      if (!row.parts) return;
      const { d, m, y } = row.parts;
      let key = `${y}-${m}-${d}`;
      let label = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
      let sort = row.dateKey;
      if (period === 'week') {
        const day = new Date(y, m - 1, d);
        day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
        key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
        label = `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
        sort = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
      }
      if (!groups.has(key)) groups.set(key, { label, sort, value: 0, orders: 0 });
      groups.get(key).value += row.revenue;
      groups.get(key).orders++;
    });
    return [...groups.values()].sort((a,b) => a.sort - b.sort);
  }

  function hideChartTooltip() {
    const tooltip=$('overviewChartTooltip'); if(tooltip)tooltip.hidden=true;
  }

  function bindInstantChartHover(container, series, geometry, onSelect, onLeave) {
    let selected=-1;
    function show(index,event) {
      if(!series.length || !overviewUnlocked()) return;
      selected=Math.max(0,Math.min(series.length-1,index));
      const item=series[selected];
      onSelect(selected);
      const tooltip=$('overviewChartTooltip');
      if(!tooltip) return;
      $('overviewHoverLabel').textContent=geometry.label(item);
      $('overviewHoverValue').textContent=money(item.value);
      $('overviewHoverMeta').textContent=`${number(item.orders)} đơn hàng · Doanh thu USD`;
      tooltip.hidden=false;
      const rect=container.getBoundingClientRect();
      const x=event?.clientX ?? rect.left+geometry.position(selected)*rect.width;
      const y=event?.clientY ?? rect.top+rect.height*.4;
      const tw=tooltip.offsetWidth || 208, th=tooltip.offsetHeight || 88;
      const viewportWidth=window.innerWidth || 1366, viewportHeight=window.innerHeight || 768;
      const left=x+15+tw>viewportWidth-12 ? x-tw-15 : x+15;
      const top=y+14+th>viewportHeight-12 ? y-th-14 : y+14;
      tooltip.style.left=`${Math.max(12,Math.min(left,viewportWidth-tw-12))}px`;
      tooltip.style.top=`${Math.max(12,Math.min(top,viewportHeight-th-12))}px`;
    }
    function move(event) {
      const rect=container.getBoundingClientRect();
      if(!rect.width || !series.length)return;
      const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
      show(geometry.index(fraction),event);
    }
    container.onpointerenter=move;
    container.onpointermove=move;
    container.onpointerdown=move;
    container.onpointerleave=() => { hideChartTooltip(); onLeave(); };
    container.onfocus=() => show(geometry.initial ?? 0);
    container.onblur=() => { hideChartTooltip();onLeave();selected=-1; };
    container.onkeydown=event => {
      if(event.key==='Escape') {hideChartTooltip();onLeave();return;}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      show(event.key==='Home'?0:event.key==='End'?series.length-1:(selected<0?0:selected)+(event.key==='ArrowRight'?1:-1));
    };
    hideChartTooltip();
  }

  function drawBars(rows) {
    const fullSeries=seriesFor(rows,view.period),series=fullSeries.slice(-7);
    const peak=Math.max(1,...series.map(s=>s.value));
    const upper=Math.ceil(peak/(peak>10000?10000:1000))*(peak>10000?10000:1000);
    const container=$('overviewBarChart');
    const width=Math.max(280,container.clientWidth || 460),height=container.clientHeight || 165,left=35,top=20,bottom=25;
    const plotHeight=height-top-bottom,plotWidth=width-left-8,gap=plotWidth/Math.max(series.length,1),barWidth=Math.min(39,gap*.69);
    const peakIndex=series.findIndex(s=>s.value===peak);
    let svg=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><pattern id="barHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="5" stroke="#ffffff" stroke-opacity=".17" stroke-width="2"/></pattern></defs>`;
    for(let i=0;i<=3;i++){
      const y=top+plotHeight*i/3,value=upper*(1-i/3),label=value>=1000?`${Math.round(value/1000)}k`:`${Math.round(value)}`;
      svg+=`<line class="chart-grid-line" x1="${left}" x2="${width}" y1="${y}" y2="${y}"/><text x="0" y="${y+3}">${label}</text>`;
    }
    series.forEach((item,i)=>{
      const barHeight=Math.max(2,item.value/upper*plotHeight),x=left+i*gap+(gap-barWidth)/2,y=top+plotHeight-barHeight;
      svg+=`<g class="bar-column" data-bar-index="${i}"><rect class="bar-body ${i===peakIndex?'bar-active':'bar-muted'}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.min(19,barWidth/2)}"/><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.min(19,barWidth/2)}" fill="url(#barHatch)" pointer-events="none"/><text text-anchor="middle" x="${x+barWidth/2}" y="${height-5}">${item.label}</text></g>`;
    });
    svg+='<g id="overviewBarValueBadge" pointer-events="none" visibility="hidden"><rect x="-32" y="-17" width="64" height="17" rx="8.5" fill="#168459"/><text x="0" y="-5" text-anchor="middle" style="fill:white;font-size:8px"></text></g>';
    container.innerHTML=svg+'</svg>';
    const select=index=>{
      container.querySelectorAll('.bar-body').forEach((bar,i)=>{bar.classList.toggle('bar-active',i===index);bar.classList.toggle('bar-muted',i!==index);});
      container.querySelectorAll('.bar-column').forEach((group,i)=>group.classList.toggle('is-hovered',i===index));
      const badge=$('overviewBarValueBadge');
      if(!badge)return;
      if(index<0 || !series[index]) {badge.setAttribute('visibility','hidden');return;}
      const x=left+index*gap+gap/2,y=top+plotHeight-Math.max(2,series[index].value/upper*plotHeight);
      badge.setAttribute('visibility','visible');badge.setAttribute('transform',`translate(${Math.min(width-33,Math.max(33,x))},${Math.max(18,y-4)})`);
      badge.querySelector('text').textContent='$'+number(series[index].value);
    };
    select(peakIndex);
    bindInstantChartHover(container,series,{
      index:fraction=>Math.floor((fraction*width-left)/gap),
      position:index=>(left+index*gap+gap/2)/width,
      initial:Math.max(0,peakIndex),
      label:item=>(view.period==='week'?'Tuần từ ':'Ngày ')+item.label+'/'+Math.floor(item.sort/10000)
    },select,()=>select(peakIndex));
    container.setAttribute('aria-label',`Doanh thu theo ${view.period==='week'?'tuần':'ngày'}. Rê chuột hoặc dùng phím trái/phải để xem từng mốc. ${series.map(s=>`${s.label}: ${money(s.value)}`).join(', ')}`);
    (window.OverviewReveal?.watchChart || window.SmoothMotion?.watchSVG)?.(container,'overview-bars:'+JSON.stringify(series));
    $('overviewChartTotal').textContent=number(series.reduce((sum,s)=>sum+s.value,0));
    const missingDates=rows.filter(row=>!row.parts).length;
    $('overviewChartCaption').textContent=`${series.length} ${view.period==='week'?'tuần':'ngày'} gần nhất · ${missingDates?`${missingDates} đơn chưa có ngày`:fullSeries.length>7?'Một phần kỳ dữ liệu':'Toàn bộ kỳ dữ liệu'}`;
  }

  function drawSparkline(rows) {
    const series=seriesFor(rows,'day'),container=$('overviewSparkline');
    if(!series.length){container.innerHTML='';bindInstantChartHover(container,[],{index:()=>0,position:()=>0,label:()=>''},()=>{},()=>{});return;}
    const values=series.map(s=>s.value),max=Math.max(...values,1),min=Math.min(...values);
    const points=values.map((value,i)=>[values.length===1?150:i/(values.length-1)*300,68-((value-min)/Math.max(1,max-min))*50]);
    const line=points.map((p,i)=>`${i?'L':'M'} ${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    container.innerHTML=`<svg viewBox="0 0 300 85" preserveAspectRatio="none"><defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#89bd9e" stop-opacity=".4"/><stop offset="100%" stop-color="#89bd9e" stop-opacity="0"/></linearGradient></defs><path d="${line} L ${points.at(-1)[0]},85 L ${points[0][0]},85 Z" fill="url(#sparkFill)"/><path d="${line}" fill="none" stroke="#83ac92" stroke-width="1.5" stroke-linejoin="round"/><g id="overviewSparkFocus" visibility="hidden" pointer-events="none"><line x1="0" x2="0" y1="5" y2="85" stroke="#168459" stroke-opacity=".4" stroke-dasharray="3 3"/><circle cx="0" cy="0" r="4" fill="#168459" stroke="var(--bg-surface)" stroke-width="2"/></g></svg>`;
    const focus=index=>{
      const marker=$('overviewSparkFocus');if(!marker)return;
      marker.setAttribute('visibility','visible');marker.setAttribute('transform',`translate(${points[index][0]},0)`);marker.querySelector('circle').setAttribute('cy',points[index][1]);
    };
    bindInstantChartHover(container,series,{
      index:fraction=>Math.round(fraction*(series.length-1)),position:index=>points[index][0]/300,
      label:item=>'Ngày '+item.label+'/'+Math.floor(item.sort/10000)
    },focus,()=> $('overviewSparkFocus')?.setAttribute('visibility','hidden'));
    (window.OverviewReveal?.watchChart || window.SmoothMotion?.watchSVG)?.(container,'overview-spark:'+JSON.stringify(series));
    container.setAttribute('aria-label','Doanh thu từng ngày. Rê chuột hoặc dùng phím trái/phải để xem chi tiết.');
  }

  function renderRecent(rows) {
    const query = ($('globalSearch').value || '').trim().toLowerCase();
    const matches = [...rows].filter(row => Object.values(row).some(v => typeof v !== 'object' && String(v).toLowerCase().includes(query))).sort((a,b) => b.dateKey-a.dateKey);
    const shown = matches.slice(0,view.expanded ? 10 : 3);
    $('overviewRecentRows').innerHTML = shown.length ? shown.map((row,i) => {
      const meta = classifyStatusMeta(row.status);
      const labels = { Completed: 'Hoàn tất', Shipped: 'Đang giao', Processing: 'Đang xử lý', Canceled: 'Đã hủy' };
      return `<tr><td><div class="recent-product"><span class="product-icon product-color-${i%4}">${safe(row.product.charAt(0).toUpperCase())}</span><div><strong>${safe(row.product)}</strong><small>${safe(row.name)} · ${safe(row.order)}</small></div></div></td><td>${safe(row.date)}</td><td><span class="mini-status ${meta.key.toLowerCase()}">${safe(labels[meta.key] || row.status)}</span></td><td>${money(row.revenue)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-recent">Không tìm thấy đơn hàng phù hợp.</td></tr>';
    $('recentCount').textContent = `${shown.length} / ${number(matches.length)} đơn hàng${query ? ' phù hợp' : ''}`;
    $('recentShowAll').innerHTML = `${view.expanded ? 'Thu gọn' : 'Xem thêm'} <i data-lucide="${view.expanded ? 'arrow-up' : 'arrow-right'}"></i>`;
    icons();
  }

  function overviewUnlocked() {
    return AppState.workflow.importValid && AppState.workflow.cleaned && [2,6].includes(AppState.currentStep) && currentData().rows.length > 0;
  }

  function syncOverviewLock(data) {
    const locked=!AppState.workflow.importValid || !AppState.workflow.cleaned || AppState.currentStep===1 || data.rows.length===0;
    $('overviewSection').hidden=[3,4,5].includes(AppState.currentStep);
    $('overviewSection').classList.toggle('is-locked',locked);
    $('overviewLockBanner').hidden=!locked;
    $('overviewTimeSlicer').disabled=locked;
    $('toggleOverviewSearch').disabled=locked;
    if(window.OverviewReveal)window.OverviewReveal.sync({locked,visible:!$('overviewSection').hidden});
    else document.querySelectorAll('.overview-card-lock').forEach(overlay=>overlay.hidden=!locked);
    ['overviewBarChart','overviewSparkline'].forEach(id=>$(id).setAttribute('tabindex',locked?'-1':'0'));
    if(!window.OverviewReveal)document.querySelectorAll('[data-overview-card]').forEach(card=>{
      card.classList.toggle('dashboard-card-locked',locked);
      card.setAttribute('aria-disabled',String(locked));
      card.querySelectorAll('button,input,select').forEach(control=>control.disabled=locked);
      [...card.children].forEach(child=>{
        if(child.classList.contains('overview-card-lock')) { child.hidden=!locked; return; }
        child.inert=locked;
        if(locked) child.setAttribute('aria-hidden','true'); else child.removeAttribute('aria-hidden');
      });
    });
    if(locked) {
      hideChartTooltip();
      window.SmoothMotion?.forgetChart($('overviewBarChart'));
      window.SmoothMotion?.forgetChart($('overviewSparkline'));
      const cleaning=AppState.workflow.importValid && !AppState.workflow.cleaned;
      const emptyAfterImport=AppState.workflow.importValid && !cleaning;
      $('overviewLockTitle').textContent=cleaning?'Đang làm sạch dữ liệu':emptyAfterImport?'Bảng dữ liệu hiện không còn bản ghi':'Dashboard chưa được mở khóa';
      $('overviewLockDescription').textContent=cleaning?'Hoàn tất Bước 2 rồi cuộn tới từng thẻ để mở khóa số liệu và biểu đồ.':emptyAfterImport?'Khôi phục dữ liệu ở Bước 3 hoặc nhập bảng tính mới để xem dashboard.':'Tải file Excel hoặc CSV hợp lệ ở Bước 1 để xem số liệu và biểu đồ.';
      $('overviewSource').textContent=emptyAfterImport?'Không có bản ghi để hiển thị':'Chưa nhập bảng tính';
      $('overviewDateRange').textContent=emptyAfterImport?'Không có bản ghi':'Chưa chọn bảng tính';
      $('overviewTimeSummary').textContent='Tải file để sử dụng bộ lọc thời gian';
      ['overviewRecordCount','overviewCustomers','overviewRevenue','overviewChartTotal','overviewCompletion'].forEach(id=>$(id).textContent='—');
      $('overviewDatasetType').textContent='CHƯA CÓ DỮ LIỆU';
      $('overviewCompletionBar').style.width='0%';
      $('overviewStatusSummary').innerHTML='';
      $('overviewBarChart').innerHTML=''; $('overviewSparkline').innerHTML='';
      $('overviewChartCaption').textContent='Chưa có dữ liệu để phân tích';
      $('overviewRecentRows').innerHTML='<tr><td colspan="4" class="empty-recent">Nhập bảng tính để xem các đơn hàng.</td></tr>';
      $('recentCount').textContent='Chưa có dữ liệu';
      $('useSampleData').hidden=false;
      view.dateRange={from:'',to:''}; view.expanded=false;view.period='week';
      $('globalSearch').value='';$('overviewSearchWrap').hidden=true;
      $('overviewPeriod').querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.period==='week'));
      resetTimeSlicerInputs('overview');
      $('overviewTimeSummary').textContent='Tải file để sử dụng bộ lọc thời gian';
    }
    return !locked;
  }

  function renderOverview() {
    const data = currentData();
    if(!syncOverviewLock(data)) return;
    const rows = datasetRows(data);
    $('overviewTimeSummary').textContent = `${rows.length} / ${data.rows.length} bản ghi trong kỳ${view.dateRange.from || view.dateRange.to ? ' · loại các dòng chưa có ngày' : ''}`;
    const revenue = rows.reduce((sum,row) => sum + row.revenue,0);
    const customers = new Set(rows.map(r => r.customer).filter(Boolean)).size;
    const completed = rows.filter(r => ['Completed','Shipped'].includes(classifyStatusMeta(r.status).key)).length;
    const canceled = rows.filter(r => classifyStatusMeta(r.status).key === 'Canceled').length;
    const rate = rows.length ? completed / rows.length * 100 : 0;
    $('overviewRecordCount').textContent = number(rows.length);
    $('overviewCustomers').textContent = number(customers);
    $('overviewRevenue').textContent = money(revenue);
    $('overviewCompletion').textContent = rate.toFixed(1) + '%';
    $('overviewCompletionBar').style.width = rate + '%';
    $('overviewStatusSummary').innerHTML = `<span>${number(completed)} hoàn tất / đang giao</span><span>${number(canceled)} đã hủy</span>`;
    $('overviewSource').textContent = `${data.isOwn ? (data.isClean ? 'Dữ liệu đã làm sạch' : 'Dữ liệu vừa tải lên') : 'Dữ liệu mẫu'} · ${number(data.rows.length)} đơn hàng`;
    $('overviewDatasetType').textContent = data.isOwn ? (data.isClean ? 'ĐÃ LÀM SẠCH' : 'ĐÃ KẾT NỐI') : 'DỮ LIỆU MẪU';
    $('useSampleData').hidden = data.isOwn;
    const dates = rows.filter(r => r.parts).sort((a,b) => a.dateKey-b.dateKey);
    $('overviewDateRange').textContent = dates.length ? `${dates[0].date} — ${dates[dates.length-1].date}` : 'Chưa có dữ liệu ngày';
    drawBars(rows);
    drawSparkline(rows);
    renderRecent(rows);
  }

  async function readSampleCsv() {
    if (location.protocol === 'file:') {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'assets/sample-orders.js';
        script.onload = () => {
          const csv = window.CodeKitSampleCsv;
          delete window.CodeKitSampleCsv;
          script.remove();
          if (typeof csv === 'string') resolve(csv);
          else reject(new Error('Không đọc được dữ liệu mẫu'));
        };
        script.onerror = () => {
          script.remove();
          reject(new Error('Không đọc được dữ liệu mẫu'));
        };
        document.head.append(script);
      });
    }
    const response = await fetch('du_lieu_don_hang_chuan_300_dong.csv');
    if (!response.ok) throw new Error('Không đọc được dữ liệu mẫu');
    return response.text();
  }

  async function readSample() {
    if (!view.samplePromise) view.samplePromise = (async () => {
      const csv = await readSampleCsv();
      if (!window.Papa) throw new Error('Chưa tải được thư viện đọc CSV. Vui lòng kiểm tra kết nối và tải lại trang.');
      view.sampleRows = Papa.parse(csv, { header:true, skipEmptyLines: true, transformHeader:h => h.replace(/^\uFEFF/,'').trim() }).data;
      return view.sampleRows;
    })().catch(error => { view.samplePromise = null; throw error; });
    return view.samplePromise;
  }

  function setNavigation(active) {
    document.querySelectorAll('[data-view]').forEach(el => {
      if (el.matches('.topnav-link, .nav-item')) {
        const selected = el.dataset.view === active;
        el.classList.toggle('active',selected);
        if (selected) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
      }
    });
  }

  function openView(target) {
    if (target === 'overview') {
      if(![1,2,6].includes(AppState.currentStep))setStep(canEnterStep(6)?6:AppState.workflow.importValid?2:1);
      document.body.classList.remove('workflow-view');
      setNavigation('overview'); renderOverview(); if(window.SmoothMotion)window.SmoothMotion.navigate($('overviewSection'), {stagger:true,direction:1}); else $('overviewSection').scrollIntoView({behavior:'smooth',block:'start'}); return;
    }
    if (target === 'upload') {
      document.body.classList.add('workflow-view'); setStep(1); setNavigation('workflow');
      $('fileInput').click(); return;
    }
    document.body.classList.add('workflow-view');
    if (target === 'data') {
      if (canEnterStep(3)) { renderStep3View(); setStep(3); setNavigation('data'); }
      else { setNavigation('workflow'); notify('Tải lên bảng tính và hoàn tất bước làm sạch để xem dữ liệu.'); $('workflowHeading').scrollIntoView({behavior:'smooth'}); }
    } else if (target === 'reports') {
      if (canEnterStep(5)) { setStep(5); setNavigation('reports'); }
      else { setNavigation('workflow'); notify('Phê duyệt dữ liệu ở bước 3 để mở báo cáo phân tích.'); $('workflowHeading').scrollIntoView({behavior:'smooth'}); }
    } else { setNavigation('workflow'); if(window.SmoothMotion)window.SmoothMotion.navigate(document.querySelector('.pipeline-step-pane.active'), {stagger:true,direction:-1,scrollTarget:$('workflowHeading')}); else $('workflowHeading').scrollIntoView({behavior:'smooth'}); }
  }

  function toggleSearch() {
    if(!overviewUnlocked()) { notify('Nhập bảng tính hợp lệ ở Bước 1 để mở tìm kiếm dữ liệu.'); return; }
    $('overviewSearchWrap').hidden = !$('overviewSearchWrap').hidden;
    if (!$('overviewSearchWrap').hidden) {
      document.body.classList.remove('workflow-view'); setNavigation('overview');
      $('globalSearch').focus(); $('overviewSearchWrap').scrollIntoView({behavior:'smooth', block:'center'});
    } else { $('globalSearch').value=''; renderRecent(datasetRows(currentData())); }
  }

  function toggleProfilePopover() {
    const popover = $('headerPopover');
    if (!popover.hidden) {
      closeProfilePopover();
      return;
    }
    popover.hidden = false;
    $('profileToggle').setAttribute('aria-expanded', 'true');
    popover.innerHTML = '<strong>Không gian cá nhân</strong><p>Quản lý cột dữ liệu và các tùy chọn phân tích.</p><button class="text-action" id="popoverSettings" style="margin-top:12px">Cấu hình dữ liệu <i data-lucide="arrow-right"></i></button>';
    $('popoverSettings').addEventListener('click', () => {
      $('btnOpenSchemaConfig').click();
      closeProfilePopover();
    });
    icons();
  }

  function closeProfilePopover() {
    $('headerPopover').hidden = true;
    $('profileToggle').setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.addEventListener('scroll',hideChartTooltip,{capture:true,passive:true});
    window.addEventListener('blur',hideChartTooltip);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',event => { event.preventDefault(); openView(button.dataset.view); }));
    $('useSampleData').addEventListener('click',async () => {
      try { const generation = fileReadGeneration; const rows = await readSample(); if (generation !== fileReadGeneration) return; document.body.classList.add('workflow-view'); validateFileSchema(structuredClone(rows),'du_lieu_don_hang_chuan_300_dong.csv'); }
      catch(error) { notify(error.message); }
    });
    $('overviewPeriod').querySelectorAll('button').forEach(button => button.addEventListener('click',() => {
      if(!overviewUnlocked()) return;
      view.period = button.dataset.period;
      $('overviewPeriod').querySelectorAll('button').forEach(b => b.classList.toggle('active', b===button));
      drawBars(datasetRows(currentData()));
    }));
    $('toggleOverviewSearch').addEventListener('click',toggleSearch);
    $('closeOverviewSearch').addEventListener('click',toggleSearch);
    $('globalSearch').addEventListener('input',() => renderRecent(datasetRows(currentData())));
    const expand = () => { if(!overviewUnlocked()) return; view.expanded = !view.expanded; renderRecent(datasetRows(currentData())); };
    $('recentShowAll').addEventListener('click',expand);
    $('recentExpand').addEventListener('click',expand);
    $('railDownloadSample').addEventListener('click',() => { const link=document.createElement('a'); link.href='du_lieu_don_hang_chuan_300_dong.xlsx'; link.download='du_lieu_don_hang_chuan_300_dong.xlsx'; link.click(); });
    $('railHelp').addEventListener('click',() => notify('1. Nhập file → 2. Làm sạch → 3. Duyệt dữ liệu → 4. Phân tích → 5. Xem kết quả → 6. Nghiệm thu và xuất báo cáo.'));
    $('profileToggle').addEventListener('click', toggleProfilePopover);
    document.addEventListener('click', event => {
      if (!event.target.closest('.header-popover, #profileToggle')) closeProfilePopover();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeProfilePopover();
      if (!$('overviewSearchWrap').hidden) toggleSearch();
    });
    document.addEventListener('pipeline:data', renderOverview);
    document.addEventListener('pipeline:step',event => {
      if (event.detail.step > 1) document.body.classList.add('workflow-view');
      setNavigation(event.detail.step===3 ? 'data' : event.detail.step>=4 ? 'reports' : 'workflow');
      renderOverview();
    });
    let chartWidth = 0;
    new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (overviewUnlocked() && width > 0 && width !== chartWidth) { chartWidth = width; drawBars(datasetRows(currentData())); }
    }).observe($('overviewBarChart'));
    initTimeSlicer('overview', () => { const data=currentData(); return data.rows.map(row => row[data.fields.date]); }, range => { if(!overviewUnlocked()) return; view.dateRange=range; renderOverview(); });
    icons();
    renderOverview();
    setNavigation('workflow');
  });
})();
