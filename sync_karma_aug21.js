const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const dbPath = path.join(__dirname, 'crm_fanpage.db');
const db = new Database(dbPath);

const SUPABASE_URL = 'https://eotcqkgfddvudzcbavaw.supabase.co';
const SUPABASE_KEY = 'sb_secret_Z54UkXInHPqAAYZXM02-8A_Ejucg2Tq';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] ${msg}`);
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

const pageDisambiguation = {
  '118064137953020': { name: 'Natural Cleansing', staff: 'Trần Thị Thuý Vy' },
  '104945032657502': { name: 'Natural Cleansing', staff: 'Nguyễn Anh Tú' },
  '351681954702992': { name: 'My Decor Style', staff: 'Phạm Thị Thanh Nga' }
};

async function main() {
  log('====================================================');
  log('⚡ SYNCING ACCURATE KARMA DATA FOR 2026-08-21');
  log('====================================================');

  const targetDate = '2026-08-21';
  const fromMs = Date.UTC(2026, 7, 21, 0, 0, 0);
  const toMs = Date.UTC(2026, 7, 21, 23, 59, 59, 999);

  const tabs = await getJson('http://127.0.0.1:9222/json/list');
  let karmaTab = tabs.find(t => t.url && t.url.includes('fanpagekarma') && t.type === 'page');
  if (!karmaTab) karmaTab = tabs.find(t => t.type === 'page');
  if (!karmaTab) throw new Error('No active browser tab found');

  const ws = new WebSocket(karmaTab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  // 1. EXTRACT METRICS OVERVIEW (Report 1)
  const urlReport1 = `https://app.fanpagekarma.com/dashboard?h=Sf6fNa9Vm&tl0=ag5zfmZhbnBhZ2VrYXJtYXIcCxIPRGFzaGJvYXJkUmVwb3J0GICAwZrZvKEJDA&time=FREE&from=${fromMs}&to=${toMs}`;
  log(`🚀 Navigating to Report 1 (Metrics Overview): ${urlReport1}`);
  await sendWsMsg(ws, 'Page.navigate', { url: urlReport1 });
  await new Promise(r => setTimeout(r, 7000));

  const jsReport1 = `
  JSON.stringify((function() {
    let tables = Array.from(document.querySelectorAll('table'));
    let mainTable = tables.find(t => t.querySelectorAll('tbody tr').length >= 40);
    if (!mainTable) return [];
    let rows = Array.from(mainTable.querySelectorAll('tbody tr'));
    return rows.map(r => {
      let cells = Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.replace(/\\n/g, ' ').trim());
      let img = r.querySelector('img')?.src || '';
      let link = r.querySelector('a[href*="discovery"]')?.href || '';
      let pageId = '';
      if (link) {
        let m = link.match(/discovery\\/[A-Z]+\\/([0-9]+)/i);
        if (m) pageId = m[1];
      }
      return { cells, img, link, pageId };
    });
  })())
  `;
  const eval1 = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsReport1, returnByValue: true });
  const rawMetricsRows = JSON.parse(eval1.result.result.value || '[]');
  log(`📊 Extracted ${rawMetricsRows.length} raw metric rows for 2026-08-21`);

  // 2. EXTRACT VIRAL POSTS (Report 2)
  const urlReport2 = `https://app.fanpagekarma.com/dashboard?h=Sf6fNa9Vm&tl0=ag5zfmZhbnBhZ2VrYXJtYXIcCxIPRGFzaGJvYXJkUmVwb3J0GICAwZrnkL8LDA&time=FREE&from=${fromMs}&to=${toMs}`;
  log(`🚀 Navigating to Report 2 (Viral Posts): ${urlReport2}`);
  await sendWsMsg(ws, 'Page.navigate', { url: urlReport2 });
  await new Promise(r => setTimeout(r, 7000));

  const jsReport2 = `
  JSON.stringify((function() {
    let trs = Array.from(document.querySelectorAll('tr')).filter(r => r.querySelectorAll('a[href*="discovery"]').length > 0);
    let extracted = [];
    let seenHrefs = new Set();

    for (let r of trs) {
      let cells = Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.replace(/\\n/g, ' ').trim());
      let discoveryLink = r.querySelector('a[href*="discovery"]');
      let fbLink = r.querySelector('a[href*="facebook.com"], a[href*="reel"], a[href*="posts"]');
      
      let postImgEl = r.querySelector('img.dashboardsPostsTabelle-postPicture') || r.querySelector('img[class*="postPicture"]');
      if (!postImgEl) {
        let imgs = Array.from(r.querySelectorAll('img'));
        postImgEl = imgs.find(i => !i.className.includes('pagePicture')) || imgs[imgs.length - 1];
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

      let caption = fbLink ? fbLink.innerText.trim() : '';
      let thumbUrl = postImgEl ? postImgEl.src : '';

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
  const eval2 = await sendWsMsg(ws, 'Runtime.evaluate', { expression: jsReport2, returnByValue: true });
  const rawPosts = JSON.parse(eval2.result.result.value || '[]');
  log(`🎯 Extracted ${rawPosts.length} post rows for 2026-08-21`);

  ws.close();

  // Load existing staff map
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

  // Process and save METRICS to SQLite
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

  db.prepare("DELETE FROM daily_metrics WHERE report_date = ?").run(targetDate);

  const insertMetricStmt = db.prepare(`
    INSERT INTO daily_metrics 
    (page_name, page_id, report_date, views, posts_per_day, post_count, interactions, engagement_rate, page_performance_index, followers, source, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Karma Sync 2026-08-21', ?)
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
        targetDate,
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
        report_date: targetDate,
        views,
        posts_per_day: postsPerDay,
        post_count: postCount,
        interactions,
        engagement_rate: er,
        page_performance_index: ppi,
        followers,
        source: 'Karma Sync 2026-08-21',
        raw_data: r
      });

      countMetrics++;
      totalViewsSum += views;
    }
  });

  trxMetrics();
  log(`✅ Local SQLite updated: ${countMetrics} fanpages for ${targetDate} (Total Views: ${totalViewsSum.toLocaleString()})`);

  // Process and save POSTS to SQLite
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

    postsToInsert.push({
      page_name: pageName,
      post_id: postId,
      post_url: r.post_url,
      message: r.message || 'Bài viết ngày 21/08/2026',
      thumbnail_url: r.thumbnail_url || '',
      media_type: r.post_url.includes('/reel/') ? 'reel' : 'post',
      published_at: '2026-08-21 12:00:00',
      likes,
      comments,
      shares: 0,
      interactions,
      interaction_rate: er,
      reach,
      interactions_per_impression: ipi,
      negative_sentiment_share: negSentiment,
      staff_name: staff,
      source: 'Aug 21 Scrape'
    });
  }

  postsToInsert.sort((a, b) => b.reach - a.reach);
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

  trxPosts(postsToInsert);
  db.pragma('wal_checkpoint(FULL)');
  log(`✅ Local SQLite updated: ${countPosts} viral posts saved for ${targetDate}`);

  // Sync to Supabase Cloud Database
  try {
    const { error: delErr } = await supabase.from('daily_metrics').delete().eq('report_date', targetDate);
    const { error: insErr } = await supabase.from('daily_metrics').insert(metricsToSyncSupabase);
    if (insErr) {
      log(`⚠️ Supabase Cloud daily_metrics sync error: ${insErr.message}`);
    } else {
      log(`☁️ Supabase Cloud daily_metrics synced successfully: ${metricsToSyncSupabase.length} records!`);
    }

    const { error: postDelErr } = await supabase.from('posts').delete().neq('id', 0);
    const { error: postInsErr } = await supabase.from('posts').insert(postsToInsert);
    if (postInsErr) {
      log(`⚠️ Supabase Cloud posts sync error: ${postInsErr.message}`);
    } else {
      log(`☁️ Supabase Cloud posts synced successfully: ${postsToInsert.length} records!`);
    }
  } catch (errSupabase) {
    log(`⚠️ Supabase sync exception: ${errSupabase.message}`);
  }

  log('🎉 SYNC COMPLETED SUCCESSFULLY FOR 2026-08-21!');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
