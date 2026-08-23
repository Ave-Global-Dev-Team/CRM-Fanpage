const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const dbPath = path.join(__dirname, 'crm_fanpage.db');
const db = new Database(dbPath);

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
  return isNaN(num) ? 0 : Math.round(num * mult);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
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

async function main() {
  console.log('🚀 Extracting exact Fanpage Views & Posts for 2026-08-21...');

  const tabs = await getJson('http://127.0.0.1:9222/json/list');
  let karmaTab = tabs.find(t => t.url && t.url.includes('fanpagekarma') && t.type === 'page');
  if (!karmaTab) karmaTab = tabs.find(t => t.type === 'page');
  if (!karmaTab) {
    console.error('❌ No active tab in Chrome!');
    process.exit(1);
  }

  const wsUrl = karmaTab.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  await new Promise(r => ws.on('open', r));
  console.log('✅ Connected to Chrome CDP WebSocket!');

  // Extraction JS script
  const jsExtract = `
  JSON.stringify((function() {
    let trs = Array.from(document.querySelectorAll("tr")).filter(r => r.querySelectorAll("a[href*='discovery']").length > 0);
    
    let extracted = [];
    let seenHrefs = new Set();

    for (let r of trs) {
      let cells = Array.from(r.querySelectorAll("td, th")).map(c => c.innerText.replace(/\\n/g, " ").trim());
      let discoveryLink = r.querySelector("a[href*='discovery']");
      let fbLink = r.querySelector("a[href*='facebook.com'], a[href*='reel'], a[href*='posts']");
      
      // Post Thumbnail Image vs Page Avatar
      let postImgEl = r.querySelector("img.dashboardsPostsTabelle-postPicture") || r.querySelector("img[class*='postPicture']");
      if (!postImgEl) {
        let imgs = Array.from(r.querySelectorAll("img"));
        postImgEl = imgs.find(i => !i.className.includes("pagePicture")) || imgs[imgs.length - 1];
      }

      let href = fbLink ? fbLink.href : "";
      if (href && seenHrefs.has(href)) continue;
      if (href) seenHrefs.add(href);

      let pageId = "";
      if (discoveryLink && discoveryLink.href) {
        let m = discoveryLink.href.match(/discovery\\/[A-Z]+\\/([0-9]+)/i);
        if (m) pageId = m[1];
      }

      let pageName = "";
      if (discoveryLink) {
        pageName = discoveryLink.innerText.split("\\n")[0].trim();
      }
      if (!pageName && cells.length > 0) {
        let mName = cells[0].match(/^[0-9]+\\s+([A-Za-z0-9\\s&'-]+?)\\s+[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2}/);
        if (mName) pageName = mName[1].trim();
      }

      let caption = fbLink ? fbLink.innerText.trim() : "";
      let thumbUrl = postImgEl ? postImgEl.src : "";

      extracted.push({
        page_name: pageName,
        page_id: pageId,
        post_url: href,
        message: caption,
        thumbnail_url: thumbUrl,
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

  const evalRes = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsExtract, returnByValue: true });
  const rawPosts = JSON.parse(evalRes.result.result.value || '[]');
  console.log(`🎯 Extracted ${rawPosts.length} post rows for 2026-08-21!`);

  ws.close();

  if (rawPosts.length === 0) {
    console.error('❌ No posts extracted!');
    process.exit(1);
  }

  // Map staff & disambiguate duplicate page names
  const pageDisambiguation = {
    '118064137953020': { name: 'Natural Cleansing', staff: 'Trần Thị Thuý Vy' },
    '104945032657502': { name: 'Natural Cleansing', staff: 'Nguyễn Anh Tú' },
    '351681954702992': { name: 'My Decor Style', staff: 'Phạm Thị Thanh Nga' }
  };

  const allPages = db.prepare('SELECT name, staff_name FROM pages UNION SELECT page_name as name, staff_name FROM master_pages').all();
  const staffMap = new Map();
  for (const p of allPages) {
    if (p.name && p.staff_name) staffMap.set(p.name.trim().toLowerCase(), p.staff_name);
  }

  // Aggregate daily metrics per page for 2026-08-21
  const pageMetricsAgg = new Map();
  const postsToInsert = [];

  for (const r of rawPosts) {
    const pageId = r.page_id || '';
    let pageName = r.page_name || 'Unknown Page';

    if (pageId && pageDisambiguation[pageId]) {
      pageName = pageDisambiguation[pageId].name;
    }

    const likes = parseKarmaNum(r.likes_raw);
    const comments = parseKarmaNum(r.comments_raw);
    const interactions = parseKarmaNum(r.interactions_raw) || (likes + comments);
    const er = parseKarmaNum(r.er_raw);
    const reach = parseKarmaNum(r.reach_raw);
    const ipi = parseKarmaNum(r.ipi_raw);
    const negSentiment = parseKarmaNum(r.negative_sentiment_raw);

    let matchedStaff = 'Chưa phân bổ';
    if (pageId && pageDisambiguation[pageId]) {
      matchedStaff = pageDisambiguation[pageId].staff;
    } else if (staffMap.has(pageName.toLowerCase())) {
      matchedStaff = staffMap.get(pageName.toLowerCase());
    } else {
      for (const [pName, sName] of staffMap.entries()) {
        if (pageName.toLowerCase().includes(pName) || pName.includes(pageName.toLowerCase())) {
          matchedStaff = sName;
          break;
        }
      }
    }

    let postId = '';
    if (r.post_url) {
      const matchId = r.post_url.match(/(?:reel|posts|p)\/([0-9]+)/);
      if (matchId) postId = matchId[1];
    }

    postsToInsert.push({
      page_name: pageName,
      post_id: postId,
      post_url: r.post_url,
      message: r.message || 'Bài viết ngày 21/08/2026',
      thumbnail_url: r.thumbnail_url || '',
      media_type: r.post_url.includes('/reel/') ? 'reel' : 'post',
      published_at: '2026-08-21 12:00:00',
      likes: likes,
      comments: comments,
      shares: 0,
      interactions: interactions,
      interaction_rate: er,
      reach: reach,
      interactions_per_impression: ipi,
      negative_sentiment_share: negSentiment,
      staff_name: matchedStaff,
      source: 'Aug 21 Scrape'
    });

    // Aggregate page metrics
    const key = pageId || pageName;
    if (!pageMetricsAgg.has(key)) {
      pageMetricsAgg.set(key, {
        page_name: pageName,
        page_id: pageId,
        views: 0,
        post_count: 0,
        interactions: 0,
        max_er: 0,
        staff_name: matchedStaff
      });
    }

    const agg = pageMetricsAgg.get(key);
    agg.views += reach;
    agg.post_count += 1;
    agg.interactions += interactions;
    if (er > agg.max_er) agg.max_er = er;
  }

  // Delete existing 2026-08-21 records before re-inserting
  db.prepare("DELETE FROM daily_metrics WHERE report_date = '2026-08-21'").run();

  const insertMetricStmt = db.prepare(`
    INSERT INTO daily_metrics 
    (page_name, page_id, report_date, views, posts_per_day, post_count, interactions, engagement_rate, page_performance_index, followers, source)
    VALUES (?, ?, '2026-08-21', ?, ?, ?, ?, ?, 0, 0, 'Karma Scrape Aug 21')
  `);

  let countMetrics = 0;
  let totalViewsSum = 0;

  for (const [key, agg] of pageMetricsAgg.entries()) {
    insertMetricStmt.run(
      agg.page_name,
      agg.page_id,
      agg.views,
      agg.post_count,
      agg.post_count,
      agg.interactions,
      agg.max_er
    );
    countMetrics++;
    totalViewsSum += agg.views;
  }

  // Sort posts by reach descending
  postsToInsert.sort((a, b) => b.reach - a.reach);
  const top100Reach = postsToInsert.slice(0, 100);

  db.prepare("DELETE FROM posts").run();

  const insertPostStmt = db.prepare(`
    INSERT INTO posts 
    (page_name, post_id, post_url, message, thumbnail_url, media_type, published_at, likes, comments, shares, interactions, interaction_rate, reach, interactions_per_impression, negative_sentiment_share, staff_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let countPosts = 0;
  const insertManyPosts = db.transaction((rows) => {
    for (const item of rows) {
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

  insertManyPosts(top100Reach);

  // WAL checkpoint FULL
  db.pragma('wal_checkpoint(FULL)');
  console.log(`✅ Updated daily_metrics: ${countMetrics} pages saved for 2026-08-21 (Total Views: ${totalViewsSum.toLocaleString()})`);
  console.log(`✅ Updated posts table: ${countPosts} viral posts saved for 2026-08-21 (Top Reach: ${top100Reach[0] ? top100Reach[0].reach : 0})`);

  console.log('\n🎉 Complete! 2026-08-21 Fanpage Views & Posts updated on CRM!');
}

main().catch(err => console.error('Error:', err));
