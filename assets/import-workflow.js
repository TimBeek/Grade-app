// =============================================================================
// IMPORT WORKFLOW
// Excel/CSV parsing, normalisatie, batchopbouw en importvoortgang.
// =============================================================================
const XLSX_SCRIPT_SRC = 'assets/xlsx.full.min.js';
let xlsxLoadPromise = null;

function formatMemory(value) {
  const text = normalizeText(value);
  const num = Number(String(text).replace(',', '.'));
  if (!text) return '';
  if (Number.isFinite(num) && num >= 1024) return `${Math.round(num / 1024)}GB`;
  if (Number.isFinite(num) && num > 0) return `${num}GB`;
  return text;
}

function formatStorage(sizeValue, driveValue) {
  const drive = normalizeText(driveValue);
  const size = normalizeText(sizeValue);
  const driveMatch = drive.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB)/i);
  if (driveMatch) return `${Math.round(Number(driveMatch[1].replace(',', '.')))}${driveMatch[2].toUpperCase()}`;
  const num = Number(String(size).replace(',', '.'));
  if (Number.isFinite(num) && num > 0) {
    if (num > 900 && num < 1100) return '1TB';
    return `${Math.round(num / 10) * 10}GB`;
  }
  return drive || size;
}

function formatDisplay(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:W|touch\s*)?(\d+(?:[.,]\d+)?)\s*"?/i);
  if (!match) return text;
  const size = match[1].replace(',', '.');
  return `${text.toLowerCase().includes('touch') ? 'touch ' : ''}${size}"`;
}

function cleanGpu(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text
    .replace(/^Intel Corporation\s+/i, 'Intel ')
    .replace(/^NVIDIA Corporation\s+/i, 'NVIDIA ')
    .replace(/^Advanced Micro Devices, Inc\.\s*/i, 'AMD ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isImportYes(value) {
  return /^(ja|yes|true|1|y)$/i.test(normalizeText(value));
}

function getNoteworthyGpu(value) {
  const gpu = cleanGpu(value);
  if (!gpu) return '';
  if (/nvidia|rtx|gtx|quadro|radeon pro|rx\s?\d/i.test(gpu)) return gpu;
  return '';
}

function getXmlLocalElements(parent, localName) {
  return Array.from(parent.getElementsByTagNameNS('*', localName));
}

function getCellValue(cell) {
  const data = getXmlLocalElements(cell, 'Data')[0];
  return data ? normalizeText(data.textContent) : '';
}

function readSpreadsheetRows(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('File cannot be read as XML Excel.');
  const rows = getXmlLocalElements(doc, 'Row');
  return rows.map(row => {
    const values = [];
    let index = 0;
    getXmlLocalElements(row, 'Cell').forEach(cell => {
      const explicitIndex = cell.getAttribute('ss:Index') || cell.getAttribute('Index');
      if (explicitIndex) index = Number(explicitIndex) - 1;
      values[index] = getCellValue(cell);
      index++;
    });
    return values;
  }).filter(row => row.some(Boolean));
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(normalizeText(current));
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(normalizeText(current));
  return cells;
}

function readDelimitedRows(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  return lines.map(line => parseDelimitedLine(line, delimiter));
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    obj[normalizeText(header)] = row[index] || '';
  });
  return obj;
}

function getRowValue(row, names) {
  for (const name of names) {
    const foundKey = Object.keys(row).find(key => key.toLowerCase().trim() === name.toLowerCase().trim());
    if (foundKey && normalizeText(row[foundKey])) return normalizeText(row[foundKey]);
  }
  return '';
}

function rowHasAnyHeader(row, names) {
  const normalizedNames = names.map(name => name.toLowerCase().trim());
  return Object.keys(row).some(key => normalizedNames.includes(key.toLowerCase().trim()));
}

function getSupplierSheetName(sourceName) {
  const text = String(sourceName || '');
  const separatorIndex = text.lastIndexOf(':');
  return separatorIndex >= 0 ? text.slice(separatorIndex + 1).trim() : '';
}

function shouldSkipSupplierSheet(sourceName) {
  const sheetName = getSupplierSheetName(sourceName);
  return /^(pc|desktop|desktops|validatie|validation)$/i.test(sheetName);
}

function isLaptopSupplierSheet(sourceName) {
  return /laptop/i.test(getSupplierSheetName(sourceName));
}

function classifyImportedProduct(row) {
  const productText = getRowValue(row, ['ProductType', 'Product Type', 'Product Group', 'Productgroep', 'Category', 'Type']);
  const modelText = getRowValue(row, ['Device Name', 'Product Name', 'Omschrijving', 'Description', 'Name', 'Model', 'BIOS Model']);
  const combined = `${productText} ${modelText}`.toLowerCase();
  if (/monitor|display|tft|lcd\s*monitor|screen/.test(combined)) return 'monitor';
  if (/laptop|notebook|portable/.test(combined)) return 'laptop';
  if (/desktop|workstation|thin\s*client|mini\s*pc|tower|pc\b/.test(combined)) return 'desktop';
  return '';
}

function inferLaptopBrandFromName(deviceName, fallbackMerk = '') {
  const fallback = sanitizeExternalText(fallbackMerk, 80);
  if (fallback) return fallback;
  const name = sanitizeExternalText(deviceName, 180);
  if (/^(latitude|inspiron|vostro|precision|xps|alienware)\b/i.test(name)) return 'Dell';
  if (/^(elitebook|probook|zbook|pavilion|envy|omen)\b/i.test(name)) return 'HP';
  if (/^(thinkpad|thinkbook|ideapad|yoga|legion)\b/i.test(name) || /^2[0-9][A-Z]{2}$/i.test(name)) return 'Lenovo';
  if (/^macbook\b/i.test(name)) return 'Apple';
  if (/^surface\b/i.test(name)) return 'Microsoft';
  const leadingBrand = (name.match(/^[A-Za-z0-9-]+/) || [''])[0];
  return leadingBrand;
}

function formatProcessorWithGeneration(processor, generation) {
  const cleanProcessor = normalizeText(processor);
  const cleanGeneration = normalizeText(generation);
  if (cleanProcessor && cleanGeneration && !cleanProcessor.toLowerCase().includes(cleanGeneration.toLowerCase())) {
    return `${cleanProcessor} ${cleanGeneration}`;
  }
  return cleanProcessor || cleanGeneration;
}

function formatLaptopDisplayWithTouch(displayValue, touchscreenValue) {
  const display = formatDisplay(displayValue);
  if (!display) return '';
  if (isImportYes(touchscreenValue) && !/^touch\b/i.test(display)) return `touch ${display}`;
  return display;
}

function cleanImportedGpu(value) {
  const text = normalizeText(value);
  if (/^(nee|no|false|0|n)$/i.test(text)) return '';
  if (isImportYes(text)) return 'Dedicated GPU';
  return cleanGpu(text);
}

function extractVideoInputsFromText(text) {
  const found = [];
  const add = value => {
    if (!found.includes(value)) found.push(value);
  };
  const source = String(text || '');
  if (/\bhdmi\b/i.test(source)) add('HDMI');
  if (/\bdisplay\s*port\b|\bdisplayport\b|\bdisplay\s*poort\b|\bdisplaypoort\b|\bscherm\s*poort\b|\bschermport\b|\bschermpoort\b|\bdp\b/i.test(source)) add('DisplayPort');
  if (/\bmini\s*display\s*port\b|\bmini\s*dp\b/i.test(source)) add('Mini DisplayPort');
  if (/\busb[\s-]*c\b|\btype[\s-]*c\b/i.test(source)) add('USB-C');
  if (/\bthunderbolt\b/i.test(source)) add('Thunderbolt');
  if (/\bdvi\b/i.test(source)) add('DVI');
  if (/\bvga\b|\bd-sub\b/i.test(source)) add('VGA');
  return found.join(' / ');
}

function inferMonitorVideoInputs(row, monitorText) {
  const explicit = getRowValue(row, [
    'Video In', 'Video Inputs', 'Video input', 'Inputs', 'Ports', 'Aansluitingen',
    'Video poorten', 'Video Ports', 'Connector', 'Connectors'
  ]);
  return extractVideoInputsFromText(`${explicit} ${monitorText}`);
}

function escapeImportRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMonitorModelFromName(deviceName, merk) {
  const cleanName = sanitizeExternalText(deviceName, 180);
  if (!cleanName) return '';
  const cleanMerk = sanitizeExternalText(merk, 80);
  let modelName = cleanName;
  if (cleanMerk) {
    modelName = modelName.replace(new RegExp(`^${escapeImportRegex(cleanMerk)}\\s+`, 'i'), '').trim();
  }
  modelName = modelName
    .replace(/\b(monitors?|displays?|screens?|beeldscherm|schermen|lcd|led|tft|inch|inches)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return modelName || cleanName;
}

function getMonitorBrandForName(deviceName, fallbackMerk) {
  const cleanName = sanitizeExternalText(deviceName, 180);
  const cleanFallback = sanitizeExternalText(fallbackMerk, 80);
  if (cleanFallback && cleanName.toLowerCase().startsWith(cleanFallback.toLowerCase())) return cleanFallback;
  const leadingBrand = (cleanName.match(/^[A-Za-z0-9-]+/) || [''])[0];
  return leadingBrand || cleanFallback;
}

function buildMonitorIdentityOption(source, deviceName, merk, model) {
  const cleanName = sanitizeExternalText(deviceName, 180);
  if (!cleanName) return null;
  const optionMerk = getMonitorBrandForName(cleanName, merk);
  const optionModel = sanitizeExternalText(model, 160) || extractMonitorModelFromName(cleanName, optionMerk);
  const enriched = enrichMonitorWithPortDatabase({
    deviceName: cleanName,
    merk: optionMerk,
    model: optionModel,
  });
  return normalizeMonitorIdentityOption({
    source,
    deviceName: cleanName,
    merk: enriched.merk || optionMerk,
    model: enriched.model || optionModel,
    display: enriched.display,
    resolution: enriched.resolution,
    videoInputs: enriched.videoInputs,
    monitorDatabaseModel: enriched.monitorDatabaseModel,
  });
}

function buildMonitorIdentityOptions(deviceName, accountDeviceName, merk, model) {
  if (!accountDeviceName || !monitorIdentityLooksDifferent(deviceName, accountDeviceName)) return [];
  return normalizeMonitorIdentityOptions([
    buildMonitorIdentityOption('Device Name', deviceName, merk, model),
    buildMonitorIdentityOption('Account Device Name', accountDeviceName, merk, ''),
  ]);
}

function isArontoLaptopRow(row, sourceName) {
  if (shouldSkipSupplierSheet(sourceName)) return false;
  if (!rowHasAnyHeader(row, ['ID']) || !rowHasAnyHeader(row, ['Naam'])) return false;
  if (isLaptopSupplierSheet(sourceName)) return true;
  return rowHasAnyHeader(row, ['Schermgrootte', 'Touchscreen']);
}

function importedArontoRowToLaptop(row, sourceName) {
  if (!isArontoLaptopRow(row, sourceName)) return null;

  const value = (names, maxLength = 160) => sanitizeExternalText(getRowValue(row, names), maxLength);
  const sticker = value(['ID'], 64).replace(/[^\w.-]/g, '');
  const deviceName = value(['Naam'], 180);
  if (!sticker || !deviceName) return null;

  const merk = inferLaptopBrandFromName(deviceName, value(['Merk', 'Manufacturer', 'Brand'], 80));
  const gpu = cleanImportedGpu(value(['Videokaart', 'GPU', 'Graphics', 'Videokaart Model'], 180));
  return {
    sticker,
    merk,
    model: deviceName,
    processor: formatProcessorWithGeneration(
      value(['Processor Model', 'Processor', 'CPU'], 120),
      value(['Processor Generatie', 'Processor Generation'], 80)
    ),
    ram: formatMemory(value(['Werkgeheugen', 'Memory', 'RAM', 'Geheugen'], 40)),
    ssd: formatStorage(value(['Opslag', 'Storage', 'Disk Size', 'SSD', 'HDD'], 80), ''),
    display: formatLaptopDisplayWithTouch(value(['Schermgrootte', 'Display', 'Screen', 'Scherm'], 80), value(['Touchscreen', 'Touch'], 40)),
    serial: value(['Serial Number', 'Serial', 'Serienummer', 'Service Tag'], 80),
    leverancier_class: value(['Grade', 'Quality class', 'Quality Class', 'Class', 'Klasse'], 40),
    meldingen: value(['Meldingen', 'Remarks', 'Remark', 'Defects', 'Problems', 'Device Errors'], 1000),
    battery: value(['Battery Capacity', 'Battery', 'Batterij', 'Batterijcapaciteit'], 60),
    gpu,
    labelGpu: getNoteworthyGpu(gpu),
    pallet: value(['Pallet Id', 'Pallet', 'Pallet ID'], 80),
    keyboard: value(['Keyboard layout', 'Keyboard', 'Toetsenbord'], 80),
    herkomst: sanitizeExternalText(sourceName, 180),
  };
}

function importedRowToLaptop(row, sourceName) {
  const arontoLaptop = importedArontoRowToLaptop(row, sourceName);
  if (arontoLaptop) return arontoLaptop;

  const productType = classifyImportedProduct(row);
  if (productType && productType !== 'laptop') return null;

  const value = (names, maxLength = 160) => sanitizeExternalText(getRowValue(row, names), maxLength);
  const sticker = value(['Sticker Number', 'Sticker', 'Barcode', 'Asset Tag', 'AssetTag', 'UnitID', 'Unit ID', 'Item Number', 'Item No'], 64).replace(/[^\w.-]/g, '');
  if (!sticker) return null;

  const deviceName = value(['Device Name', 'DeviceName', 'Product Name', 'Omschrijving', 'Description', 'Name'], 180);
  const merk = value(['BIOS Make', 'Make', 'Brand', 'Merk', 'Manufacturer'], 80) || deviceName.split(' ')[0] || '';
  const model = value(['BIOS Model', 'Model', 'BIOS Product Name'], 160) || deviceName.replace(merk, '').trim();
  const gpu = cleanGpu(value(['[GPU]', 'GPU', 'Graphics', 'Videokaart', 'Video Card'], 180));
  return {
    sticker,
    merk,
    model,
    processor: value(['Processor Name', 'Processor', 'CPU', 'Processor Type'], 120),
    ram: formatMemory(value(['Memory', 'RAM', 'Geheugen'], 40)),
    ssd: formatStorage(value(['Hard Disk Size Overall', 'Storage', 'Disk Size', 'SSD', 'HDD'], 80), value(['Hard Drive Count', 'Hard Disk', 'Drive'], 80)),
    display: formatDisplay(value(['Display', 'Screen', 'Scherm'], 80)),
    serial: value(['Serial Number', 'Serial', 'Serienummer', 'Service Tag'], 80),
    leverancier_class: value(['Quality class', 'Quality Class', 'Class', 'Grade', 'Leverancier Class'], 40),
    meldingen: value(['Device Errors', 'Errors', 'Meldingen', 'Remarks', 'Remark', 'Defects', 'Problems'], 1000),
    battery: value(['Battery Capacity', 'Battery', 'Batterij', 'Batterijcapaciteit'], 60),
    gpu,
    labelGpu: getNoteworthyGpu(gpu),
    pallet: value(['Pallet Id', 'Pallet', 'Pallet ID'], 80),
    keyboard: value(['Keyboard layout', 'Keyboard', 'Toetsenbord'], 80),
    herkomst: sanitizeExternalText(sourceName, 180),
  };
}

function importedRowToMonitor(row, sourceName) {
  const productType = classifyImportedProduct(row);
  if (productType && productType !== 'monitor') return null;
  if (!productType) {
    const productSignal = getRowValue(row, ['Device Name', 'DeviceName', 'Product Name', 'Product Group', 'Productgroep', 'Omschrijving', 'Description', 'Name', 'Model']);
    if (!/monitor|display|tft|lcd\s*monitor|screen/i.test(productSignal)) return null;
  }

  const value = (names, maxLength = 160) => sanitizeExternalText(getRowValue(row, names), maxLength);
  const sticker = value(['Sticker Number', 'Sticker', 'Barcode', 'Asset Tag', 'AssetTag', 'UnitID', 'Unit ID', 'Item Number', 'Item No'], 64).replace(/[^\w.-]/g, '');
  if (!sticker) return null;

  const merk = value(['Manufacturer', 'Make', 'Brand', 'Merk', 'BIOS Make'], 80);
  const model = value(['Model', 'BIOS Model', 'Product Name', 'Device Model'], 160);
  const deviceName = value(['Device Name', 'DeviceName', 'Product Name', 'Omschrijving', 'Description', 'Name'], 180)
    || `${merk} ${model}`.trim()
    || model
    || sticker;
  const accountDeviceName = value(['Account Device Name', 'Account DeviceName', 'AccountDeviceName', 'Account Product Name', 'Account Name'], 180);
  const identityOptions = buildMonitorIdentityOptions(deviceName, accountDeviceName, merk, model);
  const monitorText = [
    deviceName,
    accountDeviceName,
    model,
    value(['Expanded Codes', 'Device Errors', 'Errors', 'Meldingen', 'Remarks', 'Remark', 'Defects', 'Problems'], 1000),
    Object.values(row).join(' '),
  ].join(' ');

  const monitor = {
    sticker,
    deviceName,
    merk: merk || deviceName.split(' ')[0] || '',
    model: model || deviceName.replace(merk, '').trim(),
    serial: value(['Serial Number', 'SerialNumber', 'Serial', 'Serienummer', 'Service Tag'], 80),
    display: formatDisplay(value(['Display', 'DisplaySize', 'Display Size', 'Screen', 'Scherm'], 80)),
    resolution: value(['Resolution', 'Resolutie'], 80),
    videoInputs: inferMonitorVideoInputs(row, monitorText),
    leverancier_class: value(['OpticalGrade', 'Quality class', 'Quality Class', 'Class', 'Grade', 'Leverancier Class', 'Supplier grade'], 40),
    meldingen: value(['Expanded Codes', 'Device Errors', 'Errors', 'Meldingen', 'Remarks', 'Remark', 'Defects', 'Problems', 'Supplier notes'], 1000),
    herkomst: sanitizeExternalText(sourceName, 180),
  };
  if (identityOptions.length > 1) monitor.identityOptions = identityOptions;
  return enrichMonitorWithPortDatabase(monitor);
}

function parseSupplierExcel(xmlText, sourceName) {
  if (shouldSkipSupplierSheet(sourceName)) return { laptops: [], monitors: [], totalRows: 0 };
  const rows = xmlText.trim().startsWith('<') ? readSpreadsheetRows(xmlText) : readDelimitedRows(xmlText);
  if (rows.length < 2) return { laptops: [], totalRows: 0 };
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const laptops = dataRows
    .map(row => importedRowToLaptop(rowToObject(headers, row), sourceName))
    .filter(Boolean);
  const monitors = dataRows
    .map(row => importedRowToMonitor(rowToObject(headers, row), sourceName))
    .filter(Boolean);
  return { laptops, monitors, totalRows: dataRows.length };
}

async function parseSupplierExcelChunked(xmlText, sourceName, onProgress) {
  const rows = xmlText.trim().startsWith('<') ? readSpreadsheetRows(xmlText) : readDelimitedRows(xmlText);
  return parseSupplierRowsChunked(rows, sourceName, onProgress);
}

function parseSupplierRows(rows, sourceName) {
  if (shouldSkipSupplierSheet(sourceName)) return { laptops: [], monitors: [], totalRows: 0 };
  const cleanRows = rows
    .map(row => row.map(cell => normalizeText(cell)))
    .filter(row => row.some(Boolean));
  if (cleanRows.length < 2) return { laptops: [], monitors: [], totalRows: 0 };
  const headerIndex = cleanRows.findIndex(row => row.some(cell => /^(sticker number|sticker|barcode|assettag|asset tag|unitid|unit id|producttype|product type|model|id|naam|processor model|schermgrootte|werkgeheugen)$/i.test(cell)));
  const headers = cleanRows[headerIndex >= 0 ? headerIndex : 0];
  const dataRows = cleanRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);
  const laptops = [];
  const monitors = [];
  dataRows.forEach(row => {
    const obj = rowToObject(headers, row);
    const laptop = importedRowToLaptop(obj, sourceName);
    if (laptop) laptops.push(laptop);
    const monitor = importedRowToMonitor(obj, sourceName);
    if (monitor) monitors.push(monitor);
  });
  return { laptops, monitors, totalRows: dataRows.length };
}

function waitForUiFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

async function setImportProgress(progress) {
  STATE.importProgress = progress ? { ...progress } : null;
  render();
  await waitForUiFrame();
}

async function ensureXlsxLoaded() {
  if (window.XLSX) return window.XLSX;
  if (!xlsxLoadPromise) {
    xlsxLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${XLSX_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(window.XLSX));
        existing.addEventListener('error', () => reject(new Error('Excel parser could not be loaded.')));
        return;
      }
      const script = document.createElement('script');
      script.src = XLSX_SCRIPT_SRC;
      script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel parser loaded but is not available.'));
      script.onerror = () => reject(new Error('Excel parser could not be loaded.'));
      document.head.appendChild(script);
    });
  }
  return xlsxLoadPromise;
}

async function parseSupplierRowsChunked(rows, sourceName, onProgress) {
  if (shouldSkipSupplierSheet(sourceName)) return { laptops: [], monitors: [], totalRows: 0 };
  const cleanRows = [];
  const normalizeChunkSize = 300;
  const totalWork = Math.max(rows.length, 1);
  const normalizeWeight = 0.4;
  for (let i = 0; i < rows.length; i += normalizeChunkSize) {
    const slice = rows.slice(i, i + normalizeChunkSize);
    slice.forEach(row => {
      const clean = row.map(cell => normalizeText(cell));
      if (clean.some(Boolean)) cleanRows.push(clean);
    });
    if (onProgress) await onProgress(Math.round(Math.min(i + normalizeChunkSize, rows.length) * normalizeWeight), totalWork);
    await waitForUiFrame();
  }

  if (cleanRows.length < 2) return { laptops: [], monitors: [], totalRows: 0 };
  const headerIndex = cleanRows.findIndex(row => row.some(cell => /^(sticker number|sticker|barcode|assettag|asset tag|unitid|unit id|producttype|product type|model|id|naam|processor model|schermgrootte|werkgeheugen)$/i.test(cell)));
  const headers = cleanRows[headerIndex >= 0 ? headerIndex : 0];
  const dataRows = cleanRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);
  const laptops = [];
  const monitors = [];
  const mapChunkSize = 250;
  for (let i = 0; i < dataRows.length; i += mapChunkSize) {
    const slice = dataRows.slice(i, i + mapChunkSize);
    slice.forEach(row => {
      const obj = rowToObject(headers, row);
      const laptop = importedRowToLaptop(obj, sourceName);
      if (laptop) laptops.push(laptop);
      const monitor = importedRowToMonitor(obj, sourceName);
      if (monitor) monitors.push(monitor);
    });
    if (onProgress) {
      const mapped = Math.min(i + mapChunkSize, dataRows.length);
      const weighted = Math.round((totalWork * normalizeWeight) + ((mapped / Math.max(dataRows.length, 1)) * totalWork * (1 - normalizeWeight)));
      await onProgress(weighted, totalWork);
    }
    await waitForUiFrame();
  }
  return { laptops, monitors, totalRows: dataRows.length };
}

async function parseSupplierFile(file, onProgress) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isZipXlsx = bytes[0] === 0x50 && bytes[1] === 0x4B;
  const isBinaryXls = bytes[0] === 0xD0 && bytes[1] === 0xCF;

  if (isZipXlsx || isBinaryXls || /\.xlsx?$/i.test(file.name)) {
    await ensureXlsxLoaded();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const combined = { laptops: [], monitors: [], totalRows: 0 };
    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const sheetName = workbook.SheetNames[i];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      const parsed = await parseSupplierRowsChunked(rows, `${file.name}:${sheetName}`, onProgress);
      combined.laptops.push(...(parsed.laptops || []));
      combined.monitors.push(...(parsed.monitors || []));
      combined.totalRows += parsed.totalRows || 0;
    }
    return combined;
  }

  const text = new TextDecoder('utf-8').decode(buffer);
  return parseSupplierExcelChunked(text, file.name, onProgress);
}

function getImportBatchNumber(fileName) {
  return sanitizeExternalText(String(fileName || '').replace(/\.[^.]+$/, ''), 100) || `Import ${Date.now()}`;
}

function slugifyBatchPart(value) {
  return (sanitizeExternalText(value, 100) || 'batch')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'batch';
}

function createImportRunId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function getImportedItemSignature(items) {
  return (items || [])
    .map(item => normalizeStickerCode(item && item.sticker))
    .filter(Boolean)
    .sort()
    .join('|');
}

function createImportedBatchId(prefix, nummer, importRunId, fileIndex, existingBatches) {
  const base = `${prefix}_${slugifyBatchPart(nummer)}_${importRunId}_${fileIndex + 1}`;
  const existingIds = new Set((existingBatches || []).map(batch => batch && batch.id).filter(Boolean));
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

async function importSupplierFiles(files) {
  const allImported = [];
  const allImportedMonitors = [];
  const importedByFile = new Map();
  const monitorImportedByFile = new Map();
  const seen = new Set();
  const seenMonitors = new Set();
  let duplicateCount = 0;
  let totalRows = 0;
  const fileList = Array.from(files);
  const totalFiles = fileList.length;
  const importRunId = createImportRunId();

  await setImportProgress({
    active: true,
    percent: 2,
    title: 'Preparing import',
    detail: `${totalFiles} file${totalFiles === 1 ? '' : 's'} selected`,
  });
  await loadMonitorPortDatabase();

  for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
    const file = fileList[fileIndex];
    await setImportProgress({
      active: true,
      percent: Math.round((fileIndex / Math.max(totalFiles, 1)) * 75) + 5,
      title: `Reading file: ${file.name}`,
      detail: `File ${fileIndex + 1} of ${totalFiles}`,
    });
    const parsed = await parseSupplierFile(file, async (done, total) => {
      const fileProgress = total ? done / total : 0;
      await setImportProgress({
        active: true,
        percent: Math.min(85, Math.round(((fileIndex + fileProgress) / Math.max(totalFiles, 1)) * 75) + 5),
        title: `Processing rows: ${file.name}`,
        detail: `${Math.min(done, total)} of ${total} rows`,
      });
    });
    totalRows += parsed.totalRows;
    const laptops = parsed.laptops || [];
    const monitors = parsed.monitors || [];
    const fileImported = [];
    const fileImportedMonitors = [];
    for (const laptop of laptops) {
      const key = normalizeStickerCode(laptop.sticker);
      if (seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);
      allImported.push(laptop);
      fileImported.push(laptop);
    }
    for (const monitor of monitors) {
      const key = normalizeStickerCode(monitor.sticker);
      if (seenMonitors.has(key)) {
        duplicateCount++;
        continue;
      }
      seenMonitors.add(key);
      allImportedMonitors.push(monitor);
      fileImportedMonitors.push(monitor);
    }
    importedByFile.set(file.name, fileImported);
    monitorImportedByFile.set(file.name, fileImportedMonitors);
    await waitForUiFrame();
  }

  const importedBatches = [];
  const importedMonitorBatches = [];
  if (allImported.length) {
    if (BATCHES.length === 1 && BATCHES[0].id === 'batch_50375' && STATE.history.length === 0) {
      BATCHES.length = 0;
    }
    await setImportProgress({
      active: true,
      percent: 90,
      title: 'Building batches',
      detail: `${allImported.length} devices ready`,
    });
    fileList.forEach((file, fileIndex) => {
      const nummer = getImportBatchNumber(file.name);
      const sourceLaptops = importedByFile.get(file.name) || [];
      if (!sourceLaptops.length) return;
      const incomingSignature = getImportedItemSignature(sourceLaptops);
      const existingIndex = BATCHES.findIndex(batch => batch.nummer === nummer && getImportedItemSignature(batch.laptops) === incomingSignature);
      const batchId = existingIndex >= 0
        ? BATCHES[existingIndex].id
        : createImportedBatchId('batch', nummer, importRunId, fileIndex, BATCHES);
      const laptops = sourceLaptops.map(l => ({ ...l, batchId, batchNummer: nummer }));
      const batch = {
        id: batchId,
        nummer,
        leverancier: 'Supplier import',
        geimporteerd: new Date().toLocaleDateString('nl-NL'),
        importedAt: new Date().toISOString(),
        laptops,
      };
      clearBatchDeletion(batch.id);
      laptops.forEach(laptop => clearLaptopDeletion(laptop.sticker));
      if (existingIndex >= 0) BATCHES[existingIndex] = batch;
      else BATCHES.push(batch);
      importedBatches.push(batch);
    });
    syncBatchAggregate();
  }
  if (allImportedMonitors.length) {
    await setImportProgress({
      active: true,
      percent: 94,
      title: 'Building monitor batches',
      detail: `${allImportedMonitors.length} monitors ready`,
    });
    fileList.forEach((file, fileIndex) => {
      const nummer = getImportBatchNumber(file.name);
      const sourceMonitors = monitorImportedByFile.get(file.name) || [];
      if (!sourceMonitors.length) return;
      const incomingSignature = getImportedItemSignature(sourceMonitors);
      const existingIndex = MONITOR_BATCHES.findIndex(batch => batch.nummer === nummer && getImportedItemSignature(batch.monitors) === incomingSignature);
      const batchId = existingIndex >= 0
        ? MONITOR_BATCHES[existingIndex].id
        : createImportedBatchId('monitor_batch', nummer, importRunId, fileIndex, MONITOR_BATCHES);
      const monitors = sourceMonitors.map(monitor => ({ ...monitor, batchId, batchNummer: nummer }));
      const batch = {
        id: batchId,
        nummer,
        leverancier: 'Monitor supplier import',
        geimporteerd: new Date().toLocaleDateString('nl-NL'),
        importedAt: new Date().toISOString(),
        monitors,
      };
      clearMonitorBatchDeletion(batch.id);
      monitors.forEach(monitor => clearMonitorDeletion(monitor.sticker));
      if (existingIndex >= 0) MONITOR_BATCHES[existingIndex] = batch;
      else MONITOR_BATCHES.push(batch);
      importedMonitorBatches.push(batch);
    });
    rebuildMonitorIndex();
  }

  STATE.importResult = {
    imported: allImported.length + allImportedMonitors.length,
    importedLaptops: allImported.length,
    importedMonitors: allImportedMonitors.length,
    skipped: Math.max(totalRows - allImported.length - allImportedMonitors.length, duplicateCount),
    laptops: allImported,
    monitors: allImportedMonitors,
    batches: importedBatches,
    monitorBatches: importedMonitorBatches,
  };
  await setImportProgress(null);
}

