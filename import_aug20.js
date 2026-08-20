const fs = require('fs');
const { db } = require('./db.js');
const { parse } = require('csv-parse/sync');

// Read the uploaded file from the conversation
const files = [
  '/Users/maivanduc/.gemini/antigravity-ide/brain/024cc8f8-9270-4961-820e-a81bd10ceb2c/.user_uploaded/media_1787195504625.csv',
  '/Users/maivanduc/.gemini/antigravity-ide/brain/024cc8f8-9270-4961-820e-a81bd10ceb2c/.user_uploaded/media_1787200335154.csv'
];

let targetFile = files[0];
if (!fs.existsSync(targetFile)) {
  targetFile = files[1];
}

const csvContent = fs.readFileSync(targetFile, 'utf8');

const rows = parse(csvContent, {
  columns: true,
  delimiter: ';',
  skip_empty_lines: true,
  trim: true,
  relax_quotes: true,
  relax_column_count: true
});

console.log('Parsed rows count:', rows.length);

const findExistingPage = db.prepare(`
  SELECT id FROM pages 
  WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR name = ?
  LIMIT 1
`);

const updateExistingPage = db.prepare(`
  UPDATE pages SET 
    page_id = CASE WHEN ? != '' THEN ? ELSE page_id END,
    page_url = CASE WHEN ? != '' THEN ? ELSE page_url END,
    avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END
  WHERE id = ?
`);

const insertNewPage = db.prepare(`
  INSERT INTO pages (name, category, page_id, page_url, avatar_url, staff_name) 
  VALUES (?, 'Của tôi', ?, ?, ?, 'Chưa phân bổ')
`);

const insertMetric = db.prepare(`
  INSERT OR REPLACE INTO daily_metrics 
  (page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, source, raw_data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const targetReportDate = '2026-08-20';

const trx = db.transaction(() => {
  for (const r of rows) {
    const pageName = r.Profile || r.profile || r.Page || r.Name || '';
    if (!pageName) continue;
    const pageId = (r['Profile-ID'] || r.profileid || '').trim();
    const avatar = r['Image Link'] || r.imagelink || '';
    const pageUrl = pageId ? `https://facebook.com/${pageId}` : '';
    const views = Math.round(parseFloat(r['Daily Views'] || r.dailyviews || 0));
    const postCount = Math.round(parseFloat(r['Number of posts'] || r.numberofposts || 0));
    const postsPerDay = parseFloat((postCount / 7).toFixed(2));
    const likes = Math.round(parseFloat(r['Number of Likes'] || 0));
    const comments = Math.round(parseFloat(r['Number of comments'] || 0));
    const interactions = likes + comments;
    let er = parseFloat(r['Post interaction rate'] || 0);
    if (er > 0 && er < 1) er = parseFloat((er * 100).toFixed(4));
    const followers = Math.round(parseFloat(r.Follower || r.follower || 0));

    const existing = findExistingPage.get(pageId, pageName);
    if (existing) {
      updateExistingPage.run(pageId, pageId, pageUrl, pageUrl, avatar, avatar, existing.id);
    } else {
      insertNewPage.run(pageName, pageId, pageUrl, avatar);
    }

    insertMetric.run(pageName, targetReportDate, views, postsPerDay, postCount, interactions, er, followers, 'Manual Upload 2026-08-20', null);
  }
});

trx();

console.log('=== RESULTS IN DAILY_METRICS ===');
console.log(db.prepare('SELECT report_date, COUNT(*) as pages_count, SUM(views) as total_views FROM daily_metrics GROUP BY report_date ORDER BY report_date DESC').all());
