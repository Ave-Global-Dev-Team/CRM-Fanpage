const fs = require('fs');
const { db } = require('./db.js');
const { parse } = require('csv-parse/sync');

// Check the real CSV from conversation artifacts
const csvPath = '/Users/maivanduc/.gemini/antigravity-ide/brain/024cc8f8-9270-4961-820e-a81bd10ceb2c/.user_uploaded/media_1787208897694.csv';
let content = '';

if (fs.existsSync(csvPath)) {
  content = fs.readFileSync(csvPath, 'utf8');
} else {
  // Read any other uploaded CSV
  const candidates = [
    '/Users/maivanduc/.gemini/antigravity-ide/brain/024cc8f8-9270-4961-820e-a81bd10ceb2c/.user_uploaded/media_1787201422200.csv',
    '/Users/maivanduc/.gemini/antigravity-ide/brain/024cc8f8-9270-4961-820e-a81bd10ceb2c/.user_uploaded/media_1787200335154.csv'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      content = fs.readFileSync(c, 'utf8');
      break;
    }
  }
}

if (!content) {
  console.error('No CSV file found.');
  process.exit(1);
}

// Clean BOM
if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

// Find header line
const lines = content.split(/\r?\n/);
let headerIndex = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].toLowerCase();
  if (line.includes('profile') || line.includes('follower') || line.includes('daily views')) {
    headerIndex = i;
    break;
  }
}

const cleanContent = lines.slice(headerIndex).join('\n');
const firstLine = lines[headerIndex] || '';
const delimiter = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');

const rows = parse(cleanContent, {
  columns: true,
  delimiter,
  skip_empty_lines: true,
  trim: true,
  relax_quotes: true,
  relax_column_count: true
});

console.log(`Read ${rows.length} rows for 2026-08-20 real report.`);

const findExistingPage = db.prepare(`
  SELECT id FROM pages 
  WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR name = ?
  LIMIT 1
`);

const updateExistingPage = db.prepare(`
  UPDATE pages SET 
    page_id = CASE WHEN ? != '' THEN ? ELSE page_id END,
    page_url = CASE WHEN ? != '' THEN ? ELSE page_url END,
    avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
    staff_name = CASE WHEN ? != 'Chưa phân bổ' THEN ? ELSE staff_name END,
    topic = CASE WHEN ? != 'Chưa phân loại' THEN ? ELSE topic END
  WHERE id = ?
`);

const insertNewPage = db.prepare(`
  INSERT INTO pages (name, category, page_id, page_url, avatar_url, staff_name, topic) 
  VALUES (?, 'Của tôi', ?, ?, ?, ?, ?)
`);

// Delete temporary copied 2026-08-20 placeholder metrics
db.prepare("DELETE FROM daily_metrics WHERE report_date = '2026-08-20'").run();

const insertMetric = db.prepare(`
  INSERT OR REPLACE INTO daily_metrics 
  (page_name, report_date, views, posts_per_day, post_count, interactions, engagement_rate, followers, source, raw_data)
  VALUES (?, '2026-08-20', ?, ?, ?, ?, ?, ?, 'Karma Report 2026-08-20 Real', ?)
`);

function parseKarmaNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const s = String(val).trim().replace(/\s/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const trx = db.transaction(() => {
  for (const r of rows) {
    const keys = Object.keys(r);
    const findKey = (candidates) => {
      for (const k of keys) {
        const cleanK = k.toLowerCase().replace(/[\s_\-\.\/\(\)\[\]\%]/g, '');
        for (const c of candidates) {
          if (cleanK === c || cleanK.includes(c)) return r[k];
        }
      }
      return null;
    };

    const pageName = findKey(['tênpage', 'tenpage', 'têntrang', 'tentrang', 'fanpage', 'pagename', 'page', 'profile', 'name', 'tên']);
    if (!pageName || pageName === 'Unknown Page') continue;

    const pageIdRaw = findKey(['profile-id', 'profileid', 'idpage', 'id page', 'pageid', 'page id', 'id', 'mãpage', 'mapage', 'fb id', 'fbid']);
    const avatarRaw = findKey(['imagelink', 'image', 'avatar', 'avatarurl', 'logo', 'ảnh']);
    const linkRaw = findKey(['link', 'urllink', 'url', 'profilelink']);
    const topicRaw = findKey(['chủđề', 'chude', 'chủde', 'topic', 'theme', 'niche', 'chuyênmục', 'chuyenmuc', 'ngành', 'lĩnhvực', 'linhvuc', 'category']);
    const staffRaw = findKey(['nhânsựphụtrách', 'nhansuphutrach', 'nhânsự', 'nhansu', 'ngườiphụtrách', 'nguoiphutrach', 'nhânviên', 'nhanvien', 'staff', 'owner', 'assignee', 'nv']);

    let pageId = '';
    let pageUrl = '';
    if (pageIdRaw && String(pageIdRaw).trim() !== '') {
      pageId = String(pageIdRaw).trim();
      pageUrl = `https://facebook.com/${pageId}`;
    } else if (linkRaw && String(linkRaw).trim() !== '') {
      const cleanLink = String(linkRaw).trim();
      const karmaMatch = cleanLink.match(/discovery\/[A-Z]+\/([0-9]+)/i);
      if (karmaMatch && karmaMatch[1]) {
        pageId = karmaMatch[1];
        pageUrl = `https://facebook.com/${pageId}`;
      } else if (cleanLink.startsWith('http')) {
        pageUrl = cleanLink;
      }
    }

    const views = Math.round(parseKarmaNumber(findKey(['dailyviews', 'videoviews', 'videoview', 'pageviews', 'views', 'view', 'lượt xem', 'impressions'])));
    const postCount = Math.round(parseKarmaNumber(findKey(['numberofposts', 'postcount', 'bàiđăng', 'sốbài', 'posts', 'anzahlposts'])));
    let postsPerDay = parseFloat(parseKarmaNumber(findKey(['postsperday', 'posts/day', 'bài/ngày', 'frequency', 'postperday', 'anzahlposts'])).toFixed(2));
    if (postsPerDay === 0 && postCount > 0) {
      postsPerDay = parseFloat((postCount / 7).toFixed(1));
    }

    const likes = Math.round(parseKarmaNumber(findKey(['numberoflikes', 'likes'])));
    const comments = Math.round(parseKarmaNumber(findKey(['numberofcomments', 'comments'])));
    let interactions = Math.round(parseKarmaNumber(findKey(['totalinteractions', 'interactions', 'tươngtác', 'engagement', 'reactions'])));
    if (interactions === 0 && (likes || comments)) interactions = likes + comments;

    let er = parseFloat(parseKarmaNumber(findKey(['postinteractionrate', 'interactionrate', 'engagementrate', 'pagerate', 'tỷlệtươngtác'])));
    if (er > 0 && er < 1) er = parseFloat((er * 100).toFixed(2));
    else er = parseFloat(er.toFixed(2));

    const followers = Math.round(parseKarmaNumber(findKey(['follower', 'followers', 'fans', 'ngườitheodõi', 'fan'])));
    const avatarUrl = avatarRaw ? String(avatarRaw).trim() : '';
    const finalTopic = topicRaw ? String(topicRaw).trim() : 'Chưa phân loại';
    const finalStaff = staffRaw ? String(staffRaw).trim() : 'Chưa phân bổ';

    const existing = findExistingPage.get(pageId || '', pageName);
    if (existing) {
      updateExistingPage.run(
        pageId || '', pageId || '',
        pageUrl || '', pageUrl || '',
        avatarUrl || '', avatarUrl || '',
        finalStaff, finalStaff,
        finalTopic, finalTopic,
        existing.id
      );
    } else {
      insertNewPage.run(pageName, pageId || '', pageUrl || '', avatarUrl || '', finalStaff, finalTopic);
    }

    insertMetric.run(pageName, views, postsPerDay, postCount, interactions, er, followers, JSON.stringify(r));
  }
});

trx();

console.log('=== REAL SUMMARY IN DATABASE ===');
console.log(db.prepare('SELECT report_date, COUNT(*) as pages_count, SUM(views) as total_views, SUM(post_count) as total_posts FROM daily_metrics GROUP BY report_date ORDER BY report_date DESC').all());
