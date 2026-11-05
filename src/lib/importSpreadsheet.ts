import ExcelJS from 'exceljs';

// All DB field names that represent dates and need special date-parsing handling.
// Add new date fields here whenever a new module introduces one — never inline this check again.
const DATE_FIELDS = [
  'filed_date',
  'published_or_granted_date',
  'year_of_registration',
  'amount_credited_date',
  'submitted_date',
  'date_of_publication',
  'project_date',   // consultancy
];

export async function parseSpreadsheetRows(buffer: Buffer, expectedColumns: Record<string, string | string[]>, sheetName?: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  
  // Try to find the most relevant sheet or just use the first one
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) {
    throw new Error('No worksheets found in the Excel file');
  }

  const rows: any[] = [];
  const errors: string[] = [];
  let skipped = 0;

  // We need to find the header row. It might not be row 1.
  // We'll scan the first few rows to find the one with the most matching headers.
  let headerRowIndex = 1;
  let maxMatches = 0;
  let bestColMap = new Map<number, string>(); // excel col index -> db field name

  for (let r = 1; r <= 10; r++) {
    const row = sheet.getRow(r);
    if (!row.values || !Array.isArray(row.values)) continue;
    
    let matches = 0;
    const tempColMap = new Map<number, string>();
    const claimedDbFields = new Set<string>();
    
    row.eachCell((cell, colNumber) => {
      let rawVal = cell.value;
      if (typeof rawVal === 'object' && rawVal !== null && !(rawVal instanceof Date)) {
        if ((rawVal as any).richText) {
          rawVal = (rawVal as any).richText.map((rt: any) => rt.text).join('');
        } else if ((rawVal as any).text) {
          rawVal = (rawVal as any).text;
        }
      }
      const val = String(rawVal || '').trim().toLowerCase();
      if (!val) return;
      
      let bestDbField: string | null = null;
      let isExact = false;
      let longestMatchLen = 0;
      
      // Pass 1: exact match
      for (const [dbField, headerNames] of Object.entries(expectedColumns)) {
        const names = Array.isArray(headerNames) ? headerNames : [headerNames];
        for (const headerName of names) {
          if (val === headerName.toLowerCase()) {
             bestDbField = dbField;
             isExact = true;
             break;
          }
        }
        if (isExact) break;
      }
      
      // Pass 2: longest partial match
      if (!bestDbField) {
        let matchCount = 0;
        for (const [dbField, headerNames] of Object.entries(expectedColumns)) {
          const names = Array.isArray(headerNames) ? headerNames : [headerNames];
          for (const headerName of names) {
            const lowerHeader = headerName.toLowerCase();
            if (val.includes(lowerHeader) && !claimedDbFields.has(dbField)) {
              matchCount++;
              if (lowerHeader.length > longestMatchLen) {
                bestDbField = dbField;
                longestMatchLen = lowerHeader.length;
              }
            }
          }
        }
      }
      
      if (bestDbField) {
        matches++;
        tempColMap.set(colNumber, bestDbField);
        claimedDbFields.add(bestDbField);
      }
    });

    if (matches > maxMatches) {
      maxMatches = matches;
      headerRowIndex = r;
      bestColMap = tempColMap;
    }
  }

  if (maxMatches === 0) {
    throw new Error('Could not find expected column headers in the spreadsheet');
  }

  const getText = (cell: any, dbField: string) => {
    let val = cell.value;
    if (cell.isMerged && cell.master) {
      val = cell.master.value;
    }
    
    if (val === null || val === undefined) return null;
    
    let baseVal = val;
    if (typeof val === 'object' && !(val instanceof Date)) {
      if (val.hyperlink) baseVal = val.hyperlink;
      else if (val.richText) baseVal = val.richText.map((rt: any) => rt.text).join('');
      else if (val.text) baseVal = val.text;
      else if (val.result !== undefined) baseVal = val.result;
    }

    const isDateField = DATE_FIELDS.includes(dbField);

    if (isDateField) {
      if (baseVal instanceof Date) {
        const y = baseVal.getFullYear();
        const m = String(baseVal.getMonth() + 1).padStart(2, '0');
        const d = String(baseVal.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      
      const strVal = String(baseVal).trim();
      const dateMatch = strVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dateMatch) {
        const d = parseInt(dateMatch[1], 10);
        const m = parseInt(dateMatch[2], 10);
        const y = parseInt(dateMatch[3], 10);
        
        // Let JS Date handle rollovers (e.g., 2025-09-31 -> 2025-10-01)
        const parsedDate = new Date(y, m - 1, d);
        if (isNaN(parsedDate.getTime())) return null;
        
        const py = parsedDate.getFullYear();
        const pm = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const pd = String(parsedDate.getDate()).padStart(2, '0');
        return `${py}-${pm}-${pd}`;
      }

      // Try parsing date string like '14-Nov-2025', '14 Nov 2025', '2025-11-14'
      const parsedNative = new Date(strVal);
      if (!isNaN(parsedNative.getTime())) {
        const py = parsedNative.getFullYear();
        const pm = String(parsedNative.getMonth() + 1).padStart(2, '0');
        const pd = String(parsedNative.getDate()).padStart(2, '0');
        return `${py}-${pm}-${pd}`;
      }

      return null;
    }

    if (typeof baseVal === 'number' && (dbField === 'au_registration_number' || dbField === 'ref_no' || dbField === 'publication_or_grant_number' || dbField === 'file_number')) {
      return Math.round(baseVal).toString();
    }

    if (baseVal instanceof Date) {
      const y = baseVal.getFullYear();
      const m = String(baseVal.getMonth() + 1).padStart(2, '0');
      const d = String(baseVal.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    if (typeof baseVal === 'object' && baseVal !== null) {
      if (baseVal.error) return null; // Formula error like #N/A
      return String(baseVal.result || baseVal.text || baseVal.value || '').trim();
    }
    
    return String(baseVal).trim();
  };

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return; // skip header and above
    
    const rowData: any = {};
    let hasData = false;

    row.eachCell((cell, colNumber) => {
      const dbField = bestColMap.get(colNumber);
      if (dbField) {
        const val = getText(cell, dbField);
        if (val) {
          rowData[dbField] = val;
          hasData = true;
        }
      }
    });

    if (hasData) {
      rows.push(rowData);
    } else {
      skipped++;
    }
  });

  // Post-processing: Smart backfill for missing department or phd_status.
  // In human-entered spreadsheets, these are often left blank for subsequent rows of the same faculty.
  const facultyCache = new Map<string, { dept?: string, phd?: string }>();
  
  // First pass: learn the values
  for (const row of rows) {
    if (!row.faculty_name) continue;
    const key = row.faculty_name.toLowerCase().replace(/\s+/g, '').trim();
    if (!facultyCache.has(key)) facultyCache.set(key, {});
    
    const cache = facultyCache.get(key)!;
    if (row.department && !cache.dept) cache.dept = row.department;
    if (row.phd_status && !cache.phd) cache.phd = row.phd_status;
  }
  
  // Second pass: fill in the blanks
  for (const row of rows) {
    if (!row.faculty_name) continue;
    const key = row.faculty_name.toLowerCase().replace(/\s+/g, '').trim();
    const cache = facultyCache.get(key);
    if (cache) {
      if (!row.department && cache.dept) row.department = cache.dept;
      if (!row.phd_status && cache.phd) row.phd_status = cache.phd;
    }
  }

  return { rows, skipped, errors };
}
