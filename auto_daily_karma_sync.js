const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

// Setup log file
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'auto_karma_sync.log');

function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${timestamp}] ${msg}\n`;
  console.log(line.trim());
  try { fs.appendFileSync(logFile, line); } catch(e) {}
}

function parseKarmaNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  let str = String(val).trim().replace(/,/g, '');
  if (!str || str === '-') return 0;
  let mult = 1;
  if (str.toLowerCase().endsWith('k')) {
    mult = 1000;
    str = str.slice(0, -1);
  } else if (str.toLowerCase().endsWith('m')) {
    mult = 1000000;
    str = str.slice(0, -1);
  } else if (str.endsWith('%')) {
    str = str.slice(0, -1);
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num * mult;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sendWsMsg(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function ensureChromeCDP() {
  try {
    const tabs = await getJson('http://127.0.0.1:9222/json/list');
    if (Array.isArray(tabs)) {
      log('✅ Chrome CDP is already running on port 9222!');
      return true;
    }
  } catch (e) {}

  log('🚀 Launching Chrome in background with Profile 53 on port 9222...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const userDataDir = '/Users/maivanduc/Library/Application Support/Google/Chrome';
  
  const child = spawn(chromePath, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--profile-directory=Profile 53',
    '--headless=new',
    '--no-sandbox'
  ], { detached: true, stdio: 'ignore' });

  child.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const tabs = await getJson('http://127.0.0.1:9222/json/list');
      if (Array.isArray(tabs)) {
        log('✅ Chrome background process started successfully!');
        return true;
      }
    } catch (e) {}
  }
  throw new Error('Could not connect to Chrome CDP port 9222 after launching');
}

const pageDisambiguation = {
  '118064137953020': { name: 'Natural Cleansing', staff: 'Trần Thị Thuý Vy' },
  '104945032657502': { name: 'Natural Cleansing', staff: 'Nguyễn Anh Tú' },
  '351681954702992': { name: 'My Decor Style', staff: 'Phạm Thị Thanh Nga' }
};

async function syncKarma(targetDateStr) {
  log(`\n====================================================`);
  log(`⚡ SYNCING METRICS FOR ${targetDateStr} & TOP POSTS (LAST 30 DAYS)`);
  log(`====================================================`);

  const [yStr, mStr, dStr] = targetDateStr.split('-');
  const yYear = parseInt(yStr, 10);
  const yMonth = parseInt(mStr, 10) - 1;
  const yDay = parseInt(dStr, 10);

  const fromMs = Date.UTC(yYear, yMonth, yDay, 0, 0, 0);
  const toMs = Date.UTC(yYear, yMonth, yDay, 23, 59, 59, 999);

  // 30 Days window for Viral Posts
  const post30DaysFromMs = toMs - (30 * 24 * 60 * 60 * 1000) + 1;

  await ensureChromeCDP();

  let tabs = await getJson('http://127.0.0.1:9222/json/list');
  let karmaTab = tabs.find(t => t.url && t.url.includes('fanpagekarma') && t.type === 'page');
  if (!karmaTab) karmaTab = tabs.find(t => t.type === 'page');

  let wsUrl = karmaTab ? karmaTab.webSocketDebuggerUrl : null;
  if (!wsUrl) {
    const versionInfo = await getJson('http://127.0.0.1:9222/json/version');
    const browserWs = new WebSocket(versionInfo.webSocketDebuggerUrl);
    await new Promise(r => browserWs.on('open', r));
    const createRes = await sendWsMsg(browserWs, 'Target.createTarget', { url: 'about:blank' });
    browserWs.close();
    const targetId = createRes.result ? createRes.result.targetId : null;
    wsUrl = `ws://127.0.0.1:9222/devtools/page/${targetId}`;
  }

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));
  log('✅ Connected to Chrome CDP WebSocket!');

  // 1. EXTRACT REPORT 1: METRICS OVERVIEW (Daily Metrics for target date)
  const urlReport1 = `https://app.fanpagekarma.com/dashboard?h=Sf6fNa9Vm&tl0=ag5zfmZhbnBhZ2VrYXJtYXIcCxIPRGFzaGJvYXJkUmVwb3J0GICAwZrZvKEJDA&time=FREE&from=${fromMs}&to=${toMs}`;
  log(`🚀 Navigating to Report 1 (Metrics Overview): ${urlReport1}`);
  await sendWsMsg(ws, 'Page.navigate', { url: urlReport1 });
  await new Promise(r => setTimeout(r, 7000));

  // Check and click "Update now" if Karma data needs refresh
  await sendWsMsg(ws, 'Runtime.evaluate', {
    expression: `(function() {
      var btns = Array.from(document.querySelectorAll('button, a, div')).filter(function(el) {
        return el.innerText && el.innerText.trim() === 'Update now';
      });
      if (btns.length > 0) {
        btns[0].click();
        return true;
      }
      return false;
    })()`
  });
  await new Promise(r => setTimeout(r, 5000));

  const jsReport1 = `
  JSON.stringify((function() {
    var tables = Array.from(document.querySelectorAll('table'));
    var mainTable = tables.find(function(t) {
      var rows = t.querySelectorAll('tbody tr');
      if (rows.length < 40) return false;
      var firstRowCells = rows[0].querySelectorAll('td, th');
      return firstRowCells.length >= 8;
    });
    if (!mainTable) mainTable = tables.find(function(t) { return t.querySelectorAll('tbody tr').length >= 40; });
    if (!mainTable) return [];
    var rows = Array.from(mainTable.querySelectorAll('tbody tr'));
    return rows.map(function(r) {
      var cells = Array.from(r.querySelectorAll('td, th')).map(function(c) { return c.innerText.replace(/\\n/g, ' ').trim(); });
      var img = r.querySelector('img') ? r.querySelector('img').src : '';
      var link = r.querySelector('a[href*="discovery"]') ? r.querySelector('a[href*="discovery"]').href : '';
      var pageId = '';
      if (link) {
        var m = link.match(/discovery\\/[A-Z]+\\/([0-9]+)/i);
        if (m) pageId = m[1];
      }
      return { cells: cells, img: img, link: link, pageId: pageId };
    });
  })())
  `;
  const eval1 = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsReport1, returnByValue: true });
  const rawMetricsRows = JSON.parse(eval1.result.result.value || '[]');
  log(`📊 Extracted ${rawMetricsRows.length} raw metric rows from Fanpage Karma`);

  // 2. EXTRACT REPORT 2: VIRAL POSTS (Always 30-Day Window)
  const urlReport2 = `https://app.fanpagekarma.com/dashboard?h=Sf6fNa9Vm&tl0=ag5zfmZhbnBhZ2VrYXJtYXIcCxIPRGFzaGJvYXJkUmVwb3J0GICAwZrnkL8LDA&time=FREE&from=${post30DaysFromMs}&to=${toMs}`;
  log(`🚀 Navigating to Report 2 (Viral Posts 30 Ngày Qua): ${urlReport2}`);
  await sendWsMsg(ws, 'Page.navigate', { url: urlReport2 });
  await new Promise(r => setTimeout(r, 7000));

  // Scroll table to load all rows in Top 100 Posts table
  for (let s = 1; s <= 12; s++) {
    await sendWsMsg(ws, 'Runtime.evaluate', { expression: `
      (function() {
        let allHeaders = Array.from(document.querySelectorAll("*")).filter(el => el.innerText && el.innerText.trim() === "Top 100 Posts Overview");
        let container = null;
        for (let h of allHeaders) {
          let c = h.closest("div.dashboardsDashboard-chart, div.js-dashboard-chartContainer, div[class*='chart'], div.card") || h.parentElement.parentElement;
          if (c.querySelectorAll("tr").length >= 10) { container = c; break; }
        }
        if (container) {
          let tableBox = container.querySelector("div[class*='scroll'], div[class*='table'], table") || container;
          tableBox.scrollTop = tableBox.scrollHeight;
        }
        window.scrollTo(0, 1500 + ${s * 300});
      })()
    ` });
    await new Promise(r => setTimeout(r, 600));
  }

  const jsReport2 = `
  JSON.stringify((function() {
    let trs = Array.from(document.querySelectorAll("tr")).filter(r => r.querySelectorAll("a[href*='discovery']").length > 0 || r.querySelector("a[href*='facebook.com'], a[href*='reel'], a[href*='posts']") !== null);
    let extracted = [];
    let seenHrefs = new Set();

    for (let r of trs) {
      let cells = Array.from(r.querySelectorAll("td, th")).map(c => c.innerText.replace(/\\n/g, " ").trim());
      let discoveryLink = r.querySelector("a[href*='discovery']");
      let fbLink = r.querySelector("a[href*='facebook.com'], a[href*='reel'], a[href*='posts'], a[href*='permalink']");
      
      let postImgEl = r.querySelector("img.dashboardsPostsTabelle-postPicture") || r.querySelector("img[class*='postPicture']");
      if (!postImgEl) {
        let imgs = Array.from(r.querySelectorAll("img"));
        postImgEl = imgs.find(i => !i.className.includes("pagePicture")) || imgs[imgs.length - 1];
      }

      let href = fbLink ? fbLink.href : '';
      if (href && seenHrefs.has(href)) continue;
      if (href) seenHrefs.add(href);

      let pageId = '';
      if (discoveryLink && discoveryLink.href) {
        let m = discoveryLink.href.match(/discovery\\/[A-Z]+\\/([0-9]+)/i);
        if (m) pageId = m[1];
      }

      let pageName = '';
      if (discoveryLink) {
        pageName = discoveryLink.innerText.split('\\n')[0].trim();
      }

      if (!pageName && cells.length > 0) {
        let firstTxt = cells[0];
        let m = firstTxt.match(/^[0-9]+\\s+([A-Za-z0-9\\s&'-]+?)\\s+[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2}/);
        if (m) pageName = m[1].trim();
      }

      let dateEl = r.querySelector(".dashboardsPostsTabelle-postDate, span[class*='date']");
      let dateTxt = dateEl ? dateEl.innerText.trim() : "";
      if (!dateTxt && cells.length > 0) {
        let mDate = cells[0].match(/([0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2},?\\s+[0-9]{1,2}:[0-9]{2}\\s*(?:AM|PM)?)/i);
        if (mDate) dateTxt = mDate[1].trim();
      }

      let caption = fbLink ? fbLink.innerText.trim() : '';
      let thumbUrl = postImgEl ? postImgEl.src : '';

      extracted.push({
        page_name: pageName,
        page_id: pageId,
        post_url: href,
        message: caption,
        thumbnail_url: thumbUrl,
        published_at_raw: dateTxt,
        likes_raw: cells.length > 1 ? cells[1] : '0',
        comments_raw: cells.length > 2 ? cells[2] : '0',
        interactions_raw: cells.length > 3 ? cells[3] : '0',
        er_raw: cells.length > 4 ? cells[4] : '0',
        reach_raw: cells.length > 5 ? cells[5] : '0',
        ipi_raw: cells.length > 6 ? cells[6] : '0',
        negative_sentiment_raw: cells.length > 7 ? cells[7] : '0'
      });
    }
    return extracted;
  })())
  `;
  const eval2 = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsReport2, returnByValue: true });
  const rawPosts = JSON.parse(eval2.result.result.value || '[]');
  log(`🎯 Extracted ${rawPosts.length} post rows (Last 30 Days)`);

  ws.close();

  // Connect to local SQLite DB
  const dbPath = path.join(__dirname, 'crm_fanpage.db');
  const db = new Database(dbPath);

  const allPages = db.prepare('SELECT name, staff_name FROM pages UNION SELECT page_name as name, staff_name FROM master_pages').all();
  const staffMap = new Map();
  for (const p of allPages) {
    if (p.name && p.staff_name) staffMap.set(p.name.trim().toLowerCase(), p.staff_name);
  }

  function getStaff(pageId, pageName) {
    if (pageId && pageDisambiguation[pageId]) return pageDisambiguation[pageId].staff;
    const lower = (pageName || '').toLowerCase().trim();
    if (staffMap.has(lower)) return staffMap.get(lower);
    for (const [k, v] of staffMap.entries()) {
      if (lower.includes(k) || k.includes(lower)) return v;
    }
    return 'Chưa phân bổ';
  }

  // Insert Metrics
  const findExistingPage = db.prepare(`
    SELECT id, staff_name FROM pages 
    WHERE (page_id IS NOT NULL AND page_id != '' AND page_id = ?) OR name = ?
    LIMIT 1
  `);

  const updatePageStmt = db.prepare(`
    UPDATE pages SET 
      page_id = CASE WHEN ? != '' THEN ? ELSE page_id END,
      page_url = CASE WHEN ? != '' THEN ? ELSE page_url END,
      avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END
    WHERE id = ?
  `);

  db.prepare("DELETE FROM daily_metrics WHERE report_date = ?").run(targetDateStr);

  const insertMetricStmt = db.prepare(`
    INSERT INTO daily_metrics 
    (page_name, page_id, report_date, views, posts_per_day, post_count, interactions, engagement_rate, page_performance_index, followers, source, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Karma Auto Sync', ?)
  `);

  let countMetrics = 0;
  let totalViewsSum = 0;
  const metricsToSyncSupabase = [];

  const trxMetrics = db.transaction(() => {
    for (const r of rawMetricsRows) {
      const fullName = (r.cells[0] || '').trim();
      if (!fullName || fullName === 'Sum' || fullName.startsWith('http')) continue;
      let cleanName = fullName.split('@')[0].trim();
      const pageId = r.pageId || '';

      if (pageId && pageDisambiguation[pageId]) {
        cleanName = pageDisambiguation[pageId].name;
      }

      const followers = Math.round(parseKarmaNum(r.cells[1]));
      const postCount = Math.round(parseKarmaNum(r.cells[2]));
      const likes = Math.round(parseKarmaNum(r.cells[3]));
      const comments = Math.round(parseKarmaNum(r.cells[4]));
      let interactions = Math.round(parseKarmaNum(r.cells[3])) + Math.round(parseKarmaNum(r.cells[4]));
      const er = parseFloat(parseKarmaNum(r.cells[5]).toFixed(4));
      const ppi = Math.round(parseKarmaNum(r.cells[7]));
      const views = Math.round(parseKarmaNum(r.cells[8]));
      const postsPerDay = postCount;

      const pageUrl = pageId ? `https://facebook.com/${pageId}` : (r.link || '');
      const existingPage = findExistingPage.get(pageId, cleanName);
      if (existingPage) {
        updatePageStmt.run(pageId, pageId, pageUrl, pageUrl, r.img, r.img, existingPage.id);
      }

      insertMetricStmt.run(
        cleanName,
        pageId,
        targetDateStr,
        views,
        postsPerDay,
        postCount,
        interactions,
        er,
        ppi,
        followers,
        JSON.stringify(r)
      );

      metricsToSyncSupabase.push({
        page_name: cleanName,
        page_id: pageId,
        report_date: targetDateStr,
        views,
        posts_per_day: postsPerDay,
        post_count: postCount,
        interactions,
        engagement_rate: er,
        page_performance_index: ppi,
        followers,
        source: 'Karma Auto Sync',
        raw_data: r
      });

      countMetrics++;
      totalViewsSum += views;
    }
  });

  trxMetrics();
  log(`✅ Local SQLite updated: ${countMetrics} fanpages saved for ${targetDateStr} (Total Views: ${totalViewsSum.toLocaleString()})`);

  // Process Viral Posts (30 Days window)
  const postsToInsert = [];
  for (const r of rawPosts) {
    const pageId = r.page_id || '';
    let pageName = r.page_name || 'Unknown Page';
    if (pageId && pageDisambiguation[pageId]) pageName = pageDisambiguation[pageId].name;

    const likes = Math.round(parseKarmaNum(r.likes_raw));
    const comments = Math.round(parseKarmaNum(r.comments_raw));
    const interactions = Math.round(parseKarmaNum(r.interactions_raw)) || (likes + comments);
    const er = parseFloat(parseKarmaNum(r.er_raw).toFixed(4));
    const reach = Math.round(parseKarmaNum(r.reach_raw));
    const ipi = parseFloat(parseKarmaNum(r.ipi_raw).toFixed(4));
    const negSentiment = parseFloat(parseKarmaNum(r.negative_sentiment_raw).toFixed(2));
    const staff = getStaff(pageId, pageName);

    let postId = '';
    if (r.post_url) {
      const matchId = r.post_url.match(/(?:reel|posts|p)\/([0-9]+)/);
      if (matchId) postId = matchId[1];
    }

    let publishedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    if (r.published_at_raw) {
      try {
        const d = new Date(r.published_at_raw);
        if (!isNaN(d.getTime())) {
          publishedAt = d.toISOString().replace('T', ' ').substring(0, 19);
        }
      } catch(e) {}
    }

    postsToInsert.push({
      page_name: pageName,
      post_id: postId,
      post_url: r.post_url,
      message: r.message || 'Bài viết viral 30 ngày qua',
      thumbnail_url: r.thumbnail_url || '',
      media_type: r.post_url.includes('/reel/') ? 'reel' : 'post',
      published_at: publishedAt,
      likes,
      comments,
      shares: 0,
      interactions,
      interaction_rate: er,
      reach,
      interactions_per_impression: ipi,
      negative_sentiment_share: negSentiment,
      staff_name: staff,
      source: 'Top Viral Posts 30 Days'
    });
  }

  // Sort by reach descending and select Top 100
  postsToInsert.sort((a, b) => b.reach - a.reach);
  const topViralPosts = postsToInsert.slice(0, 100);

  db.prepare("DELETE FROM posts").run();

  const insertPostStmt = db.prepare(`
    INSERT INTO posts 
    (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let countPosts = 0;
  const trxPosts = db.transaction((items) => {
    for (const item of items) {
      insertPostStmt.run(
        item.page_name,
        item.post_id,
        item.post_url,
        item.message,
        item.thumbnail_url,
        item.media_type,
        item.published_at,
        item.likes,
        item.comments,
        item.shares,
        item.interactions,
        item.interaction_rate,
        item.reach,
        item.interactions_per_impression,
        item.negative_sentiment_share,
        item.staff_name,
        item.source
      );
      countPosts++;
    }
  });

  trxPosts(topViralPosts);
  db.pragma('wal_checkpoint(FULL)');
  log(`✅ Local SQLite updated: ${countPosts} Top Viral Posts (Last 30 Days) saved into CRM! (Top Reach: ${topViralPosts[0] ? topViralPosts[0].reach.toLocaleString() : 0})`);
}

async function main() {
  const argDate = process.argv[2];
  if (argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
    await syncKarma(argDate);
  } else {
    // Default to yesterday
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yYear = yesterday.getFullYear();
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yDay = String(yesterday.getDate()).padStart(2, '0');
    const dateStr = `${yYear}-${yMonth}-${yDay}`;
    await syncKarma(dateStr);
  }
  log('🎉 AUTOMATED SYNC COMPLETED SUCCESSFULLY!');
}

main().catch(err => {
  log(`❌ ERROR in auto_daily_karma_sync: ${err.message}\n${err.stack}`);
  process.exit(1);
});
