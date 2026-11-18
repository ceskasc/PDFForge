import { tools, translations, iconMarkup } from './i18n.js';
import { formatSize, safeBaseName } from './ranges.js';
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, importPdf, importImage, releaseDocuments, previewPage, previewImage, combinePages, splitPdf, imagesToPdf, watermarkPdf, compressPdf } from './engine.js';
import './styles.css';

const $ = id => document.getElementById(id);
const get = key => translations[language][key];
let language = 'tr';
try { if (localStorage.getItem('pdfforge-language') === 'en') language = 'en'; } catch {}
const state = {
  tool: 'merge', docs: [], pages: [], busy: false, importing: false, gridPage: 0, previewSeq: 0,
  outputUrl: null, output: null,
  options: { range: '1', quality: 62, paper: 'a4', margin: 18, watermark: 'TASLAK', opacity: 22 }
};
const PAGE_GRID_SIZE = 24;
const MAX_TOTAL_PAGES = 220;
const thumbnails = new Map();
const thumbnailTasks = [];
let thumbnailsInFlight = 0;
const MAX_CONCURRENT_PREVIEWS = 2;
function pumpThumbnails() {
  while (thumbnailsInFlight < MAX_CONCURRENT_PREVIEWS && thumbnailTasks.length) {
    const task = thumbnailTasks.shift();
    if (task.serial !== state.previewSeq) continue;
    thumbnailsInFlight++;
    void task.run().finally(() => { thumbnailsInFlight--; pumpThumbnails(); });
  }
}
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const svg = (name, contents = '') => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (contents || '<path d="M12 4v16M4 12h16"/>') + '</svg>';
const actionIcons = {
  prev: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
  rotate: '<path d="M20 11a8 8 0 1 1-2.4-6M20 3v6h-6"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/>'
};

function setMessage(message = '', error = false) {
  $('feedback').hidden = !message;
  $('feedback').textContent = message;
  $('feedback').classList.toggle('danger', error);
}
let toastTimer;
function toast(text) {
  const node = $('toast'); node.textContent = text; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 3400);
}
function friendlyError(error) {
  const code = error?.message;
  return get('errors')[code] || get('genericError');
}
function resetOutput() {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null; state.output = null; $('resultPanel').hidden = true;
}
function applyTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#10141e' : '#f7f6f2';
  try { localStorage.setItem('pdfforge-theme', theme); } catch {}
}
try { applyTheme(localStorage.getItem('pdfforge-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); }
catch { applyTheme('light'); }

function translatePage() {
  document.documentElement.lang = language;
  document.title = language === 'tr' ? 'PDFForge — Belgelerin. Kontrol sende.' : 'PDFForge — Your documents. Your rules.';
  for (const el of document.querySelectorAll('[data-t]')) {
    const value = get(el.dataset.t); if (typeof value === 'string') el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', get(el.dataset.tAria));
  $('langButton').textContent = language === 'tr' ? 'EN' : 'TR';
  $('langButton').setAttribute('aria-label', language === 'tr' ? 'Switch to English' : 'Türkçeye geç');
  $('dropZone').setAttribute('aria-label', language === 'tr' ? 'Dosya seçmek için tıkla veya dosyaları sürükle' : 'Click to select files or drop files');
  $('toolNav').setAttribute('aria-label', language === 'tr' ? 'PDF araçları' : 'PDF tools');
  $('pageGrid').setAttribute('aria-label', language === 'tr' ? 'Belge sayfaları' : 'Document pages');
  renderTools(); renderHeading(); renderOptions(); renderFiles(); renderPages();
  if (state.output) renderResult();
}
function renderTools() {
  const list = $('toolButtons'); list.replaceChildren();
  tools.forEach((tool, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tool-button' + (state.tool === tool.id ? ' active' : '');
    button.dataset.tool = tool.id; button.disabled = state.busy || state.importing;
    if (state.tool === tool.id) button.setAttribute('aria-current', 'true');
    button.innerHTML = '<span class="tool-button-icon">' + iconMarkup(tool.icon) + '</span><span><span class="tool-button-title"></span><span class="tool-button-sub"></span></span>';
    button.querySelector('.tool-button-title').textContent = tool.title[language];
    button.querySelector('.tool-button-sub').textContent = tool.sub[language];
    button.addEventListener('click', () => switchTool(tool.id));
    list.append(button);
  });
}
function renderHeading() {
  const index = tools.findIndex(item => item.id === state.tool);
  const tool = tools[index];
  $('toolNumber').textContent = String(index + 1).padStart(2,'0') + ' / ' + String(tools.length).padStart(2,'0');
  $('toolHeading').textContent = tool.title[language];
  $('toolDescription').textContent = tool.desc[language];
  $('toolIcon').innerHTML = iconMarkup(tool.icon);
  const images = state.tool === 'images';
  $('fileInput').accept = images ? 'image/jpeg,image/png,image/webp,.jpeg,.jpg,.png,.webp' : '.pdf,application/pdf';
  $('fileInput').multiple = ['merge','images'].includes(state.tool);
  $('dropFootnote').textContent = get(images ? 'imageLimits' : 'limits');
  $('runLabel').textContent = get('process');
}
async function clearAll(silent = false) {
  state.previewSeq++;
  const docs = state.docs;
  state.docs = []; state.pages = []; state.gridPage = 0; thumbnails.clear();
  resetOutput(); setMessage();
  renderFiles(); renderPages();
  await releaseDocuments(docs);
  if (!silent && docs.length) toast(get('allRemoved'));
}
async function switchTool(id) {
  if (state.busy || state.importing || id === state.tool) return;
  if (state.docs.length && !window.confirm(get('confirmSwitch'))) return;
  await clearAll(true);
  state.tool = id;
  state.options.range = '1'; state.options.quality = 62;
  renderTools(); renderHeading(); renderOptions(); renderFiles(); renderPages();
}
function createButton(label, action, icon, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'page-control'; button.title = label;
  button.setAttribute('aria-label', label); button.innerHTML = svg(icon, actionIcons[icon]);
  button.disabled = disabled; button.addEventListener('click', action);
  return button;
}
function updateBusy() {
  const locked = state.busy || state.importing;
  $('runButton').disabled = locked || !state.docs.length || !state.pages.length;
  $('fileInput').disabled = locked;
  $('chooseFiles').disabled = locked;
  $('addMore').disabled = locked;
  $('clearAll').disabled = locked;
  $('dropZone').setAttribute('aria-disabled', String(locked));
  renderTools();
}
function renderFiles() {
  const files = $('fileItems'); files.replaceChildren();
  const filled = state.docs.length > 0;
  $('dropZone').hidden = filled;
  $('uploadTopline').hidden = !filled;
  $('addMore').hidden = filled && !['merge','images'].includes(state.tool);
  $('actionForm').hidden = !filled;
  $('fileSummary').textContent = get('fileCount')(state.docs.length);
  for (const doc of state.docs) {
    const row = document.createElement('div'); row.className = 'file-row';
    const fileIcon = document.createElement('span'); fileIcon.className = 'file-row-icon'; fileIcon.innerHTML = iconMarkup(state.tool === 'images' ? 'images' : 'merge');
    const info = document.createElement('div'); info.className = 'file-row-main';
    const title = document.createElement('strong'); title.className = 'file-row-name'; title.textContent = doc.file.name; title.title = doc.file.name;
    const details = document.createElement('span'); details.className = 'file-row-meta';
    details.textContent = formatSize(doc.file.size) + ' · ' + (doc.type === 'pdf' ? get('pageCount')(doc.pageCount) : String(doc.width) + ' × ' + String(doc.height));
    info.append(title, details);
    const remove = document.createElement('button'); remove.type='button'; remove.className='file-remove';
    remove.setAttribute('aria-label', get('removePage') + ': ' + doc.file.name);
    remove.title = get('clear'); remove.innerHTML = svg('delete', actionIcons.delete);
    remove.disabled = state.busy;
    remove.addEventListener('click', async () => {
      if (state.busy) return;
      state.previewSeq++; state.docs = state.docs.filter(item => item.id !== doc.id);
      state.pages = state.pages.filter(page => page.docId !== doc.id);
      for (const key of thumbnails.keys()) if (key.startsWith(doc.id + ':')) thumbnails.delete(key);
      state.gridPage = Math.min(state.gridPage, Math.max(0,Math.ceil(state.pages.length/PAGE_GRID_SIZE)-1));
      resetOutput(); renderFiles(); renderPages(); updateBusy();
      await releaseDocuments([doc]); toast(get('fileRemoved'));
    });
    row.append(fileIcon, info, remove); files.append(row);
  }
  $('resultInfo').textContent = filled ? get(state.tool === 'images' ? 'imagesSelected' : 'docSelected')(state.docs.length) : get('ready');
  updateBusy();
}
function renderOptions() {
  const options = $('options'); options.replaceChildren();
  const field = (id, label, control, help = '', wide = false) => {
    const wrapper = document.createElement('div'); wrapper.className = 'option-field' + (wide?' wide':'');
    const caption = document.createElement('label'); caption.textContent = label; caption.htmlFor = id;
    control.id = id; control.className = 'field-input';
    wrapper.append(caption, control);
    if (help) { const p = document.createElement('p'); p.className='field-help'; p.textContent=help; wrapper.append(p); }
    options.append(wrapper); return control;
  };
  const input = (key, def, placeholder) => {
    const el = document.createElement('input'); el.type='text'; el.value=state.options[key] ?? def; el.placeholder=placeholder;
    el.addEventListener('input',()=>{state.options[key]=el.value;resetOutput();});
    return el;
  };
  const select = (key, items) => {
    const el=document.createElement('select');
    for(const [value,label] of items){const opt=document.createElement('option');opt.value=value;opt.textContent=label;el.append(opt);}
    el.value=String(state.options[key]);el.addEventListener('change',()=>{state.options[key]=el.value;resetOutput();});return el;
  };
  const range = (key, min, max, output) => {
    const el=document.createElement('input');el.type='range';el.min=min;el.max=max;el.value=state.options[key];
    el.addEventListener('input',()=>{state.options[key]=Number(el.value);output.textContent=el.value+'%';resetOutput();});return el;
  };
  if (state.tool === 'split') field('pageRange',get('rangeLabel'),input('range','1',get('rangePlaceholder')),get('rangeHelp'),true);
  if (state.tool === 'compress') {
    field('imageQuality',get('qualityLabel'),select('quality',[[45,'45%'],[55,'55%'],[62,'62%'],[72,'72%'],[82,'82%']]),get('qualityHelp'));
    const warning=document.createElement('p');warning.className='field-warning';warning.textContent=get('compressWarning');options.append(warning);
  }
  if (state.tool === 'images') {
    field('paperSize',get('paperLabel'),select('paper',[['a4',get('paperA4')],['letter',get('paperLetter')],['original',get('paperOriginal')]]));
    field('paperMargin',get('marginLabel'),select('margin',[[0,get('marginNone')],[18,get('marginSmall')],[36,get('marginLarge')]]));
  }
  if (state.tool === 'watermark') {
    field('watermarkText',get('watermarkLabel'),input('watermark','TASLAK',get('watermarkPlaceholder')), '', true);
    const out=document.createElement('output');out.textContent=String(state.options.opacity)+'%';
    const control=range('opacity',10,65,out);const wrapper=field('watermarkOpacity',get('opacityLabel'),control);
    wrapper.parentElement.querySelector('label').append(' ',out);
  }
}
function movePage(from,to) {
  if (state.busy || from===to || to<0 || to>=state.pages.length) return;
  const [item]=state.pages.splice(from,1);state.pages.splice(to,0,item);
  state.gridPage=Math.floor(to/PAGE_GRID_SIZE);resetOutput();renderPages();
}
function rotatePage(index) {
  if(state.busy)return;
  state.pages[index].rotation=(state.pages[index].rotation+90)%360;
  const item=state.pages[index];thumbnails.delete(item.docId+':'+item.pageIndex+':'+((item.rotation+270)%360));
  resetOutput();renderPages();
}
function deletePage(index) {
  if(state.busy)return;
  if(state.pages.length===1){toast(get('noPages'));return;}
  state.pages.splice(index,1);state.gridPage=Math.min(state.gridPage,Math.max(0,Math.ceil(state.pages.length/PAGE_GRID_SIZE)-1));
  resetOutput();renderPages();updateBusy();
}
async function setPreviewImage(element, doc, page, key, serial) {
  try {
    let src=thumbnails.get(key);
    if(!src){src=doc.type==='image'?await previewImage(doc,174):await previewPage(doc,page.pageIndex,174,page.rotation);thumbnails.set(key,src);}
    if(serial!==state.previewSeq || !element.isConnected)return;
    const image=document.createElement('img');image.src=src;image.alt='';image.decoding='async';element.replaceChildren(image);
  }catch{
    if(serial===state.previewSeq && element.isConnected)element.textContent='PDF';
  }
}
function renderPages(){
  const grid=$('pageGrid');grid.replaceChildren();
  thumbnailTasks.length = 0;
  const total=state.pages.length;
  $('pagesTopline').hidden=!total;
  if(!total)return;
  const editing=['merge','organize','images'].includes(state.tool);
  $('pageHint').textContent=get(editing?'pageHint':'pageHintRead');
  $('pageSummary').textContent=get('pageCount')(total);
  const pageCount=Math.ceil(total/PAGE_GRID_SIZE);state.gridPage=Math.max(0,Math.min(state.gridPage,pageCount-1));
  const start=state.gridPage*PAGE_GRID_SIZE,end=Math.min(total,start+PAGE_GRID_SIZE);
  const serial=++state.previewSeq;
  for(let index=start;index<end;index++){
    const item=state.pages[index],doc=state.docs.find(d=>d.id===item.docId);
    if(!doc)continue;
    const card=document.createElement('article');card.className='page-card';card.dataset.uid=item.uid;
    card.draggable=editing&&!state.busy;
    const preview=document.createElement('div');preview.className='page-preview';
    const loading=document.createElement('span');loading.className='thumb-loading';loading.textContent=String(index+1).padStart(2,'0');preview.append(loading);
    const footer=document.createElement('div');footer.className='page-card-footer';
    const label=document.createElement('span');label.className='page-card-label';label.textContent=String(index+1).padStart(2,'0');
    footer.append(label);
    if(editing){
      const controls=document.createElement('div');controls.className='page-card-controls';
      controls.append(createButton(get('moveLeft'),()=>movePage(index,index-1),'prev',index===0||state.busy));
      if(doc.type==='pdf')controls.append(createButton(get('rotate'),()=>rotatePage(index),'rotate',state.busy));
      if(doc.type==='pdf')controls.append(createButton(get('removePage'),()=>deletePage(index),'delete',state.pages.length===1||state.busy));
      controls.append(createButton(get('moveRight'),()=>movePage(index,index+1),'next',index===state.pages.length-1||state.busy));
      footer.append(controls);
      card.addEventListener('dragstart',e=>{if(state.busy)return;e.dataTransfer.setData('text/plain',item.uid);e.dataTransfer.effectAllowed='move';card.classList.add('is-dragging');});
      card.addEventListener('dragend',()=>card.classList.remove('is-dragging'));
      card.addEventListener('dragover',e=>{if(state.busy)return;e.preventDefault();card.classList.add('drag-target');});
      card.addEventListener('dragleave',()=>card.classList.remove('drag-target'));
      card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-target');const uid=e.dataTransfer.getData('text/plain');const from=state.pages.findIndex(p=>p.uid===uid);if(from>=0)movePage(from,index);});
    }
    card.append(preview,footer);grid.append(card);
    const key=item.docId+':'+item.pageIndex+':'+item.rotation;
    thumbnailTasks.push({serial,run:()=>setPreviewImage(preview,doc,item,key,serial)});
    pumpThumbnails();
  }
  if(pageCount>1){
    const nav=document.createElement('div');nav.className='page-grid-nav';
    const prev=createButton(get('moveLeft'),()=>{state.gridPage--;renderPages();},'prev',state.gridPage===0);
    const count=document.createElement('span');count.textContent=String(start+1)+'–'+String(end)+' / '+String(total);
    const next=createButton(get('moveRight'),()=>{state.gridPage++;renderPages();},'next',state.gridPage===pageCount-1);
    nav.append(prev,count,next);grid.append(nav);
  }
}
async function addFiles(newFiles){
  if(state.busy||state.importing||!newFiles.length)return;
  if(state.docs.length && !['merge','images'].includes(state.tool)) {
    setMessage(get('singleFileOnly'),true);return;
  }
  state.importing=true;updateBusy();
  try {
  resetOutput();setMessage();
  const images=state.tool==='images';
  const allowed=file=>images?(/\.(png|jpg|jpeg|webp)$/i.test(file.name)||['image/png','image/jpeg','image/webp'].includes(file.type)):(/\.pdf$/i.test(file.name)||file.type==='application/pdf');
  let rejected=0,added=0;
  let bytes=state.docs.reduce((n,doc)=>n+doc.file.size,0);
  for(const file of newFiles){
    if(state.docs.length>=MAX_FILES||file.size===0||file.size>MAX_FILE_BYTES||bytes+file.size>MAX_TOTAL_BYTES||!allowed(file)){rejected++;continue;}
    let doc;
    try{
      doc=images?await importImage(file):await importPdf(file);
      if(state.pages.length+(images?1:doc.pageCount)>MAX_TOTAL_PAGES){await releaseDocuments([doc]);throw new Error('too-many-pages');}
    }catch(error){rejected++;setMessage(friendlyError(error),true);continue;}
    state.docs.push(doc);bytes+=file.size;added++;
    const count=doc.type==='image'?1:doc.pageCount;
    for(let index=0;index<count;index++)state.pages.push({uid:crypto.randomUUID(),docId:doc.id,pageIndex:index,rotation:0});
    if(!['merge','images'].includes(state.tool))break;
  }
  if (added && state.tool === 'split' && state.docs[0]) {
    state.options.range = '1-' + state.docs[0].pageCount;
    renderOptions();
  }
  $('fileInput').value='';
  renderFiles();renderPages();
  if(added)toast(get('toastAdd')(added));
  if(rejected&&!$('feedback').textContent)setMessage(get('toastSkip')(rejected),true);
  } finally {
    state.importing=false;
    updateBusy();
  }
}
async function process(){
  if(state.busy||state.importing||!state.docs.length)return;
  if(!state.pages.length){setMessage(get('noPages'),true);return;}
  state.busy=true;setMessage();resetOutput();updateBusy();
  $('progressArea').hidden=false;$('runLabel').textContent=get('processing');
  const onProgress=value=>{const pct=Math.min(100,Math.max(0,Math.round(value*100)));$('progressBar').style.width=pct+'%';$('progressPct').textContent=pct+'%';};
  onProgress(0);
  try{
    let result;
    switch(state.tool){
      case 'merge':case 'organize':result=await combinePages(state.docs,state.pages,onProgress);break;
      case 'split':result=await splitPdf(state.docs[0],state.options.range,onProgress);break;
      case 'compress':result=await compressPdf(state.docs[0],state.options.quality,onProgress);break;
      case 'images':result=await imagesToPdf(state.docs, state.options.paper, state.options.margin,onProgress);break;
      case 'watermark':result=await watermarkPdf(state.docs[0],state.options.watermark,state.options.opacity,onProgress);break;
      default:throw new Error('no-files');
    }
    state.output=result;state.outputUrl=URL.createObjectURL(result.blob);
    renderResult();$('resultPanel').hidden=false;
    toast(get('outputReady'));
    if(state.tool==='compress'&&result.blob.size>=state.docs[0].file.size){
      setMessage(language==='tr'?'Bu belgede küçültme dosya boyutunu azaltmadı. Sonuç orijinalden büyük olabilir.':'This document did not become smaller. The output may be larger than the original.',true);
    }
  }catch(error){setMessage(friendlyError(error),true);}
  finally{state.busy=false;$('progressArea').hidden=true;$('runLabel').textContent=get('process');updateBusy();}
}
function renderResult(){
  if(!state.output)return;
  $('resultTitle').textContent=get('resultTitle');
  $('resultDetail').textContent=get('resultDetail')(formatSize(state.output.blob.size),state.output.detail);
}
function downloadOutput(){
  if(!state.output||!state.outputUrl)return;
  const link=document.createElement('a');link.href=state.outputUrl;link.download=state.output.filename||safeBaseName(state.docs[0]?.file.name)+'.pdf';
  document.body.append(link);link.click();link.remove();
}

$('themeButton').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('langButton').addEventListener('click',()=>{language=language==='tr'?'en':'tr';try{localStorage.setItem('pdfforge-language',language);}catch{}translatePage();});
$('chooseFiles').addEventListener('click',e=>{e.stopPropagation();$('fileInput').click();});
$('addMore').addEventListener('click',()=>$('fileInput').click());
$('clearAll').addEventListener('click',()=>{if(!state.busy&&!state.importing)void clearAll();});
$('fileInput').addEventListener('change',event=>{void addFiles([...event.target.files]);});
$('dropZone').addEventListener('click',event=>{if(event.target.closest('button'))return;if(!state.busy&&!state.importing)$('fileInput').click();});
$('dropZone').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target===$('dropZone')){event.preventDefault();$('fileInput').click();}});
$('dropZone').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();$('dropZone').classList.add('is-dragover');}});
$('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('is-dragover'));
$('dropZone').addEventListener('drop',event=>{event.preventDefault();$('dropZone').classList.remove('is-dragover');void addFiles([...event.dataTransfer.files]);});
document.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
document.addEventListener('drop',event=>{if([...event.dataTransfer.types].includes('Files')&&!event.target.closest('#dropZone,#pageGrid'))event.preventDefault();});
$('actionForm').addEventListener('submit',event=>{event.preventDefault();void process();});
$('downloadAgain').addEventListener('click',downloadOutput);
$('privacyButton').addEventListener('click',()=>$('privacyDialog').showModal());
$('closeDialog').addEventListener('click',()=>$('privacyDialog').close());
$('privacyDialog').addEventListener('click',event=>{if(event.target===$('privacyDialog'))event.target.close();});
$('year').textContent=String(new Date().getFullYear());
window.addEventListener('pagehide',()=>{resetOutput();void releaseDocuments(state.docs);});
translatePage();renderFiles();
