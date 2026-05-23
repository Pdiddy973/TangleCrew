const axios = require('axios');
const ExcelJS = require('exceljs');
const { CLAN_RANKS } = require('./ranks');

function normalise(str) {
  return String(str).toLowerCase().replace(/[\s_-]/g, '');
}

async function fetchRanksFromExcel() {
  const shareUrl = process.env.RANKS_EXCEL_URL;
  if (!shareUrl) throw new Error('RANKS_EXCEL_URL is not set in .env');

  const downloadUrl = shareUrl.includes('?')
    ? `${shareUrl}&download=1`
    : `${shareUrl}?download=1`;

  const response = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    maxRedirects: 10,
    timeout: 15_000,
    headers: { 'User-Agent': 'Tanglebot/1.0' },
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.data);

  for (const worksheet of workbook.worksheets) {
    let headers = null;
    const rows = [];

    worksheet.eachRow((row, rowNumber) => {
      // row.values is 1-indexed — index 0 is always undefined
      const values = row.values.slice(1).map(v => {
        // Cells can be objects (rich text, hyperlinks) — extract plain value
        if (v && typeof v === 'object' && 'text' in v) return v.text;
        if (v && typeof v === 'object' && 'richText' in v) return v.richText.map(r => r.text).join('');
        return v ?? '';
      });

      if (rowNumber === 1) {
        headers = values.map(v => String(v));
      } else {
        if (!headers) return;
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
        rows.push(obj);
      }
    });

    if (!headers || rows.length === 0) continue;

    const idKey   = headers.find(k => normalise(k) === 'discordid');
    const rankKey = headers.find(k => normalise(k) === 'rank');

    if (!idKey || !rankKey) continue;

    const results = rows
      .filter(r => r[idKey] && r[rankKey])
      .map(r => ({
        discordId: String(r[idKey]).trim().replace(/\D/g, ''),
        rank: String(r[rankKey]).trim(),
      }))
      .filter(r => r.discordId.length >= 17 && CLAN_RANKS.includes(r.rank));

    if (results.length > 0) return results;
  }

  throw new Error(
    'Could not find rank data in the spreadsheet. ' +
    'Make sure there is a sheet with "DiscordID" and "Rank" column headers, ' +
    'and that ranks are one of: ' + CLAN_RANKS.join(', ') + '.'
  );
}

module.exports = { fetchRanksFromExcel };
