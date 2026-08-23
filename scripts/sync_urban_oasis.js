const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'crm_fanpage.db');
const db = new Database(dbPath);

function parseNum(val) {
  if (!val || val === 'N/A' || val === '-') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim().toLowerCase().replace(/,/g, '');
  if (str.endsWith('k')) {
    return Math.round(parseFloat(str.replace('k', '')) * 1000);
  }
  if (str.endsWith('m')) {
    return Math.round(parseFloat(str.replace('m', '')) * 1000000);
  }
  if (str.endsWith('%')) {
    return parseFloat(str.replace('%', ''));
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

const rawHistory = {
  '2026-08-01': { cells: ['Urban Oasis @urbanoasisave', '153k', '4', '16', '0', '0.0029%', '6,026', '1%', '8.1k'] },
  '2026-08-02': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '3', '1', '0.0020%', '1,565', '1%', '2.4k'] },
  '2026-08-03': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '18', '0', '0.0046%', '1,358', '1%', '2.3k'] },
  '2026-08-04': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '21', '0', '0.0046%', '1,400', '1%', '2.3k'] },
  '2026-08-05': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '132', '3', '0.032%', '2,538', '3%', '4.3k'] },
  '2026-08-06': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '43', '5', '0.012%', '6,939', '2%', '11k'] },
  '2026-08-07': { cells: ['Urban Oasis @urbanoasisave', '153k', '1', '3', '0', '0.0020%', '3,854', '1%', '6.4k'] },
  '2026-08-08': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '1', '1', '0.00044%', '1,290', '1%', '2.1k'] },
  '2026-08-09': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '46', '2', '0.019%', '2,704', '2%', '4.3k'] },
  '2026-08-10': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '32', '0', '0.011%', '1,353', '1%', '2.2k'] },
  '2026-08-11': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '16', '1', '0.0059%', '3,376', '1%', '4.2k'] },
  '2026-08-12': { cells: ['Urban Oasis @urbanoasisave', '153k', '4', '25', '1', '0.0046%', '1,264', '1%', '1.9k'] },
  '2026-08-13': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '28', '2', '0.0072%', '2,031', '1%', '3.1k'] },
  '2026-08-14': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '2', '0', '0.00044%', '2,178', '1%', '3.1k'] },
  '2026-08-15': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '2', '0', '0.00065%', '869', '1%', '1.4k'] },
  '2026-08-16': { cells: ['Urban Oasis @urbanoasisave', '153k', '4', '41', '3', '0.0082%', '917', '1%', '1.4k'] },
  '2026-08-17': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '38', '3', '0.011%', '3,355', '1%', '5.0k'] },
  '2026-08-18': { cells: ['Urban Oasis @urbanoasisave', '153k', '1', '48', '1', '0.038%', '2,867', '2%', '4.2k'] },
  '2026-08-19': { cells: ['Urban Oasis @urbanoasisave', '153k', '2', '57', '7', '0.023%', '1,850', '2%', '2.9k'] },
  '2026-08-20': { cells: ['Urban Oasis @urbanoasisave', '153k', '3', '9', '1', '0.0022%', '3,703', '1%', '5.2k'] },
  '2026-08-21': { cells: ['Urban Oasis @urbanoasisave', '153k', '1', '9', '0', '0.0072%', '2,261', '1%', '3.3k'] },
  '2026-08-22': { cells: ['Urban Oasis @urbanoasisave', '153k', '0', '0', '0', '0%', '844', '1%', '1.2k'] },
  '2026-08-23': { cells: ['Urban Oasis @urbanoasisave', '153k', '4', '8', '2', '0.0018%', '331', '1%', '442'] }
};

const pageId = '116012434869808';
const pageName = 'Urban Oasis';
const staffName = 'Trương Thị Anh Nhung';
const department = 'Aff Fitness';
const topic = 'Fitness transformation';
const bm = 'AVE Global 2.1';
const avatarUrl = 'https://scontent-ord5-1.xx.fbcdn.net/v/t39.30808-1/514430871_585225491300209_1432711261547345280_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=106&ccb=1-7&_nc_sid=f907e8&_nc_ohc=YiSZ6fRs58kQ7kNvwFvHAi_&_nc_oc=AdoX59EELcbFVm28pHMeG40tBtpX-VPPcFybcWsINxvzoowm3Akm5dc5GCKryAWii28&_nc_zt=24&_nc_ht=scontent-ord5-1.xx&edm=AJdBtusEAAAA&_nc_gid=AP8M3oRXtp7IXOGEwHwrAA&_nc_tpa=Q5bMBQIMg1vH_KohMo_CJdRcBIJuA1v7tlmr2RuAf3T8AN7hg7aF8hCxGIkJjJm1ufL0fTyVokGcSk58&oh=00_AQFkkXhD55LKXoEnW7pBJGdta3oK95g-PHro9kyTYoKMPw&oe=6A9018BC';
const pageUrl = 'https://facebook.com/' + pageId;

// 1. Ensure staff exists
db.prepare('INSERT OR IGNORE INTO staff (name, department, code) VALUES (?, ?, ?)').run(staffName, department, 'NV_NHUNG');

// 2. Insert or update pages
const existingPage = db.prepare('SELECT id FROM pages WHERE page_id = ? OR name = ?').get(pageId, pageName);
if (existingPage) {
  db.prepare('UPDATE pages SET name = ?, page_id = ?, page_url = ?, staff_name = ?, topic = ?, avatar_url = ? WHERE id = ?').run(
    pageName, pageId, pageUrl, staffName, topic, avatarUrl, existingPage.id
  );
} else {
  db.prepare('INSERT INTO pages (name, page_id, page_url, category, avatar_url, staff_name, topic) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    pageName, pageId, pageUrl, 'Của tôi', avatarUrl, staffName, topic
  );
}

// 3. Insert or update master_pages
const existingMaster = db.prepare('SELECT id FROM master_pages WHERE page_id = ? OR page_name = ?').get(pageId, pageName);
if (existingMaster) {
  db.prepare('UPDATE master_pages SET page_name = ?, page_id = ?, staff_name = ?, department = ?, topic = ?, bm = ?, status = ?, avatar_url = ? WHERE id = ?').run(
    pageName, pageId, staffName, department, topic, bm, 'Active', avatarUrl, existingMaster.id
  );
} else {
  db.prepare('INSERT INTO master_pages (page_name, page_id, staff_name, department, topic, bm, status, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    pageName, pageId, staffName, department, topic, bm, 'Active', avatarUrl
  );
}

// 4. Insert all daily metrics
const insertMetric = db.prepare(`
  INSERT OR REPLACE INTO daily_metrics 
  (page_id, page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, page_performance_index, source, raw_data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let insertedDays = 0;
for (const [dateStr, data] of Object.entries(rawHistory)) {
  const c = data.cells;
  const followers = parseNum(c[1]);
  const posts = parseNum(c[2]);
  const likes = parseNum(c[3]);
  const comments = parseNum(c[4]);
  const interactions = likes + comments;
  const ppi = parseNum(c[7]);
  const views = parseNum(c[8]);

  const rawJson = JSON.stringify({
    page_name: pageName,
    page_id: pageId,
    report_date: dateStr,
    followers,
    post_count: posts,
    posts_per_day: posts,
    interactions,
    engagement_rate: ppi,
    page_performance_index: ppi,
    views,
    source: 'Fanpage Karma Live Sync'
  });

  // Delete existing for this page and date
  db.prepare('DELETE FROM daily_metrics WHERE (page_id = ? OR page_name = ?) AND report_date = ?').run(pageId, pageName, dateStr);

  insertMetric.run(
    pageId,
    pageName,
    dateStr,
    views,
    posts,
    posts,
    interactions,
    ppi,
    followers,
    ppi,
    'Fanpage Karma Live Sync',
    rawJson
  );
  insertedDays++;
}

console.log(`✅ Successfully synced ${insertedDays} days of metrics for ${pageName} (${pageId}) assigned to ${staffName}!`);

const staffKpi = db.prepare(`
  SELECT 
    s.name,
    COUNT(DISTINCT p.id) as pages_count,
    COALESCE(SUM(dm.views), 0) as total_views_latest,
    COALESCE(SUM(dm.post_count), 0) as total_posts_latest
  FROM staff s
  LEFT JOIN pages p ON p.staff_name = s.name
  LEFT JOIN daily_metrics dm ON dm.page_name = p.name AND dm.report_date = '2026-08-23'
  WHERE s.name = ?
  GROUP BY s.id
`).get(staffName);
console.log('Nhung updated stats for 2026-08-23:', staffKpi);

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
