import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { combinePages, splitPdf } from '../src/pdf-core.js';

async function fixture(count, tag) {
  const pdf = await PDFDocument.create();
  for (let i=0;i<count;i++) {
    const page=pdf.addPage([300+i*20, 440+i*20]);
    page.drawText(tag+' '+i, {x:22,y:100});
  }
  const bytes=await pdf.save();
  return {id:tag,bytes,file:{name:tag+'.pdf'},pageCount:count};
}
test('merge preserves order, page counts and rotation',async()=>{
  const a=await fixture(2,'alpha'),b=await fixture(1,'beta');
  const result=await combinePages([a,b],[
    {docId:b.id,pageIndex:0,rotation:90},
    {docId:a.id,pageIndex:1,rotation:0},
    {docId:a.id,pageIndex:0,rotation:270}
  ]);
  assert.equal(result.blob.type,'application/pdf');
  assert.equal(result.filename,'pdfforge-merged.pdf');
  const pdf=await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(pdf.getPageCount(),3);
  assert.deepEqual(pdf.getPages().map(p=>p.getWidth()),[300,320,300]);
  assert.deepEqual(pdf.getPages().map(p=>p.getRotation().angle),[90,0,270]);
});
test('split creates a readable PDF and separate ZIP entries for semicolon groups',async()=>{
  const doc=await fixture(5,'demo');
  const one=await splitPdf(doc,'2-4');
  assert.equal(one.filename,'demo-part-01.pdf');
  const single=await PDFDocument.load(await one.blob.arrayBuffer());
  assert.equal(single.getPageCount(),3);
  const zipped=await splitPdf(doc,'1-2;4-5');
  assert.equal(zipped.blob.type,'application/zip');
  const entries=await JSZip.loadAsync(await zipped.blob.arrayBuffer());
  const names=Object.keys(entries.files).sort();
  assert.deepEqual(names,['demo-part-01.pdf','demo-part-02.pdf']);
  for(const name of names){
    const bytes=await entries.file(name).async('uint8array');
    const read=await PDFDocument.load(bytes);
    assert.equal(read.getPageCount(),2);
  }
});
test('invalid or missing pages fail instead of producing a misleading file',async()=>{
  const doc=await fixture(2,'source');
  await assert.rejects(combinePages([doc],[]),{message:'no-pages'});
  await assert.rejects(combinePages([doc],[{docId:'missing',pageIndex:0}]),{message:'missing-document'});
  await assert.rejects(splitPdf(doc,'1-99'),{message:'out-of-range'});
});
