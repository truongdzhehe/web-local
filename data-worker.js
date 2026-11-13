/* File parsing and cleaning run away from the UI thread for large inputs. */
importScripts('data-core.js');
let workbook=null;
function sheetResult(name) {
  const sheet=workbook?.Sheets[name];
  if(!sheet)throw new Error('Sheet không tồn tại.');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  const names=(matrix[0]||[]).map(normalizeHeaderKey);
  const errors=names.some((name,index)=>name && names.indexOf(name)!==index)?['Sheet có tiêu đề cột trùng nhau.']:[];
  return {rows:XLSX.utils.sheet_to_json(sheet,{defval:''}),sheetNames:workbook.SheetNames,sheetName:name,errors};
}
self.onmessage=event=>{
  const {id,type,payload}=event.data;
  try {
    self.postMessage({id,progress:20});
    let result;
    if(type==='clean')result=cleanDataset(payload.rows,payload.fieldMap);
    else if(type==='sheet')result=sheetResult(payload.name);
    else if(type==='parse') {
      const ext=payload.name.split('.').pop().toLowerCase();
      if(ext==='csv') {
        if(typeof Papa==='undefined')importScripts('assets/papaparse.min.js');
        const parsed=Papa.parse(new TextDecoder('utf-8').decode(payload.buffer),{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.replace(/^\uFEFF/,'').trim()});
        const errors=parsed.errors.map(err=>`CSV dòng ${Number.isInteger(err.row)?err.row+2:'?'}: ${err.message}`);
        if(Object.keys(parsed.meta?.renamedHeaders||{}).length)errors.push('CSV có tiêu đề trùng nhau.');
        result={rows:parsed.data,sheetNames:[],sheetName:'',errors};
      } else {
        if(typeof XLSX==='undefined')importScripts('assets/xlsx.full.min.js');
        workbook=XLSX.read(payload.buffer,{type:'array'});
        if(!workbook.SheetNames.length)throw new Error('Excel không có sheet dữ liệu.');
        result=sheetResult(workbook.SheetNames[0]);
      }
    } else throw new Error('Tác vụ chưa được hỗ trợ.');
    self.postMessage({id,progress:95});self.postMessage({id,result});
  } catch(error) {self.postMessage({id,error:error.message});}
};
