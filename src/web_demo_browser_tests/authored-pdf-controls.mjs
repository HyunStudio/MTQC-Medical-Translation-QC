// Authored in-memory controls, never natural corpus or human truth.
export function imageMaskControlPdf() {
  const content = 'q 100 0 0 100 50 50 cm /Im Do Q BT /F1 12 Tf 20 200 Td (Caption) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1 /Length 1 >>\nstream\n\u0000\nendstream',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let text = '%PDF-1.4\n'; const offsets = [];
  for (let n = 0; n < objects.length; n++) { offsets.push(Buffer.byteLength(text)); text += `${n+1} 0 obj\n${objects[n]}\nendobj\n`; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  text += offsets.map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}

// Separate vector-and-blue-caption control for private editor mechanics.
// The original image mask above remains byte-identical and is now held by intake.
export function vectorCaptionControlPdf() {
  const content = 'q 0 g 50 50 100 100 re f Q BT /F1 12 Tf 0 0 1 rg 20 200 Td (Caption) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let text='%PDF-1.4\n';const offsets=[];
  for(let n=0;n<objects.length;n++){offsets.push(Buffer.byteLength(text));text+=`${n+1} 0 obj\n${objects[n]}\nendobj\n`;}
  const start=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
