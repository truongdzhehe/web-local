/**
 * DASHBOARD V14 — AI WORKFLOW & DATA AGENT CONTROLLER
 * Full 6-step pipeline matching the user's diagram & Settigation V14 design.
 */

// ===================================================================
// GLOBAL PIPELINE STATE
// ===================================================================
function getDefaultRequiredSchema() {
  return [
    { key: 'customer_id', label: 'Mã khách hàng', aliases: ['makh', 'mã khách hàng', 'ma khach hang', 'ma_khach_hang', 'customer_id', 'customer', 'makhachhang'] },
    { key: 'order_id', label: 'Mã đơn hàng', aliases: ['madon', 'mã đơn hàng', 'ma don hang', 'ma_don_hang', 'order_id', 'order', 'madonhang'] },
    { key: 'date', label: 'Ngày giao hàng', aliases: ['ngay', 'ngày', 'ngày giao hàng', 'ngay giao hang', 'ngay_giao_hang', 'ngaygiaohang', 'ngày giao', 'ngay_giao', 'ngay_dat', 'ngày đặt', 'order_date', 'date', 'delivery_date'] },
    { key: 'revenue', label: 'Doanh thu', aliases: ['doanh thu', 'doanh_thu', 'revenue', 'amount', 'gia_tri', 'so_tien', 'total', 'price', 'tiền'] },
    { key: 'status', label: 'Trạng thái', aliases: ['trang_thai', 'trạng thái', 'trang thai', 'status', 'tinh_trang'] }
  ];
}



const AppState = {
  currentStep: 1,
  rawRows: [],
  cleanRows: [],
  step2BackupCleanRows: [],
  headers: [],
  fieldMap: {},
  failedFile: null,
  fileName: '',
  sheetName: '',
  cleaningAudit: null,
  workflow: { importValid: false, cleaning: false, cleaned: false, dataApproved: false,
    analysisRunning: false, analysisReady: false, resultsViewed: false, finalApproved: false,
    paramsDirty: false, dataFeedbackPending: false, finalFeedbackPending: false },
  analysisFeedbackHistory: [],
  pendingBulkDelete: null,
  lastBulkDelete: null,
  requiredSchema: getDefaultRequiredSchema(),
  step3: {
    statusFilters: [],
    searchQuery: '',
    categoryFilters: [],
    page: 1,
    pageSize: 20,
    feedbackHistory: [], selectedRows: new Set()
  },
  analytics: {
    period: 'day',
    dateRange: { from: '', to: '' },
    crossFilters: {},
    profitMargin: 0.32,
    excludeCanceled: false,
    focusStrategy: 'balanced',
    lastMetrics: null
  },
  charts: {
    financeChart: null,
    donutChart: null
  }
};

// ===================================================================
// INITIALIZATION
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  renderRequiredKeysPills();
  initEventListeners();
  animatePointsCounter(12480);
});

// Animate points counter like Settigation V14
function animatePointsCounter(target) {
  const el = document.getElementById('rewardPointsCount');
  if (!el) return;

  const duration = 1200;
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = Math.floor(target * ease);
    el.textContent = val.toLocaleString();

    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ===================================================================
// STEPPER PROGRESSION & NAVIGATION
// ===================================================================
function workflowNotice(message) {
  const toast = document.getElementById('appToast');
  if (toast) { toast.textContent = message; toast.hidden = false; }
}
function canEnterStep(step) {
  const w = AppState.workflow;
  if (step === 1) return true;
  if (!w.importValid) return false;
  if (step === 2) return true;
  if (!w.cleaned || w.cleaning) return false;
  if (step === 3) return true;
  if (!w.dataApproved || w.dataFeedbackPending || !AppState.cleanRows.length) return false;
  if (step === 4) return true;
  return w.analysisReady && !w.analysisRunning && !w.paramsDirty && (step !== 6 || w.resultsViewed);
}
function canExport() {
  const w = AppState.workflow;
  return w.importValid && w.cleaned && w.dataApproved && w.analysisReady && w.finalApproved &&
    !w.cleaning && !w.analysisRunning && !w.paramsDirty && !w.dataFeedbackPending && !w.finalFeedbackPending &&
    AppState.cleanRows.length > 0 && Boolean(AppState.analytics.lastMetrics);
}
function syncWorkflowControls() {
  const w = AppState.workflow;
  for (let step = 2; step <= 6; step++) {
    const el = document.getElementById(`stepIndicator${step}`);
    if (el) { el.setAttribute('aria-disabled', String(!canEnterStep(step))); el.classList.toggle('is-locked', !canEnterStep(step)); }
  }
  const disabled = (id, value) => { const el = document.getElementById(id); if (el) el.disabled = value; };
  disabled('btnGoToStep3', !w.cleaned || w.cleaning);
  disabled('btnApproveStep3', !w.cleaned || w.cleaning || !AppState.cleanRows.length || w.dataFeedbackPending);
  disabled('btnGoToStep5', !w.analysisReady || w.analysisRunning);
  disabled('btnGoToStep6', !canEnterStep(6));
  disabled('btnApproveStep6', !canEnterStep(6) || w.finalFeedbackPending);
  for (const [step, message] of [
    [3,w.cleaning?'Đang làm sạch dữ liệu.':w.cleaned?'':'Cần nhập và làm sạch bảng tính.'],
    [5,w.analysisRunning?'Đang phân tích dữ liệu.':w.analysisReady?'':'Cần duyệt dữ liệu ở Bước 3 và chạy phân tích.'],
    [6,canEnterStep(6)?'':w.paramsDirty?'Cần chạy lại với tham số mới.':'Cần xem kết quả ở Bước 5.']
  ]) {
    const hint = document.getElementById('nextStep'+step+'Hint');
    if (hint) { hint.textContent=message; hint.hidden=!message; }
  }
  const approvalHint=document.getElementById('approveDataHint');
  if (approvalHint) {
    const message=w.dataFeedbackPending?'Hãy xử lý phản hồi đang chờ.':!AppState.cleanRows.length?'Cần ít nhất một dòng để phân tích.':!w.cleaned||w.cleaning?'Cần hoàn tất làm sạch dữ liệu.':'';
    approvalHint.textContent=message;
    approvalHint.hidden=!message;
  }
  disabled('btnSaveReportVersion', !canExport());
  ['btnExportHtmlReport','btnExportCleanedXlsx','btnExportCleanedData','btnPrintPdfReport'].forEach(id => disabled(id, !canExport()));
  const status = document.getElementById('finalApprovalStatus');
  if (status) status.textContent = w.finalApproved ? 'Đã nghiệm thu kết quả hiện tại. Bạn có thể xuất báo cáo.'
    : w.paramsDirty ? 'Tham số đã thay đổi. Hãy chạy lại phân tích và kiểm duyệt kết quả mới.'
    : w.finalFeedbackPending ? 'Phản hồi chưa được xử lý. Hãy chạy lại hoặc xóa phản hồi để hủy yêu cầu.'
    : 'Chờ người kiểm duyệt cuối cùng xác nhận. Các nút xuất đang khóa.';
}
function invalidateAnalysis(dataChanged = false) {
  window.Workbench?.saveSoon();
  const w = AppState.workflow;
  if (dataChanged) { clearTimeout(analysisTimer); if(aiActivity?.phase==='analysis')hideAIActivity(aiActivity); w.analysisRunning = false; w.resultsViewed = false; w.dataApproved = false; w.analysisReady = false; AppState.analytics.lastMetrics = null; }
  w.finalApproved = false;
  document.getElementById('celebrationBanner')?.classList.remove('active');
  syncWorkflowControls();
}
function requireExportApproval() {
  if (canExport()) return true;
  workflowNotice('Cần duyệt dữ liệu ở Bước 3, chạy phân tích và nghiệm thu kết quả hiện tại ở Bước 6 trước khi xuất.');
  return false;
}
function jumpToStep(step) { setStep(step); }

function animateStepEntrance(pane, backwards = false) {
  if (window.SmoothMotion) { window.SmoothMotion.navigate(pane, { stagger: true, direction: backwards ? -1 : 1, scrollTarget: document.getElementById('workflowHeading') }); return; }
  pane.classList.toggle('step-backwards', backwards);
  pane.classList.add('step-entering');
  [...pane.children].forEach((child, index) => {
    child.classList.add('step-reveal-item');
    child.style.animationDelay = `${Math.min(index * 55, 280)}ms`;
  });
}

function setStep(step) {
  if (![1,2,3,4,5,6].includes(step) || !canEnterStep(step)) {
    workflowNotice('Bước này đang khóa. Hãy hoàn tất xử lý và phê duyệt ở bước trước.');
    return false;
  }
  const stage=document.querySelector?.('.workflow-main-card');
  const previousHeight=window.SmoothMotion?.measureLayout(stage);
  const previousStep = AppState.currentStep;
  AppState.currentStep = step;
  if (step === 5) AppState.workflow.resultsViewed = true;
  if (step === 3) renderStep3View();
  syncWorkflowControls();

  // Update nav pill
  const navPill = document.getElementById('navStepPill');
  if (navPill) navPill.textContent = `Bước ${step} / 6`;

  // Update stepper items
  const stepsMap = [
    { el: 'stepIndicator1', line: 'line1', idx: 1 },
    { el: 'stepIndicator2', line: 'line2', idx: 2 },
    { el: 'stepIndicator3', line: 'line3', idx: 3 },
    { el: 'stepIndicator4', line: 'line4', idx: 4 },
    { el: 'stepIndicator5', line: 'line5', idx: 5 },
    { el: 'stepIndicator6', line: null, idx: 6 }
  ];

  stepsMap.forEach(item => {
    const el = document.getElementById(item.el);
    const line = item.line ? document.getElementById(item.line) : null;
    if (!el) return;

    el.classList.remove('active', 'completed');
    if (line) line.classList.remove('completed');

    if (item.idx === step) {
      el.classList.add('active');
    } else if (item.idx < step) {
      el.classList.add('completed');
      if (line) line.classList.add('completed');
    }
  });

  // Switch Panes
  const paneMap = {
    1: 'paneStep1',
    2: 'paneStep2',
    3: 'paneStep3',
    4: 'paneStep4',
    5: 'paneStep5',
    6: 'paneStep6'
  };

  document.querySelectorAll('.pipeline-step-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(paneMap[step]);
  if (targetPane) {
    void targetPane.offsetWidth;
    targetPane.classList.add('active');
    animateStepEntrance(targetPane, step < previousStep);
  }

  if (window.lucide) window.lucide.createIcons();
  document.dispatchEvent(new CustomEvent('pipeline:step', { detail: { step } }));
  if(!window.SmoothMotion)document.getElementById('workflowHeading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (step === 5 && AppState.analytics.lastMetrics) runDeepAnalytics();
  if(previousHeight!==undefined)window.SmoothMotion?.settleLayout(stage,previousHeight);
  return true;
}

// ===================================================================
// BƯỚC 1: FILE IMPORT & STRICT VALIDATION
// ===================================================================
function initEventListeners() {
  // Dropzone
  const dropzone = document.getElementById('fileDropzone');
  const fileInput = document.getElementById('fileInput');

  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileRead(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileRead(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // Quick Demo Buttons
  document.getElementById('btnDemoSuccess')?.addEventListener('click', loadValidDemoFile);
  document.getElementById('btnQuickLoadGood')?.addEventListener('click', loadValidDemoFile);

  // Big Error Test Buttons
  document.getElementById('btnDemoError')?.addEventListener('click', loadCorruptedDemoFile);
  document.getElementById('btnQuickLoadBad')?.addEventListener('click', loadCorruptedDemoFile);

  // Dismiss Error via Top X Button or Outside click or ESC
  const closeErrorModal = () => {
    document.getElementById('errorGiantModal')?.classList.remove('active');
  };
  document.getElementById('btnDismissErrorX')?.addEventListener('click', closeErrorModal);
  document.getElementById('btnCloseErrorModal')?.addEventListener('click', () => {
    closeErrorModal();
    document.getElementById('fileInput')?.click();
  });

  // Click outside to dismiss error modal
  document.getElementById('errorGiantModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'errorGiantModal') closeErrorModal();
  });

  // ESC key to dismiss error modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeErrorModal();
  });

  // Proceed Step 2 -> Step 3
  document.getElementById('btnGoToStep3')?.addEventListener('click', () => {
    AppState.step3.page = 1;
    AppState.step3.statusFilters = [];
    AppState.step3.searchQuery = '';
    AppState.step3.categoryFilters = [];
    const searchEl = document.getElementById('tableFilterInput');
    if (searchEl) searchEl.value = '';
    renderStep3View();
    setStep(3);
  });

  document.getElementById('btnSelectFiltered')?.addEventListener('click', () => {
    getStep3FilteredEntries().forEach(entry => AppState.step3.selectedRows.add(entry.origIdx));
    renderStep3View();
  });
  document.getElementById('btnClearSelection')?.addEventListener('click', () => { AppState.step3.selectedRows.clear(); renderStep3View(); });
  document.getElementById('btnDeleteSelected')?.addEventListener('click', () => requestBulkDelete('selected'));
  document.getElementById('btnDeleteFiltered')?.addEventListener('click', () => requestBulkDelete('filtered'));
  document.getElementById('btnDeleteAllRows')?.addEventListener('click', () => requestBulkDelete('all'));
  document.getElementById('btnConfirmBulkDelete')?.addEventListener('click', confirmBulkDelete);
  document.getElementById('btnCancelBulkDelete')?.addEventListener('click', cancelBulkDelete);
  document.getElementById('btnUndoBulkDelete')?.addEventListener('click', undoBulkDelete);
    document.addEventListener('keydown', e => {
    const dialog=document.getElementById('bulkDeleteDialog');
    if(!dialog || dialog.hidden) return;
    if(e.key==='Escape') cancelBulkDelete();
    if(e.key==='Tab') {
      const controls=[...dialog.querySelectorAll('button')];
      const first=controls[0], last=controls.at(-1);
      if(e.shiftKey && document.activeElement===first) { e.preventDefault(); last?.focus(); }
      else if(!e.shiftKey && document.activeElement===last) { e.preventDefault(); first?.focus(); }
    }
  });
  const reviewColumn = document.getElementById('reviewCategoryColumn');
  const reviewValue = document.getElementById('reviewCategoryValue');
  const addReviewFilter = document.getElementById('btnAddReviewFilter');
  reviewColumn?.addEventListener('change', () => { reviewValue.value = ''; renderStep3CategoryControls(); });
  reviewValue?.addEventListener('change', renderStep3CategoryControls);
  addReviewFilter?.addEventListener('click', () => {
    const column = reviewColumn.value, value = reviewValue.value;
    if (!column || !value || addReviewFilter.disabled) return;
    const filters = AppState.step3.categoryFilters;
    const group = filters.find(filter => filter.column === column);
    AppState.step3.categoryFilters = group
      ? filters.map(filter => filter === group ? {column, values:[...group.values, value]} : filter)
      : [...filters, {column, values:[value]}];
    reviewValue.value = '';
    applyStep3Filters();
    reviewValue.focus();
  });
  document.getElementById('btnResetReviewFilters')?.addEventListener('click', () => {
    Object.assign(AppState.step3, {statusFilters:[], categoryFilters:[], searchQuery:''});
    const search = document.getElementById('tableFilterInput');
    search.value = '';
    reviewColumn.value = '';
    reviewValue.value = '';
    applyStep3Filters();
    search.focus();
  });
  // Step 3: Feedback Loop, Quick Chips, Pagination, Reset & Approve
  document.getElementById('btnSendFeedbackStep3')?.addEventListener('click', executeStep3Feedback);
  document.getElementById('btnResetStep3Data')?.addEventListener('click', resetStep3CleanData);
  document.querySelectorAll('.step3-chip[data-fb3]').forEach(chip => {
    chip.addEventListener('click', () => {
      const box = document.getElementById('feedbackInputStep3');
      if (box) {
        box.value = chip.getAttribute('data-fb3') || '';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.focus();
      }
    });
  });

  document.getElementById('btnPrevPageStep3')?.addEventListener('click', () => {
    if (AppState.step3.page > 1) {
      AppState.step3.page--;
      renderStep3View();
    }
  });
  document.getElementById('btnNextPageStep3')?.addEventListener('click', () => {
    AppState.step3.page++;
    renderStep3View();
  });

  // Step 3: Approve (Trường hợp 2: OK)
  document.getElementById('btnApproveStep3')?.addEventListener('click', () => {
    if (!AppState.cleanRows.length || AppState.workflow.dataFeedbackPending || AppState.workflow.cleaning) return;
    AppState.workflow.dataApproved = true;
    startAnalysis();
  });

  // Step 4: Period Filter Pills (Ngày / Tuần / Tháng)
  document.querySelectorAll('#analyticsPeriodTabs .pill-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#analyticsPeriodTabs .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.analytics.period = btn.getAttribute('data-period') || 'day';
      invalidateAnalysis();
      runDeepAnalytics();
    });
  });

  document.getElementById('btnGoToStep5')?.addEventListener('click', () => setStep(5));
  document.getElementById('btnRetryAnalysis')?.addEventListener('click', startAnalysis);

  // Step 5 -> Step 6
  document.getElementById('btnGoToStep6')?.addEventListener('click', () => {
    setStep(6);
  });

  // Step 6: Parameters & Feedback Loop (Trường hợp 1: Adjust)
  const marginSlider = document.getElementById('paramProfitMargin');
  marginSlider?.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    AppState.analytics.profitMargin = val / 100;
    const lbl = document.getElementById('paramProfitMarginVal');
    if (lbl) lbl.textContent = `${val}%`;
    markParametersDirty();
  });
  document.getElementById('paramFocusStrategy')?.addEventListener('change', (e) => {
    AppState.analytics.focusStrategy = e.target.value;
    markParametersDirty();
  });
  document.getElementById('paramExcludeCanceled')?.addEventListener('change', (e) => {
    AppState.analytics.excludeCanceled = e.target.checked;
    markParametersDirty();
  });

  document.getElementById('btnSendFeedbackStep6')?.addEventListener('click', executeStep6Feedback);

  document.getElementById('feedbackInputStep3')?.addEventListener('input', (e) => {
    AppState.workflow.dataFeedbackPending = Boolean(e.target.value.trim());
    invalidateAnalysis(true);
  });
  document.getElementById('feedbackInputStep6')?.addEventListener('input', (e) => {
    AppState.workflow.finalFeedbackPending = Boolean(e.target.value.trim());
    invalidateAnalysis();
  });
  document.getElementById('btnApproveStep6')?.addEventListener('click', () => {
    if (!canEnterStep(6) || AppState.workflow.finalFeedbackPending || AppState.workflow.finalApproved) return;
    AppState.workflow.finalApproved = true;
    syncWorkflowControls();
    window.Workbench?.archiveReport();window.Workbench?.saveSoon();
  });
  // Step 6: Export Actions
  document.getElementById('btnExportHtmlReport')?.addEventListener('click', exportStandaloneHtml);
  document.getElementById('btnExportCleanedXlsx')?.addEventListener('click', exportCleanedXlsx);
  document.getElementById('btnExportCleanedData')?.addEventListener('click', exportCleanedCsv);
  document.getElementById('btnQuickExport')?.addEventListener('click', exportCleanedCsv);
  document.getElementById('btnPrintPdfReport')?.addEventListener('click', () => { if (requireExportApproval()) { setStep(5); window.print(); } });

  // Reset Workflow
  document.getElementById('btnResetWorkflow')?.addEventListener('click', resetAll);
  document.getElementById('btnStartNewAnalysis')?.addEventListener('click', resetAll);
  document.getElementById('btnQuickRefresh')?.addEventListener('click', resetAll);

  // Theme Switch (Tràn dần ra dạng sóng tròn cực mượt như video Settigation)
  document.getElementById('themeSwitch')?.addEventListener('click', (e) => toggleTheme(e));

  // Search Table in Step 3
  document.getElementById('tableFilterInput')?.addEventListener('input', (e) => {
    AppState.step3.searchQuery = e.target.value.trim();
    AppState.step3.page = 1;
    renderStep3View();
  });

  // Schema Config Modal
  setupSchemaModal();

  // Mobile drawer
  setupMobileDrawer();
  initTimeSlicer('analytics', () => AppState.cleanRows.map(row => row[AppState.fieldMap.date]), range => {
    AppState.analytics.dateRange = range;
    window.SmoothMotion?.refreshChartData();
    invalidateAnalysis();
    runDeepAnalytics();
    const rows = getAnalysisRows();
    document.getElementById('analyticsTimeSummary').textContent = `${rows.length} / ${AppState.cleanRows.length} bản ghi trong kỳ${range.from || range.to ? ' · loại các dòng chưa có ngày' : ''}`;
  });
  syncWorkflowControls();
}

let fileReadGeneration = 0;
let analysisTimer = null;
const counterRuns = new WeakMap();
const AI_CLEANING_MIN_MS = 3000;
const AI_ANALYSIS_MIN_MS = 1500;
let aiActivity = null;

function showAIActivity(phase) {
  if(aiActivity)hideAIActivity(aiActivity);
  const overlay=document.getElementById('aiActivityOverlay');
  const activity={phase,startedAt:performance.now(),previousFocus:document.activeElement};
  aiActivity=activity;
  const cleaning=phase==='cleaning';
  const title=document.getElementById('aiActivityTitle');
  const description=document.getElementById('aiActivityDescription');
  if(title)title.textContent=cleaning?'AI đang làm sạch dữ liệu':'AI đang phân tích dữ liệu';
  if(description)description.textContent=cleaning?'Đối soát bản ghi, loại trùng và chuẩn hóa bảng dữ liệu của bạn.':'Tính toán chỉ số, tìm xu hướng và tổng hợp đề xuất kinh doanh.';
  if(overlay) {overlay.hidden=false;overlay.focus({preventScroll:true});}
  document.getElementById('appLayout')?.setAttribute('inert','');
  document.getElementById('appLayout')?.setAttribute('aria-busy','true');
  document.body.classList.add('ai-is-processing');
  return activity;
}
function hideAIActivity(activity) {
  if(!activity || aiActivity!==activity)return;
  aiActivity=null;
  const overlay=document.getElementById('aiActivityOverlay');
  if(overlay)overlay.hidden=true;
  document.getElementById('appLayout')?.removeAttribute('inert');
  document.getElementById('appLayout')?.removeAttribute('aria-busy');
  document.body.classList.remove('ai-is-processing');
  if(activity.previousFocus?.isConnected && !activity.previousFocus.disabled)activity.previousFocus.focus({preventScroll:true});
}
document.addEventListener('keydown',event=>{
  if(aiActivity && event.key==='Tab') {event.preventDefault();document.getElementById('aiActivityOverlay')?.focus({preventScroll:true});}
});
function clearImportedData() {
  fileReadGeneration++;
  window.Workbench?.newDataset();
  AppState.sheetName='';AppState.cleaningAudit=null;AppState.analytics.crossFilters={};
  clearCleaningTimers(); clearTimeout(analysisTimer);
  hideAIActivity(aiActivity);
  AppState.rawRows = []; AppState.cleanRows = []; AppState.step2BackupCleanRows = [];
  AppState.headers = []; AppState.fieldMap = {}; AppState.failedFile = null; AppState.fileName = '';
  AppState.pendingBulkDelete = null; AppState.lastBulkDelete = null;
  cancelBulkDelete();
  AppState.step3 = { statusFilters: [], searchQuery: '', categoryFilters: [], page: 1, pageSize: 20, feedbackHistory: [], selectedRows: new Set() };
  AppState.analytics.lastMetrics = null; AppState.analytics.dateRange = { from: '', to: '' }; AppState.analysisFeedbackHistory = [];
  resetTimeSlicerInputs('analytics');
  Object.keys(AppState.workflow).forEach(key => AppState.workflow[key] = false);
  ['feedbackInputStep3','feedbackInputStep6','tableFilterInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['step3FeedbackToast','step6FeedbackToast'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('celebrationBanner')?.classList.remove('active');
  for (const key of Object.keys(AppState.charts)) {
    const chart=AppState.charts[key];if(chart?.canvas)window.SmoothMotion?.forgetChart(chart.canvas);
    chart?.destroy(); AppState.charts[key] = null;
  }
  ['kpiRevenueVal','kpiOrdersVal','kpiAovVal','kpiCustomersVal','statRawCount','statRemovedCount','statCleanedCount','statQualityPct'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—';});
  ['topProductsList','topCustomersList','proposalsList','reviewTableThead','reviewTableTbody','linkedRowsTable','linkedFilterChips','step3FeedbackHistory','cleaningLogsContainer','cleaningBreakdownBox'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
  ['kpiProfitMarginNote','kpiCompletionRateNote','kpiPeakOrderNote','kpiRepeatRateNote'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='Chờ phân tích dữ liệu mới';});
  ['fileInput','reviewerName'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const audit=document.getElementById('cleaningAuditPanel');if(audit)audit.hidden=true;
  const label=document.getElementById('analysisProgressLabel');if(label)label.textContent='Sẵn sàng phân tích';
  const feedback=document.getElementById('analysisRunFeedback');if(feedback)feedback.textContent='';
  setStep(1); syncWorkflowControls();
}
function setFailedFileContext(fileName, rows = [], headers = [], missingFields = AppState.requiredSchema, fieldMapping = {}, isEmptyOrInvalid = false) {
  AppState.failedFile = { fileName, rows, headers, missingFields, fieldMapping, isEmptyOrInvalid };
}

function handleFileRead(file) {
  clearImportedData();
  const generation = fileReadGeneration;
  const fail = errors => { if (generation !== fileReadGeneration) return; setFailedFileContext(file.name); showBigRedError(errors); };
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) { fail([`Định dạng .${ext} không hợp lệ. Chỉ chấp nhận .CSV, .XLSX hoặc .XLS.`]); return; }
  if(file.size>=2*1024*1024 && window.Workbench?.workerAvailable()) { window.Workbench.parseLargeFile(file,generation).catch(error=>fail([error.message])); return; }
  const reader = new FileReader();
  reader.onerror = () => fail(['Không đọc được file. Vui lòng kiểm tra file và tải lại.']);
  reader.onload = e => {
    if (generation !== fileReadGeneration) return;
    try {
      let rows;
      let parsedWorkbook=null;
      if (ext === 'csv') {
        const result = Papa.parse(e.target.result, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.replace(/^\uFEFF/, '').trim() });
        const errors = result.errors || [];
        if (errors.length) { fail(errors.slice(0, 10).map(err => `CSV dòng ${Number.isInteger(err.row) ? err.row + 2 : '?'}: ${err.message}`)); return; }
        if (Object.keys(result.meta?.renamedHeaders || {}).length) { fail(['CSV có tên cột trùng nhau. Hãy đặt tên riêng cho từng cột.']); return; }
        rows = result.data;
      } else {
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        parsedWorkbook=workbook;
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) { fail(['File Excel không có sheet dữ liệu.']); return; }
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      }
      if(window.Workbench) { if(parsedWorkbook)window.Workbench.stageWorkbook(parsedWorkbook,file.name);else window.Workbench.stageImport(rows,file.name); }
      else validateFileSchema(rows,file.name);
    } catch (error) { fail([`Không đọc được bảng tính: ${error.message}`]); }
  };
  if (ext === 'csv') reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

// VALIDATE KHÓA CHÍNH (THEO ĐÚNG BƯỚC 1 CỦA SƠ ĐỒ)
function validateFileSchema(dataRows, fileName = 'File dữ liệu') {
  clearImportedData();
  const {rows, headers:rawHeaders, fieldMap:fieldMapping, missingFields, errors}=inspectDataset(dataRows,AppState.requiredSchema);
  if (errors.length) {
    setFailedFileContext(fileName, dataRows, rawHeaders, missingFields, fieldMapping);
    showBigRedError([`File "${fileName}" không đạt yêu cầu.`, ...errors, `Các cột hiện có: ${rawHeaders.join(', ') || '(không có)'}.`, 'Sửa file trên máy và tải lại file đạt yêu cầu để tiếp tục.']);
    return false;
  }
  document.getElementById('errorGiantModal')?.classList.remove('active');
  AppState.rawRows = rows; AppState.headers = rawHeaders; AppState.fieldMap = fieldMapping; AppState.fileName = fileName;
  AppState.workflow.importValid = true;
  setStep(2); startAICleaning();
  return true;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showBigRedError(errors) {
  const modal = document.getElementById('errorGiantModal');
  const ul = document.getElementById('errorListItems');
  if (!modal || !ul) return;

  ul.innerHTML = errors.map(err => `<li>${escapeHtml(err)}</li>`).join('');
  window.FileRepair?.load(AppState.failedFile);
  syncWorkflowControls();
  modal.classList.add('active');
  if (window.lucide) window.lucide.createIcons();

  if (window.navigator && window.navigator.vibrate) {
    window.navigator.vibrate([150, 60, 150]);
  }
}

// ===================================================================
// BƯỚC 2: AI LỌC NHIỄU & CHUẨN HÓA DỮ LIỆU
// ===================================================================
let _cleaningTimers = [];

function clearCleaningTimers() {
  _cleaningTimers.forEach(id => clearTimeout(id));
  _cleaningTimers = [];
  if(aiActivity?.phase==='cleaning')hideAIActivity(aiActivity);
}







function updateCleaningProgressUI(pct, label, activeStage) {
  const bar = document.getElementById('cleanProgressBar');
  const pctEl = document.getElementById('cleanProgressPct');
  const labelEl = document.getElementById('cleanProgressLabel');

  if (bar) {
    bar.style.width = `${pct}%`;
    bar.classList.toggle('is-animating', pct < 100);
  }
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (labelEl) labelEl.textContent = label;

  for (let i = 1; i <= 4; i++) {
    const stageEl = document.getElementById(`cleanStage${i}`);
    if (!stageEl) continue;
    stageEl.classList.remove('is-active', 'is-done', 'active', 'done');
    if (pct >= 100 || i < activeStage) {
      stageEl.classList.add('is-done', 'done');
    } else if (i === activeStage) {
      stageEl.classList.add('is-active', 'active');
    }
  }
}

function startAICleaning(options = {}) {
  if (!AppState.workflow.importValid) return;
  clearCleaningTimers();
  invalidateAnalysis(true);
  const sourceRows = options.rows || AppState.rawRows;
  const generation=fileReadGeneration;
  const undoBefore=options.feedback ? window.Workbench?.beginChange() : null;
  AppState.workflow.cleaning = true; AppState.workflow.cleaned = false;
  const activity=showAIActivity('cleaning');
  syncWorkflowControls();

  const terminal = document.getElementById('cleaningLogsContainer');
  const breakdownBox = document.getElementById('cleaningBreakdownBox');
  const statusBadge = document.getElementById('step2StatusBadge');
  const liveBadge = document.getElementById('termLiveBadge');
  const nextBtn = document.getElementById('btnGoToStep3');

  if (terminal) terminal.innerHTML = '';
  if (breakdownBox) breakdownBox.innerHTML = '';
  if (nextBtn) nextBtn.disabled = true;

  if (statusBadge) {
    statusBadge.textContent = 'Đang xử lý...';
    statusBadge.classList.remove('done');
  }
  if (liveBadge) {
    liveBadge.innerHTML = '<span class="pulse-live-dot"></span> Đang xử lý';
    liveBadge.classList.remove('is-done');
  }

  const rawCount = sourceRows.length;
  animateCounterNumber(document.getElementById('statRawCount'), rawCount);
  animateCounterNumber(document.getElementById('statRemovedCount'), 0);
  animateCounterNumber(document.getElementById('statCleanedCount'), 0);
  const qualityEl = document.getElementById('statQualityPct');
  if (qualityEl) qualityEl.textContent = '...';

  updateCleaningProgressUI(12, 'Giai đoạn 1/4: Khởi tạo AI Engine & Quét Schema...', 1);

  function addLog(msg, colorClass = '') {
    const time = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = 'log-item';
    row.innerHTML = `<span class="log-ts">[${escapeHtml(time)}]</span><span class="${escapeHtml(colorClass)}">${escapeHtml(msg)}</span>`;
    if (terminal) {
      terminal.appendChild(row);
      terminal.scrollTop = terminal.scrollHeight;
    }
  }

  addLog('Khởi tạo AI Data Engine... Bắt đầu phân tích cấu trúc.', 'log-green');

  _cleaningTimers.push(setTimeout(() => {
    updateCleaningProgressUI(42, `Giai đoạn 2/4: Đối soát khóa trùng lặp trên ${rawCount} bản ghi...`, 2);
    addLog(`Đang kiểm tra tính toàn vẹn & khóa chính trên ${rawCount} bản ghi...`);
  }, 800));

  _cleaningTimers.push(setTimeout(() => {
    updateCleaningProgressUI(74, 'Giai đoạn 3/4: Điền khuyết Median & Chuẩn hóa định dạng...', 3);
    addLog('Đang tính trung vị (Median) doanh thu và chuẩn hóa ngày tháng Excel...');
  }, 1800));

  const commitCleaning = (preparedResult) => {
    if(generation!==fileReadGeneration || aiActivity!==activity)return;
    const fMap=AppState.fieldMap;
    const result=preparedResult || cleanDataset(sourceRows,AppState.fieldMap);
    const cleaned=result.rows;
    const {dupCount,revFixed,statusFixed,dateFixed,excelSerialFixed,normalizedDate,medianRevenue}=result.stats;
    AppState.cleaningAudit=result.audit;
    window.Workbench?.renderAudit();
    const nullFixed = revFixed + statusFixed + dateFixed;
    AppState.cleanRows = cleaned;
    AppState.step3.selectedRows.clear();
    AppState.lastBulkDelete = null;
    cancelBulkDelete();
    if (!options.feedback) AppState.step2BackupCleanRows = cleaned.map(row => ({ ...row }));
    AppState.step3.page = 1;
    AppState.step3.statusFilters = [];
    AppState.step3.searchQuery = '';
    AppState.step3.categoryFilters = [];
    if (!options.feedback) AppState.step3.feedbackHistory = [];
    else AppState.step3.feedbackHistory.push({ time: new Date().toLocaleTimeString(), text: options.feedback, delta: `${cleaned.length} dòng sau khi lọc lại` });
    AppState.workflow.cleaning = false; AppState.workflow.cleaned = true;
    AppState.workflow.dataFeedbackPending = false;
    const feedbackInput = document.getElementById('feedbackInputStep3');
    if (feedbackInput) feedbackInput.value = '';

    const removedCount = rawCount - cleaned.length;
    const completeCount = cleaned.filter(row => AppState.requiredSchema.every(field => String(row[fMap[field.key]] ?? '').trim() !== '')).length;
    const qualityScore = cleaned.length ? `${(completeCount / cleaned.length * 100).toFixed(1)}%` : '0%';

    updateCleaningProgressUI(100, 'Giai đoạn 4/4: Hoàn tất xử lý — Dữ liệu sẵn sàng kiểm duyệt!', 4);
    animateCounterNumber(document.getElementById('statRemovedCount'), removedCount);
    animateCounterNumber(document.getElementById('statCleanedCount'), cleaned.length);
    if (qualityEl) qualityEl.textContent = qualityScore;

    if (statusBadge) {
      statusBadge.textContent = 'Hoàn tất 100%';
      statusBadge.classList.add('done');
    }
    if (liveBadge) {
      liveBadge.innerHTML = '<span class="pulse-live-dot"></span> Hoàn tất';
      liveBadge.classList.add('is-done');
    }
    if (nextBtn) nextBtn.disabled = false;

    if (breakdownBox) {
      const chips = [
        {
          label: 'Median Imputation (Doanh thu)',
          val: `${revFixed} ô sửa`,
          note: `Áp dụng trung vị thực tế: $${medianRevenue.toLocaleString()}`
        },
        {
          label: 'Chuẩn hóa Ngày & Trạng thái',
          val: `${normalizedDate} dòng`,
          note: `${excelSerialFixed} serial Excel; ${dateFixed} ngày thiếu/sai để trống; ${statusFixed} trạng thái thiếu chuyển Processing`
        },
        {
          label: 'Loại bỏ Trùng lặp (Dedupe)',
          val: `${dupCount} đơn`,
          note: `Giữ lại ${cleaned.length}/${rawCount} bản ghi hợp lệ`
        }
      ];
      breakdownBox.innerHTML = chips.map(ch => `
        <div class="breakdown-chip-card">
          <span>${escapeHtml(ch.label)}</span>
          <strong>${escapeHtml(ch.val)}</strong>
          <span>${escapeHtml(ch.note)}</span>
        </div>
      `).join('');
    }

    addLog(`Phát hiện & loại bỏ ${dupCount} bản ghi trùng lặp (Duplicate Keys).`, dupCount > 0 ? 'log-yellow' : 'log-green');
    addLog(`Điền ${revFixed + statusFixed} ô doanh thu/trạng thái thiếu; ${dateFixed} ngày chưa xác định được để trống (trung vị doanh thu: $${medianRevenue.toLocaleString()}).`, 'log-green');
    addLog(`Chuẩn hóa định dạng ngày (${excelSerialFixed} serial Excel) & tiền tệ cho ${normalizedDate} dòng.`, 'log-green');
    addLog(`Hoàn tất: ${cleaned.length} dòng; tỷ lệ đủ trường bắt buộc ${qualityScore}. ${dateFixed} ngày thiếu/sai đang để trống để kiểm duyệt.`, 'log-green');

    animatePointsCounter(12480 + cleaned.length * 10);
    syncWorkflowControls();
    if(options.feedback)window.Workbench?.recordChange(undoBefore,options.feedback);
    document.dispatchEvent(new CustomEvent('pipeline:data'));
    if (options.feedback) {
      setStep(3);
      showInlineToast('step3FeedbackToast', `${options.message} Bảng làm việc đã cập nhật: ${cleaned.length} dòng. Hãy kiểm tra và phê duyệt lại.`, 'success');
    }
  };
  const failCleaning = error => {
    if(generation!==fileReadGeneration || aiActivity!==activity)return;
    clearCleaningTimers();AppState.workflow.cleaning=false;AppState.workflow.cleaned=false;
    if(statusBadge)statusBadge.textContent='Xử lý chưa hoàn tất';
    workflowNotice('Làm sạch chưa hoàn tất: '+error.message);syncWorkflowControls();
  };
  const finishCleaning = result => {
    if(generation!==fileReadGeneration || aiActivity!==activity)return;
    const remaining=Math.max(0,AI_CLEANING_MIN_MS-(performance.now()-activity.startedAt));
    _cleaningTimers.push(setTimeout(()=>{
      try {commitCleaning(result);} catch(error) {failCleaning(error);} finally {hideAIActivity(activity);}
    },remaining));
  };
  if(sourceRows.length>=5000 && window.Workbench?.workerAvailable()) {
    window.Workbench.runWorker('clean',{rows:sourceRows,fieldMap:AppState.fieldMap},[],progress=>{
      if(generation===fileReadGeneration && aiActivity===activity)updateCleaningProgressUI(Math.min(progress,92),'Đang làm sạch ở nền…',3);
    }).then(finishCleaning).catch(failCleaning);
  } else _cleaningTimers.push(setTimeout(()=>{
    if(generation!==fileReadGeneration || aiActivity!==activity)return;
    try {finishCleaning(cleanDataset(sourceRows,AppState.fieldMap));} catch(error) {failCleaning(error);}
  },60));
}

// ===================================================================
// BƯỚC 3: NGƯỜI 1: KIỂM TRA & FEEDBACK LOOP
// ===================================================================


function showInlineToast(elId, message, tone = 'success') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `inline-feedback-banner is-${tone}`;
  el.style.display = 'block';
  el.textContent = message;
}

function getStep3FilteredEntries() {
  const fMap = AppState.fieldMap;
  const cols = AppState.headers;
  const {statusFilters, categoryFilters} = AppState.step3;
  const query = (AppState.step3.searchQuery || '').trim().toLowerCase();

  return AppState.cleanRows
    .map((row, origIdx) => ({ row, origIdx, meta: classifyStatusMeta(row[fMap.status]) }))
    .filter(({ row, meta }) => {
      if (statusFilters.length && !statusFilters.includes(meta.key)) return false;
      if (!categoryFilters.every(({column, values}) => values.includes(String(row[column] ?? '')))) return false;
      if (!query) return true;
      return cols.some(c => String(row[c] ?? '').toLowerCase().includes(query));
    });
}

function setStep3StatusFilter(statusKey) {
  const active = AppState.step3.statusFilters;
  AppState.step3.statusFilters = statusKey === 'ALL' ? []
    : active.includes(statusKey) ? active.filter(key => key !== statusKey) : [...active, statusKey];
  applyStep3Filters();
}

function applyStep3Filters() {
  AppState.step3.page = 1;
  renderStep3View();
  window.Workbench?.saveSoon();
}

function changeStep3Page(delta) {
  const pageSize = AppState.step3.pageSize || 20;
  const filtered = getStep3FilteredEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const nextPage = Math.min(totalPages, Math.max(1, (AppState.step3.page || 1) + delta));
  AppState.step3.page = nextPage;
  renderStep3View();
}

function removeStep3Row(origIdx) {
  if (origIdx < 0 || origIdx >= AppState.cleanRows.length) return;
  const undoBefore=window.Workbench?.beginChange();
  const fMap = AppState.fieldMap;
  const target = AppState.cleanRows[origIdx];
  const orderLabel = target ? (target[fMap.order_id] || `#${origIdx + 1}`) : `#${origIdx + 1}`;
  AppState.cleanRows.splice(origIdx, 1);
  AppState.step3.selectedRows.clear(); AppState.lastBulkDelete = null; cancelBulkDelete();
  invalidateAnalysis(true);

  AppState.step3.feedbackHistory.push({
    time: new Date().toLocaleTimeString(),
    text: `Xóa thủ công dòng ${orderLabel}`,
    delta: '-1 dòng'
  });

  window.Workbench?.recordChange(undoBefore,`Xóa dòng ${orderLabel}`);
  renderStep3View();
  document.dispatchEvent(new CustomEvent('pipeline:data'));
  showInlineToast('step3FeedbackToast', `Đã xóa dòng ${orderLabel}. Còn lại ${AppState.cleanRows.length} bản ghi sạch.`, 'info');
  animatePointsCounter(12480 + AppState.cleanRows.length * 10);
}

function resetStep3CleanData() {
  if (!AppState.step2BackupCleanRows || AppState.step2BackupCleanRows.length === 0) {
    showInlineToast('step3FeedbackToast', 'Chưa có bản sao lưu Bước 2 để khôi phục.', 'warn');
    return;
  }
  const undoBefore=window.Workbench?.beginChange();
  AppState.cleanRows = AppState.step2BackupCleanRows.map(r => ({ ...r }));
  AppState.step3.selectedRows.clear(); AppState.lastBulkDelete = null; cancelBulkDelete();
  invalidateAnalysis(true);
  AppState.step3.statusFilters = [];
  AppState.step3.searchQuery = '';
  AppState.step3.categoryFilters = [];
  AppState.step3.page = 1;
  AppState.step3.feedbackHistory.push({
    time: new Date().toLocaleTimeString(),
    text: 'Khôi phục dữ liệu gốc từ Bước 2',
    delta: `${AppState.cleanRows.length} dòng`
  });

  const filterInput = document.getElementById('tableFilterInput');
  if (filterInput) filterInput.value = '';

  window.Workbench?.recordChange(undoBefore,`Khôi phục dữ liệu sau Bước 2`);
  renderStep3View();
  document.dispatchEvent(new CustomEvent('pipeline:data'));
  showInlineToast('step3FeedbackToast', `Đã khôi phục đầy đủ ${AppState.cleanRows.length} bản ghi sạch từ Bước 2.`, 'success');
  animatePointsCounter(12480 + AppState.cleanRows.length * 10);
}

function renderStep3StatusPills() {
  const tabsEl = document.getElementById('step3StatusTabs');
  if (!tabsEl) return;

  const fMap = AppState.fieldMap;
  const counts = { ALL: AppState.cleanRows.length, Completed: 0, Shipped: 0, Processing: 0, Canceled: 0 };
  AppState.cleanRows.forEach(r => {
    const k = classifyStatusMeta(r[fMap.status]).key;
    counts[k] = (counts[k] || 0) + 1;
  });

  const defs = [
    { key: 'ALL', label: 'Tất cả', count: counts.ALL },
    { key: 'Completed', label: 'Completed', count: counts.Completed },
    { key: 'Shipped', label: 'Shipped', count: counts.Shipped },
    { key: 'Processing', label: 'Processing', count: counts.Processing },
    { key: 'Canceled', label: 'Canceled', count: counts.Canceled },
    { key: 'Unknown', label: 'Chưa rõ', count: counts.Unknown || 0 }
  ];

  const active = AppState.step3.statusFilters;
  const focusedKey = document.activeElement?.dataset.statusKey;
  tabsEl.innerHTML = defs.map(d => {
    const pressed = d.key === 'ALL' ? active.length === 0 : active.includes(d.key);
    return `
      <button type="button" class="filter-pill ${pressed ? 'active' : ''}" data-status-key="${d.key}" aria-pressed="${pressed}">
        ${escapeHtml(d.label)} (${d.count})
      </button>
    `;
  }).join('');

  tabsEl.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => setStep3StatusFilter(btn.dataset.statusKey));
    if (btn.dataset.statusKey === focusedKey) btn.focus({preventScroll:true});
  });
}

function renderStep3FeedbackHistory() {
  const box = document.getElementById('step3FeedbackHistory');
  if (!box) return;
  const hist = AppState.step3.feedbackHistory || [];
  if (hist.length === 0) {
    box.innerHTML = '<div style="opacity:0.7;">Chưa có lệnh lọc hay chỉnh sửa nào trong phiên kiểm duyệt này.</div>';
    return;
  }
  box.innerHTML = hist.slice(-5).reverse().map(item => `
    <div>• [${escapeHtml(item.time)}] ${escapeHtml(item.text)} (${escapeHtml(item.delta)})</div>
  `).join('');
}

function renderStep3View() {
  renderStep3CategoryControls();
  renderStep3StatusPills();
  renderStep3FeedbackHistory();

  const thead = document.getElementById('reviewTableThead');
  const tbody = document.getElementById('reviewTableTbody');
  const countEl = document.getElementById('tableRowCount');
  const pageIndEl = document.getElementById('pageIndicatorStep3');
  const prevBtn = document.getElementById('btnPrevPageStep3');
  const nextBtn = document.getElementById('btnNextPageStep3');
  const approveSummaryEl = document.getElementById('step3ApproveSummary');

  const fMap = AppState.fieldMap;
  const filtered = getStep3FilteredEntries();
  const pageSize = AppState.step3.pageSize || 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, AppState.step3.page || 1));
  AppState.step3.page = currentPage;

  if (countEl) countEl.textContent = filtered.length;
  if (pageIndEl) pageIndEl.textContent = `Trang ${currentPage} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  const totalCleanRev = AppState.cleanRows.reduce((sum, r) => sum + (Number(r[fMap.revenue]) || 0), 0);
  if (approveSummaryEl) {
    approveSummaryEl.textContent = `${AppState.cleanRows.length} bản ghi sạch • Tổng doanh thu $${Math.round(totalCleanRev).toLocaleString()} — Sẵn sàng phân tích sâu`;
  }

  syncBulkDeleteControls(filtered);
  window.Workbench?.syncUndo();
  if (!thead || !tbody) return;
  const cols = AppState.headers;
  thead.innerHTML = `<tr><th class="selection-cell"><input type="checkbox" id="selectReviewPage" aria-label="Chọn tất cả dòng trên trang này"></th>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}<th>Xóa</th></tr>`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 2}" style="text-align:center; padding: 24px; color: var(--text-muted);">Không tìm thấy dòng dữ liệu nào phù hợp bộ lọc hiện tại.</td></tr>`;
    return;
  }

  const startIdx = (currentPage - 1) * pageSize;
  const pageEntries = filtered.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageEntries.map(({ row, origIdx, meta }) => `
    <tr class="${AppState.step3.selectedRows.has(origIdx) ? 'row-selected' : ''}">
      <td class="selection-cell"><input type="checkbox" class="review-row-check" data-orig-idx="${origIdx}" ${AppState.step3.selectedRows.has(origIdx) ? 'checked' : ''} aria-label="Chọn đơn ${escapeHtml(String(row[fMap.order_id]))}"></td>
      ${cols.map(c => {
        const rawVal = row[c] !== undefined ? row[c] : '';
        if (c === fMap.status) {
          return `<td><button type="button" class="editable-cell" data-edit-index="${origIdx}" data-edit-column="${escapeHtml(c)}" aria-label="Sửa ${escapeHtml(c)}"><span class="status-badge ${meta.badgeClass}">${escapeHtml(String(rawVal))}</span><span class="cell-edit-mark">✎</span></button></td>`;
        }
        let displayVal = rawVal;
        if (typeof rawVal === 'number' && (c === fMap.revenue || c.toLowerCase().includes('doanh') || c.toLowerCase().includes('rev'))) {
          displayVal = '$' + rawVal.toLocaleString();
        }
        return `<td><button type="button" class="editable-cell" data-edit-index="${origIdx}" data-edit-column="${escapeHtml(c)}" aria-label="Sửa ${escapeHtml(c)}">${escapeHtml(String(displayVal))||'∅'}<span class="cell-edit-mark">✎</span></button></td>`;
      }).join('')}
      <td>
        <button type="button" class="btn-row-del" data-orig-idx="${origIdx}" title="Xóa dòng này khỏi bảng">Xóa</button>
      </td>
    </tr>
  `).join('');

  const selectPage = document.getElementById('selectReviewPage');
  if (selectPage) {
    const selectedCount = pageEntries.filter(entry => AppState.step3.selectedRows.has(entry.origIdx)).length;
    selectPage.checked = pageEntries.length > 0 && selectedCount === pageEntries.length;
    selectPage.indeterminate = selectedCount > 0 && selectedCount < pageEntries.length;
    selectPage.addEventListener('change', () => {
      pageEntries.forEach(entry => selectPage.checked ? AppState.step3.selectedRows.add(entry.origIdx) : AppState.step3.selectedRows.delete(entry.origIdx));
      renderStep3View();
    });
  }
  tbody.querySelectorAll('.review-row-check').forEach(checkbox => checkbox.addEventListener('change', () => {
    const index = Number(checkbox.dataset.origIdx);
    checkbox.checked ? AppState.step3.selectedRows.add(index) : AppState.step3.selectedRows.delete(index);
    renderStep3View();
  }));
  tbody.querySelectorAll('[data-edit-index]').forEach(button=>button.addEventListener('click',()=>window.Workbench?.openCell(Number(button.dataset.editIndex),button.dataset.editColumn)));
  tbody.querySelectorAll('.btn-row-del').forEach(btn => {
    btn.addEventListener('click', () => removeStep3Row(Number(btn.dataset.origIdx)));
  });
}

function renderStep3CategoryControls() {
  const column = document.getElementById('reviewCategoryColumn');
  const value = document.getElementById('reviewCategoryValue');
  const add = document.getElementById('btnAddReviewFilter');
  const conditions = document.getElementById('reviewCategoryConditions');
  if (!column || !value || !add || !conditions) return;

  const selectedColumn = AppState.headers.includes(column.value) ? column.value : '';
  const selectedValue = value.value;
  const filters = AppState.step3.categoryFilters;
  const usedValues = filters.find(filter => filter.column === selectedColumn)?.values || [];
  const values = selectedColumn ? [...new Set(AppState.cleanRows.map(row => String(row[selectedColumn] ?? '')))]
    .filter(item => item && !usedValues.includes(item)).sort((a,b) => a.localeCompare(b, 'vi')) : [];
  const option = item => '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + '</option>';
  column.innerHTML = '<option value="">Chọn cột</option>' + AppState.headers.map(option).join('');
  column.value = selectedColumn;
  value.innerHTML = '<option value="">Chọn giá trị</option>' + values.map(option).join('');
  value.value = values.includes(selectedValue) ? selectedValue : '';
  value.disabled = !values.length;
  add.disabled = !value.value;
  renderStep3CategoryConditions(conditions, filters);
}

function renderStep3CategoryConditions(conditions, filters) {
  conditions.hidden = !filters.length;
  conditions.innerHTML = filters.flatMap(({column, values}, group) => values.map((value, index) => {
    const label = escapeHtml(column + ': ' + value);
    return '<button type="button" class="linked-chip" data-filter-group="' + group +
      '" data-filter-value="' + index + '" aria-label="Bỏ điều kiện ' + label + '">' + label + ' ×</button>';
  })).join('');
  conditions.querySelectorAll('[data-filter-group]').forEach(button => button.addEventListener('click', () => {
    const group = Number(button.dataset.filterGroup), index = Number(button.dataset.filterValue);
    AppState.step3.categoryFilters = filters.map((filter, i) => i === group
      ? {...filter, values:filter.values.filter((_, j) => j !== index)} : filter)
      .filter(filter => filter.values.length);
    applyStep3Filters();
    document.getElementById('reviewCategoryColumn').focus({preventScroll:true});
  }));
}


function syncBulkDeleteControls(filtered = getStep3FilteredEntries()) {
  const selected = AppState.step3.selectedRows;
  for (const index of selected) if (index >= AppState.cleanRows.length) selected.delete(index);
  const set = (id, value) => { const el = document.getElementById(id); if (el) { if(id.startsWith('btnDelete') && window.DeleteMotion)window.DeleteMotion.setLabel(el,value);else el.textContent=value; } };
  set('reviewSelectionCount', `${selected.size} dòng đã chọn`);
  const hasFilters = AppState.step3.statusFilters.length || AppState.step3.categoryFilters.length || AppState.step3.searchQuery.trim();
  const resetFilters = document.getElementById('btnResetReviewFilters');
  if (resetFilters) resetFilters.hidden = !hasFilters;
  set('btnSelectFiltered', hasFilters ? `Chọn toàn bộ kết quả lọc (${filtered.length})` : `Chọn toàn bộ dữ liệu (${filtered.length})`);
  set('btnDeleteFiltered', `Xóa kết quả lọc (${filtered.length})`);
  set('btnDeleteSelected', `Xóa đã chọn (${selected.size})`);
  const disable = (id, value) => { const el=document.getElementById(id); if(el)el.disabled=value; };
  disable('btnDeleteSelected', !selected.size); disable('btnClearSelection', !selected.size);
  disable('btnSelectFiltered', !filtered.length); disable('btnDeleteFiltered', !filtered.length);
  disable('btnDeleteAllRows', !AppState.cleanRows.length);
  disable('btnUndoBulkDelete', !AppState.lastBulkDelete || AppState.lastBulkDelete.afterRows !== AppState.cleanRows);
}

function requestBulkDelete(scope) {
  if (!AppState.workflow.cleaned || AppState.workflow.cleaning) return;
  const indices = scope === 'all' ? AppState.cleanRows.map((_, i) => i)
    : scope === 'filtered' ? getStep3FilteredEntries().map(entry => entry.origIdx)
    : [...AppState.step3.selectedRows].filter(i => i >= 0 && i < AppState.cleanRows.length);
  if (!indices.length) return;
  const label = scope === 'all' ? 'toàn bộ bảng dữ liệu sạch' : scope === 'filtered' ? 'toàn bộ kết quả đang lọc, trên tất cả các trang' : 'các dòng đã chọn, trên tất cả các trang';
  const revenue = indices.reduce((sum, index) => sum + (Number(AppState.cleanRows[index][AppState.fieldMap.revenue]) || 0), 0);
  AppState.pendingBulkDelete = { indices, rows: AppState.cleanRows, length: AppState.cleanRows.length, label };
  document.getElementById('bulkDeleteSummary').textContent = `Bạn sắp xóa ${indices.length} dòng thuộc ${label}, tổng doanh thu $${revenue.toLocaleString()}.`;
  document.getElementById('bulkDeleteDialog').hidden = false;
  document.getElementById('btnCancelBulkDelete')?.focus();
}

function cancelBulkDelete() {
  AppState.pendingBulkDelete = null;
  const dialog=document.getElementById('bulkDeleteDialog'); if(dialog) dialog.hidden=true;
}

function confirmBulkDelete() {
  const pending = AppState.pendingBulkDelete;
  if (!pending) return;
  if (pending.rows !== AppState.cleanRows || pending.length !== AppState.cleanRows.length || AppState.workflow.cleaning) { cancelBulkDelete(); return; }
  const undoBefore=window.Workbench?.beginChange();
  const remove = new Set(pending.indices);
  const beforeRows = AppState.cleanRows.map(row => ({...row}));
  AppState.cleanRows = AppState.cleanRows.filter((_,i) => !remove.has(i));
  AppState.lastBulkDelete = { beforeRows, afterRows: AppState.cleanRows };
  AppState.step3.selectedRows.clear(); AppState.step3.page=1;
  AppState.step3.feedbackHistory.push({ time:new Date().toLocaleTimeString(), text:`Xóa ${pending.label}`, delta:`-${remove.size} dòng` });
  cancelBulkDelete(); invalidateAnalysis(true); window.Workbench?.recordChange(undoBefore,`Xóa ${remove.size} dòng`); renderStep3View();
  document.dispatchEvent(new CustomEvent('pipeline:data'));
  showInlineToast('step3FeedbackToast', `Đã xóa ${remove.size} dòng. Còn ${AppState.cleanRows.length} dòng. Có thể hoàn tác lần xóa này.`, 'info');
}

function undoBulkDelete() {
  if(window.Workbench){window.Workbench.undo();return;}
  const deletion = AppState.lastBulkDelete;
  if (!deletion || deletion.afterRows !== AppState.cleanRows) return;
  AppState.cleanRows = deletion.beforeRows.map(row => ({...row}));
  AppState.lastBulkDelete=null; AppState.step3.selectedRows.clear();
  AppState.step3.feedbackHistory.push({ time:new Date().toLocaleTimeString(), text:'Hoàn tác lần xóa hàng loạt', delta:`${AppState.cleanRows.length} dòng` });
  invalidateAnalysis(true); renderStep3View();
  document.dispatchEvent(new CustomEvent('pipeline:data'));
  showInlineToast('step3FeedbackToast', 'Đã khôi phục dữ liệu trước lần xóa hàng loạt. Hãy kiểm duyệt lại.', 'success');
}

function renderReviewTable() {
  renderStep3View();
}

function filterReviewTable(query) {
  AppState.step3.searchQuery = String(query || '');
  applyStep3Filters();
}

// FEEDBACK TỪ NGƯỜI 1 (TRƯỜNG HỢP 1: NO OK -> AI LỌC LẠI TRỰC TIẾP)
function executeStep3Feedback() {
  const input = document.getElementById('feedbackInputStep3');
  const feedback = input?.value.trim() || '';
  if (!feedback || AppState.workflow.cleaning || !AppState.workflow.cleaned) return;
  AppState.workflow.dataFeedbackPending = true;
  invalidateAnalysis(true);
  let rows = AppState.cleanRows.map(row => ({ ...row }));
  const messages = [], f = AppState.fieldMap;
  const commands = feedback.split(/;|\n|,(?!\d)|\s+và\s+/i).map(t => t.trim()).filter(Boolean);
  for (const command of commands) {
    const norm = normalizeFeedback(command);
    const keep = /^(chi giu|chi lay|giu lai)/.test(norm);
    const remove = /^(xoa|bo|loai bo|loai)/.test(norm);
    const action = '(?:chi giu|chi lay|giu lai|xoa|bo|loai bo|loai)';
    const threshold = norm.match(new RegExp(`^${action}\\s+(?:(?:cac )?don (?:hang )?)?(?:co )?(?:doanh thu )?(>=|<=|>|<|tu|tren|duoi|lon hon hoac bang|nho hon hoac bang|lon hon|nho hon)\\s*\\$?\\s*([\\d,.]+)$`));
    const statusCommand = new RegExp(`^${action}\\s+(?:cac )?(?:don (?:hang )?)?(?:trang thai )?(?:da )?(canceled|cancelled|huy|completed|hoan thanh|hoan tat|shipped|dang giao|processing|dang xu ly)$`).test(norm);
    if ((keep || remove) && threshold && /doanh thu|don/.test(norm)) {
      const value = Number(threshold[2].replace(/,/g,'')), op = threshold[1];
      if (!Number.isFinite(value)) { showInlineToast('step3FeedbackToast', 'Ngưỡng doanh thu không hợp lệ. Chưa cập nhật dữ liệu.', 'warn'); return; }
      const compare = x => ['>=','tu','lon hon hoac bang'].includes(op) ? x >= value
        : ['<=','nho hon hoac bang'].includes(op) ? x <= value
        : ['>','tren','lon hon'].includes(op) ? x > value : x < value;
      rows = rows.filter(row => keep === compare(Number(row[f.revenue])));
      messages.push(`Đã áp dụng: ${command}.`);
    } else if ((keep || remove) && statusCommand) {
      const status = /cancel|huy/.test(norm) ? 'Canceled' : /completed|hoan thanh|hoan tat/.test(norm) ? 'Completed' : /shipped|dang giao/.test(norm) ? 'Shipped' : 'Processing';
      rows = rows.filter(row => keep === (classifyStatusMeta(row[f.status]).key === status));
      messages.push(`Đã áp dụng: ${command}.`);
    } else if (/^(?:chuan hoa ten khach hang in hoa|viet hoa ten khach hang|in hoa ten khach hang|viet hoa|in hoa)$/.test(norm)) {
      const nameCol = detectOptionalColumn(['ten khach hang','customer name']);
      if (!nameCol) { showInlineToast('step3FeedbackToast', 'Bảng không có cột tên khách hàng để viết hoa. Chưa cập nhật dữ liệu.', 'warn'); return; }
      rows = rows.map(row => ({...row, [nameCol]: String(row[nameCol] ?? '').toUpperCase()}));
      messages.push('Đã viết hoa tên khách hàng.');
    } else if (/^(?:xoa|bo|loai bo|loai|kiem tra|kiem tra lai) (?:don |ma don )?(?:trung|trung lap|duplicate)$/.test(norm)) {
      const seen = new Set();
      rows = rows.filter(row => { const id = String(row[f.order_id]).trim(); if (seen.has(id)) return false; seen.add(id); return true; });
      messages.push('Đã kiểm tra lại mã đơn trùng.');
    } else if (keep || remove) {
      const quoted = command.match(/^(?:Chỉ giữ|Chỉ lấy|Giữ lại|Xóa|Bỏ|Loại bỏ|Loại)\s+["']([^"']+)["']$/i);
      if (!quoted) { showInlineToast('step3FeedbackToast', `Chưa xử lý yêu cầu "${command}". Với từ khóa, hãy dùng: Chỉ giữ "Hà Nội". Không có thay đổi nào được áp dụng.`, 'warn'); return; }
      const keyword = quoted[1].toLowerCase();
      rows = rows.filter(row => keep === Object.values(row).some(value => String(value ?? '').toLowerCase().includes(keyword)));
      messages.push(`Đã lọc theo "${quoted[1]}".`);
    } else {
      showInlineToast('step3FeedbackToast', `Chưa hỗ trợ yêu cầu "${command}". Chọn gợi ý hoặc dùng lệnh lọc trạng thái, doanh thu, từ khóa trong dấu ngoặc kép. Chưa cập nhật dữ liệu.`, 'warn'); return;
    }
  }
  setStep(2);
  startAICleaning({ rows, feedback, message: messages.join(' ') });
}



// ===================================================================
// BƯỚC 4 & 5: AI PHÂN TÍCH CHUYÊN SÂU & CHARTS
// ===================================================================
function detectOptionalColumn(candidates) {
  const headers = AppState.headers || [];
  for (const h of headers) {
    const norm = normalizeHeaderKey(h);
    if (candidates.some(c => norm.includes(normalizeHeaderKey(c)))) return h;
  }
  return null;
}



function getTimeBucketMeta(rawDate, period) {
  const parts = parseDateParts(rawDate);
  if (!parts) {
    const lbl = String(rawDate || 'Khác').trim() || 'Khác';
    return { key: lbl, sortKey: 99999999 };
  }
  if (period === 'month') {
    return {
      key: `Tháng ${String(parts.m).padStart(2, '0')}/${parts.y}`,
      sortKey: parts.y * 100 + parts.m
    };
  }
  if (period === 'week') {
    const wk = Math.min(5, Math.ceil(parts.d / 7));
    return {
      key: `Tuần ${wk} T${parts.m}/${String(parts.y).slice(-2)}`,
      sortKey: parts.y * 10000 + parts.m * 100 + wk
    };
  }
  return { key: parts.label, sortKey: parts.sortKey };
}

function renderRankingBars(containerId, items, emptyMessage) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items || items.length === 0) {
    window.SmoothMotion?.forgetChart(el);
    el.innerHTML = `<div style="font-size:0.8rem; color: var(--text-muted);">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  const maxVal = Math.max(...items.map(i => i.revenue), 1);
  const fillClass = containerId === 'topCustomersList' ? 'fill-indigo' : '';
  el.innerHTML = items.map((item, idx) => {
    const pct = Math.max(8, Math.round((item.revenue / maxVal) * 100));
    return `
      <div class="rank-item">
        <div class="rank-label-row">
          <span title="${escapeHtml(item.name)}">#${idx + 1} ${escapeHtml(item.name)}</span>
          <span>${item.orders} đơn • $${Math.round(item.revenue).toLocaleString()}</span>
        </div>
        <div class="rank-bar-track">
          <div class="rank-bar-fill ${fillClass}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
  window.SmoothMotion?.watchSVG(el, JSON.stringify(items));
}

function runDeepAnalytics() {
  if (!AppState.workflow.dataApproved || AppState.workflow.dataFeedbackPending || AppState.workflow.cleaning) return;
  const allRows = getAnalysisRows();
  const fMap = AppState.fieldMap;
  if (!AppState.cleanRows.length) return;

  const period = AppState.analytics.period || 'day';
  const profitMargin = AppState.analytics.profitMargin ?? 0.32;
  const excludeCanceled = Boolean(AppState.analytics.excludeCanceled);
  const focusStrategy = AppState.analytics.focusStrategy || 'balanced';

  const statusMap = Object.create(null);
  let completedCount = 0;
  let shippedCount = 0;
  let canceledCount = 0;
  let allRevenue = 0;
  let canceledRevenue = 0;

  allRows.forEach(r => {
    const revenue = Number(r[fMap.revenue]) || 0;
    allRevenue += revenue;
    const rawSt = String(r[fMap.status] || 'Completed').trim() || 'Completed';
    statusMap[rawSt] = (statusMap[rawSt] || 0) + 1;
    const canonical = classifyStatusMeta(rawSt).key;
    if (canonical === 'Completed') completedCount++;
    else if (canonical === 'Shipped') shippedCount++;
    else if (canonical === 'Canceled') {
      canceledCount++;
      canceledRevenue += revenue;
    }
  });

  const activeRows = excludeCanceled
    ? allRows.filter(r => classifyStatusMeta(r[fMap.status]).key !== 'Canceled')
    : allRows;

  const prodCol = detectOptionalColumn(['san pham', 'product', 'dich vu', 'goi', 'item', 'mat hang']);
  const custNameCol = detectOptionalColumn(['ten khach hang', 'customer name', 'ten cong ty', 'khach hang']);

  let totalRev = 0;
  let maxRev = 0;
  let maxOrderId = '—';
  const bucketMap = Object.create(null);
  const custAgg = Object.create(null);
  const prodAgg = Object.create(null);

  activeRows.forEach((r, idx) => {
    const rev = Number(r[fMap.revenue]) || 0;
    totalRev += rev;

    const ordId = String(r[fMap.order_id] || `#${idx + 1}`);
    if (rev >= maxRev) {
      maxRev = rev;
      maxOrderId = ordId;
    }

    const bucket = getTimeBucketMeta(r[fMap.date], period);
    if (!bucketMap[bucket.key]) {
      bucketMap[bucket.key] = { label: bucket.key, sortKey: bucket.sortKey, revenue: 0 };
    }
    bucketMap[bucket.key].revenue += rev;

    const custId = String(r[fMap.customer_id] || '').trim();
    const custName = custNameCol ? String(r[custNameCol] || '').trim() : '';
    const custKey = custId || custName || `Khách #${idx + 1}`;
    const custLabel = custName && custId && custName !== custId ? `${custName} (${custId})` : custKey;
    if (!custAgg[custKey]) custAgg[custKey] = { name: custLabel, orders: 0, revenue: 0 };
    custAgg[custKey].orders += 1;
    custAgg[custKey].revenue += rev;

    const prodName = prodCol ? (String(r[prodCol] || '').trim() || 'Chưa phân loại') : String(r[fMap.status] || 'Đơn tiêu chuẩn');
    if (!prodAgg[prodName]) prodAgg[prodName] = { name: prodName, orders: 0, revenue: 0 };
    prodAgg[prodName].orders += 1;
    prodAgg[prodName].revenue += rev;
  });

  const orderCount = activeRows.length;
  const aov = orderCount > 0 ? Number((totalRev / orderCount).toFixed(1)) : 0;
  const estimatedProfit = totalRev * profitMargin;
  const custEntries = Object.values(custAgg);
  const uniqueCustomers = custEntries.length;
  const repeatCustomers = custEntries.filter(c => c.orders >= 2).length;
  const repeatRate = uniqueCustomers > 0 ? ((repeatCustomers / uniqueCustomers) * 100).toFixed(1) : '0.0';
  const completionRate = allRows.length > 0 ? (((completedCount + shippedCount) / allRows.length) * 100).toFixed(1) : '0.0';

  const topProducts = Object.values(prodAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topCustomers = custEntries.sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const series = Object.values(bucketMap).sort((a, b) => a.sortKey - b.sortKey);
  const peakPeriod = series.length > 0 ? [...series].sort((a, b) => b.revenue - a.revenue)[0] : null;

  AppState.analytics.lastMetrics = {
    totalRev,
    estimatedProfit,
    profitMargin,
    orderCount,
    allCount: allRows.length,
    allRevenue,
    canceledRevenue,
    canceledCount,
    completionRate,
    aov,
    maxRev,
    maxOrderId,
    uniqueCustomers,
    repeatCustomers,
    repeatRate,
    topProducts,
    topCustomers,
    series,
    statusMap,
    explorations: buildExplorationData(activeRows),
    peakPeriodLabel: peakPeriod ? peakPeriod.label : '—',
    period
  };

  renderAnalysisScenario();
  animateCounterNumber(document.getElementById('kpiRevenueVal'), totalRev, '$', '', 0, 1000);
  animateCounterNumber(document.getElementById('kpiOrdersVal'), orderCount, '', '', 0, 850);
  animateCounterNumber(document.getElementById('kpiAovVal'), aov, '$', '', 1, 900);
  animateCounterNumber(document.getElementById('kpiCustomersVal'), uniqueCustomers, '', '', 0, 850);

  const profitNoteEl = document.getElementById('kpiProfitMarginNote');
  const compNoteEl = document.getElementById('kpiCompletionRateNote');
  const peakNoteEl = document.getElementById('kpiPeakOrderNote');
  const repeatNoteEl = document.getElementById('kpiRepeatRateNote');

  if (profitNoteEl) {
    profitNoteEl.textContent = `Biên lợi nhuận ${(profitMargin * 100).toFixed(0)}%: Ước tính lãi $${Math.round(estimatedProfit).toLocaleString()}`;
  }
  if (compNoteEl) {
    compNoteEl.textContent = excludeCanceled && canceledCount > 0
      ? `Hoàn tất/Giao: ${completionRate}% (Đã loại ${canceledCount} đơn hủy)`
      : `Hoàn tất/Giao: ${completionRate}% (${canceledCount} đơn hủy)`;
  }
  if (peakNoteEl) {
    peakNoteEl.textContent = `Đơn cao nhất: $${Math.round(maxRev).toLocaleString()} (${maxOrderId})`;
  }
  if (repeatNoteEl) {
    repeatNoteEl.textContent = `Mua lại (≥2 đơn): ${repeatCustomers}/${uniqueCustomers} khách (${repeatRate}%)`;
  }

  drawFinanceLineChart(series, profitMargin);
  drawStatusDonutChart(statusMap);
  renderRankingBars('topProductsList', topProducts, 'Chưa đủ dữ liệu sản phẩm để xếp hạng.');
  renderRankingBars('topCustomersList', topCustomers, 'Chưa đủ dữ liệu khách hàng để xếp hạng.');
  renderProposals(AppState.analytics.lastMetrics, focusStrategy);
  drawExplorationCharts(AppState.analytics.lastMetrics);
  window.Workbench?.renderLinked();
  window.WorkflowImprovements?.renderComparison();
}

// Biểu đồ đường kép tài chính (Doanh thu & Lợi nhuận ước tính)
function drawFinanceLineChart(series, profitMargin) {
  const canvas = document.getElementById('financeChart');
  if (!canvas) return;

  const sliced = series.length > 16 && AppState.analytics.period === 'day'
    ? series.slice(-16)
    : series;

  const labels = sliced.map(s => s.label);
  const revData = sliced.map(s => Math.round(s.revenue));
  const profitData = sliced.map(s => Math.round(s.revenue * profitMargin));

  if (AppState.charts.financeChart) {
    AppState.charts.financeChart.destroy();
  }

  const ctx = canvas.getContext('2d');
  const revGrad = ctx.createLinearGradient(0, 0, 0, 240);
  revGrad.addColorStop(0, 'rgba(21, 133, 90, 0.34)');
  revGrad.addColorStop(1, 'rgba(21, 133, 90, 0.0)');

  const profGrad = ctx.createLinearGradient(0, 0, 0, 240);
  profGrad.addColorStop(0, 'rgba(107, 160, 132, 0.22)');
  profGrad.addColorStop(1, 'rgba(107, 160, 132, 0.0)');

  AppState.charts.financeChart = (window.SmoothMotion?.createChart || ((canvas,config)=>new Chart(canvas,config)))(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Doanh Thu ($)',
          data: revData,
          borderColor: '#15855a',
          borderWidth: 3,
          backgroundColor: revGrad,
          fill: true,
          tension: 0.38,
          pointBackgroundColor: '#15855a',
          pointRadius: 4
        },
        {
          label: `Lợi Nhuận (${Math.round(profitMargin * 100)}%)`,
          data: profitData,
          borderColor: '#75ac91',
          borderWidth: 2.5,
          borderDash: [5, 4],
          backgroundColor: profGrad,
          fill: true,
          tension: 0.38,
          pointBackgroundColor: '#75ac91',
          pointRadius: 3
        }
      ]
    },
    options: {
      ...chartInteractionOptions(),
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...chartInteractionOptions().plugins,
        legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } }
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
          }
        }
      }
    }
  });
}

function drawStatusDonutChart(statusMap) {
  const canvas=document.getElementById('statusDonutChart');if(!canvas)return;
  const labels=Object.keys(statusMap),values=labels.map(label=>Number(statusMap[label])||0);
  const colors=['#15855a','#66a68b','#10b981','#f59e0b','#a0bca6'];
  // Cartesian axes are deliberately omitted from radial charts.
  const {scales,...base}=chartInteractionOptions();
  const visible=(chart,index)=>typeof chart.getDataVisibility!=='function' || chart.getDataVisibility(index);
  const total=chart=>chart.data.datasets[0].data.reduce((sum,value,index)=>sum+(visible(chart,index)?Number(value)||0:0),0);
  const percentFormat=new Intl.NumberFormat('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1});
  const percent=(value,sum)=>percentFormat.format(sum?value/sum*100:0)+'%';
  const percentLabels={
    id:'statusPercentLabels',
    afterDatasetsDraw(chart) {
      const ctx=chart.ctx,meta=chart.getDatasetMeta(0),sum=total(chart);
      ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
      meta.data.forEach((arc,index)=>{
        const value=Number(chart.data.datasets[0].data[index])||0;
        if(!visible(chart,index) || !sum || value/sum<.07)return;
        const point=typeof arc.getProps==='function'?arc.getProps(['x','y','startAngle','endAngle','innerRadius','outerRadius'],false):arc;
        if(!point.outerRadius || point.endAngle-point.startAngle<.18)return;
        const angle=(point.startAngle+point.endAngle)/2,radius=(point.innerRadius+point.outerRadius)/2;
        const x=point.x+Math.cos(angle)*radius,y=point.y+Math.sin(angle)*radius;
        ctx.font='600 11px "Plus Jakarta Sans", sans-serif';ctx.fillStyle='#fff';ctx.shadowColor='#103b2940';ctx.shadowBlur=4;
        ctx.fillText(percent(value,sum),x,y);
      });
      ctx.shadowBlur=0;
      const first=meta.data[0],area=chart.chartArea;
      const cx=first?.x ?? (area.left+area.right)/2,cy=first?.y ?? (area.top+area.bottom)/2;
      const dark=document.documentElement.getAttribute('data-theme')==='dark';
      ctx.font='500 24px "Plus Jakarta Sans", sans-serif';ctx.fillStyle=dark?'#edf4ef':'#20382a';
      ctx.fillText(sum?'100%':'0%',cx,cy-6);
      ctx.font='10px "Plus Jakarta Sans", sans-serif';ctx.fillStyle=dark?'#a4b5aa':'#506358';
      ctx.fillText(sum?sum.toLocaleString('vi-VN')+' đơn':'Chưa có đơn',cx,cy+15);ctx.restore();
    }
  };
  AppState.charts.donutChart?.destroy();
  AppState.charts.donutChart=(window.SmoothMotion?.createChart || ((canvas,config)=>new Chart(canvas,config)))(canvas,{
    type:'doughnut',
    data:{labels,datasets:[{data:values,backgroundColor:colors,borderColor:'transparent',borderWidth:2,hoverOffset:7,spacing:2}]},
    plugins:[percentLabels],
    options:{
      ...base,scales:{},responsive:true,maintainAspectRatio:false,cutout:'62%',layout:{padding:10},
      plugins:{
        ...base.plugins,
        legend:{position:'bottom',labels:{...base.plugins.legend.labels,padding:15,
          generateLabels(chart){const sum=total(chart);return chart.data.labels.map((label,index)=>({
            text:label+' · '+(visible(chart,index)?percent(Number(chart.data.datasets[0].data[index])||0,sum):'đã ẩn'),
            fillStyle:colors[index%colors.length],strokeStyle:'transparent',lineWidth:0,index,hidden:!visible(chart,index),
            fontColor:base.plugins.legend.labels.color
          }));}
        }},
        tooltip:{...base.plugins.tooltip,callbacks:{label(context){const sum=total(context.chart);return `${context.label}: ${Number(context.raw).toLocaleString('vi-VN')} đơn (${percent(Number(context.raw),sum)})`;}}}
      }
    }
  });
  const sum=values.reduce((a,b)=>a+b,0);
  canvas.setAttribute('aria-label','Tỷ trọng trạng thái đơn hàng: '+labels.map((label,i)=>`${label}: ${values[i]} đơn, ${percent(values[i],sum)}`).join('; '));
}

function renderProposals(metrics, focusStrategy = 'balanced') {
  const container = document.getElementById('proposalsList');
  if (!container || !metrics) return;

  const topProd = metrics.topProducts[0];
  const topCust = metrics.topCustomers[0];
  const cancelShare = metrics.allCount > 0 ? ((metrics.canceledCount / metrics.allCount) * 100).toFixed(1) : '0.0';
  const targetAov = (metrics.aov * 1.18).toFixed(0);

  const cards = [];

  if (focusStrategy === 'revenue' || focusStrategy === 'balanced') {
    cards.push({
      tag: 'Tối Ưu Doanh Thu',
      title: topProd ? `Mở Rộng Sản Phẩm "${topProd.name}"` : 'Đẩy Mạnh Gói Combo Chủ Lực',
      desc: topProd
        ? `"${topProd.name}" dẫn đầu với $${Math.round(topProd.revenue).toLocaleString()} (${topProd.orders} đơn). Ghép upsell cùng sản phẩm top giúp nâng AOV từ $${metrics.aov} lên $${targetAov}.`
        : `AOV hiện tại đạt $${metrics.aov} với tổng doanh thu $${Math.round(metrics.totalRev).toLocaleString()}. Gói combo phụ trợ giúp đẩy AOV vượt $${targetAov}.`
    });
  }

  if (focusStrategy === 'retention' || focusStrategy === 'balanced') {
    cards.push({
      tag: 'Giữ Chân Khách VIP',
      title: topCust ? `Chăm Sóc Nhóm VIP (${metrics.repeatRate}% Mua Lại)` : 'Kích Hoạt Hạng Thành Viên VIP',
      desc: topCust
        ? `Khách hàng dẫn đầu ${topCust.name} đóng góp $${Math.round(topCust.revenue).toLocaleString()} (${topCust.orders} đơn). Hiện có ${metrics.repeatCustomers}/${metrics.uniqueCustomers} khách mua lại.`
        : `Có ${metrics.uniqueCustomers} khách hàng hoạt động (${metrics.repeatRate}% quay lại). Tự động ưu đãi sau đơn thứ 2 giúp tăng CLV rõ rệt.`
    });
  }

  if (focusStrategy === 'efficiency' || focusStrategy === 'balanced') {
    cards.push({
      tag: 'Tối Ưu Vận Hành & Biên Lãi',
      title: metrics.canceledCount > 0 ? `Giảm Tỷ Lệ Hủy Đơn (${cancelShare}%)` : `Duy Trì Hiệu Suất ${metrics.completionRate}%`,
      desc: metrics.canceledCount > 0
        ? `Ghi nhận ${metrics.canceledCount}/${metrics.allCount} đơn bị hủy (${cancelShare}%). Gửi xác nhận tự động qua Zalo/SMS ngay khi đặt giúp giữ lại phần lớn biên lợi nhuận ${Math.round(metrics.profitMargin * 100)}%.`
        : `Đạt tỷ lệ hoàn tất/giao hàng ${metrics.completionRate}%. Lợi nhuận ước tính hiện tại đạt $${Math.round(metrics.estimatedProfit).toLocaleString()} với điểm rơi cao nhất tại ${metrics.peakPeriodLabel}.`
    });
  }

  /* Scenario targets are assumptions, not model predictions. */
  while (cards.length < 3) {
    cards.push({
      tag: 'Mục Tiêu Trọng Tâm',
      title: `Kịch Bản Mục Tiêu Tăng Doanh Thu 15% ($${Math.round(metrics.totalRev * 1.15).toLocaleString()})`,
      desc: `Với biên lợi nhuận ${Math.round(metrics.profitMargin * 100)}%, tập trung phân bổ ngân sách vào chu kỳ đỉnh điểm (${metrics.peakPeriodLabel}) để thử mục tiêu doanh thu tăng 15%. Đây là giả định kế hoạch, chưa phải dự báo đã được kiểm chứng.`
    });
  }

  metrics.proposals = cards.slice(0,3);
  container.innerHTML = metrics.proposals.map(item => `
    <div class="prop-card">
      <span class="prop-tag">${escapeHtml(item.tag)}</span>
      <h4 class="prop-title">${escapeHtml(item.title)}</h4>
      <p class="prop-desc">${escapeHtml(item.desc)}</p>
    </div>
  `).join('');
}

// ===================================================================
// BƯỚC 6: PHÊ DUYỆT CUỐI CÙNG & XUẤT DỮ LIỆU
// ===================================================================
function renderAnalysisScenario() {
  const metrics = AppState.analytics.lastMetrics;
  if (!metrics) return;
  const {excludeCanceled, profitMargin, focusStrategy} = AppState.analytics;
  const revenue = metrics.allRevenue - (excludeCanceled ? metrics.canceledRevenue : 0);
  const orders = metrics.allCount - (excludeCanceled ? metrics.canceledCount : 0);
  const profit = revenue * profitMargin;
  const money = new Intl.NumberFormat('vi-VN', {style:'currency', currency:'USD', maximumFractionDigits:0});
  const profitDelta = Math.round(profit) - Math.round(metrics.estimatedProfit);
  const orderDelta = orders - metrics.orderCount;
  const changes = [];
  if (profitDelta) changes.push((profitDelta > 0 ? '+' : '−') + money.format(Math.abs(profitDelta)) + ' lợi nhuận ước tính');
  if (orderDelta) changes.push((orderDelta > 0 ? '+' : '−') + Math.abs(orderDelta).toLocaleString('vi-VN') + ' đơn');

  document.getElementById('scenarioRevenue').textContent = money.format(revenue);
  document.getElementById('scenarioProfit').textContent = money.format(profit);
  document.getElementById('scenarioOrders').textContent = orders.toLocaleString('vi-VN');
  document.getElementById('scenarioComparison').textContent = changes.length
    ? 'So với lần chạy gần nhất: ' + changes.join(' · ')
    : 'Lợi nhuận ước tính và số đơn bằng lần chạy gần nhất.';

  const focusNotes = {
    balanced:'Gợi ý cân bằng giữa doanh thu và vận hành.',
    retention:'Ưu tiên giữ chân khách hàng và chăm sóc nhóm VIP.',
    revenue:'Ưu tiên tăng doanh thu từ sản phẩm bán tốt.',
    efficiency:'Ưu tiên giảm rủi ro và tỷ lệ hủy đơn.'
  };
  document.getElementById('scenarioFocus').textContent = focusNotes[focusStrategy] || focusNotes.balanced;
}


function markParametersDirty() {
  renderAnalysisScenario();
  AppState.workflow.paramsDirty = true;
  invalidateAnalysis();
}
function startAnalysis() {
  const w = AppState.workflow;
  if (!w.dataApproved || w.dataFeedbackPending || !AppState.cleanRows.length || w.cleaning || w.analysisRunning) return;
  clearTimeout(analysisTimer);
  w.analysisRunning = true; w.analysisReady = false; w.resultsViewed = false; w.finalApproved = false;
  setStep(4);
  const activity=showAIActivity('analysis');
  const generation=fileReadGeneration;
  const label = document.getElementById('analysisProgressLabel');
  if (label) label.textContent = 'Đang tính chỉ số, tổng hợp xu hướng và tạo đề xuất kinh doanh…';
  const retry = document.getElementById('btnRetryAnalysis');
  if (retry) retry.hidden = true;
  const feedback = document.getElementById('analysisRunFeedback');
  if (feedback) feedback.textContent = AppState.analysisFeedbackHistory.at(-1) || 'Phân tích dữ liệu đã được người kiểm duyệt 1 phê duyệt.';
  syncWorkflowControls();
  analysisTimer = setTimeout(() => {
    if(generation!==fileReadGeneration || aiActivity!==activity)return;
    try {
      runDeepAnalytics();
      if (!AppState.analytics.lastMetrics) throw new Error('Không có kết quả phân tích.');
      const remaining=Math.max(0,AI_ANALYSIS_MIN_MS-(performance.now()-activity.startedAt));
      analysisTimer=setTimeout(()=>{
        if(generation!==fileReadGeneration || aiActivity!==activity)return;
        w.analysisRunning = false; w.analysisReady = true; w.paramsDirty = false;
        if (label) label.textContent = 'Đã hoàn tất tính toán và đề xuất. Mở Bước 5 để xem kết quả.';
        hideAIActivity(activity);syncWorkflowControls();
      },remaining);
    } catch (error) {
      w.analysisRunning = false; w.analysisReady = false;
      if (label) label.textContent = `Phân tích chưa hoàn tất: ${error.message}`;
      if (retry) retry.hidden = false;
      hideAIActivity(activity);
    }
    syncWorkflowControls();
  }, 60);
}
function executeStep6Feedback() {
  const input = document.getElementById('feedbackInputStep6');
  const feedback = input?.value.trim() || '';
  const plan = { profitMargin: AppState.analytics.profitMargin, excludeCanceled: AppState.analytics.excludeCanceled, focusStrategy: AppState.analytics.focusStrategy };
  const commands = feedback.split(/;|\n|,(?!\d)|\s+và\s+/i).map(t => t.trim()).filter(Boolean);
  for (const command of commands) {
    const norm = normalizeFeedback(command);
    const margin = norm.match(/^(?:dat |dieu chinh )?(?:bien loi nhuan|bien lai)(?: uoc tinh)?(?: la| thanh| =)?\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/);
    if (margin && Number(margin[1].replace(',','.')) >= 0 && Number(margin[1].replace(',','.')) <= 100) plan.profitMargin = Number(margin[1].replace(',','.')) / 100;
    else if (/^(loai|loai bo|loai tru|bo|tru) (?:cac )?don (?:hang )?(?:da )?(huy|canceled)$/.test(norm)) plan.excludeCanceled = true;
    else if (/^(tinh ca|bao gom) (?:cac )?don (?:hang )?(?:da )?(huy|canceled)$/.test(norm)) plan.excludeCanceled = false;
    else if (/^(tap trung|uu tien) (?:nhom )?(?:khach hang vip|vip|giu chan|giu chan khach hang)$/.test(norm)) plan.focusStrategy = 'retention';
    else if (/^(tap trung|uu tien) (?:tang )?(doanh thu|tang truong)$/.test(norm)) plan.focusStrategy = 'revenue';
    else if (/^(tap trung|uu tien) (van hanh|chi phi|hieu suat)$/.test(norm)) plan.focusStrategy = 'efficiency';
    else if (/^(can bang|can bang toan dien)$/.test(norm)) plan.focusStrategy = 'balanced';
    else {
      AppState.workflow.finalFeedbackPending = true;
      invalidateAnalysis();
      showInlineToast('step6FeedbackToast', `Chưa hỗ trợ yêu cầu "${command}". Hãy dùng các tham số bên trên hoặc ví dụ: Biên lợi nhuận 40%; Loại đơn hủy; Tập trung VIP. Chưa áp dụng thay đổi nào.`, 'warn');
      return;
    }
  }
  Object.assign(AppState.analytics, plan);
  document.getElementById('paramProfitMargin').value = plan.profitMargin * 100;
  document.getElementById('paramProfitMarginVal').textContent = `${Math.round(plan.profitMargin * 100)}%`;
  document.getElementById('paramExcludeCanceled').checked = plan.excludeCanceled;
  document.getElementById('paramFocusStrategy').value = plan.focusStrategy;
  AppState.analysisFeedbackHistory.push(feedback || `Chạy lại với biên lợi nhuận ${Math.round(plan.profitMargin * 100)}%, trọng tâm ${plan.focusStrategy}, ${plan.excludeCanceled ? 'loại' : 'gồm'} đơn hủy.`);
  AppState.workflow.finalFeedbackPending = false;
  if (input) input.value = '';
  startAnalysis();
}

function showCelebrationReady(exportTypeLabel) {
  const banner = document.getElementById('celebrationBanner');
  const detailEl = document.getElementById('celebrationDetailText');
  const m = AppState.analytics.lastMetrics;
  if (detailEl && m) {
    detailEl.textContent = `Đã xuất thành công ${exportTypeLabel} • ${m.allCount} bản ghi sạch • Tổng doanh thu $${Math.round(m.totalRev).toLocaleString()} (Lợi nhuận ước tính $${Math.round(m.estimatedProfit).toLocaleString()}).`;
  }
  if (banner) banner.classList.add('active');
}

function exportStandaloneHtml() {
  if (!requireExportApproval()) return;
  const html = buildStandaloneReport({
    metrics: AppState.analytics.lastMetrics,
    linkedFilters:AppState.analytics.crossFilters || {},
    sheetName:AppState.sheetName || '',reviewer:document.getElementById('reviewerName')?.value || 'Người kiểm duyệt',
    fileName: AppState.fileName,
    dateRange: AppState.analytics.dateRange,
    excludeCanceled: AppState.analytics.excludeCanceled,
    generatedAt: new Date().toLocaleString('vi-VN'),
    feedback: AppState.analysisFeedbackHistory
  });
  downloadBlob(html, 'Bao_Cao_Nghiem_Thu_V14.html', 'text/html;charset=utf-8;');
  showInlineToast('step6FeedbackToast', 'Đã xuất báo cáo HTML tương tác, mở được khi không có mạng.', 'success');
  showCelebrationReady('Báo Cáo HTML Tương Tác');
}

function exportCleanedXlsx() {
  if (!requireExportApproval()) return;
  if (!AppState.cleanRows || AppState.cleanRows.length === 0) {
    showInlineToast('step6FeedbackToast', 'Chưa có dữ liệu sạch để xuất file Excel. Hãy hoàn tất Bước 2 trước.', 'warn');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(getAnalysisRows(), { header: [...AppState.headers] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DuLieuSach_V14');
  XLSX.writeFile(wb, 'Du_Lieu_Sach_V14.xlsx');
  showInlineToast('step6FeedbackToast', `Đã xuất ${getAnalysisRows().length} dòng sạch trong kỳ ra file Excel (.xlsx)!`, 'success');
  showCelebrationReady('File Excel Sạch (.xlsx)');
}

function exportCleanedCsv() {
  if (!requireExportApproval()) return;
  if (!AppState.cleanRows || AppState.cleanRows.length === 0) {
    showInlineToast('step6FeedbackToast', 'Chưa có dữ liệu sạch để xuất CSV. Hãy hoàn tất Bước 2 trước.', 'warn');
    return;
  }
  const csv = '\uFEFF' + Papa.unparse({ fields: AppState.headers, data: getAnalysisRows() });
  downloadBlob(csv, 'Du_Lieu_Sach_V14.csv', 'text/csv;charset=utf-8;');
  showInlineToast('step6FeedbackToast', `Đã xuất ${getAnalysisRows().length} dòng sạch trong kỳ ra file CSV (UTF-8)!`, 'success');
  showCelebrationReady('File Dữ Liệu CSV Sạch');
}

function downloadBlob(content, fileName, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===================================================================
// DEMO DATA GENERATORS
// ===================================================================
function loadValidDemoFile() {
  const sample = [];
  const statuses = ['Completed', 'Shipped', 'Completed', 'Processing', 'Canceled'];
  const dates = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  for (let i = 1; i <= 32; i++) {
    sample.push({
      'Mã khách hàng': `KH-${1000 + (i % 6)}`,
      'Mã đơn hàng': `ORD-V14-${200 + i}`,
      'Ngày giao hàng': dates[i % dates.length],
      'Doanh thu': Math.floor(Math.random() * 650) + 120,
      'Trạng thái': statuses[i % statuses.length],
      'Sản phẩm': i % 2 === 0 ? 'Cloud SaaS Pro' : 'API License Pack'
    });
  }

  // Inject duplicate & null for AI to clean
  sample.push({ ...sample[2] });
  sample.push({ ...sample[5] });
  sample[8]['Doanh thu'] = '';

  validateFileSchema(sample, 'Bang_tinh_kinh_doanh_chuan.xlsx');
}

function loadCorruptedDemoFile() {
  // Thiếu 'Mã đơn hàng' và 'Ngày giao hàng' để kích hoạt CHỮ ERROR ĐỎ TO ĐÙNG
  const corrupted = [
    {
      'Mã khách hàng': 'KH-8801',
      'Doanh thu': 320,
      'Ghi chú': 'Thiếu mã đơn và ngày giao'
    },
    {
      'Mã khách hàng': 'KH-8802',
      'Doanh thu': 640,
      'Ghi chú': 'Không đạt chuẩn khóa chính'
    }
  ];

  validateFileSchema(corrupted, 'File_Loi_Thieu_Khoa_Chinh.xlsx');
}

// ===================================================================
// THEME & CIRCULAR EXPANDING RIPPLE (SETTIGATION SIGNATURE)
// ===================================================================
function toggleTheme(event) {
  const html = document.documentElement;
  const cur = html.getAttribute('data-theme') || 'light';
  const next = cur === 'light' ? 'dark' : 'light';

  // Tính toán tâm điểm phát tán hiệu ứng tròn từ vị trí nút click
  let x = window.innerWidth - 80;
  let y = 42;
  if (event && event.clientX !== undefined) {
    x = event.clientX;
    y = event.clientY;
  } else {
    const btn = document.getElementById('themeSwitch');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
  }

  // Bán kính lớn nhất để phủ kín toàn bộ màn hình từ tâm (x, y)
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  // 1. Sử dụng View Transitions API (Hỗ trợ 100% trên Chrome, Edge, Cốc Cốc)
  if (document.startViewTransition) {
    const transition = document.startViewTransition(() => {
      html.setAttribute('data-theme', next);
      if (AppState.charts.financeChart) AppState.charts.financeChart.update();
    });

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
          ]
        },
        {
          duration: 750,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    });
  } else {
    // 2. Fallback sóng tròn cho các trình duyệt chưa bật View Transition
    executeFallbackRipple(x, y, endRadius, next);
  }
}

function executeFallbackRipple(x, y, endRadius, nextTheme) {
  const html = document.documentElement;
  const ripple = document.createElement('div');
  ripple.className = 'theme-radial-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.style.width = `${endRadius * 2}px`;
  ripple.style.height = `${endRadius * 2}px`;
  ripple.style.backgroundColor = nextTheme === 'dark' ? '#090c15' : '#f4f5f9';
  document.body.appendChild(ripple);

  requestAnimationFrame(() => {
    ripple.classList.add('animate');
    setTimeout(() => {
      html.setAttribute('data-theme', nextTheme);
      if (AppState.charts.financeChart) AppState.charts.financeChart.update();
      setTimeout(() => ripple.remove(), 400);
    }, 600);
  });
}

// Hàm hiệu ứng nhảy số mềm mại (Number Counter Easing)
function animateCounterNumber(el, target, prefix = '', suffix = '', decimals = 0, duration = 1000) {
  if (!el) return;
  const generation=fileReadGeneration,run={};counterRuns.set(el,run);
  const start = performance.now();
  const numTarget = typeof target === 'number' ? target : parseFloat(target) || 0;

  function step(now) {
    if(generation!==fileReadGeneration || counterRuns.get(el)!==run)return;
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Easing Out Cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = numTarget * ease;

    const formatted = decimals > 0 
      ? current.toFixed(decimals) 
      : Math.floor(current).toLocaleString();

    el.textContent = `${prefix}${formatted}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = `${prefix}${decimals > 0 ? numTarget.toFixed(decimals) : numTarget.toLocaleString()}${suffix}`;
    }
  }
  requestAnimationFrame(step);
}

function triggerQuickUpload() {
  document.getElementById('fileInput').click();
}

function resetAll() {
  if (confirm('Làm mới toàn bộ quy trình AI Agent?')) {
    clearImportedData();
    AppState.rawRows = [];
    AppState.cleanRows = [];
    AppState.step2BackupCleanRows = [];
    AppState.step3 = { statusFilters: [], searchQuery: '', categoryFilters: [], page: 1, pageSize: 20, feedbackHistory: [], selectedRows: new Set() };
    AppState.analytics = { period: 'day', dateRange: { from: '', to: '' }, crossFilters:{}, profitMargin: 0.32, excludeCanceled: false, focusStrategy: 'balanced', lastMetrics: null };

    if (AppState.charts.financeChart) {
      AppState.charts.financeChart.destroy();
      AppState.charts.financeChart = null;
    }
    if (AppState.charts.donutChart) {
      AppState.charts.donutChart.destroy();
      AppState.charts.donutChart = null;
    }

    const filterInput = document.getElementById('tableFilterInput');
    if (filterInput) filterInput.value = '';

    const marginSlider = document.getElementById('paramProfitMargin');
    const marginVal = document.getElementById('paramProfitMarginVal');
    const stratSel = document.getElementById('paramFocusStrategy');
    const exclChk = document.getElementById('paramExcludeCanceled');
    const fb6 = document.getElementById('feedbackInputStep6');
    const t3 = document.getElementById('step3FeedbackToast');
    const t6 = document.getElementById('step6FeedbackToast');

    if (marginSlider) marginSlider.value = 32;
    if (marginVal) marginVal.textContent = '32%';
    if (stratSel) stratSel.value = 'balanced';
    if (exclChk) exclChk.checked = false;
    if (fb6) fb6.value = '';
    if (t3) { t3.className = 'inline-feedback-banner'; t3.style.display = 'none'; t3.textContent = ''; }
    if (t6) { t6.className = 'inline-feedback-banner'; t6.style.display = 'none'; t6.textContent = ''; }

    document.querySelectorAll('#analyticsPeriodTabs .pill-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-period') === 'day');
    });

    document.getElementById('celebrationBanner')?.classList.remove('active');
    document.getElementById('errorGiantModal')?.classList.remove('active');
    setStep(1);
  }
}

function renderRequiredKeysPills() {
  const container = document.getElementById('requiredKeysPills');
  if (!container) return;

  container.innerHTML = AppState.requiredSchema.map(item => `
    <div class="key-pill-row">
      <span>${item.label}</span>
      <span class="badge-tag">Bắt buộc</span>
    </div>
  `).join('');
}

function setupSchemaModal() {
  const btn = document.getElementById('btnOpenSchemaConfig');
  const modal = document.getElementById('schemaModal');
  const closeBtn = document.getElementById('btnCloseSchema');
  const wrapper = document.getElementById('schemaTagsWrapper');
  const addBtn = document.getElementById('btnAddNewSchema');
  const input = document.getElementById('newSchemaInput');
  const saveBtn = document.getElementById('btnSaveSchemaSettings');
  const restoreBtn = document.getElementById('btnRestoreDefaultSchema');

  let draft = AppState.requiredSchema.map(field => ({ ...field, aliases: [...field.aliases] }));

  function renderTags() {
    wrapper.innerHTML = draft.map((s, idx) => `
      <span class="tag-item">
        ${escapeHtml(s.label)}
        <button type="button" aria-label="Xóa cột ${escapeHtml(s.label)}" onclick="removeSchemaTag(${idx})">&times;</button>
      </span>
    `).join('');
  }

  window.removeSchemaTag = (i) => {
    if (getDefaultRequiredSchema().some(field => field.key === draft[i]?.key)) { alert('Cần giữ các cột cốt lõi để phân tích. Bạn có thể thêm cột bắt buộc.'); return; }
    draft.splice(i, 1);
    renderTags();
  };

  btn?.addEventListener('click', (e) => {
    e.preventDefault();
    draft = AppState.requiredSchema.map(field => ({ ...field, aliases: [...field.aliases] }));
    renderTags();
    modal.classList.add('active');
  });

  closeBtn?.addEventListener('click', () => modal.classList.remove('active'));

  addBtn?.addEventListener('click', () => {
    const val = input.value.trim();
    if (val && !draft.some(field => normalizeHeaderKey(field.label) === normalizeHeaderKey(val))) {
      draft.push({
        key: val.toLowerCase().replace(/\s+/g, '_'),
        label: val,
        aliases: [val.toLowerCase()]
      });
      input.value = '';
      renderTags();
    }
  });

  saveBtn?.addEventListener('click', () => {
    if (JSON.stringify(draft) !== JSON.stringify(AppState.requiredSchema)) {
      AppState.requiredSchema = draft.map(field => ({ ...field, aliases: [...field.aliases] }));
      if (AppState.rawRows.length) validateFileSchema(AppState.rawRows, AppState.fileName);
      else clearImportedData();
    }
    renderRequiredKeysPills();
    modal.classList.remove('active');
    alert('Đã lưu cấu hình khóa chính thành công!');
  });

  restoreBtn?.addEventListener('click', () => {
    draft = getDefaultRequiredSchema();
    renderTags();
  });
}

function setupMobileDrawer() {
  const openBtn = document.getElementById('mobileMenuBtn');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  function open() {
    sidebar.classList.add('active');
    backdrop.classList.add('active');
  }
  function close() {
    sidebar.classList.remove('active');
    backdrop.classList.remove('active');
  }

  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
}


function dateToISO(value) {
  const parts = parseDateParts(normalizeDateCell(value).value);
  return parts ? `${parts.y}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')}` : '';
}
function rowInDateRange(value, range) {
  if (!range?.from && !range?.to) return true;
  const date = dateToISO(value);
  return Boolean(date) && (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
function getAnalysisRows(options={}) {
  return AppState.cleanRows.filter(row => rowInDateRange(row[AppState.fieldMap.date], AppState.analytics.dateRange) && (options.ignoreCross || !window.Workbench || window.Workbench.linkedMatch(row)));
}
function resetTimeSlicerInputs(scope) {
  ['DateFrom','DateTo'].forEach(key => { const el = document.getElementById(scope + key); if (el) el.value = ''; });
  const preset = document.getElementById(scope + 'TimePreset'); if (preset) preset.value = 'all';
  const summary = document.getElementById(scope + 'TimeSummary'); if (summary) summary.textContent = 'Đang hiển thị toàn bộ dữ liệu';
}
function initTimeSlicer(scope, getDates, onApply) {
  const el = suffix => document.getElementById(scope + suffix);
  const apply = () => {
    const range = { from: el('DateFrom').value, to: el('DateTo').value };
    if (range.from && range.to && range.from > range.to) { el('TimeSummary').textContent = 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc. Bộ lọc chưa được áp dụng.'; return; }
    el('TimeSummary').textContent = 'Đang cập nhật dữ liệu trong kỳ…';
    onApply(range);
  };
  el('TimePreset').addEventListener('change', () => {
    const preset = el('TimePreset').value;
    if (preset === 'custom') return;
    if (preset === 'all') { el('DateFrom').value = ''; el('DateTo').value = ''; apply(); return; }
    const dates = getDates().map(dateToISO).filter(Boolean).sort();
    if (!dates.length) { el('TimeSummary').textContent = 'Chưa có ngày hợp lệ để chọn khoảng thời gian.'; return; }
    const latest = dates.at(-1);
    const start = new Date(latest + 'T00:00:00Z');
    if (preset === 'lastmonth') start.setUTCDate(1);
    else start.setUTCDate(start.getUTCDate() - (preset === 'last7' ? 6 : 29));
    el('DateFrom').value = start.toISOString().slice(0,10); el('DateTo').value = latest;
    apply();
  });
  ['DateFrom','DateTo'].forEach(key => el(key).addEventListener('input', () => { el('TimePreset').value = 'custom'; el('TimeSummary').textContent = 'Nhấn Áp dụng để cập nhật khoảng ngày.'; }));
  el('ApplyTime').addEventListener('click',apply);
  el('ResetTime').addEventListener('click', () => { resetTimeSlicerInputs(scope); onApply({from:'',to:''}); });
}
