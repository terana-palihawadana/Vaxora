function escapeCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Saves rows (an array of arrays, header row first) as a .csv file. */
export function downloadCsv(fileName, rows) {
  const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  // The BOM keeps Excel from garbling non-ASCII text such as "°C".
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default downloadCsv;
