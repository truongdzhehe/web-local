/* Additional views of the approved rows. Charts never mutate the dataset. */
function buildExplorationData(rows) {
  const f = AppState.fieldMap;
  const productCol = detectOptionalColumn(['san pham', 'product', 'dich vu', 'item', 'mat hang']);
  const regionCol = detectOptionalColumn(['khu vuc', 'region', 'tinh thanh', 'thanh pho']);
  const nameCol = detectOptionalColumn(['ten khach hang', 'customer name', 'ten cong ty']);
  const products = new Map(), regions = new Map(), customers = new Map();
  for (const row of rows) {
    const revenue = Number(row[f.revenue]) || 0;
    const add = (map, label) => {
      if (!map.has(label)) map.set(label, { name: label, orders: 0, revenue: 0 });
      const item = map.get(label); item.orders++; item.revenue += revenue;
    };
    add(products, productCol ? String(row[productCol] || 'Chưa phân loại') : 'Chưa có cột sản phẩm');
    if (regionCol) add(regions, String(row[regionCol] || 'Chưa xác định'));
    const id = String(row[f.customer_id]);
    if (!customers.has(id)) customers.set(id, { id, name: nameCol ? `${row[nameCol] || id} (${id})` : id, orders: 0, revenue: 0 });
    const customer = customers.get(id); customer.orders++; customer.revenue += revenue;
  }
  const values = rows.map(row => Number(row[f.revenue]) || 0);
  const binSource=AppState.analytics.crossFilters?.range?getAnalysisRows({ignoreCross:true}).filter(row=>!AppState.analytics.excludeCanceled || classifyStatusMeta(row[f.status]).key!=='Canceled').map(row=>Number(row[f.revenue])||0):values;
  const maximum = binSource.reduce((max,value)=>Math.max(max,value),0);
  const step = Math.max(1, Math.ceil(maximum / 6 / 50) * 50);
  const bins = Array.from({ length: 6 }, (_, i) => ({ from: i * step, to: (i + 1) * step, count: 0 }));
  values.forEach(value => bins[Math.min(5, Math.floor(value / step))].count++);
  return {
    products: [...products.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,8),
    regions: [...regions.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,20),regionCount:regions.size,
    customers: [...customers.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,500),customerCount:customers.size,bins,regionAvailable: Boolean(regionCol)
  };
}

function chartInteractionOptions() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const ink = dark ? '#c1d4c8' : '#506358';
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 850, easing: 'easeOutQuart' },
    interaction: { mode: 'nearest', intersect: true },
    onHover: (event, elements, chart) => { chart.canvas.style.cursor = elements.length ? 'pointer' : 'default'; },
    onClick: (event, elements, chart) => {
      if (!elements.length) return;
      const { index, datasetIndex } = elements[0];
      const raw = chart.data.datasets[datasetIndex].data[index];
      const label = raw?.name || chart.data.labels?.[index] || chart.data.datasets[datasetIndex].label;
      const value = typeof raw === 'object' ? `$${Number(raw.y).toLocaleString()} · ${raw.x} đơn` : Number(raw).toLocaleString();
      const note = document.getElementById('chartFocusNote');
      if (note) note.textContent = `Đang xem: ${label} — ${value}. Rê chuột lên các điểm khác để so sánh.`;
      if(window.Workbench) {
        const id=chart.canvas?.id;
        const data=AppState.analytics.lastMetrics.explorations;
        let type,value;
        if(id==='financeChart'){type='bucket';value={period:AppState.analytics.period,key:String(label)};}
        else if(id==='statusDonutChart'){type='status';value=String(label);}
        else if(id==='productRevenueChart' && detectOptionalColumn(['san pham','product','dich vu','item','mat hang'])){type='product';value=data.products[index].name;}
        else if(id==='regionRevenueChart'){type='region';value=data.regions[index].name;}
        else if(id==='customerValueChart'){type='customer';value=raw.id;}
        else if(id==='orderDistributionChart'){type='range';value={from:data.bins[index].from,to:data.bins[index].to,inclusive:index===data.bins.length-1};}
        if(type)requestAnimationFrame(()=>window.Workbench.applyFilter(type,value));
      }
    },
    plugins: {
      legend: { labels: { color: ink, usePointStyle: true, boxWidth: 8, font: { family: 'Plus Jakarta Sans', size: 10 } } },
      tooltip: { backgroundColor: '#183d2d', titleColor: '#fff', bodyColor: '#d9eee2', padding: 13, cornerRadius: 12, displayColors: true }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink, font: { size: 10 } }, border: { display: false } },
      y: { beginAtZero: true, grid: { color: dark ? '#ffffff0a' : '#244b3410' }, ticks: { color: ink, font: { size: 10 } }, border: { display: false } }
    }
  };
}

function drawExplorationCharts(metrics) {
  const data = metrics.explorations;
  if (!data) return;
  const focusNote=document.getElementById('chartFocusNote');
  if(focusNote)focusNote.textContent='Rê chuột để xem chi tiết · Bấm dữ liệu để ghim thông tin · Bấm chú giải để ẩn/hiện chuỗi';
  const coverage=document.getElementById('customerChartCoverage');
  if(coverage)coverage.textContent=`${Math.min(500,data.customerCount)} / ${data.customerCount} khách có doanh thu cao nhất · Trục ngang: số đơn · Trục dọc: doanh thu · Kích thước: AOV`;
  const regionCoverage=document.getElementById('regionChartCoverage');
  if(regionCoverage)regionCoverage.textContent=`${Math.min(20,data.regionCount)} / ${data.regionCount} khu vực có doanh thu cao nhất`;
  const colors = ['#168459','#4aab83','#83c6a7','#c1ddcc','#d2b779','#96b9b1','#789b84','#b9c9a2'];
  const create = (key, canvasId, config) => {
    const canvas = document.getElementById(canvasId); if (!canvas) return;
    AppState.charts[key]?.destroy();
    AppState.charts[key] = window.SmoothMotion?.createChart ? window.SmoothMotion.createChart(canvas,config) : new Chart(canvas,config);
  };
  const productOptions = chartInteractionOptions();
  productOptions.indexAxis='y'; productOptions.plugins.legend.display=false;
  productOptions.scales.x.ticks.callback = value => '$' + Number(value).toLocaleString();
  productOptions.plugins.tooltip.callbacks = { label: context => `$${Number(context.raw).toLocaleString()} · ${data.products[context.dataIndex].orders} đơn` };
  create('products','productRevenueChart',{ type:'bar',data:{labels:data.products.map(p=>p.name),datasets:[{label:'Doanh thu ($)',data:data.products.map(p=>p.revenue),backgroundColor:colors,borderRadius:7,borderSkipped:false,maxBarThickness:28,hoverBackgroundColor:'#125e42'}]},options:productOptions });

  const distributionOptions=chartInteractionOptions();
  distributionOptions.plugins.legend.display=false; distributionOptions.scales.y.ticks.precision=0;
  distributionOptions.plugins.tooltip.callbacks={label: context=>`${context.raw} đơn · ${(metrics.orderCount ? context.raw/metrics.orderCount*100 : 0).toFixed(1)}% số đơn`};
  create('distribution','orderDistributionChart',{type:'bar',data:{labels:data.bins.map((b,i)=>`$${b.from.toLocaleString()}–${b.to.toLocaleString()}${i===5?' (gồm trần)':''}`),datasets:[{label:'Số đơn',data:data.bins.map(b=>b.count),backgroundColor:'#8cc4a7',hoverBackgroundColor:'#168459',borderRadius:9,borderSkipped:false}]},options:distributionOptions});

  const regionOptions=chartInteractionOptions(); regionOptions.plugins.legend.display=false;
  regionOptions.plugins.tooltip.callbacks={label: context=>`$${Number(context.raw).toLocaleString()} · ${data.regions[context.dataIndex].orders} đơn`};
  const regionCanvas=document.getElementById('regionRevenueChart'), empty=document.getElementById('regionChartEmpty');
  if(regionCanvas)regionCanvas.hidden=!data.regionAvailable;
  if(empty)empty.hidden=data.regionAvailable;
  create('regions','regionRevenueChart',{type:'bar',data:{labels:data.regions.map(r=>r.name),datasets:[{label:'Doanh thu ($)',data:data.regions.map(r=>r.revenue),backgroundColor:colors,hoverBackgroundColor:'#125e42',borderRadius:9,borderSkipped:false,maxBarThickness:45}]},options:regionOptions});

  const customerOptions=chartInteractionOptions();
  customerOptions.plugins.legend.display=false;
  customerOptions.scales.x.title={display:true,text:'Số đơn hàng'}; customerOptions.scales.x.ticks.precision=0;
  customerOptions.scales.y.title={display:true,text:'Doanh thu ($)'};
  customerOptions.plugins.tooltip.callbacks={ title:contexts=>contexts[0]?.raw.name || '',label:context=>`${context.raw.x} đơn · $${context.raw.y.toLocaleString()} · AOV $${context.raw.aov.toFixed(1)}` };
  const maxAov=Math.max(1,...data.customers.map(c=>c.revenue/c.orders));
  create('customers','customerValueChart',{type:'bubble',data:{datasets:[{label:'Khách hàng',data:data.customers.map(c=>({x:c.orders,y:c.revenue,r:5+Math.sqrt(c.revenue/c.orders/maxAov)*12,name:c.name,id:c.id,aov:c.revenue/c.orders})),backgroundColor:'#16845970',borderColor:'#168459',borderWidth:1.2,hoverBackgroundColor:'#168459ce',hoverBorderWidth:2}]},options:customerOptions});
}
